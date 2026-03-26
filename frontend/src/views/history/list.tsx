import { useCallback, useState } from "preact/hooks";
import alertSvg from "../../assets/icons/alert.svg?raw";
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
    size: number;
    index: number;
    active?: boolean;
    corrupted?: boolean;
    onSelect: (i: number) => void;
    onDelete: (i: number) => void;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function SessionCard({
    session,
    summary,
    filename,
    size,
    index,
    active,
    corrupted,
    onSelect,
    onDelete,
}: SessionCardProps) {
    if (corrupted) {
        return (
            <div class="history-session-row corrupted">
                <div class="history-session-card history-session-corrupted">
                    <div class="history-session-icon corrupted">
                        <Icon svg={alertSvg} />
                    </div>
                    <div class="history-session-body">
                        <div class="history-session-header">
                            <span class="history-session-mode">Corrupted</span>
                            <span class="history-session-date">{formatSize(size)}</span>
                        </div>
                        <div class="history-session-stats corrupted">
                            <span>{filename}</span>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    class="history-session-delete"
                    onClick={() => onDelete(index)}
                    aria-label="Delete session"
                >
                    <Icon svg={trashSvg} />
                </button>
            </div>
        );
    }

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
                                {session?.battery ?? "?"}%
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
}

export function HistoryListView({
    files,
    hasRecording,
    deleting,
    onSelect,
    onDeleteSession,
    onDeleteAll,
}: HistoryListViewProps) {
    const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

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

    return (
        <>
            {/* Summary bar */}
            <div class="history-summary">
                <span>
                    {files.length} session{files.length !== 1 ? "s" : ""}
                    {hasRecording ? " · Running..." : ""}
                </span>
                <button
                    type="button"
                    class={`history-delete-all-btn${deleting ? " pending" : ""}`}
                    onClick={() => setConfirmTarget("__all__")}
                    disabled={deleting}
                >
                    Delete All
                </button>
            </div>

            {/* Session cards */}
            {files.map((f, i) => (
                <SessionCard
                    key={f.session?.time ?? i}
                    session={f.session}
                    summary={f.summary}
                    filename={f.name}
                    size={f.size}
                    index={i}
                    active={f.recording}
                    corrupted={f.corrupted}
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
