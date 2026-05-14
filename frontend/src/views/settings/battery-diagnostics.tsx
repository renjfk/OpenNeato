import { useCallback, useState } from "preact/hooks";
import { api } from "../../api";
import alertSvg from "../../assets/icons/alert.svg?raw";
import { ConfirmDialog } from "../../components/confirm-dialog";
import type { ErrorStackHandle } from "../../components/error-banner";
import { Icon } from "../../components/icon";
import { usePolling } from "../../hooks/use-polling";
import type { BatteryAnalogData, BatteryWarrantyData, ChargerData, VersionData } from "../../types";
import { normalizeError } from "../../utils";

interface BatteryDiagnosticsProps {
    firmwareSupported: boolean;
    errorStack: ErrorStackHandle;
}

function batteryStateLabel(charger: ChargerData): string {
    if (charger.chargingActive) return "Charging";
    if (charger.extPwrPresent) return "Docked";
    return "On battery";
}

function formatHours(seconds: number): string {
    return `${Math.round(seconds / 3600)} h`;
}

function mfgDateLooksUnreliable(version: VersionData | null | undefined): boolean {
    if (!version?.smartBatteryMfgDate) return false;

    const parts = version.smartBatteryMfgDate.split("-");
    const year = Number(parts[0]);
    if (!Number.isFinite(year)) return false;

    const currentYear = new Date().getFullYear();
    if (year <= currentYear) return false;

    return true;
}

export function BatteryDiagnostics({ firmwareSupported, errorStack }: BatteryDiagnosticsProps) {
    const chargerPoll = usePolling<ChargerData>(api.getCharger, 30000);
    const analogPoll = usePolling<BatteryAnalogData>(api.getBatteryAnalog, 30000);
    const warrantyPoll = usePolling<BatteryWarrantyData>(api.getBatteryWarranty, 60000);
    const versionPoll = usePolling<VersionData>(api.getVersion, 60000);

    const [showNewBatteryConfirm, setShowNewBatteryConfirm] = useState(false);
    const [settingNewBattery, setSettingNewBattery] = useState(false);

    const charger = chargerPoll.data;
    const analog = analogPoll.data;
    const warranty = warrantyPoll.data;
    const version = versionPoll.data;
    const showMfgDateNotice = mfgDateLooksUnreliable(version);

    const handleNewBattery = useCallback(() => {
        setShowNewBatteryConfirm(false);
        setSettingNewBattery(true);
        api.newBattery()
            .catch((e: unknown) => {
                errorStack.push(normalizeError(e, "Failed to set new battery"));
            })
            .finally(() => setSettingNewBattery(false));
    }, [errorStack]);

    const errorMessage = chargerPoll.error ?? analogPoll.error ?? warrantyPoll.error ?? versionPoll.error;

    return (
        <>
            <div class="settings-section">
                <div class="settings-battery-card">
                    <div class="settings-battery-header">
                        <div>
                            <div class="settings-battery-title">Battery diagnostics</div>
                            <div class="settings-battery-desc">
                                Maintenance signals from charger, analog sensors, warranty data, and version metadata
                            </div>
                        </div>
                    </div>

                    {charger && analog && warranty ? (
                        <>
                            <div class="settings-battery-grid">
                                <div>
                                    <span>Charge</span>
                                    <strong>{charger.fuelPercent}%</strong>
                                </div>
                                <div>
                                    <span>State</span>
                                    <strong>{batteryStateLabel(charger)}</strong>
                                </div>
                                <div>
                                    <span>Voltage</span>
                                    <strong>{charger.vBattV.toFixed(2)} V</strong>
                                </div>
                                <div>
                                    <span>Temp</span>
                                    <strong>{analog.batteryTemperatureC.toFixed(1)} C</strong>
                                </div>
                                <div>
                                    <span>Cycles</span>
                                    <strong>{warranty.cumulativeBatteryCycles}</strong>
                                </div>
                                <div>
                                    <span>Pack</span>
                                    <strong>{version?.smartBatteryManufacturerName || "Unknown"}</strong>
                                </div>
                                <div>
                                    <span>Current</span>
                                    <strong>{analog.batteryCurrentMA} mA</strong>
                                </div>
                                <div>
                                    <span>External voltage</span>
                                    <strong>{analog.externalVoltageV.toFixed(2)} V</strong>
                                </div>
                                <div>
                                    <span>Charging enabled</span>
                                    <strong>{charger.chargingEnabled ? "Yes" : "No"}</strong>
                                </div>
                                <div>
                                    <span>Fuel confidence</span>
                                    <strong>{charger.confidOnFuel ? "Yes" : "No"}</strong>
                                </div>
                                <div>
                                    <span>Reserved fuel</span>
                                    <strong>{charger.onReservedFuel ? "Yes" : "No"}</strong>
                                </div>
                                <div>
                                    <span>Charged</span>
                                    <strong>{charger.chargerMAH} mAh</strong>
                                </div>
                                <div>
                                    <span>Discharged</span>
                                    <strong>{charger.dischargeMAH} mAh</strong>
                                </div>
                                <div>
                                    <span>Cleaning time</span>
                                    <strong>{formatHours(warranty.cumulativeCleaningTimeSeconds)}</strong>
                                </div>
                                <div>
                                    <span>Chemistry</span>
                                    <strong>{version?.smartBatteryChemistry || "Unknown"}</strong>
                                </div>
                                <div>
                                    <span>Device</span>
                                    <strong>{version?.smartBatteryDeviceName || "Unknown"}</strong>
                                </div>
                                <div>
                                    <span>Serial</span>
                                    <strong>{version?.smartBatterySerialNumber || "Unknown"}</strong>
                                </div>
                                <div>
                                    <span>Mfg date</span>
                                    <strong>{version?.smartBatteryMfgDate || "Unknown"}</strong>
                                    {showMfgDateNotice && (
                                        <small class="settings-battery-note">
                                            Reported by robot firmware, may be unreliable.
                                        </small>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                class={`settings-nav-row${settingNewBattery ? " pending" : ""}`}
                                onClick={() => setShowNewBatteryConfirm(true)}
                                disabled={settingNewBattery || !firmwareSupported}
                            >
                                <div class="settings-nav-row-left">
                                    <Icon svg={alertSvg} />
                                    {settingNewBattery ? "Applying..." : "New Battery"}
                                </div>
                            </button>
                            <div class="settings-robot-time">
                                Use only after physically installing a replacement battery.
                            </div>
                        </>
                    ) : (
                        <div class="settings-battery-empty">{errorMessage ?? "Loading battery diagnostics..."}</div>
                    )}
                </div>
            </div>

            {showNewBatteryConfirm && (
                <ConfirmDialog
                    message="This resets the battery fuel gauge and calibration data. Only use this after physically replacing the battery. The charge percentage may be inaccurate for a few cycles until the system relearns the battery capacity."
                    confirmLabel="New Battery"
                    confirmText="NEW BATTERY"
                    destructive
                    disabled={settingNewBattery}
                    onConfirm={handleNewBattery}
                    onCancel={() => setShowNewBatteryConfirm(false)}
                />
            )}
        </>
    );
}
