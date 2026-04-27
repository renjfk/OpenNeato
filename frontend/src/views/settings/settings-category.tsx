import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../../components/icon";

interface SettingsCategoryProps {
    title: string;
    icon: string;
    defaultOpen?: boolean;
    disabled?: boolean;
    // When true, children are only mounted after the section has been opened
    // at least once. Useful for sections that poll the device or run expensive
    // work the user shouldn't pay for unless they're looking at them.
    lazy?: boolean;
    children: ComponentChildren;
}

export function SettingsCategory({
    title,
    icon,
    defaultOpen = false,
    disabled,
    lazy = false,
    children,
}: SettingsCategoryProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [hasOpened, setHasOpened] = useState(defaultOpen);
    const showChildren = lazy ? hasOpened : true;
    return (
        <div class={`settings-category${open && !disabled ? " open" : ""}${disabled ? " disabled" : ""}`}>
            <button
                type="button"
                class="settings-category-header"
                onClick={() => {
                    if (disabled) return;
                    setOpen(!open);
                    if (!open) setHasOpened(true);
                }}
                disabled={disabled}
            >
                <div class="settings-category-title">
                    <Icon svg={icon} />
                    {title}
                </div>
                {!disabled && <span class="settings-category-chevron">&rsaquo;</span>}
            </button>
            <div class="settings-category-body">
                <div class="settings-category-inner">{showChildren && children}</div>
            </div>
        </div>
    );
}
