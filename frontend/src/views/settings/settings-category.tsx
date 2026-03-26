import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../../components/icon";

interface SettingsCategoryProps {
    title: string;
    icon: string;
    defaultOpen?: boolean;
    disabled?: boolean;
    children: ComponentChildren;
}

export function SettingsCategory({ title, icon, defaultOpen = false, disabled, children }: SettingsCategoryProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div class={`settings-category${open && !disabled ? " open" : ""}${disabled ? " disabled" : ""}`}>
            <button
                type="button"
                class="settings-category-header"
                onClick={() => !disabled && setOpen(!open)}
                disabled={disabled}
            >
                <div class="settings-category-title">
                    <Icon svg={icon} />
                    {title}
                </div>
                {!disabled && <span class="settings-category-chevron">&rsaquo;</span>}
            </button>
            <div class="settings-category-body">
                <div class="settings-category-inner">{children}</div>
            </div>
        </div>
    );
}
