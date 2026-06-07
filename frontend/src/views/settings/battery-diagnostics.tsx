import { useCallback, useState } from "preact/hooks";
import { api } from "../../api";
import alertSvg from "../../assets/icons/alert.svg?raw";
import { ConfirmDialog } from "../../components/confirm-dialog";
import type { ErrorStackHandle } from "../../components/error-banner";
import { Icon } from "../../components/icon";
import { usePolling } from "../../hooks/use-polling";
import { T, useI18n } from "../../i18n";
import type { BatteryAnalogData, BatteryWarrantyData, ChargerData, VersionData } from "../../types";
import { normalizeError } from "../../utils";

interface BatteryDiagnosticsProps {
    firmwareSupported: boolean;
    errorStack: ErrorStackHandle;
}

function batteryStateLabel(charger: ChargerData): string {
    if (charger.chargingActive) return "Charging";
    if (charger.extPwrPresent) return "Docked";
    return "On Battery";
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
    const { t, formatDuration, formatNumber } = useI18n();
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
                            <div class="settings-battery-title">
                                <T>Battery diagnostics</T>
                            </div>
                            <div class="settings-battery-desc">
                                <T>
                                    Maintenance signals from charger, analog sensors, warranty data, and version
                                    metadata
                                </T>
                            </div>
                        </div>
                    </div>

                    {charger && analog && warranty ? (
                        <>
                            <div class="settings-battery-grid">
                                <div>
                                    <span>
                                        <T>Charge</T>
                                    </span>
                                    <strong>{charger.fuelPercent}%</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>State</T>
                                    </span>
                                    <strong>{t(batteryStateLabel(charger))}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Voltage</T>
                                    </span>
                                    <strong>
                                        {formatNumber(charger.vBattV, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        V
                                    </strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Temp</T>
                                    </span>
                                    <strong>
                                        {formatNumber(analog.batteryTemperatureC, {
                                            minimumFractionDigits: 1,
                                            maximumFractionDigits: 1,
                                        })}{" "}
                                        C
                                    </strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Cycles</T>
                                    </span>
                                    <strong>{warranty.cumulativeBatteryCycles}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Pack</T>
                                    </span>
                                    <strong>{version?.smartBatteryManufacturerName || t("Unknown")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Current</T>
                                    </span>
                                    <strong>{formatNumber(analog.batteryCurrentMA)} mA</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>External voltage</T>
                                    </span>
                                    <strong>
                                        {formatNumber(analog.externalVoltageV, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        V
                                    </strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Charging enabled</T>
                                    </span>
                                    <strong>{t(charger.chargingEnabled ? "Yes" : "No")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Fuel confidence</T>
                                    </span>
                                    <strong>{t(charger.confidOnFuel ? "Yes" : "No")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Reserved fuel</T>
                                    </span>
                                    <strong>{t(charger.onReservedFuel ? "Yes" : "No")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Charged</T>
                                    </span>
                                    <strong>{formatNumber(charger.chargerMAH)} mAh</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Discharged</T>
                                    </span>
                                    <strong>{formatNumber(charger.dischargeMAH)} mAh</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Cleaning time</T>
                                    </span>
                                    <strong>{formatDuration(warranty.cumulativeCleaningTimeSeconds)}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Chemistry</T>
                                    </span>
                                    <strong>{version?.smartBatteryChemistry || t("Unknown")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Device</T>
                                    </span>
                                    <strong>{version?.smartBatteryDeviceName || t("Unknown")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Serial</T>
                                    </span>
                                    <strong>{version?.smartBatterySerialNumber || t("Unknown")}</strong>
                                </div>
                                <div>
                                    <span>
                                        <T>Mfg date</T>
                                    </span>
                                    <strong>{version?.smartBatteryMfgDate || t("Unknown")}</strong>
                                    {showMfgDateNotice && (
                                        <small class="settings-battery-note">
                                            <T>Reported by robot firmware, may be unreliable.</T>
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
                                    {t(settingNewBattery ? "Applying..." : "New Battery")}
                                </div>
                            </button>
                            <div class="settings-robot-time">
                                <T>Use only after physically installing a replacement battery.</T>
                            </div>
                        </>
                    ) : (
                        <div class="settings-battery-empty">
                            {errorMessage ?? <T>Loading battery diagnostics...</T>}
                        </div>
                    )}
                </div>
            </div>

            {showNewBatteryConfirm && (
                <ConfirmDialog
                    message={t(
                        "This resets the battery fuel gauge and calibration data. Only use this after physically replacing the battery. The charge percentage may be inaccurate for a few cycles until the system relearns the battery capacity.",
                    )}
                    confirmLabel={t("New Battery")}
                    confirmText={t("NEW BATTERY")}
                    destructive
                    disabled={settingNewBattery}
                    onConfirm={handleNewBattery}
                    onCancel={() => setShowNewBatteryConfirm(false)}
                />
            )}
        </>
    );
}
