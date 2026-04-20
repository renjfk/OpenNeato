import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import databaseSvg from "../../assets/icons/database.svg?raw";
import downloadSvg from "../../assets/icons/download.svg?raw";
import trashSvg from "../../assets/icons/trash.svg?raw";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Icon } from "../../components/icon";
import { useNavigate } from "../../components/router";
import type { LogFileInfo } from "../../types";
import { normalizeError } from "../../utils";
import { filenameToDate, formatBytes } from "./helpers";

interface LogsListViewProps {
    onError: (msg: string) => void;
}

export function LogsListView({ onError }: LogsListViewProps) {
    const navigate = useNavigate();
    const [files, setFiles] = useState<LogFileInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [deletingAll, setDeletingAll] = useState(false);
    const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

    const fetchFiles = useCallback(() => {
        setLoading(true);
        api.getLogs()
            .then((data) => {
                // current.jsonl first, then archives newest-first (epoch filenames sort lexicographically)
                data.sort((a, b) => {
                    if (a.name === "current.jsonl") return -1;
                    if (b.name === "current.jsonl") return 1;
                    return b.name.localeCompare(a.name);
                });
                setFiles(data);
                setLoading(false);
            })
            .catch((e: unknown) => {
                onError(normalizeError(e, "Failed to load logs"));
                setLoading(false);
            });
    }, [onError]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const confirmDelete = useCallback(() => {
        if (!confirmTarget) return;
        setConfirmTarget(null);

        if (confirmTarget === "__all__") {
            setDeletingAll(true);
            api.deleteAllLogs()
                .then(() => setFiles([]))
                .catch((e: unknown) => {
                    onError(normalizeError(e, "Failed to delete logs"));
                })
                .finally(() => setDeletingAll(false));
        } else {
            const name = confirmTarget;
            setDeleting(name);
            api.deleteLog(name)
                .then(() => {
                    setFiles((prev) => prev.filter((f) => f.name !== name));
                })
                .catch((e: unknown) => {
                    onError(normalizeError(e, "Failed to delete log"));
                })
                .finally(() => setDeleting(null));
        }
    }, [confirmTarget, onError]);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    return (
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

            {!loading && files.length === 0 && (
                <div class="logs-empty">
                    <Icon svg={databaseSvg} />
                    No log files
                </div>
            )}

            {!loading && (
                <div class="logs-file-list">
                    {files.map((f) => (
                        <div class="logs-file-row" key={f.name}>
                            <button type="button" class="logs-file-info" onClick={() => navigate(`/logs/${f.name}`)}>
                                <div class="logs-file-name">{f.name}</div>
                                <div class="logs-file-meta">
                                    {filenameToDate(f.name)} &middot; {formatBytes(f.size)}
                                    {f.compressed && <> &middot; compressed</>}
                                </div>
                            </button>
                            <a
                                class="logs-file-download"
                                href={`/api/logs/${f.name}`}
                                download={f.name.replace(/\.hs$/, "")}
                                aria-label={`Download ${f.name}`}
                            >
                                <Icon svg={downloadSvg} />
                            </a>
                            <button
                                type="button"
                                class={`logs-file-delete${deleting === f.name ? " pending" : ""}`}
                                onClick={() => setConfirmTarget(f.name)}
                                disabled={deleting === f.name}
                                aria-label={`Delete ${f.name}`}
                            >
                                <Icon svg={trashSvg} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

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
