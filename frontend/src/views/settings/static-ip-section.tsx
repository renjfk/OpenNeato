import globeSvg from "../../assets/icons/globe.svg?raw";
import { Icon } from "../../components/icon";
import { T, useI18n } from "../../i18n";

interface StaticIpSectionProps {
    enabled: boolean;
    ip: string;
    gateway: string;
    subnet: string;
    dns: string;
    error: string | null;
    saving: boolean;
    onEnabledChange: (value: boolean) => void;
    onIpChange: (value: string) => void;
    onGatewayChange: (value: string) => void;
    onSubnetChange: (value: string) => void;
    onDnsChange: (value: string) => void;
}

export function StaticIpSection({
    enabled,
    ip,
    gateway,
    subnet,
    dns,
    error,
    saving,
    onEnabledChange,
    onIpChange,
    onGatewayChange,
    onSubnetChange,
    onDnsChange,
}: StaticIpSectionProps) {
    const { t } = useI18n();
    const disabled = saving || !enabled;

    return (
        <div class="settings-section">
            <div class="settings-toggle-row">
                <div class="settings-toggle-label">
                    <span class="settings-toggle-title">
                        <T>Static IP</T>
                    </span>
                    <span class="settings-toggle-desc">
                        <T>
                            Use a fixed IPv4 address instead of asking your router for one via DHCP. The device restarts
                            after saving.
                        </T>
                    </span>
                </div>
                <button
                    type="button"
                    class={`settings-toggle${enabled ? " on" : ""}`}
                    onClick={() => onEnabledChange(!enabled)}
                    disabled={saving}
                    aria-label={t("Toggle static IP")}
                />
            </div>
            {enabled && (
                <>
                    <div class="settings-pin-row">
                        <label class="settings-pin-label">
                            <T>IP address</T>
                            <input
                                type="text"
                                class="settings-pin-input"
                                value={ip}
                                placeholder="192.168.1.50"
                                onInput={(e) => onIpChange((e.target as HTMLInputElement).value)}
                                disabled={disabled}
                            />
                        </label>
                        <label class="settings-pin-label">
                            <T>Gateway</T>
                            <input
                                type="text"
                                class="settings-pin-input"
                                value={gateway}
                                placeholder="192.168.1.1"
                                onInput={(e) => onGatewayChange((e.target as HTMLInputElement).value)}
                                disabled={disabled}
                            />
                        </label>
                    </div>
                    <div class="settings-pin-row">
                        <label class="settings-pin-label">
                            <T>Subnet mask</T>
                            <input
                                type="text"
                                class="settings-pin-input"
                                value={subnet}
                                placeholder="255.255.255.0"
                                onInput={(e) => onSubnetChange((e.target as HTMLInputElement).value)}
                                disabled={disabled}
                            />
                        </label>
                        <label class="settings-pin-label">
                            <T>DNS (optional)</T>
                            <input
                                type="text"
                                class="settings-pin-input"
                                value={dns}
                                placeholder="192.168.1.1"
                                onInput={(e) => onDnsChange((e.target as HTMLInputElement).value)}
                                disabled={disabled}
                            />
                        </label>
                    </div>
                    {error ? (
                        <div class="settings-field-error">{error}</div>
                    ) : (
                        <div class="settings-robot-time">
                            <Icon svg={globeSvg} />
                            <T>
                                Choose an address outside your router's DHCP range. If the gateway does not answer, the
                                device falls back to DHCP for that boot. If it is still unreachable, hold the BOOT
                                button for 5 seconds to factory reset it.
                            </T>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
