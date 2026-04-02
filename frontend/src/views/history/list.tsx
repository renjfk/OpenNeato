import { useCallback, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import boltSvg from "../../assets/icons/bolt.svg?raw";
import clockSvg from "../../assets/icons/clock.svg?raw";
import downloadSvg from "../../assets/icons/download.svg?raw";
import trashSvg from "../../assets/icons/trash.svg?raw";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Icon } from "../../components/icon";
import type { HistoryFileInfo, MapSession, MapSummary } from "../../types";
import { formatDate, formatDuration, modeInfo } from "./helpers";

// Session card component
interface SessionCardProps {
    session: MapSession | null;
    summary: MapSummary | null;
    filename: string;
    index: number;
    active?: boolean;
    onSelect: (i: number) => void;
    onDelete: (i: number) => void;
}

function SessionCard({ session, summary, filename, index, active, onSelect, onDelete }: SessionCardProps) {
    const info = modeInfo(session?.mode ?? "");
    return (
        <div class={`history-session-row${active ? " running" : ""}`}>
            <button type="button" class="history-session-card" onClick={() => onSelect(index)}>
                <div class="history-session-icon">
                    <Icon svg={info.icon} />
                </div>
                <div class="history-session-body">
                    <div class="history-session-header">
                        <span class="history-session-mode">
                            {info.label}
                            {active && <span class="history-running-badge">Running</span>}
                        </span>
                        <span class="history-session-date">{session ? formatDate(session.time) : ""}</span>
                    </div>
                    {summary && (
                        <div class="history-session-stats">
                            <span>
                                <Icon svg={clockSvg} />
                                {formatDuration(summary.duration)}
                            </span>
                            <span>{summary.distanceTraveled.toFixed(1)}m</span>
                            <span>{summary.areaCovered.toFixed(1)}m&sup2;</span>
                            <span>
                                <Icon svg={boltSvg} />
                                {session?.battery ?? "?"}% &rarr; {summary.batteryEnd ?? "?"}%
                            </span>
                        </div>
                    )}
                    {active && !summary && (
                        <div class="history-session-stats">
                            <span>
                                <Icon svg={boltSvg} />
                                {session?.battery ?? "?"}%
                            </span>
                        </div>
                    )}
                </div>
                <span class="history-session-chevron">&rsaquo;</span>
            </button>
            {!active && (
                <a
                    class="history-session-download"
                    href={`/api/history/${filename}`}
                    download={filename.replace(/\.hs$/, "")}
                    aria-label="Download session"
                >
                    <Icon svg={downloadSvg} />
                </a>
            )}
            {!active && (
                <button
                    type="button"
                    class="history-session-delete"
                    onClick={() => onDelete(index)}
                    aria-label="Delete session"
                >
                    <Icon svg={trashSvg} />
                </button>
            )}
        </div>
    );
}

interface HistoryListViewProps {
    files: HistoryFileInfo[];
    hasRecording: boolean;
    deleting: boolean;
    onSelect: (idx: number) => void;
    onDeleteSession: (idx: number) => void;
    onDeleteAll: () => void;
    onImported: () => void;
    onError: (msg: string) => void;
}

type ImportStatus = "idle" | "uploading" | "done" | "error";

export function HistoryListView({
    files,
    hasRecording,
    deleting,
    onSelect,
    onDeleteSession,
    onDeleteAll,
    onImported,
    onError,
}: HistoryListViewProps) {
    const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
    const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleConfirmDelete = useCallback(() => {
        if (!confirmTarget) return;
        if (confirmTarget === "__all__") {
            onDeleteAll();
        } else {
            const idx = Number.parseInt(confirmTarget.replace("session-", ""), 10);
            onDeleteSession(idx);
        }
        setConfirmTarget(null);
    }, [confirmTarget, onDeleteAll, onDeleteSession]);

    const handleImportFile = useCallback(
        async (file: File) => {
            if (!file.name.endsWith(".jsonl")) {
                onError("Invalid file: expected a .jsonl session file");
                return;
            }

            // 256 KB limit — matches firmware HISTORY_IMPORT_MAX_BYTES
            if (file.size > 256 * 1024) {
                onError("File too large (max 256 KB)");
                return;
            }

            // Validate session header matches filename before uploading
            try {
                const head = await file.slice(0, 512).text();
                const firstLine = head.split("\n")[0];
                const header = JSON.parse(firstLine);
                if (header.type !== "session") {
                    onError("Invalid file: first line must be a session header");
                    return;
                }
                const fileEpoch = file.name.replace(".jsonl", "");
                if (header.time !== undefined && String(header.time) !== fileEpoch) {
                    onError("Session timestamp does not match filename");
                    return;
                }
            } catch {
                onError("Invalid file: could not parse session header");
                return;
            }

            // Check for duplicate in current list
            const importedName = `${file.name}.hs`;
            if (files.some((f) => f.name === importedName || f.name === file.name)) {
                onError("Session already exists");
                return;
            }

            setImportStatus("uploading");
            api.importSession(file, () => {})
                .then(() => {
                    setImportStatus("done");
                    onImported();
                    setTimeout(() => setImportStatus("idle"), 1500);
                })
                .catch((e: unknown) => {
                    setImportStatus("error");
                    onError(e instanceof Error ? e.message : "Import failed");
                    setTimeout(() => setImportStatus("idle"), 2000);
                })
                .finally(() => {
                    if (fileInputRef.current) fileInputRef.current.value = "";
                });
        },
        [files, onImported, onError],
    );

    return (
        <>
            {/* Summary bar */}
            <div class="history-summary">
                <span>
                    {files.length} session{files.length !== 1 ? "s" : ""}
                    {hasRecording ? " · Running..." : ""}
                </span>
                <div class="history-summary-actions">
                    <label class="history-import-label">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".jsonl"
                            class="history-import-input"
                            disabled={importStatus === "uploading"}
                            onChange={(e) => {
                                const f = (e.target as HTMLInputElement).files?.[0];
                                if (f) handleImportFile(f);
                            }}
                        />
                        <span class={`history-import-btn${importStatus === "uploading" ? " pending" : ""}`}>
                            {importStatus === "uploading"
                                ? "Importing..."
                                : importStatus === "done"
                                  ? "Imported"
                                  : "Import"}
                        </span>
                    </label>
                    <button
                        type="button"
                        class={`history-delete-all-btn${deleting ? " pending" : ""}`}
                        onClick={() => setConfirmTarget("__all__")}
                        disabled={deleting}
                    >
                        Delete All
                    </button>
                </div>
            </div>

            {files.length === 0 && <div class="history-empty">No cleaning history yet</div>}

            {/* Session cards */}
            {files.map((f, i) => (
                <SessionCard
                    key={f.session?.time ?? i}
                    session={f.session}
                    summary={f.summary}
                    filename={f.name}
                    index={i}
                    active={f.recording}
                    onSelect={onSelect}
                    onDelete={() => setConfirmTarget(`session-${i}`)}
                />
            ))}

            {confirmTarget && (
                <ConfirmDialog
                    message={confirmTarget === "__all__" ? "Delete all map data?" : "Delete this session?"}
                    confirmLabel="Delete"
                    disabled={deleting}
                    onConfirm={handleConfirmDelete}
                    onCancel={() => setConfirmTarget(null)}
                />
            )}
        </>
    );
}
