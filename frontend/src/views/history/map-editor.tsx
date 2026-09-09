import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../../api";
import { T, useI18n } from "../../i18n";
import type { HistoryFileInfo, MapConfig, MapData, MapPoint, MapTransform } from "../../types";
import { normalizeError } from "../../utils";
import { computeMapProjection } from "./helpers";

interface MapEditorProps {
    canvas: HTMLCanvasElement | null;
    file: HistoryFileInfo;
    map: MapData;
    transform: MapTransform;
    rotation: number;
}

type DrawMode = "idle" | "zone" | "no-go";

interface CanvasSize {
    width: number;
    height: number;
}

const EMPTY_CONFIG: MapConfig = { version: 1, name: "", zones: [], noGoLines: [] };

function newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function MapEditor({ canvas, file, map, transform, rotation }: MapEditorProps) {
    const { t } = useI18n();
    const [config, setConfig] = useState<MapConfig>(EMPTY_CONFIG);
    const [pinned, setPinned] = useState(file.pinned);
    const [editing, setEditing] = useState(false);
    const [mode, setMode] = useState<DrawMode>("idle");
    const [draft, setDraft] = useState<MapPoint[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });

    useEffect(() => {
        api.getMapConfig(file.name)
            .then(setConfig)
            .catch((e: unknown) => setError(normalizeError(e, "Could not load map configuration")));
    }, [file.name]);

    useEffect(() => {
        if (!canvas) return;
        const update = () => setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [canvas]);

    const projection = useMemo(() => {
        if (!map.bounds || size.width <= 0 || size.height <= 0) return null;
        return computeMapProjection(size.width, size.height, map.bounds);
    }, [map.bounds, size]);

    const rotatePoint = useCallback(
        (point: MapPoint, degrees: number): MapPoint => {
            const radians = (degrees * Math.PI) / 180;
            const cx = size.width / 2;
            const cy = size.height / 2;
            const dx = point.x - cx;
            const dy = point.y - cy;
            return {
                x: cx + dx * Math.cos(radians) - dy * Math.sin(radians),
                y: cy + dx * Math.sin(radians) + dy * Math.cos(radians),
            };
        },
        [size],
    );

    const toScreen = useCallback(
        (point: MapPoint): MapPoint => {
            if (!projection) return { x: 0, y: 0 };
            const transformed = {
                x: projection.toX(point.x) * transform.zoom + transform.panX,
                y: projection.toY(point.y) * transform.zoom + transform.panY,
            };
            return rotatePoint(transformed, rotation);
        },
        [projection, rotatePoint, rotation, transform],
    );

    const toWorld = useCallback(
        (point: MapPoint): MapPoint | null => {
            if (!projection) return null;
            const unrotated = rotatePoint(point, -rotation);
            const px = (unrotated.x - transform.panX) / transform.zoom;
            const py = (unrotated.y - transform.panY) / transform.zoom;
            const offX = projection.toX(projection.minX);
            const offY = projection.toY(projection.maxY);
            return {
                x: Number((projection.minX + (px - offX) / projection.scale).toFixed(3)),
                y: Number((projection.maxY - (py - offY) / projection.scale).toFixed(3)),
            };
        },
        [projection, rotatePoint, rotation, transform],
    );

    const save = useCallback(
        async (next: MapConfig) => {
            setSaving(true);
            setError("");
            try {
                const saved = await api.saveMapConfig(file.name, next);
                setConfig(saved);
                setPinned(true);
            } catch (e: unknown) {
                setError(normalizeError(e, "Could not save map configuration"));
            } finally {
                setSaving(false);
            }
        },
        [file.name],
    );

    const togglePinned = useCallback(async () => {
        setSaving(true);
        setError("");
        try {
            await api.setHistoryPinned(file.name, !pinned);
            setPinned(!pinned);
            if (pinned) {
                setEditing(false);
                setMode("idle");
                setDraft([]);
            }
        } catch (e: unknown) {
            setError(normalizeError(e, "Could not update pinned map"));
        } finally {
            setSaving(false);
        }
    }, [file.name, pinned]);

    const handleMapClick = useCallback(
        (event: MouseEvent) => {
            if (mode === "idle" || !canvas) return;
            const rect = canvas.getBoundingClientRect();
            const point = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            if (!point) return;
            if (mode === "no-go" && draft.length === 1) {
                const next: MapConfig = {
                    ...config,
                    noGoLines: [...config.noGoLines, { id: newId("line"), start: draft[0], end: point }],
                };
                setDraft([]);
                void save(next);
                return;
            }
            setDraft((current) => [...current, point]);
        },
        [canvas, config, draft, mode, save, toWorld],
    );

    const finishZone = useCallback(() => {
        if (draft.length < 3) return;
        const name = window.prompt(t("Room name"));
        if (!name?.trim()) return;
        const next: MapConfig = {
            ...config,
            zones: [...config.zones, { id: newId("zone"), name: name.trim(), points: draft }],
        };
        setDraft([]);
        void save(next);
    }, [config, draft, save, t]);

    const removeZone = useCallback(
        (id: string) => void save({ ...config, zones: config.zones.filter((zone) => zone.id !== id) }),
        [config, save],
    );
    const removeLine = useCallback(
        (id: string) => void save({ ...config, noGoLines: config.noGoLines.filter((line) => line.id !== id) }),
        [config, save],
    );

    const polygon = (points: MapPoint[]) =>
        points
            .map(toScreen)
            .map((point) => `${point.x},${point.y}`)
            .join(" ");
    const draftScreen = draft.map(toScreen);

    return (
        <div class="map-editor">
            <div class="map-editor-actions">
                <button type="button" class="btn secondary" disabled={saving} onClick={togglePinned}>
                    {pinned ? <T>Unpin map</T> : <T>Pin as map</T>}
                </button>
                {pinned && (
                    <button type="button" class="btn secondary" onClick={() => setEditing((value) => !value)}>
                        {editing ? <T>Close editor</T> : <T>Edit rooms and no-go lines</T>}
                    </button>
                )}
            </div>
            {editing && (
                <>
                    <div class="map-editor-toolbar">
                        <button
                            type="button"
                            class={mode === "zone" ? "btn primary" : "btn secondary"}
                            onClick={() => {
                                setMode("zone");
                                setDraft([]);
                            }}
                        >
                            <T>Draw room</T>
                        </button>
                        <button
                            type="button"
                            class={mode === "no-go" ? "btn primary" : "btn secondary"}
                            onClick={() => {
                                setMode("no-go");
                                setDraft([]);
                            }}
                        >
                            <T>Draw no-go line</T>
                        </button>
                        {mode === "zone" && draft.length >= 3 && (
                            <button type="button" class="btn primary" onClick={finishZone}>
                                <T>Finish room</T>
                            </button>
                        )}
                        {draft.length > 0 && (
                            <button type="button" class="btn secondary" onClick={() => setDraft([])}>
                                <T>Cancel drawing</T>
                            </button>
                        )}
                    </div>
                    <p class="history-map-hint">
                        {mode === "zone"
                            ? t("Tap at least three corners, then finish the room.")
                            : mode === "no-go"
                              ? t("Tap the start and end of the no-go line.")
                              : t("Choose a drawing tool.")}
                    </p>
                </>
            )}
            {error && <div class="map-editor-error">{error}</div>}
            {projection && (
                <svg
                    class={`map-editor-overlay${editing ? "" : " readonly"}`}
                    viewBox={`0 0 ${size.width} ${size.height}`}
                    onClick={handleMapClick}
                    aria-label={t("Map editor")}
                >
                    {config.zones.map((zone) => (
                        <polygon key={zone.id} points={polygon(zone.points)} class="map-zone-shape" />
                    ))}
                    {config.noGoLines.map((line) => {
                        const start = toScreen(line.start);
                        const end = toScreen(line.end);
                        return (
                            <line
                                key={line.id}
                                x1={start.x}
                                y1={start.y}
                                x2={end.x}
                                y2={end.y}
                                class="map-no-go-shape"
                            />
                        );
                    })}
                    {draftScreen.length > 1 && (
                        <polyline
                            points={draftScreen.map((point) => `${point.x},${point.y}`).join(" ")}
                            class="map-draft-shape"
                        />
                    )}
                    {draftScreen.map((point, index) => (
                        <circle key={index} cx={point.x} cy={point.y} r="4" class="map-draft-point" />
                    ))}
                </svg>
            )}
            {editing && (
                <div class="map-editor-items">
                    {config.zones.map((zone) => (
                        <button type="button" class="map-editor-chip zone" onClick={() => removeZone(zone.id)}>
                            {zone.name} ×
                        </button>
                    ))}
                    {config.noGoLines.map((line, index) => (
                        <button type="button" class="map-editor-chip no-go" onClick={() => removeLine(line.id)}>
                            {t("No-go line {number}", { number: index + 1 })} ×
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
