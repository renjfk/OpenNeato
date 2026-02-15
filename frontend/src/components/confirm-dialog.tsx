import { useState } from "preact/hooks";

interface ConfirmDialogProps {
    message: string;
    confirmLabel?: string;
    confirmText?: string; // When set, user must type this exact text to enable confirm
    disabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    message,
    confirmLabel = "Delete",
    confirmText,
    disabled = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const [typed, setTyped] = useState("");
    const textMatch = !confirmText || typed === confirmText;

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismiss is supplementary to Cancel button
        <div class="confirm-overlay" role="dialog" aria-modal="true" onClick={disabled ? undefined : onCancel}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not interactive */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog container */}
            <div class="confirm-dialog" onClick={(e) => e.stopPropagation()}>
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
                <div class="confirm-actions">
                    <button type="button" class="confirm-btn cancel" onClick={onCancel} disabled={disabled}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="confirm-btn destructive"
                        onClick={onConfirm}
                        disabled={disabled || !textMatch}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
