import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import backSvg from "../assets/icons/back.svg?raw";
import { ConfirmDialog } from "../components/confirm-dialog";
import { ErrorBannerStack, useErrorStack } from "../components/error-banner";
import { Icon } from "../components/icon";
import { useDirtyGuard } from "../hooks/use-dirty-guard";
import { useFetch } from "../hooks/use-fetch";
import type { SettingsData, SystemData } from "../types";
import { findCurrentTzAbbrev, findPresetLabel } from "./settings/helpers";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS_PER_DAY = 2;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface SlotState {
    hour: number;
    minute: number;
    on: boolean;
}

interface DayState {
    slots: SlotState[];
}

type SchedDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function readDays(s: SettingsData): DayState[] {
    const days: DayState[] = [];
    for (let d = 0; d < 7; d++) {
        const day = d as SchedDay;
        const slot0: SlotState = {
            hour: (s[`sched${day}Hour` as keyof SettingsData] as number) ?? 0,
            minute: (s[`sched${day}Min` as keyof SettingsData] as number) ?? 0,
            on: (s[`sched${day}On` as keyof SettingsData] as boolean) ?? false,
        };
        const slot1: SlotState = {
            hour: (s[`sched${day}Slot1Hour` as keyof SettingsData] as number) ?? 0,
            minute: (s[`sched${day}Slot1Min` as keyof SettingsData] as number) ?? 0,
            on: (s[`sched${day}Slot1On` as keyof SettingsData] as boolean) ?? false,
        };
        days.push({ slots: [slot0, slot1] });
    }
    return days;
}

function daysToDrafts(days: DayState[]): string[][] {
    return days.map((d) => d.slots.map((s) => fmtTime(s.hour, s.minute)));
}

function buildSchedulePatch(days: DayState[], server: DayState[]): Partial<SettingsData> {
    const patch: Record<string, number | boolean> = {};
    for (let d = 0; d < 7; d++) {
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
            const cur = days[d].slots[s];
            const srv = server[d].slots[s];
            const prefix = s === 0 ? `sched${d}` : `sched${d}Slot${s}`;
            if (cur.hour !== srv.hour) patch[`${prefix}Hour`] = cur.hour;
            if (cur.minute !== srv.minute) patch[`${prefix}Min`] = cur.minute;
            if (cur.on !== srv.on) patch[`${prefix}On`] = cur.on;
        }
    }
    return patch as Partial<SettingsData>;
}

function fmtTime(h: number, m: number): string {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function parseTime(value: string): { hour: number; minute: number } | null {
    const match = value.match(TIME_RE);
    if (!match) return null;
    return { hour: Number.parseInt(match[1], 10), minute: Number.parseInt(match[2], 10) };
}

function tzLabel(tz: string, isDst?: boolean): string {
    // Show abbreviation with current offset, e.g. "EEST (UTC+3)"
    if (isDst !== undefined) {
        const abbrev = findCurrentTzAbbrev(tz, isDst);
        const preset = findPresetLabel(tz);
        if (abbrev && preset) {
            const offset = preset.replace(/^.*\(UTC([^)]+)\/([^)]+)\).*$/, (_m, std, dst) => (isDst ? dst : std));
            // If regex matched (DST zone), show "EEST (UTC+3)"; otherwise just use the preset label
            return offset !== preset ? `${abbrev} (UTC${offset})` : preset;
        }
        if (abbrev) return abbrev;
    }
    const preset = findPresetLabel(tz);
    if (preset) return preset;
    const match = tz.match(/^([A-Z]{2,5})/);
    return match ? match[1] : tz;
}

// Validate all enabled time drafts. Returns set of "day-slot" keys that are invalid.
function validateDrafts(days: DayState[], drafts: string[][]): Set<string> {
    const invalid = new Set<string>();
    for (let d = 0; d < 7; d++) {
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
            if (days[d].slots[s].on && !parseTime(drafts[d][s])) {
                invalid.add(`${d}-${s}`);
            }
        }
    }
    return invalid;
}

// Apply parsed draft times back into day state (only for enabled, valid slots)
function applyDrafts(days: DayState[], drafts: string[][]): DayState[] {
    return days.map((day, d) => ({
        slots: day.slots.map((slot, s) => {
            if (!slot.on) return slot;
            const parsed = parseTime(drafts[d][s]);
            if (!parsed) return slot;
            return { ...slot, hour: parsed.hour, minute: parsed.minute };
        }),
    }));
}

export function ScheduleView() {
    const [errors, errorStack] = useErrorStack();
    const [saving, setSaving] = useState(false);

    const { data: settings, loading, error: fetchError } = useFetch(api.getSettings);
    const { data: system } = useFetch<SystemData>(api.getSystem);

    const [enabled, setEnabled] = useState(false);
    const [tz, setTz] = useState("UTC0");
    const [days, setDays] = useState<DayState[]>(() =>
        Array.from({ length: 7 }, () => ({
            slots: Array.from({ length: SLOTS_PER_DAY }, () => ({ hour: 0, minute: 0, on: false })),
        })),
    );

    // Draft strings for time inputs (free-form text, validated at save)
    const [drafts, setDrafts] = useState<string[][]>(() => Array.from({ length: 7 }, () => ["00:00", "00:00"]));

    // Set of "day-slot" keys with validation errors (populated at save time)
    const [invalidSlots, setInvalidSlots] = useState<Set<string>>(new Set());

    // Server-confirmed state for dirty detection
    const serverDays = useRef<DayState[]>(days);
    const serverEnabled = useRef(false);

    useEffect(() => {
        if (settings) {
            const d = readDays(settings);
            setEnabled(settings.scheduleEnabled);
            serverEnabled.current = settings.scheduleEnabled;
            setTz(settings.tz);
            setDays(d);
            setDrafts(daysToDrafts(d));
            serverDays.current = d;
            setInvalidSlots(new Set());
        }
    }, [settings]);

    useEffect(() => {
        if (fetchError) errorStack.push(fetchError);
    }, [fetchError]);

    // Dirty = toggle changed, or any draft text differs from server
    const isDirty = enabled !== serverEnabled.current || !draftsMatchDays(drafts, days, serverDays.current);

    const { guardedNavigate, showDiscardConfirm, setShowDiscardConfirm, handleDiscard } = useDirtyGuard(isDirty);

    // Local-only state changes (no API call)
    const updateSlot = useCallback((day: number, slot: number, patch: Partial<SlotState>) => {
        setDays((cur) =>
            cur.map((d, i) =>
                i === day ? { slots: d.slots.map((s, si) => (si === slot ? { ...s, ...patch } : s)) } : d,
            ),
        );
        // When adding slot 2, seed draft with default time
        if (patch.on === true && patch.hour !== undefined) {
            setDrafts((cur) =>
                cur.map((r, i) =>
                    i === day ? r.map((v, si) => (si === slot ? fmtTime(patch.hour ?? 0, patch.minute ?? 0) : v)) : r,
                ),
            );
        }
    }, []);

    const updateDraft = useCallback((day: number, slot: number, raw: string) => {
        // Auto-insert colon: "0930" -> "09:30"
        let value = raw;
        if (/^\d{4}$/.test(value)) {
            value = `${value.slice(0, 2)}:${value.slice(2)}`;
        }
        setDrafts((cur) => cur.map((r, i) => (i === day ? r.map((v, si) => (si === slot ? value : v)) : r)));
        // Clear validation error for this slot on edit
        setInvalidSlots((cur) => {
            const key = `${day}-${slot}`;
            if (!cur.has(key)) return cur;
            const next = new Set(cur);
            next.delete(key);
            return next;
        });
    }, []);

    // Single batched save with validation
    const handleSave = useCallback(() => {
        // Apply drafts to get final day state
        const finalDays = applyDrafts(days, drafts);

        // Validate all enabled slots
        const invalid = validateDrafts(finalDays, drafts);
        if (invalid.size > 0) {
            setInvalidSlots(invalid);
            errorStack.push("Fix invalid times before saving (use HH:MM format, 00:00-23:59)");
            return;
        }

        const patch: Partial<SettingsData> = {
            ...buildSchedulePatch(finalDays, serverDays.current),
        };
        if (enabled !== serverEnabled.current) {
            patch.scheduleEnabled = enabled;
        }

        setSaving(true);
        setInvalidSlots(new Set());
        api.saveSchedule(patch)
            .then((res) => {
                const d = readDays(res);
                serverDays.current = d;
                serverEnabled.current = res.scheduleEnabled;
                setDays(d);
                setDrafts(daysToDrafts(d));
                setEnabled(res.scheduleEnabled);
            })
            .catch((e: unknown) => {
                errorStack.push(e instanceof Error ? e.message : "Failed to save schedule");
            })
            .finally(() => setSaving(false));
    }, [days, drafts, enabled, errorStack]);

    const onKeyDown = useCallback((e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
        }
    }, []);

    return (
        <>
            <div class="header">
                <button
                    type="button"
                    class="header-back-btn"
                    onClick={() => guardedNavigate("/settings")}
                    aria-label="Back"
                >
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
                                class={`settings-toggle${enabled ? " on" : ""}`}
                                onClick={() => setEnabled((v) => !v)}
                                aria-label="Toggle schedule"
                            />
                        </div>

                        <div class="schedule-tz-hint">Times are in {tzLabel(tz, system?.isDst)}</div>

                        {/* Day rows */}
                        <div class="schedule-days">
                            {days.map((day, i) => {
                                const s0 = day.slots[0];
                                const s1 = day.slots[1];

                                return (
                                    <div key={i} class="sched-row">
                                        <button
                                            type="button"
                                            class={`schedule-day-toggle${s0.on ? " on" : ""}`}
                                            onClick={() => updateSlot(i, 0, { on: !s0.on })}
                                            aria-label={`Toggle ${DAY_NAMES[i]}`}
                                        />
                                        <span class={`sched-day-label${s0.on ? "" : " off"}`}>{DAY_NAMES[i]}</span>

                                        <div class="sched-slots">
                                            {s0.on && (
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    class={`sched-time-input${invalidSlots.has(`${i}-0`) ? " invalid" : ""}`}
                                                    value={drafts[i][0]}
                                                    maxLength={5}
                                                    placeholder="HH:MM"
                                                    onInput={(e) =>
                                                        updateDraft(i, 0, (e.target as HTMLInputElement).value)
                                                    }
                                                    onKeyDown={onKeyDown}
                                                />
                                            )}

                                            {s0.on && s1.on && (
                                                <div class="sched-slot2-wrap">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        class={`sched-time-input${invalidSlots.has(`${i}-1`) ? " invalid" : ""}`}
                                                        value={drafts[i][1]}
                                                        maxLength={5}
                                                        placeholder="HH:MM"
                                                        onInput={(e) =>
                                                            updateDraft(i, 1, (e.target as HTMLInputElement).value)
                                                        }
                                                        onKeyDown={onKeyDown}
                                                    />
                                                    <button
                                                        type="button"
                                                        class="sched-remove-btn"
                                                        onClick={() => updateSlot(i, 1, { on: false })}
                                                        aria-label={`Remove ${DAY_NAMES[i]} second slot`}
                                                    >
                                                        x
                                                    </button>
                                                </div>
                                            )}
                                            {s0.on && !s1.on && (
                                                <button
                                                    type="button"
                                                    class="sched-add-btn"
                                                    onClick={() => updateSlot(i, 1, { on: true, hour: 15, minute: 0 })}
                                                    aria-label={`Add ${DAY_NAMES[i]} second slot`}
                                                >
                                                    +
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Save button */}
                        <button
                            type="button"
                            class={`settings-save-btn${saving ? " pending" : ""}`}
                            onClick={handleSave}
                            disabled={saving || !isDirty}
                        >
                            {saving ? "Saving..." : "Save"}
                        </button>
                    </>
                )}
            </div>

            {showDiscardConfirm && (
                <ConfirmDialog
                    message="You have unsaved changes. Discard them?"
                    confirmLabel="Discard"
                    onConfirm={handleDiscard}
                    onCancel={() => setShowDiscardConfirm(false)}
                />
            )}
        </>
    );
}

// Check if drafts differ from server state (accounts for toggle changes + text edits)
function draftsMatchDays(drafts: string[][], days: DayState[], server: DayState[]): boolean {
    for (let d = 0; d < 7; d++) {
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
            const cur = days[d].slots[s];
            const srv = server[d].slots[s];
            // Toggle state changed
            if (cur.on !== srv.on) return false;
            // For enabled slots, check if draft text resolves to a different time
            if (cur.on) {
                const parsed = parseTime(drafts[d][s]);
                if (!parsed) return false; // unparseable = dirty (will fail validation)
                if (parsed.hour !== srv.hour || parsed.minute !== srv.minute) return false;
            }
        }
    }
    return true;
}
