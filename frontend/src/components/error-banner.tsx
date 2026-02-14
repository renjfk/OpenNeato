import alertSvg from "../assets/icons/alert.svg?raw";
import { Icon } from "./icon";

interface ErrorBannerProps {
    title?: string;
    message: string;
}

export function ErrorBanner({ title = "Alert", message }: ErrorBannerProps) {
    return (
        <div class="error-banner">
            <div class="error-banner-row">
                <div class="error-banner-icon">
                    <Icon svg={alertSvg} />
                </div>
                <div>
                    <div class="error-banner-title">{title}</div>
                    <div class="error-banner-msg">{message}</div>
                </div>
            </div>
        </div>
    );
}
