import { useState } from "preact/hooks";

interface ConfirmDialogProps {
    message: string;
    confirmLabel?: string;
    // When true (default), the confirm button is rendered as a destructive
    // (red) action. Set to false for benign confirmations like Connect.
    destructive?: boolean;
    // When set, user must type this exact text to enable confirm. Useful for
    // destructive actions (e.g. "Type RESET to confirm").
    confirmText?: string;
    // Prompts the user for a free-form value (text or password). The entered
    // value is passed to `onConfirm`. When `inputRequired` is true the
    // confirm button is disabled until the field is non-empty.
    inputType?: "text" | "password";
    inputPlaceholder?: string;
    inputLabel?: string;
    inputRequired?: boolean;
    disabled?: boolean;
    onConfirm: (value?: string) => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    message,
    confirmLabel = "Delete",
    destructive = true,
    confirmText,
    inputType,
    inputPlaceholder,
    inputLabel,
    inputRequired = false,
    disabled = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const [typed, setTyped] = useState("");
    const [value, setValue] = useState("");
    const textMatch = !confirmText || typed === confirmText;
    const valueOk = !inputType || !inputRequired || value.length > 0;

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismiss is supplementary to Cancel button
        <div class="confirm-overlay" role="dialog" aria-modal="true" onClick={disabled ? undefined : onCancel}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not interactive */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog container */}
            <div
                class={`confirm-dialog ${destructive ? "destructive" : "primary"}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div class="confirm-message">{message}</div>
                {confirmText && (
                    <div class="confirm-text-input-wrap">
                        <label class="confirm-text-label" htmlFor="confirm-text">
                            Type <strong>{confirmText}</strong> to confirm
                        </label>
                        <input
                            id="confirm-text"
                            type="text"
                            class="confirm-text-input"
                            value={typed}
                            onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
                            autocomplete="off"
                            spellcheck={false}
                            disabled={disabled}
                        />
                    </div>
                )}
                {inputType && (
                    <div class="confirm-text-input-wrap">
                        {inputLabel && (
                            <label class="confirm-text-label" htmlFor="confirm-input-value">
                                {inputLabel}
                            </label>
                        )}
                        <input
                            id="confirm-input-value"
                            type={inputType}
                            class="confirm-text-input"
                            value={value}
                            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                            placeholder={inputPlaceholder}
                            autocomplete={inputType === "password" ? "current-password" : "off"}
                            spellcheck={false}
                            disabled={disabled}
                        />
                    </div>
                )}
                <div class="confirm-actions">
                    <button type="button" class="confirm-btn cancel" onClick={onCancel} disabled={disabled}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        class={`confirm-btn ${destructive ? "destructive" : "primary"}`}
                        onClick={() => onConfirm(inputType ? value : undefined)}
                        disabled={disabled || !textMatch || !valueOk}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
