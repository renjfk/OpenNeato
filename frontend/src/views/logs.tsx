import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import alertSvg from "../assets/icons/alert.svg?raw";
import backSvg from "../assets/icons/back.svg?raw";
import databaseSvg from "../assets/icons/database.svg?raw";
import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate, usePath } from "../components/router";
import type { LogFileInfo } from "../types";

// -- Helpers --

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

function filenameToDate(name: string): string {
    if (name === "current.jsonl") return "Active";
    // Filenames like "1700000000.jsonl.hs" — epoch prefix
    const match = name.match(/^(\d+)\./);
    if (match) {
        const epoch = parseInt(match[1], 10);
        const d = new Date(epoch * 1000);
        const mon = (d.getMonth() + 1).toString().padStart(2, "0");
        const day = d.getDate().toString().padStart(2, "0");
        const h = d.getHours().toString().padStart(2, "0");
        const m = d.getMinutes().toString().padStart(2, "0");
        return `${mon}/${day} ${h}:${m}`;
    }
    return name;
}

// Type badge for log entries
function typeBadge(type: string): { label: string; color: string } {
    switch (type) {
        case "boot":
            return { label: "BOOT", color: "blue" };
        case "wifi":
            return { label: "WIFI", color: "green" };
        case "ntp":
            return { label: "NTP", color: "green" };
        case "command":
            return { label: "CMD", color: "amber" };
        case "request":
            return { label: "HTTP", color: "amber" };
        case "event":
            return { label: "EVT", color: "red" };
        case "ota":
            return { label: "OTA", color: "blue" };
        default:
            return { label: type.toUpperCase().slice(0, 4), color: "dim" };
    }
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts * 1000);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    const s = d.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function parseLogLine(line: string): { ts: number; type: string; summary: string } | null {
    try {
        const obj = JSON.parse(line);
        const ts = obj.ts ?? 0;
        const type = obj.type ?? "?";
        // Build a human-readable summary from remaining fields
        const parts: string[] = [];
        for (const [k, v] of Object.entries(obj)) {
            if (k === "ts" || k === "type") continue;
            parts.push(`${k}=${v}`);
        }
        return { ts, type, summary: parts.join(" ") };
    } catch {
        return null;
    }
}

// -- Component --

export function LogsView() {
    const navigate = useNavigate();
    const path = usePath();

    // Derive view mode from URL: /logs = list, /logs/filename = detail
    const selectedFile = path.startsWith("/logs/") ? decodeURIComponent(path.slice(6)) : null;
    const isDetail = selectedFile !== null;

    const [files, setFiles] = useState<LogFileInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [errors, errorStack] = useErrorStack();

    // Detail view state
    const [logLines, setLogLines] = useState<ReturnType<typeof parseLogLine>[]>([]);
    const [loadingContent, setLoadingContent] = useState(false);

    // Deleting state
    const [deleting, setDeleting] = useState<string | null>(null);
    const [deletingAll, setDeletingAll] = useState(false);

    // Confirm dialog state
    const [confirmTarget, setConfirmTarget] = useState<string | null>(null); // filename or "__all__"

    const fetchFiles = useCallback(() => {
        setLoading(true);
        api.getLogs()
            .then((data) => {
                setFiles(data);
                setLoading(false);
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to load logs");
                setLoading(false);
            });
    }, [errorStack]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    // Fetch log content when selectedFile changes
    useEffect(() => {
        if (!selectedFile) {
            setLogLines([]);
            return;
        }
        setLoadingContent(true);
        setLogLines([]);
        api.getLogContent(selectedFile)
            .then((text) => {
                const lines = text
                    .split("\n")
                    .filter((l) => l.trim())
                    .map(parseLogLine)
                    .filter((l): l is NonNullable<typeof l> => l !== null);
                setLogLines(lines);
                setLoadingContent(false);
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to load log");
                setLoadingContent(false);
            });
    }, [selectedFile]);

    const confirmDelete = useCallback(() => {
        if (!confirmTarget) return;
        setConfirmTarget(null);

        if (confirmTarget === "__all__") {
            setDeletingAll(true);
            api.deleteAllLogs()
                .then(() => {
                    setFiles([]);
                    navigate("/logs");
                })
                .catch((e: unknown) => {
                    errorStack.push(e instanceof Error ? e.message : "Failed to delete logs");
                })
                .finally(() => setDeletingAll(false));
        } else {
            const name = confirmTarget;
            setDeleting(name);
            api.deleteLog(name)
                .then(() => {
                    setFiles((prev) => prev.filter((f) => f.name !== name));
                    if (selectedFile === name) {
                        navigate("/logs");
                    }
                })
                .catch((e: unknown) => {
                    errorStack.push(e instanceof Error ? e.message : "Failed to delete log");
                })
                .finally(() => setDeleting(null));
        }
    }, [confirmTarget, selectedFile, navigate, errorStack]);

    const handleBack = useCallback(() => {
        if (isDetail) {
            navigate("/logs");
            errorStack.clear();
        } else {
            navigate("/settings");
        }
    }, [isDetail, navigate, errorStack]);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={handleBack} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>{isDetail && selectedFile ? selectedFile : "Logs"}</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="logs-page">
                {!isDetail && (
                    <>
                        {/* Summary bar */}
                        {!loading && files.length > 0 && (
                            <div class="logs-summary">
                                <span>
                                    {files.length} file{files.length !== 1 ? "s" : ""} &middot; {formatBytes(totalSize)}
                                </span>
                                <button
                                    type="button"
                                    class={`logs-delete-all-btn${deletingAll ? " pending" : ""}`}
                                    onClick={() => setConfirmTarget("__all__")}
                                    disabled={deletingAll}
                                >
                                    Delete All
                                </button>
                            </div>
                        )}

                        {/* File list */}
                        {loading && <div class="logs-empty">Loading...</div>}

                        {!loading && files.length === 0 && errors.length === 0 && (
                            <div class="logs-empty">
                                <Icon svg={databaseSvg} />
                                No log files
                            </div>
                        )}

                        {!loading && (
                            <div class="logs-file-list">
                                {files.map((f) => (
                                    <div class="logs-file-row" key={f.name}>
                                        <button
                                            type="button"
                                            class="logs-file-info"
                                            onClick={() => navigate(`/logs/${f.name}`)}
                                        >
                                            <div class="logs-file-name">{f.name}</div>
                                            <div class="logs-file-meta">
                                                {filenameToDate(f.name)} &middot; {formatBytes(f.size)}
                                                {f.compressed && <> &middot; compressed</>}
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            class={`logs-file-delete${deleting === f.name ? " pending" : ""}`}
                                            onClick={() => setConfirmTarget(f.name)}
                                            disabled={deleting === f.name}
                                            aria-label={`Delete ${f.name}`}
                                        >
                                            <Icon svg={alertSvg} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {isDetail && (
                    <>
                        {loadingContent && <div class="logs-empty">Loading...</div>}

                        {!loadingContent && logLines.length === 0 && errors.length === 0 && (
                            <div class="logs-empty">
                                <Icon svg={databaseSvg} />
                                Empty log
                            </div>
                        )}

                        {!loadingContent && logLines.length > 0 && (
                            <div class="logs-entries">
                                {logLines.map((line, i) => {
                                    const badge = typeBadge(line.type);
                                    return (
                                        <div class="logs-entry" key={i}>
                                            <div class="logs-entry-header">
                                                <span class={`logs-entry-badge ${badge.color}`}>{badge.label}</span>
                                                <span class="logs-entry-time">{formatTimestamp(line.ts)}</span>
                                            </div>
                                            <div class="logs-entry-body">{line.summary}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {confirmTarget && (
                <ConfirmDialog
                    message={confirmTarget === "__all__" ? "Delete all log files?" : `Delete ${confirmTarget}?`}
                    onConfirm={confirmDelete}
                    onCancel={() => setConfirmTarget(null)}
                />
            )}
        </>
    );
}
