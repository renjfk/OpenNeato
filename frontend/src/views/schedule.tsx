import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import clockSvg from "../assets/icons/clock.svg?raw";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useNavigate } from "../components/router";
import { useFetch } from "../hooks/use-fetch";
import type { SettingsData } from "../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DayState {
    hour: number;
    minute: number;
    on: boolean;
}

function readDays(s: SettingsData): DayState[] {
    const days: DayState[] = [];
    for (let d = 0; d < 7; d++) {
        days.push({
            hour: (s as Record<string, number>)[`sched${d}Hour`] ?? 0,
            minute: (s as Record<string, number>)[`sched${d}Min`] ?? 0,
            on: (s as Record<string, boolean>)[`sched${d}On`] ?? false,
        });
    }
    return days;
}

function padTime(n: number): string {
    return n.toString().padStart(2, "0");
}

export function ScheduleView() {
    const navigate = useNavigate();
    const [errors, errorStack] = useErrorStack();
    const [saving, setSaving] = useState<number | null>(null); // day index being saved
    const [masterSaving, setMasterSaving] = useState(false);

    // Fetch settings on mount
    const { data: settings, loading, error: fetchError } = useFetch(api.getSettings);

    // Local state — seeded from fetch, then locally managed
    const [enabled, setEnabled] = useState(false);
    const [days, setDays] = useState<DayState[]>(() =>
        Array.from({ length: 7 }, () => ({ hour: 0, minute: 0, on: false })),
    );

    useEffect(() => {
        if (settings) {
            setEnabled(settings.scheduleEnabled);
            setDays(readDays(settings));
        }
    }, [settings]);

    useEffect(() => {
        if (fetchError) errorStack.push(fetchError);
    }, [fetchError]);

    // Toggle master enable — apply immediately
    const handleToggleMaster = useCallback(() => {
        const newVal = !enabled;
        setEnabled(newVal);
        setMasterSaving(true);
        api.setScheduleEnabled(newVal)
            .catch((e: unknown) => {
                setEnabled(!newVal); // revert on failure
                errorStack.push(e instanceof Error ? e.message : "Failed to update schedule");
            })
            .finally(() => setMasterSaving(false));
    }, [enabled, errorStack]);

    // Update a single day and send to server immediately
    const applyDay = useCallback(
        (day: number, patch: Partial<DayState>) => {
            const prev = days[day];
            const updated = { ...prev, ...patch };
            setDays((cur) => cur.map((d, i) => (i === day ? updated : d)));
            setSaving(day);
            api.setScheduleDay(day, updated.hour, updated.minute, updated.on)
                .catch((e: unknown) => {
                    setDays((cur) => cur.map((d, i) => (i === day ? prev : d))); // revert
                    errorStack.push(e instanceof Error ? e.message : `Failed to save ${DAY_NAMES[day]}`);
                })
                .finally(() => setSaving(null));
        },
        [days, errorStack],
    );

    return (
        <>
            <div class="header">
                <button type="button" class="header-back-btn" onClick={() => navigate("/settings")} aria-label="Back">
                    <Icon svg={backSvg} />
                </button>
                <h1>Schedule</h1>
                <div class="header-right-spacer" />
            </div>

            <ErrorBannerStack errors={errors} />

            <div class="schedule-page">
                {loading ? (
                    <div class="schedule-loading">Loading schedule...</div>
                ) : (
                    <>
                        {/* Master toggle */}
                        <div class="schedule-master">
                            <div class="settings-toggle-label">
                                <span class="settings-toggle-title">Schedule enabled</span>
                                <span class="settings-toggle-desc">Automatically clean on set days and times</span>
                            </div>
                            <button
                                type="button"
                                class={`settings-toggle${enabled ? " on" : ""}${masterSaving ? " pending" : ""}`}
                                onClick={handleToggleMaster}
                                disabled={masterSaving}
                                aria-label="Toggle schedule"
                            />
                        </div>

                        {/* Day entries */}
                        <div class="schedule-days">
                            {days.map((day, i) => {
                                const isSaving = saving === i;
                                return (
                                    <div key={i} class={`schedule-day-row${isSaving ? " pending" : ""}`}>
                                        <div class="schedule-day-left">
                                            <button
                                                type="button"
                                                class={`schedule-day-toggle${day.on ? " on" : ""}`}
                                                onClick={() => applyDay(i, { on: !day.on })}
                                                disabled={isSaving}
                                                aria-label={`Toggle ${DAY_NAMES[i]}`}
                                            />
                                            <span class={`schedule-day-name${day.on ? "" : " off"}`}>
                                                {DAY_NAMES[i]}
                                            </span>
                                        </div>
                                        <div class="schedule-day-right">
                                            {day.on && (
                                                <div class="schedule-time-inputs">
                                                    <Icon svg={clockSvg} />
                                                    <select
                                                        class="schedule-time-select"
                                                        value={day.hour}
                                                        onChange={(e) =>
                                                            applyDay(i, {
                                                                hour: Number.parseInt(
                                                                    (e.target as HTMLSelectElement).value,
                                                                    10,
                                                                ),
                                                            })
                                                        }
                                                        disabled={isSaving}
                                                    >
                                                        {Array.from({ length: 24 }, (_, h) => (
                                                            <option key={h} value={h}>
                                                                {padTime(h)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <span class="schedule-time-colon">:</span>
                                                    <select
                                                        class="schedule-time-select"
                                                        value={day.minute}
                                                        onChange={(e) =>
                                                            applyDay(i, {
                                                                minute: Number.parseInt(
                                                                    (e.target as HTMLSelectElement).value,
                                                                    10,
                                                                ),
                                                            })
                                                        }
                                                        disabled={isSaving}
                                                    >
                                                        {Array.from({ length: 60 }, (_, m) => (
                                                            <option key={m} value={m}>
                                                                {padTime(m)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
