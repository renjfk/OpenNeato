import type { JSX } from "preact";
import { useCallback } from "preact/hooks";
import { useI18n } from "../i18n";

interface TimeInputProps {
    value: string;
    onInput: (value: string) => void;
    class?: string;
    placeholder?: string;
    maxLength?: number;
    onKeyDown?: (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    ariaLabel?: string;
}

export function TimeInput({
    value,
    onInput,
    class: className,
    placeholder,
    maxLength,
    onKeyDown,
    disabled,
    ariaLabel,
}: TimeInputProps) {
    const { t } = useI18n();
    const handleInput = useCallback(
        (e: JSX.TargetedEvent<HTMLInputElement>) => {
            let val = e.currentTarget.value;
            if (/^\d{4}$/.test(val)) {
                val = `${val.slice(0, 2)}:${val.slice(2)}`;
            }
            onInput(val);
        },
        [onInput],
    );

    return (
        <input
            type="text"
            inputMode="numeric"
            class={className}
            value={value}
            onInput={handleInput}
            maxLength={maxLength}
            placeholder={placeholder ? t(placeholder) : undefined}
            onKeyDown={onKeyDown}
            disabled={disabled}
            aria-label={ariaLabel ? t(ariaLabel) : undefined}
        />
    );
}
