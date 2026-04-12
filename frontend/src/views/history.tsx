import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate, usePath } from "../components/router";
import type { HistoryFileInfo, MapData } from "../types";
import { HistoryItemView } from "./history/item";
import { HistoryListView } from "./history/list";

export function HistoryView() {
    const navigate = useNavigate();
    const path = usePath();
    const [errors, errorStack] = useErrorStack();
    const [files, setFiles] = useState<HistoryFileInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMap, setSelectedMap] = useState<MapData | null>(null);
    const [mapEmpty, setMapEmpty] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Derive selected filename from URL: /history = list, /history/<name> = detail
    const selectedName = path.startsWith("/history/") ? decodeURIComponent(path.slice(9)) : null;
    const selectedFile = useMemo(
        () => (selectedName ? (files.find((f) => f.name === selectedName) ?? null) : null),
        [selectedName, files],
    );
    const selectedRecording = selectedFile?.recording === true;
    const hasRecording = files.some((f) => f.recording);

    // Sort sessions by date descending (newest first)
    const sortByDateDesc = (list: HistoryFileInfo[]) =>
        list.sort((a, b) => (b.session?.time ?? 0) - (a.session?.time ?? 0));

    // Load file list only (no full session data)
    useEffect(() => {
        setLoading(true);
        api.getHistoryList()
            .then((fileList) => setFiles(sortByDateDesc(fileList)))
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to load map data");
            })
            .finally(() => setLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Poll list + active recording session map (every 5s while recording)
    useEffect(() => {
        if (!hasRecording) return;
        const interval = setInterval(async () => {
            try {
                const fileList = await api.getHistoryList();
                setFiles(sortByDateDesc(fileList));

                // If the detail view shows the recording session, refresh its map
                if (selectedName) {
                    const file = fileList.find((f) => f.name === selectedName);
                    if (file?.recording) {
                        const maps = await api.getHistorySession(file.name);
                        if (maps.length > 0) setSelectedMap(maps[0]);
                    }
                }
            } catch {
                // Silently ignore poll errors
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [hasRecording, selectedName]);

    // Fetch full session data when URL points to a file
    useEffect(() => {
        if (!selectedName) {
            setSelectedMap(null);
            setMapEmpty(false);
            return;
        }
        setSelectedMap(null);
        setMapEmpty(false);
        const isRecording = files.find((f) => f.name === selectedName)?.recording === true;
        api.getHistorySession(selectedName)
            .then((maps) => {
                if (maps.length > 0) {
                    setSelectedMap(maps[0]);
                } else if (!isRecording) {
                    setMapEmpty(true);
                }
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to load session");
            });
    }, [selectedName, errorStack]);

    const handleSelect = useCallback(
        (idx: number) => {
            const file = files[idx];
            if (!file) return;
            navigate(`/history/${file.name}`);
        },
        [files, navigate],
    );

    const handleBack = useCallback(() => {
        if (selectedName) {
            navigate("/history");
            errorStack.clear();
        } else {
            navigate("/");
        }
    }, [selectedName, navigate, errorStack]);

    const handleDeleteSession = useCallback(
        (idx: number) => {
            const file = files[idx];
            if (!file) return;
            setDeleting(true);
            api.deleteHistorySession(file.name)
                .then(() => api.getHistoryList())
                .then((fileList) => {
                    setFiles(sortByDateDesc(fileList));
                    if (selectedName === file.name) navigate("/history");
                })
                .catch((e: unknown) => {
                    errorStack.push(e instanceof Error ? e.message : "Failed to delete");
                })
                .finally(() => setDeleting(false));
        },
        [files, selectedName, navigate, errorStack],
    );

    const handleDeleteAll = useCallback(() => {
        setDeleting(true);
        api.deleteAllHistory()
            .then(() => {
                setFiles([]);
                if (selectedName) navigate("/history");
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to delete");
            })
            .finally(() => setDeleting(false));
    }, [selectedName, navigate, errorStack]);

    const handleImported = useCallback(() => {
        api.getHistoryList()
            .then((fileList) => setFiles(sortByDateDesc(fileList)))
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to refresh list");
            });
    }, [errorStack]);

    const showDetail = selectedName !== null && selectedFile !== null;

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={handleBack} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>{showDetail ? "Clean Map" : "Cleaning History"}</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="history-page">
                {loading && <div class="history-empty">Loading...</div>}

                {!loading && files.length === 0 && !showDetail && (
                    <HistoryListView
                        files={files}
                        hasRecording={false}
                        deleting={false}
                        onSelect={handleSelect}
                        onDeleteSession={handleDeleteSession}
                        onDeleteAll={handleDeleteAll}
                        onImported={handleImported}
                        onError={errorStack.push}
                    />
                )}

                {!loading && files.length > 0 && !showDetail && (
                    <HistoryListView
                        files={files}
                        hasRecording={hasRecording}
                        deleting={deleting}
                        onSelect={handleSelect}
                        onDeleteSession={handleDeleteSession}
                        onDeleteAll={handleDeleteAll}
                        onImported={handleImported}
                        onError={errorStack.push}
                    />
                )}

                {!loading && showDetail && (
                    <HistoryItemView
                        file={selectedFile}
                        map={selectedMap}
                        mapEmpty={mapEmpty}
                        recording={selectedRecording}
                    />
                )}
            </div>
        </>
    );
}
