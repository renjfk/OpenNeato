import { useState } from "preact/hooks";
import { useI18n } from "../i18n";

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
    const { t } = useI18n();
    const [typed, setTyped] = useState("");
    const [value, setValue] = useState("");
    const localizedConfirmText = confirmText ? t(confirmText) : undefined;
    const textMatch = !localizedConfirmText || typed === localizedConfirmText;
    const valueOk = !inputType || !inputRequired || value.length > 0;

    return (
        <div class="confirm-overlay" role="dialog" aria-modal="true" onClick={disabled ? undefined : onCancel}>
            <div
                class={`confirm-dialog ${destructive ? "destructive" : "primary"}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div class="confirm-message">{t(message)}</div>
                {confirmText && (
                    <div class="confirm-text-input-wrap">
                        <label class="confirm-text-label" htmlFor="confirm-text">
                            {t("Type {confirmText} to confirm", { confirmText: localizedConfirmText ?? "" })}
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
                                {t(inputLabel)}
                            </label>
                        )}
                        <input
                            id="confirm-input-value"
                            type={inputType}
                            class="confirm-text-input"
                            value={value}
                            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
                            placeholder={inputPlaceholder ? t(inputPlaceholder) : undefined}
                            autocomplete={inputType === "password" ? "current-password" : "off"}
                            spellcheck={false}
                            disabled={disabled}
                        />
                    </div>
                )}
                <div class="confirm-actions">
                    <button type="button" class="confirm-btn cancel" onClick={onCancel} disabled={disabled}>
                        {t("Cancel")}
                    </button>
                    <button
                        type="button"
                        class={`confirm-btn ${destructive ? "destructive" : "primary"}`}
                        onClick={() => onConfirm(inputType ? value : undefined)}
                        disabled={disabled || !textMatch || !valueOk}
                    >
                        {t(confirmLabel)}
                    </button>
                </div>
            </div>
        </div>
    );
}
