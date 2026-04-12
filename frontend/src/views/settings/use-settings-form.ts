import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { ErrorStackHandle } from "../../components/error-banner";
import { useFetch } from "../../hooks/use-fetch";
import type { SettingsData } from "../../types";
import { DEFAULT_SERVER } from "./constants";

export function useSettingsForm(errorStack: ErrorStackHandle, startRebootFlow: () => void) {
    // Local form state
    const [tz, setTz] = useState<string>("UTC0");
    const [logLevel, setLogLevel] = useState(0);
    const [wifiTxPower, setWifiTxPower] = useState(60);
    const [uartTxPin, setUartTxPin] = useState(3);
    const [uartRxPin, setUartRxPin] = useState(4);
    const [maxGpioPin, setMaxGpioPin] = useState(21);
    const [hostname, setHostname] = useState("neato");
    const [navMode, setNavMode] = useState("Normal");
    const [stallThreshold, setStallThreshold] = useState(60);
    const [brushRpm, setBrushRpm] = useState(1200);
    const [vacuumSpeed, setVacuumSpeed] = useState(80);
    const [sideBrushPower, setSideBrushPower] = useState(1500);
    const [ntfyTopic, setNtfyTopic] = useState("");
    const [ntfyEnabled, setNtfyEnabled] = useState(false);
    const [ntfyOnDone, setNtfyOnDone] = useState(true);
    const [ntfyOnError, setNtfyOnError] = useState(true);
    const [ntfyOnAlert, setNtfyOnAlert] = useState(true);
    const [ntfyOnDocking, setNtfyOnDocking] = useState(true);

    // Server-confirmed state — used to compute dirty/needsReboot
    const server = useRef<SettingsData>({ ...DEFAULT_SERVER });
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Save flow
    const [saving, setSaving] = useState(false);
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);

    // Fetch settings on mount (do NOT sync from system polling to avoid races)
    const { data: fetched } = useFetch(api.getSettings);

    useEffect(() => {
        if (fetched) {
            server.current = { ...fetched };
            setTz(fetched.tz);
            setLogLevel(fetched.logLevel);
            setWifiTxPower(fetched.wifiTxPower);
            setUartTxPin(fetched.uartTxPin);
            setUartRxPin(fetched.uartRxPin);
            setMaxGpioPin(fetched.maxGpioPin);
            setHostname(fetched.hostname);
            setNavMode(fetched.navMode ?? "Normal");
            setStallThreshold(fetched.stallThreshold);
            setBrushRpm(fetched.brushRpm);
            setVacuumSpeed(fetched.vacuumSpeed);
            setSideBrushPower(fetched.sideBrushPower);
            setNtfyTopic(fetched.ntfyTopic ?? "");
            setNtfyEnabled(fetched.ntfyEnabled ?? false);
            setNtfyOnDone(fetched.ntfyOnDone ?? true);
            setNtfyOnError(fetched.ntfyOnError ?? true);
            setNtfyOnAlert(fetched.ntfyOnAlert ?? true);
            setNtfyOnDocking(fetched.ntfyOnDocking ?? true);
            setSettingsLoaded(true);
        }
    }, [fetched]);

    // --- Dirty / validation / reboot detection ---

    const isDirty =
        settingsLoaded &&
        (tz !== server.current.tz ||
            logLevel !== server.current.logLevel ||
            wifiTxPower !== server.current.wifiTxPower ||
            uartTxPin !== server.current.uartTxPin ||
            uartRxPin !== server.current.uartRxPin ||
            hostname !== server.current.hostname ||
            navMode !== (server.current.navMode ?? "Normal") ||
            stallThreshold !== server.current.stallThreshold ||
            brushRpm !== server.current.brushRpm ||
            vacuumSpeed !== server.current.vacuumSpeed ||
            sideBrushPower !== server.current.sideBrushPower ||
            ntfyTopic !== (server.current.ntfyTopic ?? "") ||
            ntfyEnabled !== (server.current.ntfyEnabled ?? false) ||
            ntfyOnDone !== (server.current.ntfyOnDone ?? true) ||
            ntfyOnError !== (server.current.ntfyOnError ?? true) ||
            ntfyOnAlert !== (server.current.ntfyOnAlert ?? true) ||
            ntfyOnDocking !== (server.current.ntfyOnDocking ?? true));

    const needsReboot =
        uartTxPin !== server.current.uartTxPin ||
        uartRxPin !== server.current.uartRxPin ||
        hostname !== server.current.hostname;

    const pinError =
        uartTxPin === uartRxPin
            ? "TX and RX cannot be the same pin"
            : uartTxPin < 0 || uartTxPin > maxGpioPin || uartRxPin < 0 || uartRxPin > maxGpioPin
              ? `Pin must be 0-${maxGpioPin}`
              : null;

    const hostnameError =
        hostname.length === 0
            ? "Hostname cannot be empty"
            : hostname.length > 32
              ? "Max 32 characters"
              : !/^[a-zA-Z0-9-]+$/.test(hostname)
                ? "Only letters, numbers, and hyphens"
                : null;

    const validationError = pinError || hostnameError;

    // --- Unified save ---

    const buildPatch = useCallback((): Partial<SettingsData> => {
        const patch: Partial<SettingsData> = {};
        if (tz !== server.current.tz) patch.tz = tz;
        if (logLevel !== server.current.logLevel) patch.logLevel = logLevel;
        if (wifiTxPower !== server.current.wifiTxPower) patch.wifiTxPower = wifiTxPower;
        if (uartTxPin !== server.current.uartTxPin) patch.uartTxPin = uartTxPin;
        if (uartRxPin !== server.current.uartRxPin) patch.uartRxPin = uartRxPin;
        if (hostname !== server.current.hostname) patch.hostname = hostname;
        if (navMode !== (server.current.navMode ?? "Normal")) patch.navMode = navMode;
        if (stallThreshold !== server.current.stallThreshold) patch.stallThreshold = stallThreshold;
        if (brushRpm !== server.current.brushRpm) patch.brushRpm = brushRpm;
        if (vacuumSpeed !== server.current.vacuumSpeed) patch.vacuumSpeed = vacuumSpeed;
        if (sideBrushPower !== server.current.sideBrushPower) patch.sideBrushPower = sideBrushPower;
        if (ntfyTopic !== (server.current.ntfyTopic ?? "")) patch.ntfyTopic = ntfyTopic;
        if (ntfyEnabled !== (server.current.ntfyEnabled ?? false)) patch.ntfyEnabled = ntfyEnabled;
        if (ntfyOnDone !== (server.current.ntfyOnDone ?? true)) patch.ntfyOnDone = ntfyOnDone;
        if (ntfyOnError !== (server.current.ntfyOnError ?? true)) patch.ntfyOnError = ntfyOnError;
        if (ntfyOnAlert !== (server.current.ntfyOnAlert ?? true)) patch.ntfyOnAlert = ntfyOnAlert;
        if (ntfyOnDocking !== (server.current.ntfyOnDocking ?? true)) patch.ntfyOnDocking = ntfyOnDocking;
        return patch;
    }, [
        tz,
        logLevel,
        wifiTxPower,
        uartTxPin,
        uartRxPin,
        hostname,
        navMode,
        stallThreshold,
        brushRpm,
        vacuumSpeed,
        sideBrushPower,
        ntfyTopic,
        ntfyEnabled,
        ntfyOnDone,
        ntfyOnError,
        ntfyOnAlert,
        ntfyOnDocking,
    ]);

    const handleSave = useCallback(() => {
        const willReboot = needsReboot;
        setSaving(true);
        api.updateSettings(buildPatch())
            .then((res) => {
                server.current = { ...res };
                setShowSaveConfirm(false);
                if (willReboot) {
                    startRebootFlow();
                }
            })
            .catch((e: unknown) => {
                if (e instanceof TypeError && willReboot) {
                    setShowSaveConfirm(false);
                    startRebootFlow();
                } else {
                    errorStack.push(e instanceof Error ? e.message : "Failed to save settings");
                    setShowSaveConfirm(false);
                }
            })
            .finally(() => setSaving(false));
    }, [buildPatch, needsReboot, startRebootFlow, errorStack]);

    const onSaveClick = useCallback(() => {
        if (needsReboot) {
            setShowSaveConfirm(true);
        } else {
            handleSave();
        }
    }, [needsReboot, handleSave]);

    const saveLabel = saving ? "Saving..." : needsReboot ? "Save & Reboot" : "Save";

    return {
        // Form fields
        tz,
        setTz,
        logLevel,
        setLogLevel,
        wifiTxPower,
        setWifiTxPower,
        uartTxPin,
        setUartTxPin,
        uartRxPin,
        setUartRxPin,
        maxGpioPin,
        hostname,
        setHostname,
        navMode,
        setNavMode,
        stallThreshold,
        setStallThreshold,
        brushRpm,
        setBrushRpm,
        vacuumSpeed,
        setVacuumSpeed,
        sideBrushPower,
        setSideBrushPower,
        ntfyTopic,
        setNtfyTopic,
        ntfyEnabled,
        setNtfyEnabled,
        ntfyOnDone,
        setNtfyOnDone,
        ntfyOnError,
        setNtfyOnError,
        ntfyOnAlert,
        setNtfyOnAlert,
        ntfyOnDocking,
        setNtfyOnDocking,
        // Derived state
        isDirty,
        needsReboot,
        pinError,
        hostnameError,
        validationError,
        // Save flow
        saving,
        showSaveConfirm,
        setShowSaveConfirm,
        saveLabel,
        handleSave,
        onSaveClick,
    };
}
