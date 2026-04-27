import { useCallback, useState } from "preact/hooks";
import { api } from "../../api";
import alertSvg from "../../assets/icons/alert.svg?raw";
import bolt from "../../assets/icons/bolt.svg?raw";
import globeSvg from "../../assets/icons/globe.svg?raw";
import wifiSvg from "../../assets/icons/wifi.svg?raw";
import wifiOffSvg from "../../assets/icons/wifi-off.svg?raw";
import { ConfirmDialog } from "../../components/confirm-dialog";
import type { ErrorStackHandle } from "../../components/error-banner";
import { Icon } from "../../components/icon";
import { usePolling } from "../../hooks/use-polling";
import type { WiFiNetwork, WiFiStatus } from "../../types";
import { normalizeError } from "../../utils";

interface WiFiSectionProps {
    apFallbackOnDisconnect: boolean;
    onApFallbackChange: (value: boolean) => void;
    saving: boolean;
    errorStack: ErrorStackHandle;
}

// Map dBm to a coarse 1-4 bar count, mirroring desktop OS conventions.
function rssiBars(rssi: number): number {
    if (rssi >= -55) return 4;
    if (rssi >= -65) return 3;
    if (rssi >= -75) return 2;
    return 1;
}

export function WiFiSection({ apFallbackOnDisconnect, onApFallbackChange, saving, errorStack }: WiFiSectionProps) {
    const statusPoll = usePolling<WiFiStatus>(api.getWifiStatus, 5000);
    const status = statusPoll.data;

    const [scanning, setScanning] = useState(false);
    const [networks, setNetworks] = useState<WiFiNetwork[] | null>(null);
    const [selectedSsid, setSelectedSsid] = useState("");
    const [pendingNetwork, setPendingNetwork] = useState<WiFiNetwork | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [showForgetConfirm, setShowForgetConfirm] = useState(false);

    const handleScan = useCallback(() => {
        setScanning(true);
        api.scanWifi()
            .then((res) => {
                // Sort strongest first; deduplicate by SSID (keep best RSSI per name)
                const best = new Map<string, WiFiNetwork>();
                for (const n of res.networks) {
                    if (!n.ssid) continue;
                    const existing = best.get(n.ssid);
                    if (!existing || n.rssi > existing.rssi) best.set(n.ssid, n);
                }
                setNetworks([...best.values()].sort((a, b) => b.rssi - a.rssi));
            })
            .catch((e: unknown) => errorStack.push(normalizeError(e, "WiFi scan failed")))
            .finally(() => setScanning(false));
    }, [errorStack]);

    const startConnect = useCallback(
        (ssid: string) => {
            const network = networks?.find((n) => n.ssid === ssid);
            if (!network) return;
            setPendingNetwork(network);
        },
        [networks],
    );

    // Drop the connect dialog and reset the dropdown back to "Choose a
    // network". Used on cancel and on connect failure so the UI is in the
    // same clean state either way.
    const resetConnectFlow = useCallback(() => {
        setPendingNetwork(null);
        setSelectedSsid("");
    }, []);

    const handleConnectConfirm = useCallback(
        (password?: string) => {
            const network = pendingNetwork;
            if (!network) return;
            setConnecting(true);
            api.connectWifi(network.ssid, password ?? "")
                .then(() => {
                    // Reload so the settings page picks up the new STA state
                    // and the connecting overlay clears. On real hardware the
                    // device reboots and the browser was on the AP, so the
                    // reload also forces a fresh navigation to the new IP.
                    window.location.reload();
                })
                .catch((e: unknown) => {
                    errorStack.push(normalizeError(e, "Failed to connect"));
                    resetConnectFlow();
                    setConnecting(false);
                });
        },
        [pendingNetwork, errorStack, resetConnectFlow],
    );

    const handleForget = useCallback(() => {
        setShowForgetConfirm(false);
        setDisconnecting(true);
        api.disconnectWifi()
            .then(() => {
                // Reload so the page reflects the post-disconnect state
                // (no current network, fallback AP active) without keeping
                // stale local UI state around.
                window.location.reload();
            })
            .catch((e: unknown) => {
                errorStack.push(normalizeError(e, "Failed to forget network"));
                setDisconnecting(false);
            });
    }, [errorStack]);

    const busy = scanning || connecting || disconnecting;

    return (
        <>
            <div class="settings-section">
                <div class="settings-section-title">Status</div>
                <div class="fw-info-row">
                    <div class="fw-info-item">
                        <Icon svg={status?.staConnected ? wifiSvg : wifiOffSvg} />
                        <span>
                            {status
                                ? status.staConnected
                                    ? `${status.ssid || "Connected"}`
                                    : status.ssid
                                      ? `Disconnected (${status.ssid})`
                                      : "Not configured"
                                : "..."}
                        </span>
                    </div>
                    {status?.staConnected && (
                        <>
                            <div class="fw-info-item">
                                <Icon svg={globeSvg} />
                                <span>{status.ip}</span>
                            </div>
                            <div class="fw-info-item">
                                <Icon svg={bolt} />
                                <span>
                                    {status.rssi} dBm ({rssiBars(status.rssi)}/4)
                                </span>
                            </div>
                        </>
                    )}
                    {status?.apActive && (
                        <div class="fw-info-item">
                            <Icon svg={wifiSvg} />
                            <span>
                                AP: {status.apSsid} @ {status.apIp}
                                {status.apClients > 0 && ` (${status.apClients})`}
                            </span>
                        </div>
                    )}
                </div>
                {status && !status.staConnected && status.lastError && (
                    <div class="settings-field-error">{status.lastError}</div>
                )}
            </div>

            <div class="settings-section">
                <div class="settings-toggle-row">
                    <div class="settings-toggle-label">
                        <span class="settings-toggle-title">Fallback AP on disconnect</span>
                        <span class="settings-toggle-desc">
                            Expose <code>{`<hostname>-ap`}</code> when the saved network is unreachable so you can
                            recover from a browser. Always on when no credentials are saved.
                        </span>
                    </div>
                    <button
                        type="button"
                        class={`settings-toggle${apFallbackOnDisconnect ? " on" : ""}`}
                        onClick={() => onApFallbackChange(!apFallbackOnDisconnect)}
                        disabled={saving}
                        aria-label="Toggle fallback AP"
                    />
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">Connect to a network</div>
                <div class="settings-wifi-pick-row">
                    <div class="settings-tz-select-wrap settings-wifi-select">
                        <select
                            class="settings-tz-select"
                            value={selectedSsid}
                            onChange={(e) => {
                                const value = (e.target as HTMLSelectElement).value;
                                setSelectedSsid(value);
                                if (value) startConnect(value);
                            }}
                            disabled={busy || !networks || networks.length === 0}
                        >
                            <option value="">
                                {scanning
                                    ? "Scanning..."
                                    : networks
                                      ? networks.length === 0
                                          ? "No networks found"
                                          : "Choose a network"
                                      : "Scan to choose a network"}
                            </option>
                            {networks?.map((n) => (
                                <option key={n.ssid} value={n.ssid}>
                                    {n.ssid} ({n.rssi} dBm{n.open ? ", open" : ""})
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        class={`settings-wifi-scan-btn${scanning ? " pending" : ""}`}
                        onClick={handleScan}
                        disabled={busy}
                        aria-label="Scan for networks"
                    >
                        Scan
                    </button>
                </div>
            </div>

            {status?.staConnected && (
                <div class="settings-section">
                    <button
                        type="button"
                        class={`settings-nav-row danger${disconnecting ? " pending" : ""}`}
                        onClick={() => setShowForgetConfirm(true)}
                        disabled={busy}
                    >
                        <div class="settings-nav-row-left">
                            <Icon svg={alertSvg} />
                            {disconnecting ? "Forgetting..." : "Forget current network"}
                        </div>
                    </button>
                </div>
            )}

            {pendingNetwork && !connecting && (
                <ConfirmDialog
                    message={
                        pendingNetwork.open
                            ? `Connect to ${pendingNetwork.ssid}? It is an open network.`
                            : `Enter the password for ${pendingNetwork.ssid}.`
                    }
                    confirmLabel="Connect"
                    destructive={false}
                    inputType={pendingNetwork.open ? undefined : "password"}
                    inputPlaceholder="Network password"
                    inputRequired={!pendingNetwork.open}
                    onConfirm={handleConnectConfirm}
                    onCancel={resetConnectFlow}
                />
            )}

            {connecting && pendingNetwork && (
                <div class="loading-overlay">
                    <div class="loading-dialog">
                        <div class="loading-spinner" />
                        <div class="loading-text">Connecting to {pendingNetwork.ssid}...</div>
                        <div class="loading-subtext">
                            The device will reboot after joining the network. You may need to reconnect your browser.
                        </div>
                    </div>
                </div>
            )}

            {showForgetConfirm && (
                <ConfirmDialog
                    message={`Forget "${status?.ssid ?? "current network"}"? Saved credentials will be erased and the device will drop to the fallback AP.`}
                    confirmLabel="Forget"
                    onConfirm={() => handleForget()}
                    onCancel={() => setShowForgetConfirm(false)}
                />
            )}
        </>
    );
}
