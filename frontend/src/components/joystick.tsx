import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useI18n } from "../i18n";

export interface JoystickValue {
    x: number; // -1 (left) to 1 (right)
    y: number; // -1 (back) to 1 (forward)
    magnitude: number; // 0 to 1 (speed)
}

interface JoystickProps {
    size: number;
    onMove: (value: JoystickValue) => void;
    onRelease: () => void;
}

const KNOB_RATIO = 0.3; // knob radius as fraction of base radius
const DEAD_ZONE = 0.08;

export function Joystick({ size, onMove, onRelease }: JoystickProps) {
    const { t } = useI18n();
    const baseRef = useRef<HTMLDivElement>(null);
    const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
    const activeTouch = useRef<number | null>(null);

    const baseRadius = size / 2;
    const knobRadius = baseRadius * KNOB_RATIO;
    const maxOffset = baseRadius - knobRadius;

    // Keep callback refs stable to avoid re-render cascades
    const onMoveRef = useRef(onMove);
    const onReleaseRef = useRef(onRelease);
    const maxOffsetRef = useRef(maxOffset);
    onMoveRef.current = onMove;
    onReleaseRef.current = onRelease;
    maxOffsetRef.current = maxOffset;

    const processInput = useCallback((clientX: number, clientY: number) => {
        const el = baseRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const mo = maxOffsetRef.current;

        let dx = clientX - cx;
        let dy = clientY - cy;

        // Clamp to circle
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > mo) {
            dx = (dx / dist) * mo;
            dy = (dy / dist) * mo;
        }

        setKnobPos({ x: dx, y: dy });

        const nx = dx / mo;
        const ny = -dy / mo; // invert Y: up = positive
        const mag = Math.min(1, dist / mo);

        if (mag < DEAD_ZONE) {
            onMoveRef.current({ x: 0, y: 0, magnitude: 0 });
        } else {
            onMoveRef.current({ x: nx, y: ny, magnitude: mag });
        }
    }, []);

    const release = useCallback(() => {
        setKnobPos({ x: 0, y: 0 });
        activeTouch.current = null;
        onReleaseRef.current();
    }, []);

    // Touch events
    const onTouchStart = useCallback(
        (e: TouchEvent) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            activeTouch.current = t.identifier;
            processInput(t.clientX, t.clientY);
        },
        [processInput],
    );

    const onTouchMove = useCallback(
        (e: TouchEvent) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === activeTouch.current) {
                    processInput(t.clientX, t.clientY);
                    return;
                }
            }
        },
        [processInput],
    );

    const onTouchEnd = useCallback(
        (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === activeTouch.current) {
                    release();
                    return;
                }
            }
        },
        [release],
    );

    // Mouse events
    const mouseDown = useRef(false);

    const onMouseDown = useCallback(
        (e: MouseEvent) => {
            e.preventDefault();
            mouseDown.current = true;
            processInput(e.clientX, e.clientY);
        },
        [processInput],
    );

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (mouseDown.current) processInput(e.clientX, e.clientY);
        };
        const onMouseUp = () => {
            if (mouseDown.current) {
                mouseDown.current = false;
                release();
            }
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [processInput, release]);

    return (
        <div
            ref={baseRef}
            role="slider"
            aria-label={t("Joystick")}
            aria-valuemin={-1}
            aria-valuemax={1}
            aria-valuenow={0}
            tabIndex={0}
            class="joystick-base"
            style={{ width: size, height: size }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            onMouseDown={onMouseDown}
        >
            <div
                class="joystick-knob"
                style={{
                    width: knobRadius * 2,
                    height: knobRadius * 2,
                    transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
                }}
            />
        </div>
    );
}
