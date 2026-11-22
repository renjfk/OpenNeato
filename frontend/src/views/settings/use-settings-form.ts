import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { ErrorStackHandle } from "../../components/error-banner";
import { useFetch } from "../../hooks/use-fetch";
import type { SettingsData } from "../../types";
import { fmtTime, normalizeError, parseTime } from "../../utils";
import { DEFAULT_SERVER } from "./constants";

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

function isValidIpv4(value: string): boolean {
    return IPV4_PATTERN.test(value) && value.split(".").every((octet) => +octet <= 255);
}

function ipv4ToNumber(value: string): number {
    return value.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

// Same checks the firmware applies: usable host address, contiguous mask,
// gateway inside the same subnet, and neither address equal to the gateway,
// the network address, or the broadcast address.
function isValidStaticIpConfig(ip: string, gateway: string, subnet: string): boolean {
    if (!isValidIpv4(ip) || !isValidIpv4(gateway) || !isValidIpv4(subnet)) return false;

    const ipAddr = ipv4ToNumber(ip);
    const gatewayAddr = ipv4ToNumber(gateway);
    const mask = ipv4ToNumber(subnet);
    if (ipAddr === 0 || gatewayAddr === 0 || mask === 0) return false;

    const inverted = ~mask;
    if ((inverted & (inverted + 1)) !== 0) return false;
    if (ipAddr === gatewayAddr) return false;
    if ((ipAddr & mask) !== (gatewayAddr & mask)) return false;

    const network = (ipAddr & mask) >>> 0;
    const broadcast = (network | inverted) >>> 0;
    return ipAddr !== network && ipAddr !== broadcast;
}

function isValidDns(value: string): boolean {
    return isValidIpv4(value) && ipv4ToNumber(value) !== 0;
}

export function useSettingsForm(errorStack: ErrorStackHandle, startRebootFlow: () => void) {
    // Local form state
    const [tz, setTz] = useState<string>("UTC0");
    const [logLevel, setLogLevel] = useState(0);
    const [apFallbackOnDisconnect, setApFallbackOnDisconnect] = useState(true);
    const [staticIpEnabled, setStaticIpEnabled] = useState(false);
    const [staticIp, setStaticIp] = useState("");
    const [staticGateway, setStaticGateway] = useState("");
    const [staticSubnet, setStaticSubnet] = useState("");
    const [staticDns, setStaticDns] = useState("");
    const [syslogEnabled, setSyslogEnabled] = useState(false);
    const [syslogIp, setSyslogIp] = useState("");
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
    const [autoRestartEnabled, setAutoRestartEnabled] = useState(false);
    const [autoRestartTime, setAutoRestartTime] = useState("03:00");
    const [restartBeforeClean, setRestartBeforeClean] = useState(false);

    // Server-confirmed state - used to compute dirty/needsReboot
    const server = useRef<SettingsData>({ ...DEFAULT_SERVER });
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Save flow
    const [saving, setSaving] = useState(false);
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);
    // Reboot overlay hints after a static IP change, the page the user is on
    // may not answer anymore once the device comes back.
    const [rebootAddress, setRebootAddress] = useState<string | null>(null);
    const [rebootClearsStaticIp, setRebootClearsStaticIp] = useState(false);

    // Fetch settings on mount (do NOT sync from system polling to avoid races)
    const { data: fetched } = useFetch(api.getSettings);

    useEffect(() => {
        if (fetched) {
            server.current = { ...fetched };
            setTz(fetched.tz);
            setLogLevel(fetched.logLevel);
            setApFallbackOnDisconnect(fetched.apFallbackOnDisconnect ?? true);
            setStaticIpEnabled(fetched.staticIpEnabled ?? false);
            setStaticIp(fetched.staticIp ?? "");
            setStaticGateway(fetched.staticGateway ?? "");
            setStaticSubnet(fetched.staticSubnet ?? "");
            setStaticDns(fetched.staticDns ?? "");
            setSyslogEnabled(fetched.syslogEnabled ?? false);
            setSyslogIp(fetched.syslogIp ?? "");
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
            setAutoRestartEnabled(fetched.autoRestartEnabled ?? false);
            setAutoRestartTime(fmtTime(fetched.autoRestartHour ?? 3, fetched.autoRestartMinute ?? 0));
            setRestartBeforeClean(fetched.restartBeforeClean ?? false);
            setSettingsLoaded(true);
        }
    }, [fetched]);

    const parsedMaintenanceTime = parseTime(autoRestartTime);

    // --- Dirty / validation / reboot detection ---

    const isDirty =
        settingsLoaded &&
        (tz !== server.current.tz ||
            logLevel !== server.current.logLevel ||
            apFallbackOnDisconnect !== (server.current.apFallbackOnDisconnect ?? true) ||
            staticIpEnabled !== (server.current.staticIpEnabled ?? false) ||
            staticIp !== (server.current.staticIp ?? "") ||
            staticGateway !== (server.current.staticGateway ?? "") ||
            staticSubnet !== (server.current.staticSubnet ?? "") ||
            staticDns !== (server.current.staticDns ?? "") ||
            syslogEnabled !== (server.current.syslogEnabled ?? false) ||
            syslogIp !== (server.current.syslogIp ?? "") ||
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
            ntfyOnDocking !== (server.current.ntfyOnDocking ?? true) ||
            autoRestartEnabled !== (server.current.autoRestartEnabled ?? false) ||
            autoRestartTime !== fmtTime(server.current.autoRestartHour ?? 3, server.current.autoRestartMinute ?? 0) ||
            restartBeforeClean !== (server.current.restartBeforeClean ?? false));

    const needsReboot =
        uartTxPin !== server.current.uartTxPin ||
        uartRxPin !== server.current.uartRxPin ||
        hostname !== server.current.hostname ||
        staticIpEnabled !== (server.current.staticIpEnabled ?? false) ||
        staticIp !== (server.current.staticIp ?? "") ||
        staticGateway !== (server.current.staticGateway ?? "") ||
        staticSubnet !== (server.current.staticSubnet ?? "") ||
        staticDns !== (server.current.staticDns ?? "");

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

    const syslogIpError = syslogEnabled
        ? syslogIp.trim().length === 0
            ? "IP address is required when syslog is enabled"
            : !isValidIpv4(syslogIp.trim())
              ? "Must be a valid IPv4 address"
              : null
        : null;

    const autoRestartTimeError = autoRestartEnabled ? (!parsedMaintenanceTime ? "Use HH:MM format" : null) : null;

    const staticIpError = !staticIpEnabled
        ? null
        : !isValidIpv4(staticIp)
          ? "Enter a valid IP address"
          : !isValidIpv4(staticGateway)
            ? "Enter a valid gateway address"
            : !isValidIpv4(staticSubnet)
              ? "Enter a valid subnet mask"
              : !isValidStaticIpConfig(staticIp, staticGateway, staticSubnet)
                ? "IP, gateway, and subnet mask are inconsistent"
                : staticDns.length > 0 && !isValidDns(staticDns)
                  ? "Enter a valid DNS address"
                  : null;

    const validationError = pinError || hostnameError || syslogIpError || autoRestartTimeError || staticIpError;

    // --- Unified save ---

    const buildPatch = useCallback((): Partial<SettingsData> => {
        const patch: Partial<SettingsData> = {};
        if (tz !== server.current.tz) patch.tz = tz;
        if (logLevel !== server.current.logLevel) patch.logLevel = logLevel;
        if (apFallbackOnDisconnect !== (server.current.apFallbackOnDisconnect ?? true))
            patch.apFallbackOnDisconnect = apFallbackOnDisconnect;
        if (staticIpEnabled !== (server.current.staticIpEnabled ?? false)) patch.staticIpEnabled = staticIpEnabled;
        if (staticIp !== (server.current.staticIp ?? "")) patch.staticIp = staticIp;
        if (staticGateway !== (server.current.staticGateway ?? "")) patch.staticGateway = staticGateway;
        if (staticSubnet !== (server.current.staticSubnet ?? "")) patch.staticSubnet = staticSubnet;
        if (staticDns !== (server.current.staticDns ?? "")) patch.staticDns = staticDns;
        if (syslogEnabled !== (server.current.syslogEnabled ?? false)) patch.syslogEnabled = syslogEnabled;
        if (syslogIp !== (server.current.syslogIp ?? "")) patch.syslogIp = syslogIp;
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
        if (autoRestartEnabled !== (server.current.autoRestartEnabled ?? false)) {
            patch.autoRestartEnabled = autoRestartEnabled;
        }
        if (parsedMaintenanceTime) {
            if (parsedMaintenanceTime.hour !== (server.current.autoRestartHour ?? 3)) {
                patch.autoRestartHour = parsedMaintenanceTime.hour;
            }
            if (parsedMaintenanceTime.minute !== (server.current.autoRestartMinute ?? 0)) {
                patch.autoRestartMinute = parsedMaintenanceTime.minute;
            }
        }
        if (restartBeforeClean !== (server.current.restartBeforeClean ?? false)) {
            patch.restartBeforeClean = restartBeforeClean;
        }
        return patch;
    }, [
        tz,
        logLevel,
        apFallbackOnDisconnect,
        staticIpEnabled,
        staticIp,
        staticGateway,
        staticSubnet,
        staticDns,
        syslogEnabled,
        syslogIp,
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
        autoRestartEnabled,
        parsedMaintenanceTime,
        restartBeforeClean,
    ]);

    const handleSave = useCallback(() => {
        const willReboot = needsReboot;
        const wasStaticIpEnabled = server.current.staticIpEnabled ?? false;
        const previousStaticIp = server.current.staticIp ?? "";
        setSaving(true);
        api.updateSettings(buildPatch())
            .then((res) => {
                const staticIpEnabledNow = res.staticIpEnabled ?? false;
                const staticIpChanged =
                    staticIpEnabledNow !== wasStaticIpEnabled || (res.staticIp ?? "") !== previousStaticIp;
                if (willReboot && staticIpChanged) {
                    setRebootAddress(
                        staticIpEnabledNow && res.staticIp && res.staticIp !== window.location.hostname
                            ? res.staticIp
                            : null,
                    );
                    setRebootClearsStaticIp(wasStaticIpEnabled && !staticIpEnabledNow);
                }
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
                    errorStack.push(normalizeError(e, "Failed to save settings"));
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

    // Turning static IP off hides the address fields, reset them to the saved
    // values so hidden edits don't force a pointless reboot or trip validation.
    const updateStaticIpEnabled = useCallback((value: boolean) => {
        setStaticIpEnabled(value);
        if (value) return;
        setStaticIp(server.current.staticIp ?? "");
        setStaticGateway(server.current.staticGateway ?? "");
        setStaticSubnet(server.current.staticSubnet ?? "");
        setStaticDns(server.current.staticDns ?? "");
    }, []);

    return {
        // Form fields
        tz,
        setTz,
        logLevel,
        setLogLevel,
        apFallbackOnDisconnect,
        setApFallbackOnDisconnect,
        staticIpEnabled,
        setStaticIpEnabled: updateStaticIpEnabled,
        staticIp,
        setStaticIp,
        staticGateway,
        setStaticGateway,
        staticSubnet,
        setStaticSubnet,
        staticDns,
        setStaticDns,
        syslogEnabled,
        setSyslogEnabled,
        syslogIp,
        setSyslogIp,
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
        autoRestartEnabled,
        setAutoRestartEnabled,
        autoRestartTime,
        setAutoRestartTime,
        restartBeforeClean,
        setRestartBeforeClean,
        // Derived state
        isDirty,
        needsReboot,
        pinError,
        hostnameError,
        syslogIpError,
        autoRestartTimeError,
        staticIpError,
        validationError,
        // Save flow
        saving,
        showSaveConfirm,
        setShowSaveConfirm,
        saveLabel,
        rebootAddress,
        rebootClearsStaticIp,
        handleSave,
        onSaveClick,
    };
}
