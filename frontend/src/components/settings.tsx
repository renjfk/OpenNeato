import backSvg from "../assets/icons/back.svg?raw";
import moonSvg from "../assets/icons/moon.svg?raw";
import sunSvg from "../assets/icons/sun.svg?raw";
import { Icon } from "./icon";

type Theme = "system" | "dark" | "light";

interface SettingsProps {
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    onBack: () => void;
}

export function Settings({ theme, onThemeChange, onBack }: SettingsProps) {
    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={onBack} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>Settings</h1>
                <div class="header-right-spacer" />
            </div>

            <div class="settings-page">
                <div class="settings-section">
                    <div class="settings-section-title">Appearance</div>
                    <div class="settings-theme-row">
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "system" ? " active" : ""}`}
                            onClick={() => onThemeChange("system")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={sunSvg} />
                                <Icon svg={moonSvg} />
                            </div>
                            Auto
                        </button>
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "light" ? " active" : ""}`}
                            onClick={() => onThemeChange("light")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={sunSvg} />
                            </div>
                            Light
                        </button>
                        <button
                            type="button"
                            class={`settings-theme-btn${theme === "dark" ? " active" : ""}`}
                            onClick={() => onThemeChange("dark")}
                        >
                            <div class="settings-theme-icon">
                                <Icon svg={moonSvg} />
                            </div>
                            Dark
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
