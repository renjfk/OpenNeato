import { useCallback, useEffect, useState } from "preact/hooks";
import type { ErrorStackHandle } from "../../components/error-banner";
import { fetchReleases, type ReleaseInfo, releaseInstallEnabled } from "../../releases";
import type { FirmwareVersion } from "../../types";
import { normalizeError } from "../../utils";
import { isOlderVersion } from "../../update";
import { T, useI18n } from "../../i18n";

interface UpdateSectionProps {
    firmware: FirmwareVersion | null;
    installing: boolean;
    onInstall: (release: ReleaseInfo) => void;
    errorStack: ErrorStackHandle;
}

const MAX_LISTED = 5;

// Release picker for the signed update path. Shows stable releases and
// prereleases that fit this board; the device verifies the signed token, so a
// prerelease only installs when someone explicitly asks for it here.
export function UpdateSection({ firmware, installing, onInstall, errorStack }: UpdateSectionProps) {
    const { t, formatBytes } = useI18n();
    const board = firmware?.signedUpdates ? (firmware.board ?? "") : "";
    const [releases, setReleases] = useState<ReleaseInfo[] | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(
        async (force: boolean) => {
            if (!board) return;
            setLoading(true);
            try {
                setReleases(await fetchReleases(board, force));
            } catch (e: unknown) {
                errorStack.push(normalizeError(e, "Could not load releases"));
            } finally {
                setLoading(false);
            }
        },
        [board, errorStack],
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    if (!firmware) return null;

    if (!firmware.signedUpdates) {
        return (
            <div class="settings-section" role="group" aria-label={t("Releases")}>
                <div class="fw-release-empty">
                    <T>This build was not produced by the release pipeline, so signed updates are unavailable.</T>
                </div>
            </div>
        );
    }

    const current = firmware.version;
    const listed = (releases ?? []).slice(0, MAX_LISTED);

    return (
        <div class="settings-section" role="group" aria-label={t("Releases")}>
            <div class="fw-release-header">
                <span class="settings-toggle-title">
                    <T>Releases</T>
                </span>
                <button
                    type="button"
                    class="fw-release-refresh"
                    onClick={() => void load(true)}
                    disabled={loading || installing}
                >
                    {loading ? t("Checking...") : t("Refresh")}
                </button>
            </div>

            {releases !== null && listed.length === 0 && (
                <div class="fw-release-empty">
                    <T>No releases found for this board.</T>
                </div>
            )}

            {listed.map((release) => {
                const isCurrent = release.version === current;
                const isOlder = isOlderVersion(release.version, current);
                return (
                    <div class="fw-release-row" key={release.tag}>
                        <div class="fw-release-meta">
                            <span class="fw-release-version">{`v${release.version}`}</span>
                            {release.prerelease && (
                                <span class="fw-release-badge">
                                    <T>pre-release</T>
                                </span>
                            )}
                            {isCurrent && (
                                <span class="fw-release-badge fw-release-current">
                                    <T>installed</T>
                                </span>
                            )}
                            {isOlder && (
                                <span class="fw-release-badge">
                                    <T>older</T>
                                </span>
                            )}
                            <span class="fw-release-size">{formatBytes(release.size)}</span>
                        </div>
                        {!isCurrent && !isOlder && releaseInstallEnabled && (
                            <button
                                type="button"
                                class="fw-release-install"
                                onClick={() => onInstall(release)}
                                disabled={installing}
                            >
                                <T>Install</T>
                            </button>
                        )}
                    </div>
                );
            })}

            <div class="fw-release-note">
                {releaseInstallEnabled ? (
                    <T>Installing takes a minute. Keep this page open until the device reboots.</T>
                ) : (
                    <T>Installation is disabled in the demo.</T>
                )}
            </div>
        </div>
    );
}
