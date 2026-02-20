import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { ErrorStackHandle } from "../../components/error-banner";
import { useFetch } from "../../hooks/use-fetch";
import type { SettingsData } from "../../types";
import { DEFAULT_SERVER } from "./constants";

export function useSettingsForm(errorStack: ErrorStackHandle, startRebootFlow: () => void) {
    // Local form state
    const [tz, setTz] = useState<string>("UTC0");
    const [debugLog, setDebugLog] = useState(false);
    const [wifiTxPower, setWifiTxPower] = useState(60);
    const [uartTxPin, setUartTxPin] = useState(3);
    const [uartRxPin, setUartRxPin] = useState(4);
    const [hostname, setHostname] = useState("neato");
    const [stallThreshold, setStallThreshold] = useState(60);
    const [brushRpm, setBrushRpm] = useState(1200);
    const [vacuumSpeed, setVacuumSpeed] = useState(80);
    const [sideBrushPower, setSideBrushPower] = useState(1500);

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
            setDebugLog(fetched.debugLog);
            setWifiTxPower(fetched.wifiTxPower);
            setUartTxPin(fetched.uartTxPin);
            setUartRxPin(fetched.uartRxPin);
            setHostname(fetched.hostname);
            setStallThreshold(fetched.stallThreshold);
            setBrushRpm(fetched.brushRpm);
            setVacuumSpeed(fetched.vacuumSpeed);
            setSideBrushPower(fetched.sideBrushPower);
            setSettingsLoaded(true);
        }
    }, [fetched]);

    // --- Dirty / validation / reboot detection ---

    const isDirty =
        settingsLoaded &&
        (tz !== server.current.tz ||
            debugLog !== server.current.debugLog ||
            wifiTxPower !== server.current.wifiTxPower ||
            uartTxPin !== server.current.uartTxPin ||
            uartRxPin !== server.current.uartRxPin ||
            hostname !== server.current.hostname ||
            stallThreshold !== server.current.stallThreshold ||
            brushRpm !== server.current.brushRpm ||
            vacuumSpeed !== server.current.vacuumSpeed ||
            sideBrushPower !== server.current.sideBrushPower);

    const needsReboot =
        uartTxPin !== server.current.uartTxPin ||
        uartRxPin !== server.current.uartRxPin ||
        hostname !== server.current.hostname;

    const pinError =
        uartTxPin === uartRxPin
            ? "TX and RX cannot be the same pin"
            : uartTxPin < 0 || uartTxPin > 21 || uartRxPin < 0 || uartRxPin > 21
              ? "Pin must be 0-21"
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
        if (debugLog !== server.current.debugLog) patch.debugLog = debugLog;
        if (wifiTxPower !== server.current.wifiTxPower) patch.wifiTxPower = wifiTxPower;
        if (uartTxPin !== server.current.uartTxPin) patch.uartTxPin = uartTxPin;
        if (uartRxPin !== server.current.uartRxPin) patch.uartRxPin = uartRxPin;
        if (hostname !== server.current.hostname) patch.hostname = hostname;
        if (stallThreshold !== server.current.stallThreshold) patch.stallThreshold = stallThreshold;
        if (brushRpm !== server.current.brushRpm) patch.brushRpm = brushRpm;
        if (vacuumSpeed !== server.current.vacuumSpeed) patch.vacuumSpeed = vacuumSpeed;
        if (sideBrushPower !== server.current.sideBrushPower) patch.sideBrushPower = sideBrushPower;
        return patch;
    }, [
        tz,
        debugLog,
        wifiTxPower,
        uartTxPin,
        uartRxPin,
        hostname,
        stallThreshold,
        brushRpm,
        vacuumSpeed,
        sideBrushPower,
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
        debugLog,
        setDebugLog,
        wifiTxPower,
        setWifiTxPower,
        uartTxPin,
        setUartTxPin,
        uartRxPin,
        setUartRxPin,
        hostname,
        setHostname,
        stallThreshold,
        setStallThreshold,
        brushRpm,
        setBrushRpm,
        vacuumSpeed,
        setVacuumSpeed,
        sideBrushPower,
        setSideBrushPower,
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
