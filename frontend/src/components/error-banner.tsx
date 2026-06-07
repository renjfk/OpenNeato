import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import alertSvg from "../assets/icons/alert.svg?raw";
import warningSvg from "../assets/icons/warning.svg?raw";
import { useI18n } from "../i18n";
import { Icon } from "./icon";

// -- Single banner --

interface ErrorBannerProps {
    title?: string;
    message: string;
    variant?: "error" | "warning";
    onDismiss?: () => void;
}

export function ErrorBanner({ title = "Alert", message, variant = "error", onDismiss }: ErrorBannerProps) {
    const { t } = useI18n();
    const cls = variant === "warning" ? "error-banner warning" : "error-banner";
    return (
        <div class={cls}>
            <div class="error-banner-row">
                <div class="error-banner-icon">
                    <Icon svg={variant === "warning" ? warningSvg : alertSvg} />
                </div>
                <div class="error-banner-content">
                    <div class="error-banner-title">{t(title)}</div>
                    <div class="error-banner-msg">{t(message)}</div>
                </div>
                {onDismiss && (
                    <button type="button" class="error-banner-dismiss" onClick={onDismiss} aria-label={t("Dismiss")}>
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

interface DismissableError extends StackedError {
    _dismiss: () => void;
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
    const { t } = useI18n();
    if (errors.length === 0) return null;
    return (
        <div class="error-banner-stack">
            {errors.map((e) => (
                <ErrorBanner
                    key={e.id}
                    title={t("Error")}
                    message={e.message}
                    onDismiss={(e as DismissableError)._dismiss}
                />
            ))}
        </div>
    );
}
