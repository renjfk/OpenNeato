import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

const localeModules = import.meta.glob("./locales/*.json", { eager: true, import: "default" }) as Record<
    string,
    Partial<Record<string, string>>
>;

export type Locale = string;
export type LanguagePreference = Locale;

const localeEntries = Object.entries(localeModules)
    .map(([path, strings]) => {
        const match = path.match(/\.\/locales\/([^/.]+)\.json$/);
        return match ? ([match[1].toLowerCase(), strings] as const) : null;
    })
    .filter((entry): entry is readonly [Locale, Partial<Record<string, string>>] => entry !== null);

const dictionaries: Record<Locale, Partial<Record<string, string>>> = Object.fromEntries(localeEntries);

export const availableLocales: ReadonlyArray<Locale> = [
    "en",
    ...localeEntries
        .map(([locale]) => locale)
        .filter((locale) => locale !== "en")
        .sort(),
];

const defaultLocale: Locale = availableLocales[0];

function isLocale(value: string): value is Locale {
    return availableLocales.includes(value);
}

export function resolveLocale(preference: LanguagePreference): Locale {
    return isLocale(preference) ? preference : defaultLocale;
}

export function loadLanguagePreference(): LanguagePreference {
    const saved = localStorage.getItem("language");
    if (saved && isLocale(saved)) return saved;
    return defaultLocale;
}

function interpolate(template: string, values?: Record<string, string | number>): string {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = values[key];
        return value === undefined ? match : String(value);
    });
}

function flattenText(children: ComponentChildren): string {
    if (children === null || children === undefined || typeof children === "boolean") return "";
    if (typeof children === "string" || typeof children === "number") return String(children);
    if (Array.isArray(children)) return children.map(flattenText).join("");
    return "";
}

interface I18nValue {
    preference: LanguagePreference;
    locale: Locale;
    setPreference: (preference: LanguagePreference) => void;
    t: (text: string, values?: Record<string, string | number>) => string;
    formatNumber: (value: number, options?: NumberFormatOptions) => string;
    formatDateTime: (epochSeconds: number) => string;
    formatTime: (epochSeconds: number) => string;
    formatSystemTime: (localTime: string) => string;
    formatDuration: (seconds: number) => string;
    formatClock: (seconds: number) => string;
    formatBytes: (bytes: number) => string;
}

interface NumberFormatOptions {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

function formatNumberManual(value: number, options?: NumberFormatOptions): string {
    const digits = options?.maximumFractionDigits ?? options?.minimumFractionDigits;
    if (digits !== undefined) return value.toFixed(digits);
    return String(value);
}

function formatDateTimeManual(epochSeconds: number): string {
    const date = new Date(epochSeconds * 1000);
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTimeManual(epochSeconds: number): string {
    const date = new Date(epochSeconds * 1000);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

const I18nContext = createContext<I18nValue>({
    preference: defaultLocale,
    locale: defaultLocale,
    setPreference: () => {},
    t: (text, values) => interpolate(text, values),
    formatNumber: formatNumberManual,
    formatDateTime: formatDateTimeManual,
    formatTime: formatTimeManual,
    formatSystemTime: (localTime) => localTime,
    formatDuration: (seconds) => formatDurationManual(seconds, (text) => text),
    formatClock: formatClockManual,
    formatBytes: formatBytesManual,
});

function formatDurationManual(seconds: number, t: (text: string) => string): string {
    const total = Math.max(0, Math.floor(seconds));
    if (total < 60) return `${total}${t("s")}`;

    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (days > 0) return `${days}${t("d")} ${hours}${t("h")} ${minutes}${t("m")}`;
    if (hours > 0) {
        return secs > 0
            ? `${hours}${t("h")} ${minutes}${t("m")} ${secs}${t("s")}`
            : `${hours}${t("h")} ${minutes}${t("m")}`;
    }
    return secs > 0 ? `${minutes}${t("m")} ${secs}${t("s")}` : `${minutes}${t("m")}`;
}

function formatClockManual(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`;
}

function formatBytesManual(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

interface I18nProviderProps {
    preference: LanguagePreference;
    locale: Locale;
    setPreference: (preference: LanguagePreference) => void;
    children: ComponentChildren;
}

export function I18nProvider({ preference, locale, setPreference, children }: I18nProviderProps) {
    const t = (text: string, values?: Record<string, string | number>) => {
        const translated = dictionaries[locale]?.[text] ?? text;
        return interpolate(translated, values);
    };
    const formatNumber = formatNumberManual;
    const formatDateTime = formatDateTimeManual;
    const formatTime = formatTimeManual;
    const formatSystemTime = (localTime: string) => {
        const match = localTime.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (.+)$/);
        return match ? `${t(match[1])} ${match[2]}` : localTime;
    };
    const formatDuration = (seconds: number) => formatDurationManual(seconds, t);
    const formatClock = formatClockManual;
    const formatBytes = formatBytesManual;

    return (
        <I18nContext.Provider
            value={{
                preference,
                locale,
                setPreference,
                t,
                formatNumber,
                formatDateTime,
                formatTime,
                formatSystemTime,
                formatDuration,
                formatClock,
                formatBytes,
            }}
        >
            {children}
        </I18nContext.Provider>
    );
}

export function useI18n() {
    return useContext(I18nContext);
}

interface TProps {
    children?: ComponentChildren;
}

export function T({ children }: TProps) {
    const { t } = useI18n();
    const source = flattenText(children);
    return t(source);
}
