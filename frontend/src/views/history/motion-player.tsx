// Motion player — replays a finished cleaning session as a smoothly animated
// robot on the map. Drives the time-aware variant of renderMap via
// requestAnimationFrame and exposes play/pause, restart, and a scrubber.

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import pauseSvg from "../../assets/icons/pause.svg?raw";
import playSvg from "../../assets/icons/play.svg?raw";
import restartSvg from "../../assets/icons/restart.svg?raw";
import { Icon } from "../../components/icon";
import { useKeyShortcut } from "../../hooks/use-key-shortcut";
import type { MapData, MapTransform } from "../../types";
import { formatClock, renderMap, sessionDuration } from "./helpers";

interface MotionPlayerProps {
    canvas: HTMLCanvasElement | null;
    map: MapData;
    transform: MapTransform;
    // Seconds of session time played per real second. 1x replays in real time,
    // higher values speed the playback up proportionally.
    speed?: number;
    // When true, the player's controls render as normal but it does NOT
    // touch the canvas. Used by the host UI to keep play/restart/scrubber
    // visible while the loading wave still owns the canvas drawing surface.
    canvasSuspended?: boolean;
}

export function MotionPlayer({ canvas, map, transform, speed = 8, canvasSuspended }: MotionPlayerProps) {
    const duration = sessionDuration(map);
    const [playing, setPlaying] = useState(false);
    // Start at the end of the timeline so a freshly opened session shows the
    // completed map. Pressing play rewinds to 0 and animates forward.
    const [currentTime, setCurrentTime] = useState(duration);

    // Refs used inside the rAF loop so we don't recreate the loop on every
    // state change. The loop reads the latest time via ref.
    const timeRef = useRef(duration);
    const lastFrameRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    // Keep ref in sync so rAF reads live value.
    useEffect(() => {
        timeRef.current = currentTime;
    }, [currentTime]);

    // Re-render canvas whenever the time, transform, or map changes. This
    // runs on every animation frame tick via the setCurrentTime update.
    // While `canvasSuspended` is true the wave owns the canvas, so we
    // skip painting; once the host clears the suspension this effect
    // re-runs and lays down the current playhead state.
    useEffect(() => {
        if (canvasSuspended) return;
        if (!canvas || !map) return;
        renderMap(canvas, map, false, transform, currentTime);
    }, [canvas, map, transform, currentTime, canvasSuspended]);

    // Re-render on resize — canvas backing store gets invalidated.
    useEffect(() => {
        if (canvasSuspended) return;
        if (!canvas) return;
        const onResize = () => {
            renderMap(canvas, map, false, transform, timeRef.current);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [canvas, map, transform, canvasSuspended]);

    // Reset to the completed map whenever the session switches. The scrubber
    // anchors at `duration` so the user sees the full session at rest.
    useEffect(() => {
        setPlaying(false);
        setCurrentTime(duration);
    }, [map, duration]);

    // Animation loop. Advances session time based on wall-clock delta * speed.
    useEffect(() => {
        if (!playing) {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            return;
        }
        lastFrameRef.current = performance.now();
        const tick = (now: number) => {
            const dt = (now - lastFrameRef.current) / 1000;
            lastFrameRef.current = now;
            const next = timeRef.current + dt * speed;
            if (next >= duration) {
                setCurrentTime(duration);
                setPlaying(false);
                return;
            }
            setCurrentTime(next);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [playing, duration, speed]);

    const handleTogglePlay = useCallback(() => {
        setPlaying((prev) => {
            if (prev) return false;
            // Pressing play from the resting "full map" state (or after a
            // previous playback finished) rewinds to the beginning so the
            // user sees a proper replay.
            if (timeRef.current >= duration) setCurrentTime(0);
            return true;
        });
    }, [duration]);

    const handleRestart = useCallback(() => {
        // Cancel any in-flight rAF tick, jump the playhead to 0, and pause
        // so the user can resume playback manually when ready.
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        timeRef.current = 0;
        setCurrentTime(0);
        setPlaying(false);
    }, []);

    // Seek by a constant delta (seconds), clamped to the session range.
    // Used by the arrow-key shortcuts — a small step for single presses, a
    // larger jump when Shift is held. Pauses playback so the rAF loop
    // doesn't fight the seek by overwriting the time on the next tick.
    const seekBy = useCallback(
        (delta: number) => {
            setPlaying(false);
            const next = Math.max(0, Math.min(duration, timeRef.current + delta));
            timeRef.current = next;
            setCurrentTime(next);
        },
        [duration],
    );

    const seekStep = duration * 0.01;
    const seekJump = duration * 0.05;

    // Keyboard shortcuts — space toggles play/pause, left/right seek by one
    // small step, shift+left/right jump further.
    useKeyShortcut(handleTogglePlay, { key: " ", code: "Space" });
    useKeyShortcut(() => seekBy(-seekStep), { key: "ArrowLeft" });
    useKeyShortcut(() => seekBy(seekStep), { key: "ArrowRight" });
    useKeyShortcut(() => seekBy(-seekJump), { key: "ArrowLeft", modifiers: { shift: true } });
    useKeyShortcut(() => seekBy(seekJump), { key: "ArrowRight", modifiers: { shift: true } });

    const handleScrub = useCallback(
        (e: Event) => {
            const input = e.currentTarget as HTMLInputElement;
            const v = Number(input.value);
            if (!Number.isFinite(v)) return;
            setCurrentTime(Math.max(0, Math.min(duration, v)));
        },
        [duration],
    );

    const handleScrubStart = useCallback(() => {
        // Pause while the user drags so the scrubber doesn't fight the loop.
        setPlaying(false);
    }, []);

    // Background gradient for the scrubber track: green for active cleaning,
    // yellow for recharge windows, and a darker "unplayed" overlay past the
    // current playhead. Composited as two gradients — the bottom layer is
    // the full cleaning/recharge timeline, the top layer dims the future.
    const { trackLayers, playedPercent } = useMemo(() => {
        if (duration <= 0) return { trackLayers: "", playedPercent: 0 };
        const CLEAN = "rgba(52, 199, 89, 0.75)";
        const CHARGE = "rgba(255, 204, 0, 0.85)";

        // Sort and clamp recharge windows to [0, duration]
        const windows = map.recharges
            .map((r) => [Math.max(0, Math.min(duration, r.ts)), Math.max(0, Math.min(duration, r.endTs))] as const)
            .filter(([a, b]) => b > a)
            .sort((a, b) => a[0] - b[0]);

        // Build hard-edged gradient stops walking forward through time.
        const stops: string[] = [];
        let cursor = 0;
        const toPct = (t: number) => `${((t / duration) * 100).toFixed(3)}%`;
        const pushSegment = (color: string, from: number, to: number) => {
            stops.push(`${color} ${toPct(from)}`);
            stops.push(`${color} ${toPct(to)}`);
        };
        for (const [from, to] of windows) {
            if (from > cursor) pushSegment(CLEAN, cursor, from);
            pushSegment(CHARGE, Math.max(cursor, from), to);
            cursor = to;
        }
        if (cursor < duration) pushSegment(CLEAN, cursor, duration);

        const timeline = `linear-gradient(to right, ${stops.join(", ")})`;
        const pct = (Math.min(duration, Math.max(0, currentTime)) / duration) * 100;
        return { trackLayers: timeline, playedPercent: pct };
    }, [duration, map.recharges, currentTime]);

    // Render a disabled shell when there isn't enough data to animate, so the
    // layout stays stable while the session loads.
    if (duration <= 0 || map.path.length === 0) {
        return null;
    }

    return (
        <div class="history-player">
            <div class="history-player-controls">
                <button
                    type="button"
                    class="history-player-btn"
                    onClick={handleTogglePlay}
                    aria-label={playing ? "Pause" : "Play"}
                >
                    <Icon svg={playing ? pauseSvg : playSvg} />
                </button>
                <button type="button" class="history-player-btn" onClick={handleRestart} aria-label="Restart">
                    <Icon svg={restartSvg} />
                </button>
                <span class="history-player-time" title="Elapsed time">
                    {formatClock(currentTime)}
                </span>
                <input
                    type="range"
                    class="history-player-scrubber"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={currentTime}
                    onInput={handleScrub}
                    onMouseDown={handleScrubStart}
                    onTouchStart={handleScrubStart}
                    aria-label="Seek"
                    style={{
                        "--track": trackLayers,
                        "--played": `${playedPercent}%`,
                    }}
                />
                <span class="history-player-time" title="Total time">
                    {formatClock(duration)}
                </span>
            </div>
        </div>
    );
}
