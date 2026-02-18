import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { Route, Router } from "./components/router";
import { usePolling } from "./hooks/use-polling";
import type { ChargerData, ErrorData, FirmwareVersion, StateData, SystemData } from "./types";
import { DashboardView } from "./views/dashboard";
import { LogsView } from "./views/logs";
import { ScheduleView } from "./views/schedule";
import { SettingsView } from "./views/settings";

type Theme = "system" | "dark" | "light";

const THEME_DARK = "#161618";
const THEME_LIGHT = "#ffffff";

function setThemeColor(color: string) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

function applyTheme(theme: Theme) {
    const html = document.documentElement;
    html.classList.remove("light", "system-theme");
    if (theme === "light") {
        html.classList.add("light");
        setThemeColor(THEME_LIGHT);
    } else if (theme === "system") {
        html.classList.add("system-theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setThemeColor(prefersDark ? THEME_DARK : THEME_LIGHT);
    } else {
        setThemeColor(THEME_DARK);
    }
}

function loadTheme(): Theme {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "system";
}

export function App() {
    const [theme, setTheme] = useState<Theme>(loadTheme);

    const themeInitialized = useRef(false);
    useEffect(() => {
        applyTheme(theme);
        if (themeInitialized.current) {
            localStorage.setItem("theme", theme);
        }
        themeInitialized.current = true;

        // When using system theme, track OS preference changes for status bar color
        if (theme === "system") {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            const onChange = (e: MediaQueryListEvent) => setThemeColor(e.matches ? THEME_DARK : THEME_LIGHT);
            mq.addEventListener("change", onChange);
            return () => mq.removeEventListener("change", onChange);
        }
    }, [theme]);

    const state = usePolling<StateData>(api.getState, 2000);
    const charger = usePolling<ChargerData>(api.getCharger, 5000);
    const error = usePolling<ErrorData>(api.getError, 2000);
    const system = usePolling<SystemData>(api.getSystem, 10000);
    const firmware = usePolling<FirmwareVersion>(api.getFirmwareVersion, 60000);

    return (
        <Router>
            <Route path="/">
                <DashboardView system={system} firmware={firmware} error={error} state={state} charger={charger} />
            </Route>
            <Route path="/settings">
                <SettingsView theme={theme} onThemeChange={setTheme} system={system.data} firmware={firmware.data} />
            </Route>
            <Route path="/schedule">
                <ScheduleView />
            </Route>
            <Route path="/logs" prefix>
                <LogsView />
            </Route>
        </Router>
    );
}
