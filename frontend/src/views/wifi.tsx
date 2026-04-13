import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import wifiSvg from "../assets/icons/wifi.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import { useFetch } from "../hooks/use-fetch";
import { usePolling } from "../hooks/use-polling";
import type { SettingsData, WifiNetwork, WifiStatusData } from "../types";
import { SettingsCategory } from "./settings/settings-category";

function apStateLabel(status: WifiStatusData | null): string {
    if (!status) return "Loading";
    if (!status.apConfiguredEnabled) return "Disabled";
    if (!status.apRuntimeEnabled) return "Disabled until reboot";
    if (status.apActive) return "Active";
    return "Standby";
}

function signalLabel(rssi: number): string {
    if (rssi >= -55) return "Excellent";
    if (rssi >= -67) return "Good";
    if (rssi >= -75) return "Fair";
    return "Weak";
}

export function WifiView() {
    const navigate = useNavigate();
    const [errors, errorStack] = useErrorStack();
    const settingsFetch = useFetch<SettingsData>(api.getSettings);
    const statusPoll = usePolling<WifiStatusData>(api.getWifiStatus, 3000);

    const [savedSettings, setSavedSettings] = useState<Pick<
        SettingsData,
        "apEnabled" | "apSsid" | "apPassword"
    > | null>(null);
    const [apEnabled, setApEnabled] = useState(true);
    const [apSsid, setApSsid] = useState("");
    const [apPassword, setApPassword] = useState("");
    const [savingSettings, setSavingSettings] = useState(false);
    const [runtimeBusy, setRuntimeBusy] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [networks, setNetworks] = useState<WifiNetwork[]>([]);
    const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
    const [networkPassword, setNetworkPassword] = useState("");
    const [connecting, setConnecting] = useState(false);

    useEffect(() => {
        if (settingsFetch.error) errorStack.push(settingsFetch.error);
    }, [settingsFetch.error, errorStack]);

    useEffect(() => {
        if (statusPoll.error) errorStack.push(statusPoll.error);
    }, [statusPoll.error, errorStack]);

    useEffect(() => {
        if (!settingsFetch.data) return;
        setSavedSettings({
            apEnabled: settingsFetch.data.apEnabled,
            apSsid: settingsFetch.data.apSsid ?? "",
            apPassword: settingsFetch.data.apPassword ?? "",
        });
        setApEnabled(settingsFetch.data.apEnabled);
        setApSsid(settingsFetch.data.apSsid ?? "");
        setApPassword(settingsFetch.data.apPassword ?? "");
    }, [settingsFetch.data]);

    const apPasswordError =
        apPassword.length > 0 && (apPassword.length < 8 || apPassword.length > 63)
            ? "Password must be empty or 8-63 characters"
            : null;
    const apSsidError = apSsid.length > 32 ? "SSID must be 32 characters or fewer" : null;
    const validationError = apPasswordError || apSsidError;

    const settingsDirty =
        !!savedSettings &&
        (apEnabled !== savedSettings.apEnabled ||
            apSsid !== savedSettings.apSsid ||
            apPassword !== savedSettings.apPassword);

    const status = statusPoll.data;

    const handleSave = useCallback(() => {
        if (validationError) return;
        setSavingSettings(true);
        api.updateSettings({ apEnabled, apSsid, apPassword })
            .then((updated) => {
                setSavedSettings({
                    apEnabled: updated.apEnabled,
                    apSsid: updated.apSsid ?? "",
                    apPassword: updated.apPassword ?? "",
                });
                setApEnabled(updated.apEnabled);
                setApSsid(updated.apSsid ?? "");
                setApPassword(updated.apPassword ?? "");
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to save hotspot settings");
            })
            .finally(() => setSavingSettings(false));
    }, [validationError, apEnabled, apSsid, apPassword, errorStack]);

    const handleRuntimeToggle = useCallback(() => {
        if (!status) return;
        setRuntimeBusy(true);
        api.setFallbackApRuntimeEnabled(!status.apRuntimeEnabled)
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to update runtime hotspot state");
            })
            .finally(() => setRuntimeBusy(false));
    }, [status, errorStack]);

    const handleScan = useCallback(() => {
        setScanning(true);
        setSelectedNetwork(null);
        setNetworkPassword("");
        api.scanWifi()
            .then((result) => {
                setNetworks(result.sort((left, right) => right.rssi - left.rssi));
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to scan for WiFi networks");
            })
            .finally(() => setScanning(false));
    }, [errorStack]);

    const handleSelectNetwork = useCallback(
        (network: WifiNetwork) => {
            if (network.open) {
                setConnecting(true);
                api.connectWifi(network.ssid, "")
                    .then(() => {
                        setSelectedNetwork(null);
                        setNetworkPassword("");
                        setNetworks([]);
                    })
                    .catch((e: unknown) => {
                        errorStack.push(e instanceof Error ? e.message : "Failed to connect to WiFi network");
                    })
                    .finally(() => setConnecting(false));
                return;
            }
            setSelectedNetwork(network);
            setNetworkPassword("");
        },
        [errorStack],
    );

    const handleConnectSelected = useCallback(() => {
        if (!selectedNetwork) return;
        setConnecting(true);
        api.connectWifi(selectedNetwork.ssid, networkPassword)
            .then(() => {
                setSelectedNetwork(null);
                setNetworkPassword("");
                setNetworks([]);
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to connect to WiFi network");
            })
            .finally(() => setConnecting(false));
    }, [selectedNetwork, networkPassword, errorStack]);

    const handleDisconnect = useCallback(() => {
        setDisconnecting(true);
        api.disconnectWifi()
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to disconnect from WiFi network");
            })
            .finally(() => setDisconnecting(false));
    }, [errorStack]);

    const hotspotSummary = useMemo(() => {
        if (!status) return "Checking hotspot state";
        if (!status.apConfiguredEnabled) return "Fallback hotspot is disabled in settings";
        if (!status.apRuntimeEnabled) return "Fallback hotspot will stay off until reboot";
        if (status.apActive) return `Fallback hotspot is active at ${status.apIp}`;
        return "Fallback hotspot is armed and will start only if home WiFi is unavailable";
    }, [status]);

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={() => navigate("/settings")} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>WiFi Network</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="settings-page wifi-page">
                <SettingsCategory title="Fallback Hotspot" icon={wifiSvg} defaultOpen>
                    <div class="settings-section">
                        <div class="wifi-status-pill">{apStateLabel(status)}</div>
                        <div class="wifi-subtle-copy">{hotspotSummary}</div>
                        <div class="wifi-meta-grid">
                            <div>
                                <span class="wifi-meta-label">SSID</span>
                                <strong>{status?.apSsid || apSsid || "hostname-ap"}</strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Security</span>
                                <strong>{apPassword ? "Secured" : "Open"}</strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Address</span>
                                <strong>{status?.apIp || "Standby"}</strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Clients</span>
                                <strong>{status?.apClients ?? 0}</strong>
                            </div>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Fallback hotspot enabled</span>
                                <span class="settings-toggle-desc">
                                    Allows the device to create its own WiFi if home WiFi is unavailable
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${apEnabled ? " on" : ""}`}
                                onClick={() => setApEnabled(!apEnabled)}
                                disabled={savingSettings}
                                aria-label="Toggle fallback hotspot"
                            />
                        </div>
                        <div class="settings-section-title">Hotspot name</div>
                        <input
                            type="text"
                            class="settings-text-input"
                            value={apSsid}
                            onInput={(e) => setApSsid((e.target as HTMLInputElement).value)}
                            disabled={savingSettings}
                            placeholder="Leave empty to use hostname-ap"
                        />
                        <div class="settings-section-title">Hotspot password</div>
                        <input
                            type="text"
                            class="settings-text-input"
                            value={apPassword}
                            onInput={(e) => setApPassword((e.target as HTMLInputElement).value)}
                            disabled={savingSettings}
                            placeholder="Leave empty for open network"
                        />
                        {validationError ? (
                            <div class="settings-field-error">{validationError}</div>
                        ) : (
                            <div class="wifi-subtle-copy">
                                These settings persist across reboots and are used only when infrastructure WiFi is
                                unavailable.
                            </div>
                        )}
                        <div class="wifi-action-row">
                            <button
                                type="button"
                                class="wifi-action-btn"
                                onClick={handleSave}
                                disabled={!settingsDirty || !!validationError || savingSettings}
                            >
                                {savingSettings ? "Saving..." : "Save hotspot settings"}
                            </button>
                        </div>
                    </div>
                    <div class="settings-section">
                        <div class="settings-toggle-row">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Disable hotspot until reboot</span>
                                <span class="settings-toggle-desc">
                                    Stops the fallback hotspot now and blocks it from auto-starting until the next
                                    restart
                                </span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${status && !status.apRuntimeEnabled ? "" : " on"}`}
                                onClick={handleRuntimeToggle}
                                disabled={!status || runtimeBusy}
                                aria-label="Toggle hotspot until reboot"
                            />
                        </div>
                    </div>
                </SettingsCategory>

                <SettingsCategory title="Home Network" icon={wifiSvg} defaultOpen>
                    <div class="settings-section">
                        <div class="wifi-status-pill secondary">
                            {status?.staConnected
                                ? "Connected"
                                : status?.reconnecting
                                  ? "Reconnecting"
                                  : "Disconnected"}
                        </div>
                        <div class="wifi-meta-grid">
                            <div>
                                <span class="wifi-meta-label">Network</span>
                                <strong>{status?.staSsid || "Not configured"}</strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Address</span>
                                <strong>{status?.staIp || "Offline"}</strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Signal</span>
                                <strong>
                                    {status?.staConnected
                                        ? `${signalLabel(status.staRssi)} (${status.staRssi} dBm)`
                                        : "N/A"}
                                </strong>
                            </div>
                            <div>
                                <span class="wifi-meta-label">Status</span>
                                <strong>
                                    {status?.lastError ||
                                        (status?.staConfigured ? "Saved network present" : "No saved network")}
                                </strong>
                            </div>
                        </div>
                        <div class="wifi-action-row">
                            <button
                                type="button"
                                class="wifi-action-btn"
                                onClick={handleScan}
                                disabled={scanning || connecting}
                            >
                                {scanning ? "Scanning..." : "Change network"}
                            </button>
                            <button
                                type="button"
                                class="wifi-action-btn subtle"
                                onClick={handleDisconnect}
                                disabled={disconnecting || connecting || !status?.staConfigured}
                            >
                                {disconnecting ? "Disconnecting..." : "Disconnect"}
                            </button>
                        </div>
                    </div>
                    {(scanning || networks.length > 0 || selectedNetwork) && (
                        <div class="settings-section">
                            <div class="settings-section-title">Available networks</div>
                            {selectedNetwork ? (
                                <div class="wifi-connect-panel">
                                    <div class="wifi-connect-title">Connect to {selectedNetwork.ssid}</div>
                                    <div class="wifi-subtle-copy">{selectedNetwork.auth} security</div>
                                    <input
                                        type="password"
                                        class="settings-text-input"
                                        value={networkPassword}
                                        onInput={(e) => setNetworkPassword((e.target as HTMLInputElement).value)}
                                        disabled={connecting}
                                        placeholder="Enter network password"
                                    />
                                    <div class="wifi-action-row">
                                        <button
                                            type="button"
                                            class="wifi-action-btn"
                                            onClick={handleConnectSelected}
                                            disabled={connecting || networkPassword.length === 0}
                                        >
                                            {connecting ? "Connecting..." : "Connect"}
                                        </button>
                                        <button
                                            type="button"
                                            class="wifi-action-btn subtle"
                                            onClick={() => setSelectedNetwork(null)}
                                            disabled={connecting}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div class="wifi-network-list">
                                    {networks.map((network) => (
                                        <button
                                            key={`${network.ssid}-${network.rssi}`}
                                            type="button"
                                            class="wifi-network-btn"
                                            onClick={() => handleSelectNetwork(network)}
                                            disabled={connecting}
                                        >
                                            <span>{network.ssid}</span>
                                            <span>
                                                {network.auth} · {network.rssi} dBm
                                            </span>
                                        </button>
                                    ))}
                                    {!scanning && networks.length === 0 && (
                                        <div class="wifi-subtle-copy">No networks found in range.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </SettingsCategory>
            </div>
        </>
    );
}
