import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { ErrorStackHandle } from "../../components/error-banner";
import { md5 } from "../../md5";
import { sha256 } from "../../sha256";

type UploadStatus = "idle" | "hashing" | "uploading" | "done";

// Checksum verification result after comparing firmware SHA-256 against checksums.txt.
// "match" = firmware hash found and matches, "mismatch" = found but different,
// "not-found" = checksums file loaded but firmware filename not in it.
type ChecksumResult = "match" | "mismatch" | "not-found";

// ESP32 image header: byte at offset 12 (extended header) contains chip ID.
// Mapping from ESP-IDF esp_image_format.h:
const CHIP_IDS: Record<number, string> = {
    0: "ESP32",
    2: "ESP32-S2",
    5: "ESP32-C3",
    9: "ESP32-S3",
    12: "ESP32-C2",
    13: "ESP32-C6",
    16: "ESP32-H2",
};

function parseChipFromBin(buf: ArrayBuffer): string | null {
    if (buf.byteLength < 16) return null;
    const view = new DataView(buf);
    // Extended header starts at offset 8; chip ID is at byte 4 of extended header = offset 12
    const chipId = view.getUint8(12) & 0xff;
    return CHIP_IDS[chipId] ?? null;
}

// Build the canonical release firmware filename from chip name detected in the binary header.
// e.g. "ESP32-C3" -> "openneato-esp32-c3-firmware.bin", "ESP32" -> "openneato-esp32-firmware.bin".
// This avoids relying on the user-provided filename which may be renamed by the OS (e.g. appending "(1)").
function canonicalFirmwareName(chip: string): string {
    return `openneato-${chip.toLowerCase()}-firmware.bin`;
}

// Parse GoReleaser checksums.txt format: "<sha256hex>  <filename>\n" per line.
// Returns a map of lowercase filename -> lowercase sha256 hex.
function parseChecksums(text: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // GoReleaser format: "hash  filename" (two spaces between)
        const match = trimmed.match(/^([0-9a-fA-F]{64})\s+(.+)$/);
        if (match) {
            map.set(match[2].trim().toLowerCase(), match[1].toLowerCase());
        }
    }
    return map;
}

// Verify firmware file SHA-256 against a parsed checksums map.
function verifyChecksum(checksums: Map<string, string>, firmwareName: string, sha256: string): ChecksumResult {
    const expected = checksums.get(firmwareName.toLowerCase());
    if (expected === undefined) return "not-found";
    return expected === sha256.toLowerCase() ? "match" : "mismatch";
}

export function useFirmwareUpload(
    deviceChip: string | null,
    errorStack: ErrorStackHandle,
    startRebootFlow: () => void,
) {
    const [file, setFile] = useState<File | null>(null);
    const [chipError, setChipError] = useState<string | null>(null);
    const [checksumResult, setChecksumResult] = useState<ChecksumResult | null>(null);
    const [checksumFile, setChecksumFile] = useState<File | null>(null);
    const [status, setStatus] = useState<UploadStatus>("idle");

    // Parsed checksums map, kept in ref to avoid re-renders.
    const checksumsMap = useRef<Map<string, string> | null>(null);

    // Smoothed progress: XHR fires progress in big jumps (browser buffers writes),
    // so we animate the displayed value toward the real target at a steady rate.
    const [displayProgress, setDisplayProgress] = useState(0);
    const realProgress = useRef(0);
    const animTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopProgressAnim = useCallback(() => {
        if (animTimer.current) {
            clearInterval(animTimer.current);
            animTimer.current = null;
        }
    }, []);

    const startProgressAnim = useCallback(() => {
        stopProgressAnim();
        realProgress.current = 0;
        setDisplayProgress(0);
        animTimer.current = setInterval(() => {
            setDisplayProgress((prev) => {
                const target = realProgress.current;
                if (prev >= target) return prev;
                // Close gap by ~15% each tick, minimum 1% step
                const step = Math.max(1, Math.round((target - prev) * 0.15));
                return Math.min(target, prev + step);
            });
        }, 100);
    }, [stopProgressAnim]);

    useEffect(() => stopProgressAnim, [stopProgressAnim]);

    const onUploadProgress = useCallback((pct: number) => {
        // Cap at 90% during upload — the last 10% represents server-side flash
        // write + verification. Jumps to 100% only when the server responds OK.
        realProgress.current = Math.min(90, pct);
    }, []);

    const selectFile = useCallback(
        (f: File | null) => {
            setFile(f);
            setChipError(null);
            setChecksumResult(null);
            setStatus("idle");
            setDisplayProgress(0);
            stopProgressAnim();

            if (!f || !deviceChip) return;

            // Read first 16 bytes to check chip type
            const reader = new FileReader();
            reader.onload = () => {
                const buf = reader.result as ArrayBuffer;
                const binChip = parseChipFromBin(buf);
                if (!binChip) {
                    setChipError("Could not detect chip type from firmware file");
                    return;
                }
                // Normalize comparison: device reports "ESP32-C3", bin header gives "ESP32-C3"
                if (binChip.toLowerCase() !== deviceChip.toLowerCase()) {
                    setChipError(`Firmware is for ${binChip}, but this device is ${deviceChip}`);
                }
            };
            reader.readAsArrayBuffer(f.slice(0, 16));

            // If checksums already loaded, verify against new firmware file
            if (checksumsMap.current) {
                verifyFirmwareFile(f, checksumsMap.current);
            }
        },
        [deviceChip, stopProgressAnim],
    );

    // Compute SHA-256 of firmware file and check against loaded checksums.
    // Uses pure-JS sha256 — crypto.subtle is unavailable over plain HTTP (non-secure context).
    // Looks up by canonical release filename derived from the chip ID in the binary header,
    // so renamed files (e.g. "firmware(1).bin") still match.
    const verifyFirmwareFile = useCallback(async (fw: File, checksums: Map<string, string>) => {
        const buf = await fw.arrayBuffer();
        const hash = sha256(buf);
        const chip = parseChipFromBin(buf);
        const lookupName = chip ? canonicalFirmwareName(chip) : fw.name;
        setChecksumResult(verifyChecksum(checksums, lookupName, hash));
    }, []);

    const selectChecksumFile = useCallback(
        async (f: File | null) => {
            if (!f) {
                setChecksumFile(null);
                checksumsMap.current = null;
                setChecksumResult(null);
                return;
            }

            const text = await f.text();
            const parsed = parseChecksums(text);
            if (parsed.size === 0) {
                errorStack.push("Could not parse checksums file — expected GoReleaser checksums.txt format");
                return;
            }

            setChecksumFile(f);
            checksumsMap.current = parsed;

            // If firmware file already selected, verify immediately
            if (file) {
                await verifyFirmwareFile(file, parsed);
            }
        },
        [file, errorStack, verifyFirmwareFile],
    );

    const startUpload = useCallback(async () => {
        if (!file) return;

        try {
            setStatus("hashing");
            const buf = await file.arrayBuffer();
            const fileMd5 = md5(buf);

            setStatus("uploading");
            startProgressAnim();
            await api.uploadFirmware(file, fileMd5, onUploadProgress);

            stopProgressAnim();
            setDisplayProgress(100);
            setStatus("done");
            startRebootFlow();
        } catch (e: unknown) {
            stopProgressAnim();
            setStatus("idle");
            errorStack.push(e instanceof Error ? e.message : "Firmware upload failed");
        }
    }, [file, errorStack, startRebootFlow, startProgressAnim, stopProgressAnim, onUploadProgress]);

    // Upload blocked only on chip mismatch or checksum mismatch.
    const checksumVerified = checksumResult === "match";
    const canUpload = !!file && !chipError && checksumResult !== "mismatch";

    return {
        file,
        chipError,
        checksumFile,
        checksumResult,
        checksumVerified,
        canUpload,
        status,
        progress: displayProgress,
        selectFile,
        selectChecksumFile,
        startUpload,
    };
}
