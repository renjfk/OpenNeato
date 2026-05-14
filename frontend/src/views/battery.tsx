import backSvg from "../assets/icons/back.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { BatteryDiagnosticsSection } from "./settings/battery-diagnostics-section";

interface BatteryViewProps {
    firmwareSupported: boolean;
}

export function BatteryView({ firmwareSupported }: BatteryViewProps) {
    const [errors, errorStack] = useErrorStack();

    return (
        <>
            <div class="header">
                <a href="#/settings" class="header-back-btn" aria-label="Back">
                    <Icon svg={backSvg} />
                </a>
                <h1>Battery</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="schedule-page">
                <BatteryDiagnosticsSection firmwareSupported={firmwareSupported} errorStack={errorStack} />
            </div>
        </>
    );
}
