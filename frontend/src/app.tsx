import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { Route, Router } from "./components/router";
import { usePolling } from "./hooks/use-polling";
import type { FirmwareVersion, ManualStatus, StateData } from "./types";
import { checkForUpdate, getAvailableUpdate, type UpdateInfo } from "./update";
import { DashboardView } from "./views/dashboard";
import { HistoryView } from "./views/history";
import { LogsView } from "./views/logs";
import { ManualView } from "./views/manual";
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
    const firmware = usePolling<FirmwareVersion>(api.getFirmwareVersion, 60000);

    // --- Update check (browser-side, GitHub releases API) ---
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const updateChecked = useRef(false);

    useEffect(() => {
        const version = firmware.data?.version;
        if (!version || updateChecked.current) return;
        updateChecked.current = true;

        // Read any previously stored result immediately
        setUpdateInfo(getAvailableUpdate(version));

        // Fire-and-forget check (respects 6h interval internally)
        checkForUpdate(version).then(() => {
            setUpdateInfo(getAvailableUpdate(version));
        });
    }, [firmware.data?.version]);

    // Derive manual mode from polled state — single source of truth
    const isManual = state.data?.uiState?.includes("MANUALCLEANING") ?? false;

    // Poll manual status (safety + motor state) when in manual mode
    const manualStatus = usePolling<ManualStatus>(api.getManualStatus, isManual ? 500 : 0);

    // Motor toggle state — owned at app level, persists across page navigation
    const [brush, setBrush] = useState(false);
    const [vacuum, setVacuum] = useState(false);
    const [sideBrush, setSideBrush] = useState(false);

    // Sync motor state from firmware (e.g. after wheel-lift safety stop)
    useEffect(() => {
        if (!isManual) {
            setBrush(false);
            setVacuum(false);
            setSideBrush(false);
        } else if (manualStatus.data) {
            setBrush(manualStatus.data.brush);
            setVacuum(manualStatus.data.vacuum);
            setSideBrush(manualStatus.data.sideBrush);
        }
    }, [isManual, manualStatus.data]);

    const toggleBrush = useCallback(async () => {
        const next = !brush;
        await api.manualMotors(next, vacuum, sideBrush);
        setBrush(next);
    }, [brush, vacuum, sideBrush]);

    const toggleVacuum = useCallback(async () => {
        const next = !vacuum;
        await api.manualMotors(brush, next, sideBrush);
        setVacuum(next);
    }, [brush, vacuum, sideBrush]);

    const toggleSideBrush = useCallback(async () => {
        const next = !sideBrush;
        await api.manualMotors(brush, vacuum, next);
        setSideBrush(next);
    }, [brush, vacuum, sideBrush]);

    const toggleAll = useCallback(async () => {
        const allOn = brush && vacuum && sideBrush;
        const next = !allOn;
        await api.manualMotors(next, next, next);
        setBrush(next);
        setVacuum(next);
        setSideBrush(next);
    }, [brush, vacuum, sideBrush]);

    // When the robot is still identifying or unsupported, the dashboard shows a
    // gate message in the hero area with action buttons disabled, but settings,
    // logs, and other ESP32-only pages remain accessible so the user can fix
    // UART pins, update firmware, or diagnose the issue (#14).
    const robotReady = !!(firmware.data && !firmware.data.identifying && firmware.data.supported);

    return (
        <Router>
            <Route path="/">
                <DashboardView
                    firmware={firmware}
                    state={state}
                    isManual={isManual}
                    updateInfo={updateInfo}
                    robotReady={robotReady}
                    identifying={!firmware.data || firmware.data.identifying}
                />
            </Route>
            <Route path="/settings">
                <SettingsView theme={theme} onThemeChange={setTheme} firmware={firmware.data} />
            </Route>
            {robotReady && (
                <Route path="/manual">
                    <ManualView
                        isManual={isManual}
                        status={manualStatus.data}
                        brush={brush}
                        vacuum={vacuum}
                        sideBrush={sideBrush}
                        onToggleBrush={toggleBrush}
                        onToggleVacuum={toggleVacuum}
                        onToggleSideBrush={toggleSideBrush}
                        onToggleAll={toggleAll}
                    />
                </Route>
            )}
            <Route path="/schedule">
                <ScheduleView />
            </Route>
            <Route path="/logs" prefix>
                <LogsView />
            </Route>
            <Route path="/history" prefix>
                <HistoryView />
            </Route>
        </Router>
    );
}
