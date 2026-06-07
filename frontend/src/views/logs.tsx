import { useCallback } from "preact/hooks";
import backSvg from "../assets/icons/back.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate, usePath } from "../components/router";
import { useI18n } from "../i18n";
import { LogsItemView } from "./logs/item";
import { LogsListView } from "./logs/list";

export function LogsView() {
    const { t } = useI18n();
    const navigate = useNavigate();
    const path = usePath();
    const [errors, errorStack] = useErrorStack();

    // Derive view mode from URL: /logs = list, /logs/filename = detail
    const selectedFile = path.startsWith("/logs/") ? decodeURIComponent(path.slice(6)) : null;
    const isDetail = selectedFile !== null;

    const handleBack = useCallback(() => {
        if (isDetail) {
            navigate("/logs");
            errorStack.clear();
        } else {
            navigate("/settings");
        }
    }, [isDetail, navigate, errorStack]);

    const handleError = useCallback(
        (msg: string) => {
            errorStack.push(msg);
        },
        [errorStack],
    );

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={handleBack} aria-label={t("Back")}>
                    <Icon svg={backSvg} />
                </button>
                <h1>{isDetail && selectedFile ? selectedFile : t("Logs")}</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="logs-page">
                {!isDetail && <LogsListView onError={handleError} />}
                {isDetail && selectedFile && <LogsItemView filename={selectedFile} onError={handleError} />}
            </div>
        </>
    );
}
