import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import alertSvg from "../assets/icons/alert.svg?raw";
import { Icon } from "./icon";

// -- Single error banner (fixed or dismissible) --

interface ErrorBannerProps {
    title?: string;
    message: string;
    onDismiss?: () => void;
}

export function ErrorBanner({ title = "Alert", message, onDismiss }: ErrorBannerProps) {
    return (
        <div class="error-banner">
            <div class="error-banner-row">
                <div class="error-banner-icon">
                    <Icon svg={alertSvg} />
                </div>
                <div class="error-banner-content">
                    <div class="error-banner-title">{title}</div>
                    <div class="error-banner-msg">{message}</div>
                </div>
                {onDismiss && (
                    <button type="button" class="error-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
                        &times;
                    </button>
                )}
            </div>
        </div>
    );
}

// -- Stacked dismissible error banners --

interface StackedError {
    id: number;
    message: string;
}

export interface ErrorStackHandle {
    push: (message: string) => void;
    clear: () => void;
}

export function useErrorStack(): [StackedError[], ErrorStackHandle] {
    const [errors, setErrors] = useState<StackedError[]>([]);
    const nextId = useRef(0);

    const push = useCallback((message: string) => {
        setErrors((prev) => [...prev, { id: nextId.current++, message }]);
    }, []);

    const dismiss = useCallback((id: number) => {
        setErrors((prev) => prev.filter((e) => e.id !== id));
    }, []);

    const clear = useCallback(() => {
        setErrors([]);
    }, []);

    // Attach dismiss to the errors so the stack component can use it
    const errorsWithDismiss = useMemo(
        () => errors.map((e) => ({ ...e, _dismiss: () => dismiss(e.id) })),
        [errors, dismiss],
    );

    const handle = useMemo(() => ({ push, clear }), [push, clear]);

    return [errorsWithDismiss as StackedError[], handle];
}

interface ErrorBannerStackProps {
    errors: StackedError[];
}

export function ErrorBannerStack({ errors }: ErrorBannerStackProps) {
    if (errors.length === 0) return null;
    return (
        <div class="error-banner-stack">
            {errors.map((e) => (
                <ErrorBanner
                    key={e.id}
                    title="Error"
                    message={e.message}
                    onDismiss={(e as StackedError & { _dismiss: () => void })._dismiss}
                />
            ))}
        </div>
    );
}
