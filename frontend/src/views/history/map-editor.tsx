import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import manualSvg from "../../assets/icons/manual.svg?raw";
import noGoLineSvg from "../../assets/icons/no-go-line.svg?raw";
import roomFreeformSvg from "../../assets/icons/room-freeform.svg?raw";
import roomRectangleSvg from "../../assets/icons/room-rectangle.svg?raw";
import { Icon } from "../../components/icon";
import { T, useI18n } from "../../i18n";
import type { HistoryFileInfo, MapConfig, MapData, MapPoint, MapTransform } from "../../types";
import { normalizeError } from "../../utils";
import { computeMapProjection, translateExampleMapName } from "./helpers";

interface MapEditorProps {
    canvas: HTMLCanvasElement | null;
    file: HistoryFileInfo;
    map: MapData;
    transform: MapTransform;
    rotation: number;
    onPinnedChange?: (pinned: boolean) => void;
}

type DrawMode = "idle" | "zone" | "rectangle" | "no-go" | "move";

interface DragState {
    zoneId: string;
    start: MapPoint;
    current: MapPoint;
}

interface CanvasSize {
    width: number;
    height: number;
}

const EMPTY_CONFIG: MapConfig = { version: 1, name: "", zones: [], noGoLines: [] };
const ROOM_COLORS = ["#34C759", "#0A84FF", "#BF5AF2", "#FF9F0A", "#64D2FF", "#FF375F", "#FFD60A", "#30D158"];

function roomColor(color: string | undefined, index: number): string {
    return color ?? ROOM_COLORS[index % ROOM_COLORS.length];
}

function zoneMetrics(points: MapPoint[]): { area: number; center: MapPoint } {
    let twiceArea = 0;
    let centerX = 0;
    let centerY = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const cross = current.x * next.y - next.x * current.y;
        twiceArea += cross;
        centerX += (current.x + next.x) * cross;
        centerY += (current.y + next.y) * cross;
    }
    if (Math.abs(twiceArea) <= 1e-6) {
        return {
            area: 0,
            center: {
                x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
                y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
            },
        };
    }
    return {
        area: Math.abs(twiceArea) / 2,
        center: { x: centerX / (3 * twiceArea), y: centerY / (3 * twiceArea) },
    };
}

function newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function pointsDiffer(left: MapPoint, right: MapPoint): boolean {
    return Math.abs(left.x - right.x) > 1e-6 || Math.abs(left.y - right.y) > 1e-6;
}

function isUsableZone(points: MapPoint[]): boolean {
    const unique: MapPoint[] = [];
    for (const point of points) {
        if (!unique.some((candidate) => !pointsDiffer(candidate, point))) unique.push(point);
    }
    if (unique.length < 3) return false;
    let doubleArea = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        doubleArea += current.x * next.y - next.x * current.y;
    }
    const area = Math.abs(doubleArea) / 2;
    return Number.isFinite(area) && area > 1e-6;
}

export function MapEditor({ canvas, file, map, transform, rotation, onPinnedChange }: MapEditorProps) {
    const { t, formatNumber } = useI18n();
    const [config, setConfig] = useState<MapConfig>(EMPTY_CONFIG);
    const [pinned, setPinned] = useState(file.pinned);
    const [editing, setEditing] = useState(false);
    const [mode, setMode] = useState<DrawMode>("idle");
    const [draft, setDraft] = useState<MapPoint[]>([]);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [saving, setSaving] = useState(false);
    const [configReady, setConfigReady] = useState(false);
    const [error, setError] = useState("");
    const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
    const configRef = useRef(config);
    const activeFileRef = useRef(file.name);
    const previousFileRef = useRef(file.name);
    const fileGenerationRef = useRef(0);
    const mutationGenerationRef = useRef(0);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const pendingSavesRef = useRef(0);
    configRef.current = config;
    activeFileRef.current = file.name;
    if (previousFileRef.current !== file.name) {
        previousFileRef.current = file.name;
        fileGenerationRef.current += 1;
        mutationGenerationRef.current += 1;
    }

    useEffect(() => {
        let cancelled = false;
        setPinned(file.pinned);
        setEditing(false);
        setMode("idle");
        setDraft([]);
        setDrag(null);
        setConfigReady(false);
        setError("");
        saveQueueRef.current = Promise.resolve();
        pendingSavesRef.current = 0;
        setSaving(false);
        configRef.current = EMPTY_CONFIG;
        setConfig(EMPTY_CONFIG);
        api.getMapConfig(file.name)
            .then((loaded) => {
                if (cancelled) return;
                configRef.current = loaded;
                setConfig(loaded);
                setConfigReady(true);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(normalizeError(e, "Could not load map configuration"));
            });
        return () => {
            cancelled = true;
        };
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

    const enqueueSave = useCallback(
        (update: (current: MapConfig) => MapConfig) => {
            if (!configReady) return;
            const requestedFile = file.name;
            const requestedGeneration = fileGenerationRef.current;
            const requestedMutation = ++mutationGenerationRef.current;
            pendingSavesRef.current += 1;
            setSaving(true);
            setError("");
            saveQueueRef.current = saveQueueRef.current
                .then(async () => {
                    if (activeFileRef.current !== requestedFile || fileGenerationRef.current !== requestedGeneration)
                        return;
                    const next = update(configRef.current);
                    try {
                        const saved = await api.saveMapConfig(requestedFile, next);
                        if (
                            activeFileRef.current !== requestedFile ||
                            fileGenerationRef.current !== requestedGeneration
                        )
                            return;
                        configRef.current = saved;
                        if (mutationGenerationRef.current !== requestedMutation) return;
                        setConfig(saved);
                        setPinned(true);
                        onPinnedChange?.(true);
                    } catch (e: unknown) {
                        if (
                            activeFileRef.current === requestedFile &&
                            fileGenerationRef.current === requestedGeneration &&
                            mutationGenerationRef.current === requestedMutation
                        ) {
                            setError(normalizeError(e, "Could not save map configuration"));
                        }
                    }
                })
                .finally(() => {
                    if (activeFileRef.current !== requestedFile || fileGenerationRef.current !== requestedGeneration)
                        return;
                    pendingSavesRef.current -= 1;
                    if (pendingSavesRef.current === 0) setSaving(false);
                });
        },
        [configReady, file.name, onPinnedChange],
    );

    const togglePinned = useCallback(() => {
        if (!configReady) return;
        const requestedFile = file.name;
        const requestedGeneration = fileGenerationRef.current;
        const shouldPin = !pinned;
        let name = "";
        if (shouldPin) {
            const fallbackName = configRef.current.name || t("My reference map");
            const promptedName = window.prompt(t("Reference map name"));
            if (promptedName === null) return;
            name = promptedName.trim() || fallbackName;
        }
        const requestedMutation = ++mutationGenerationRef.current;
        pendingSavesRef.current += 1;
        setSaving(true);
        setError("");
        saveQueueRef.current = saveQueueRef.current
            .then(async () => {
                if (activeFileRef.current !== requestedFile || fileGenerationRef.current !== requestedGeneration)
                    return;
                try {
                    if (shouldPin) {
                        const saved = await api.saveMapConfig(requestedFile, { ...configRef.current, name });
                        if (
                            activeFileRef.current !== requestedFile ||
                            fileGenerationRef.current !== requestedGeneration
                        )
                            return;
                        configRef.current = saved;
                        if (mutationGenerationRef.current !== requestedMutation) return;
                        setConfig(saved);
                        setPinned(true);
                        onPinnedChange?.(true);
                    } else {
                        await api.setHistoryPinned(requestedFile, false);
                        if (
                            activeFileRef.current !== requestedFile ||
                            fileGenerationRef.current !== requestedGeneration ||
                            mutationGenerationRef.current !== requestedMutation
                        )
                            return;
                        setPinned(false);
                        onPinnedChange?.(false);
                        setEditing(false);
                        setMode("idle");
                        setDraft([]);
                        setDrag(null);
                    }
                } catch (e: unknown) {
                    if (
                        activeFileRef.current === requestedFile &&
                        fileGenerationRef.current === requestedGeneration &&
                        mutationGenerationRef.current === requestedMutation
                    ) {
                        setConfig(configRef.current);
                        setError(normalizeError(e, "Could not update pinned map"));
                    }
                }
            })
            .finally(() => {
                if (activeFileRef.current !== requestedFile || fileGenerationRef.current !== requestedGeneration)
                    return;
                pendingSavesRef.current -= 1;
                if (pendingSavesRef.current === 0) setSaving(false);
            });
    }, [configReady, file.name, onPinnedChange, pinned, t]);

    const saveZone = useCallback(
        (points: MapPoint[]) => {
            if (saving || !configReady || points.length < 3) return;
            if (!isUsableZone(points)) {
                setError(t("A room needs at least three distinct corners and must enclose an area."));
                return;
            }
            const name = window.prompt(t("Room name"));
            const trimmed = name?.trim();
            if (!trimmed) return;
            if (configRef.current.zones.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) {
                setError(t("A room with this name already exists."));
                return;
            }
            setDraft([]);
            enqueueSave((current) => {
                const usedColors = new Set(current.zones.map((zone, index) => roomColor(zone.color, index)));
                const color =
                    ROOM_COLORS.find((candidate) => !usedColors.has(candidate)) ??
                    ROOM_COLORS[current.zones.length % ROOM_COLORS.length];
                return {
                    ...current,
                    zones: [...current.zones, { id: newId("zone"), name: trimmed, color, points }],
                };
            });
        },
        [configReady, enqueueSave, saving, t],
    );

    const handleMapClick = useCallback(
        (event: MouseEvent) => {
            if (saving || (mode !== "zone" && mode !== "rectangle" && mode !== "no-go") || !canvas) return;
            const rect = canvas.getBoundingClientRect();
            const point = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            if (!point) return;
            if (mode === "zone" && draft.length >= 3) {
                const first = toScreen(draft[0]);
                const click = { x: event.clientX - rect.left, y: event.clientY - rect.top };
                if (Math.hypot(click.x - first.x, click.y - first.y) <= 18) {
                    saveZone(draft);
                    return;
                }
            }
            if (mode === "rectangle" && draft.length === 1) {
                const start = draft[0];
                saveZone([start, { x: point.x, y: start.y }, point, { x: start.x, y: point.y }]);
                return;
            }
            if (mode === "no-go" && draft.length === 1) {
                const start = draft[0];
                if (!pointsDiffer(start, point)) {
                    setError(t("The start and end of a no-go line must be different."));
                    return;
                }
                const fallbackName = t("No-go line {number}", { number: configRef.current.noGoLines.length + 1 });
                const name = window.prompt(t("No-go line name"), fallbackName);
                const trimmed = name?.trim();
                if (!trimmed) return;
                if (configRef.current.noGoLines.some((line) => line.name?.toLowerCase() === trimmed.toLowerCase())) {
                    setError(t("A no-go line with this name already exists."));
                    return;
                }
                setDraft([]);
                enqueueSave((current) => ({
                    ...current,
                    noGoLines: [...current.noGoLines, { id: newId("line"), name: trimmed, start, end: point }],
                }));
                return;
            }
            setDraft((current) => [...current, point]);
        },
        [canvas, draft, enqueueSave, mode, saveZone, saving, t, toScreen, toWorld],
    );

    const finishZone = useCallback(() => saveZone(draft), [draft, saveZone]);

    const removeZone = useCallback(
        (id: string) =>
            enqueueSave((current) => ({ ...current, zones: current.zones.filter((zone) => zone.id !== id) })),
        [enqueueSave],
    );
    const removeLine = useCallback(
        (id: string) =>
            enqueueSave((current) => ({
                ...current,
                noGoLines: current.noGoLines.filter((line) => line.id !== id),
            })),
        [enqueueSave],
    );

    const renameZone = useCallback(
        (id: string) => {
            const zone = configRef.current.zones.find((item) => item.id === id);
            if (!zone) return;
            const name = window.prompt(t("Room name"), zone.name);
            const trimmed = name?.trim();
            if (!trimmed || trimmed === zone.name) return;
            if (
                configRef.current.zones.some(
                    (item) => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase(),
                )
            ) {
                setError(t("A room with this name already exists."));
                return;
            }
            enqueueSave((current) => ({
                ...current,
                zones: current.zones.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
            }));
        },
        [enqueueSave, t],
    );

    const changeZoneColor = useCallback(
        (id: string, color: string) =>
            enqueueSave((current) => ({
                ...current,
                zones: current.zones.map((zone) => (zone.id === id ? { ...zone, color } : zone)),
            })),
        [enqueueSave],
    );

    const renameLine = useCallback(
        (id: string, fallbackName: string) => {
            const line = configRef.current.noGoLines.find((item) => item.id === id);
            if (!line) return;
            const currentName = line.name ?? fallbackName;
            const name = window.prompt(t("No-go line name"), currentName);
            const trimmed = name?.trim();
            if (!trimmed || trimmed === currentName) return;
            if (
                configRef.current.noGoLines.some(
                    (item) => item.id !== id && item.name?.toLowerCase() === trimmed.toLowerCase(),
                )
            ) {
                setError(t("A no-go line with this name already exists."));
                return;
            }
            enqueueSave((current) => ({
                ...current,
                noGoLines: current.noGoLines.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
            }));
        },
        [enqueueSave, t],
    );

    const startZoneDrag = useCallback(
        (event: PointerEvent, zoneId: string) => {
            if (saving || mode !== "move" || !canvas) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = canvas.getBoundingClientRect();
            const point = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            if (!point) return;
            (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
            setDrag({ zoneId, start: point, current: point });
        },
        [canvas, mode, saving, toWorld],
    );

    const moveZone = useCallback(
        (event: PointerEvent) => {
            if (!drag || !canvas) return;
            const rect = canvas.getBoundingClientRect();
            const point = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            if (!point) return;
            setDrag({ ...drag, current: point });
        },
        [canvas, drag, toWorld],
    );

    const finishZoneDrag = useCallback(() => {
        if (!drag) return;
        const { zoneId, start, current } = drag;
        const dx = current.x - start.x;
        const dy = current.y - start.y;
        setDrag(null);
        if (dx === 0 && dy === 0) return;
        enqueueSave((latest) => ({
            ...latest,
            zones: latest.zones.map((zone) =>
                zone.id === zoneId
                    ? { ...zone, points: zone.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
                    : zone,
            ),
        }));
    }, [drag, enqueueSave]);

    const moveZoneWithKeyboard = useCallback(
        (event: KeyboardEvent, zoneId: string) => {
            if (saving || !configReady || mode !== "move") return;
            const step = event.shiftKey ? 0.25 : 0.05;
            let dx = 0;
            let dy = 0;
            switch (event.key) {
                case "ArrowLeft":
                    dx = -step;
                    break;
                case "ArrowRight":
                    dx = step;
                    break;
                case "ArrowUp":
                    dy = step;
                    break;
                case "ArrowDown":
                    dy = -step;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            event.stopPropagation();
            enqueueSave((latest) => ({
                ...latest,
                zones: latest.zones.map((zone) =>
                    zone.id === zoneId
                        ? {
                              ...zone,
                              points: zone.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
                          }
                        : zone,
                ),
            }));
        },
        [configReady, enqueueSave, mode, saving],
    );

    const displayConfig = useMemo(() => {
        if (!drag) return config;
        const dx = drag.current.x - drag.start.x;
        const dy = drag.current.y - drag.start.y;
        return {
            ...config,
            zones: config.zones.map((zone) =>
                zone.id === drag.zoneId
                    ? { ...zone, points: zone.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
                    : zone,
            ),
        };
    }, [config, drag]);

    const polygon = (points: MapPoint[]) =>
        points
            .map(toScreen)
            .map((point) => `${point.x},${point.y}`)
            .join(" ");
    const draftScreen = draft.map(toScreen);

    return (
        <div class="map-editor">
            <div class="map-editor-actions">
                <button type="button" class="map-editor-btn" disabled={saving || !configReady} onClick={togglePinned}>
                    {pinned ? <T>Remove reference map</T> : <T>Save as reference map</T>}
                </button>
                {pinned && (
                    <button
                        type="button"
                        class="map-editor-btn"
                        disabled={saving || !configReady}
                        onClick={() => setEditing((value) => !value)}
                    >
                        {editing ? <T>Close editor</T> : <T>Edit reference map</T>}
                    </button>
                )}
            </div>
            {editing && (
                <>
                    <div class="map-editor-toolbar">
                        <button
                            type="button"
                            class={`map-editor-btn${mode === "zone" ? " active" : ""}`}
                            disabled={saving || !configReady}
                            aria-pressed={mode === "zone"}
                            onClick={() => {
                                setMode("zone");
                                setDraft([]);
                            }}
                        >
                            <Icon svg={roomFreeformSvg} class="map-editor-tool-icon" />
                            <T>Freeform room</T>
                        </button>
                        <button
                            type="button"
                            class={`map-editor-btn${mode === "rectangle" ? " active" : ""}`}
                            disabled={saving || !configReady}
                            aria-pressed={mode === "rectangle"}
                            onClick={() => {
                                setMode("rectangle");
                                setDraft([]);
                            }}
                        >
                            <Icon svg={roomRectangleSvg} class="map-editor-tool-icon" />
                            <T>Rectangular room</T>
                        </button>
                        <button
                            type="button"
                            class={`map-editor-btn${mode === "no-go" ? " active" : ""}`}
                            disabled={saving || !configReady}
                            aria-pressed={mode === "no-go"}
                            onClick={() => {
                                setMode("no-go");
                                setDraft([]);
                            }}
                        >
                            <Icon svg={noGoLineSvg} class="map-editor-tool-icon" />
                            <T>Draw no-go line</T>
                        </button>
                        <button
                            type="button"
                            class={`map-editor-btn${mode === "move" ? " active" : ""}`}
                            disabled={saving || !configReady}
                            aria-pressed={mode === "move"}
                            onClick={() => {
                                setMode("move");
                                setDraft([]);
                            }}
                        >
                            <Icon svg={manualSvg} class="map-editor-tool-icon" />
                            <T>Move rooms</T>
                        </button>
                        {mode === "zone" && draft.length >= 3 && (
                            <button
                                type="button"
                                class="map-editor-btn primary"
                                disabled={saving || !configReady}
                                onClick={finishZone}
                            >
                                <T>Finish room</T>
                            </button>
                        )}
                        {draft.length > 0 && (
                            <button
                                type="button"
                                class="map-editor-btn"
                                disabled={saving || !configReady}
                                onClick={() => setDraft([])}
                            >
                                <T>Cancel drawing</T>
                            </button>
                        )}
                    </div>
                    <p class="history-map-hint">
                        {mode === "zone"
                            ? t("Tap at least three corners, then tap the first point again or finish the room.")
                            : mode === "rectangle"
                              ? t("Tap two opposite corners to create a rectangular room.")
                              : mode === "no-go"
                                ? t("Tap the start and end of the no-go line.")
                                : mode === "move"
                                  ? t("Drag a room to move it.")
                                  : t("Choose a drawing tool.")}
                    </p>
                </>
            )}
            {error && (
                <div class="map-editor-error" role="alert" aria-live="assertive">
                    {error}
                </div>
            )}
            {projection && (
                <svg
                    class={`map-editor-overlay${editing ? "" : " readonly"}`}
                    data-map-drawing={editing && mode !== "idle" && mode !== "move" ? "true" : undefined}
                    viewBox={`0 0 ${size.width} ${size.height}`}
                    onClick={handleMapClick}
                    onPointerMove={moveZone}
                    onPointerUp={finishZoneDrag}
                    onPointerCancel={() => setDrag(null)}
                    aria-label={t("Map editor")}
                >
                    {displayConfig.zones.map((zone, index) => {
                        const color = roomColor(zone.color, index);
                        const metrics = zoneMetrics(zone.points);
                        const center = toScreen(metrics.center);
                        const displayName = translateExampleMapName(zone.name, t);
                        const label = `${displayName} · ${formatNumber(metrics.area, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²`;
                        const labelWidth = Math.min(210, Math.max(96, label.length * 6.5 + 24));
                        return (
                            <g key={zone.id}>
                                <polygon
                                    points={polygon(zone.points)}
                                    class={`map-zone-shape${mode === "move" ? " movable" : ""}`}
                                    style={{ fill: color, stroke: color }}
                                    onPointerDown={(event) => startZoneDrag(event, zone.id)}
                                    tabIndex={editing && mode === "move" ? 0 : undefined}
                                    role={editing && mode === "move" ? "group" : undefined}
                                    aria-label={
                                        editing && mode === "move"
                                            ? t("Move rooms") + ": " + displayName + " (← ↑ → ↓)"
                                            : undefined
                                    }
                                    onKeyDown={(event) => moveZoneWithKeyboard(event, zone.id)}
                                />
                                <g class="map-zone-label" transform={`translate(${center.x} ${center.y})`}>
                                    <rect x={-labelWidth / 2} y={-14} width={labelWidth} height={28} rx="14" />
                                    <circle cx={-labelWidth / 2 + 13} cy="0" r="4" style={{ fill: color }} />
                                    <text x="6" y="0">
                                        {label}
                                    </text>
                                </g>
                            </g>
                        );
                    })}
                    {displayConfig.noGoLines.map((line) => {
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
                        <circle
                            key={index}
                            cx={point.x}
                            cy={point.y}
                            r={index === 0 && mode === "zone" ? 7 : 4}
                            class={`map-draft-point${index === 0 && mode === "zone" ? " start" : ""}`}
                        />
                    ))}
                </svg>
            )}
            {editing && (
                <div
                    class="map-editor-items"
                    onWheel={(event) => {
                        const items = event.currentTarget;
                        if (
                            items.scrollWidth <= items.clientWidth ||
                            Math.abs(event.deltaX) >= Math.abs(event.deltaY)
                        ) {
                            return;
                        }
                        items.scrollLeft += event.deltaY;
                        event.preventDefault();
                    }}
                >
                    {config.zones.map((zone, index) => (
                        <span
                            key={zone.id}
                            class="map-editor-chip zone"
                            style={{ borderColor: roomColor(zone.color, index) }}
                        >
                            <button
                                type="button"
                                class="map-editor-chip-name"
                                disabled={saving || !configReady}
                                onClick={() => renameZone(zone.id)}
                            >
                                {translateExampleMapName(zone.name, t)}
                            </button>
                            <input
                                type="color"
                                class="map-editor-chip-color"
                                value={roomColor(zone.color, index)}
                                disabled={saving || !configReady}
                                onChange={(event) => changeZoneColor(zone.id, event.currentTarget.value.toUpperCase())}
                                aria-label={t("Choose color for room {name}", {
                                    name: translateExampleMapName(zone.name, t),
                                })}
                            />
                            <button
                                type="button"
                                class="map-editor-chip-delete"
                                disabled={saving || !configReady}
                                onClick={() => removeZone(zone.id)}
                                aria-label={t("Delete room {name}", { name: translateExampleMapName(zone.name, t) })}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {config.noGoLines.map((line, index) => {
                        const fallbackName = t("No-go line {number}", { number: index + 1 });
                        const displayName = translateExampleMapName(line.name ?? fallbackName, t);
                        return (
                            <span key={line.id} class="map-editor-chip no-go">
                                <button
                                    type="button"
                                    class="map-editor-chip-name"
                                    disabled={saving || !configReady}
                                    onClick={() => renameLine(line.id, fallbackName)}
                                >
                                    {displayName}
                                </button>
                                <button
                                    type="button"
                                    class="map-editor-chip-delete"
                                    disabled={saving || !configReady}
                                    onClick={() => removeLine(line.id)}
                                    aria-label={t("Delete no-go line {name}", { name: displayName })}
                                >
                                    ×
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
