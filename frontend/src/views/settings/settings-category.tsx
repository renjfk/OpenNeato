import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../../components/icon";

interface SettingsCategoryProps {
    title: string;
    icon: string;
    defaultOpen?: boolean;
    children: ComponentChildren;
}

export function SettingsCategory({ title, icon, defaultOpen = false, children }: SettingsCategoryProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div class={`settings-category${open ? " open" : ""}`}>
            <button type="button" class="settings-category-header" onClick={() => setOpen(!open)}>
                <div class="settings-category-title">
                    <Icon svg={icon} />
                    {title}
                </div>
                <span class="settings-category-chevron">&rsaquo;</span>
            </button>
            <div class="settings-category-body">
                <div class="settings-category-inner">{children}</div>
            </div>
        </div>
    );
}
