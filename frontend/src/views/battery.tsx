import backSvg from "../assets/icons/back.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { T, useI18n } from "../i18n";
import { BatteryDiagnostics } from "./settings/battery-diagnostics";

interface BatteryViewProps {
    firmwareSupported: boolean;
}

export function BatteryView({ firmwareSupported }: BatteryViewProps) {
    const { t } = useI18n();
    const [errors, errorStack] = useErrorStack();

    return (
        <>
            <div class="header">
                <a href="#/settings" class="header-back-btn" aria-label={t("Back")}>
                    <Icon svg={backSvg} />
                </a>
                <h1>
                    <T>Battery</T>
                </h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="schedule-page">
                <BatteryDiagnostics firmwareSupported={firmwareSupported} errorStack={errorStack} />
            </div>
        </>
    );
}
