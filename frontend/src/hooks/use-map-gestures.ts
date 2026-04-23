import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { MapTransform } from "../types";

const DEFAULT_TRANSFORM: MapTransform = { panX: 0, panY: 0, zoom: 1 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_SPEED = 0.002;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_ZOOM = 2.5;

// Manages pan, zoom, and reset gestures for a canvas element.
// Returns the current transform and a reset function.
export function useMapGestures(canvasRef: { current: HTMLCanvasElement | null }): MapTransform {
    const [transform, setTransform] = useState<MapTransform>(DEFAULT_TRANSFORM);

    // Mutable refs for gesture state to avoid re-attaching listeners
    const tRef = useRef<MapTransform>(DEFAULT_TRANSFORM);
    const dragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const panStart = useRef({ x: 0, y: 0 });
    const lastTapTime = useRef(0);
    const pinching = useRef(false);
    const pinchStartDist = useRef(0);
    const pinchStartZoom = useRef(1);
    const pinchMidStart = useRef({ x: 0, y: 0 });
    const pinchPanStart = useRef({ x: 0, y: 0 });

    const commit = useCallback((next: MapTransform) => {
        tRef.current = next;
        setTransform(next);
    }, []);

    const reset = useCallback(() => {
        commit(DEFAULT_TRANSFORM);
    }, [commit]);

    // Clamp pan so the zoomed content always covers the viewport.
    // At zoom Z on a canvas of size W, the zoomed content spans [panX, panX + W*Z].
    // We require it to cover [0, W]: panX <= 0 and panX >= W - W*Z = -W*(Z-1).
    const clampPan = useCallback(
        (panX: number, panY: number, zoom: number): { panX: number; panY: number } => {
            const canvas = canvasRef.current;
            if (!canvas) return { panX, panY };
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            const minPanX = -w * (zoom - 1);
            const minPanY = -h * (zoom - 1);
            return {
                panX: Math.max(minPanX, Math.min(0, panX)),
                panY: Math.max(minPanY, Math.min(0, panY)),
            };
        },
        [canvasRef],
    );

    // Zoom around a point in canvas-local coordinates
    const zoomAt = useCallback(
        (localX: number, localY: number, newZoom: number) => {
            const prev = tRef.current;
            const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
            const ratio = clamped / prev.zoom;
            const nextPanX = localX - ratio * (localX - prev.panX);
            const nextPanY = localY - ratio * (localY - prev.panY);
            const pan = clampPan(nextPanX, nextPanY, clamped);
            commit({ panX: pan.panX, panY: pan.panY, zoom: clamped });
        },
        [clampPan, commit],
    );

    // Convert client coordinates to canvas-local coordinates
    const toLocal = useCallback(
        (clientX: number, clientY: number): { x: number; y: number } => {
            const canvas = canvasRef.current;
            if (!canvas) return { x: clientX, y: clientY };
            const rect = canvas.getBoundingClientRect();
            return { x: clientX - rect.left, y: clientY - rect.top };
        },
        [canvasRef],
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // --- Wheel zoom ---
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = -e.deltaY * WHEEL_ZOOM_SPEED;
            const local = toLocal(e.clientX, e.clientY);
            zoomAt(local.x, local.y, tRef.current.zoom * (1 + delta));
        };

        // --- Pointer (mouse only) drag ---
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            if (e.pointerType === "touch") return;
            dragging.current = true;
            dragStart.current = { x: e.clientX, y: e.clientY };
            panStart.current = { x: tRef.current.panX, y: tRef.current.panY };
            canvas.setPointerCapture(e.pointerId);
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!dragging.current) return;
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            const pan = clampPan(panStart.current.x + dx, panStart.current.y + dy, tRef.current.zoom);
            commit({ ...tRef.current, panX: pan.panX, panY: pan.panY });
        };

        const onPointerUp = () => {
            dragging.current = false;
        };

        // --- Double-click: zoom in when at 1x, reset otherwise ---
        const onDoubleClick = (e: MouseEvent) => {
            e.preventDefault();
            if (tRef.current.zoom <= MIN_ZOOM) {
                const local = toLocal(e.clientX, e.clientY);
                zoomAt(local.x, local.y, DOUBLE_TAP_ZOOM);
            } else {
                reset();
            }
        };

        // --- Touch gestures ---
        const onTouchStart = (e: TouchEvent) => {
            // Prevent Safari's built-in double-tap-to-zoom on all
            // touches within the canvas.
            e.preventDefault();

            if (e.touches.length === 2) {
                // Entering pinch - cancel any single-finger drag
                dragging.current = false;
                pinching.current = true;
                const [a, b] = [e.touches[0], e.touches[1]];
                pinchStartDist.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                pinchStartZoom.current = tRef.current.zoom;
                pinchMidStart.current = {
                    x: (a.clientX + b.clientX) / 2,
                    y: (a.clientY + b.clientY) / 2,
                };
                pinchPanStart.current = { x: tRef.current.panX, y: tRef.current.panY };
            } else if (e.touches.length === 1 && !pinching.current) {
                // Single-finger drag (only if not exiting a pinch)
                dragging.current = true;
                dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                panStart.current = { x: tRef.current.panX, y: tRef.current.panY };

                // Double-tap: zoom in when at 1x, reset otherwise
                const now = Date.now();
                if (now - lastTapTime.current < DOUBLE_TAP_MS) {
                    if (tRef.current.zoom <= MIN_ZOOM) {
                        const local = toLocal(e.touches[0].clientX, e.touches[0].clientY);
                        zoomAt(local.x, local.y, DOUBLE_TAP_ZOOM);
                    } else {
                        reset();
                    }
                    dragging.current = false;
                    lastTapTime.current = 0;
                } else {
                    lastTapTime.current = now;
                }
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            if (e.touches.length === 2 && pinching.current) {
                const [a, b] = [e.touches[0], e.touches[1]];
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                const newZoom = Math.max(
                    MIN_ZOOM,
                    Math.min(MAX_ZOOM, pinchStartZoom.current * (dist / pinchStartDist.current)),
                );

                // Midpoint in canvas-local coords for zoom anchor
                const midX = (a.clientX + b.clientX) / 2;
                const midY = (a.clientY + b.clientY) / 2;
                const midLocal = toLocal(midX, midY);
                const midStartLocal = toLocal(pinchMidStart.current.x, pinchMidStart.current.y);

                // Zoom around the initial pinch midpoint, then apply
                // the two-finger pan delta on top.
                const ratio = newZoom / pinchStartZoom.current;
                const nextPanX = midStartLocal.x - ratio * (midStartLocal.x - pinchPanStart.current.x);
                const nextPanY = midStartLocal.y - ratio * (midStartLocal.y - pinchPanStart.current.y);
                // Add the movement of the midpoint as a pan offset
                const panDx = midLocal.x - midStartLocal.x;
                const panDy = midLocal.y - midStartLocal.y;
                const pan = clampPan(nextPanX + panDx, nextPanY + panDy, newZoom);
                commit({ panX: pan.panX, panY: pan.panY, zoom: newZoom });
            } else if (e.touches.length === 1 && dragging.current) {
                const dx = e.touches[0].clientX - dragStart.current.x;
                const dy = e.touches[0].clientY - dragStart.current.y;
                const pan = clampPan(panStart.current.x + dx, panStart.current.y + dy, tRef.current.zoom);
                commit({ ...tRef.current, panX: pan.panX, panY: pan.panY });
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2 && pinching.current) {
                // Pinch ended - snapshot state so a remaining finger can
                // continue as a single-finger pan without a jump.
                pinching.current = false;
                if (e.touches.length === 1) {
                    dragging.current = true;
                    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    panStart.current = { x: tRef.current.panX, y: tRef.current.panY };
                }
            }
            if (e.touches.length === 0) {
                dragging.current = false;
                pinching.current = false;
            }
        };

        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("dblclick", onDoubleClick);
        canvas.addEventListener("touchstart", onTouchStart, { passive: false });
        canvas.addEventListener("touchmove", onTouchMove, { passive: false });
        canvas.addEventListener("touchend", onTouchEnd);

        return () => {
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerUp);
            canvas.removeEventListener("dblclick", onDoubleClick);
            canvas.removeEventListener("touchstart", onTouchStart);
            canvas.removeEventListener("touchmove", onTouchMove);
            canvas.removeEventListener("touchend", onTouchEnd);
        };
    }, [canvasRef, clampPan, commit, reset, toLocal, zoomAt]);

    // Reset transform when canvas ref changes (new map loaded)
    useEffect(() => {
        commit(DEFAULT_TRANSFORM);
    }, [canvasRef.current, commit]);

    return transform;
}
