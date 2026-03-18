import type { ErrorData } from "./types";

interface NormalizedRobotError {
    title: string;
    message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
    UI_ERROR_PICKED_UP: "Robot is picked up or one wheel is off the floor.",
    UI_ERROR_DUST_BIN_MISSING: "Dust bin is missing.",
    UI_ERROR_DUST_BIN_FULL: "Dust bin is full.",
    UI_ERROR_DUST_BIN_EMPTIED: "Dust bin was removed or emptied during cleaning.",
    UI_ERROR_BUMPER_STUCK: "Bumper looks stuck.",
    UI_ERROR_LWHEEL_STUCK: "Left wheel is stuck.",
    UI_ERROR_RWHEEL_STUCK: "Right wheel is stuck.",
    UI_ERROR_BRUSH_STUCK: "Main brush is stuck.",
    UI_ERROR_BRUSH_OVERLOAD: "Main brush is overloaded.",
    UI_ERROR_VACUUM_STUCK: "Vacuum motor is stuck.",
    UI_ERROR_VACUUM_SLIP: "Vacuum motor is slipping.",
    UI_ERROR_LDS_JAMMED: "LIDAR turret is jammed.",
    UI_ERROR_LDS_DISCONNECTED: "LIDAR is disconnected.",
    UI_ERROR_UNABLE_TO_RETURN_TO_BASE: "Robot could not return to the base.",
    UI_ERROR_BATTERY_CRITICAL: "Battery is critically low.",
    UI_ERROR_BATTERY_OVERTEMP: "Battery is too hot.",
    UI_ERROR_DECK_DEBRIS: "Please clear debris from the brush deck.",
    UI_ERROR_RDROP_STUCK: "Right drop sensor looks stuck.",
    UI_ERROR_LDROP_STUCK: "Left drop sensor looks stuck.",
    UI_ERROR_UNABLE_TO_SEE: "Navigation sensors cannot see clearly.",
};

const ALERT_MESSAGES: Record<string, string> = {
    UI_ALERT_DUST_BIN_FULL: "Dust bin full.",
    UI_ALERT_RETURN_TO_BASE: "Returning to base.",
    UI_ALERT_RETURN_TO_CHARGE: "Returning to charge.",
    UI_ALERT_CONNECT_CHRG_CABLE: "Connect charging cable.",
    UI_ALERT_TIME_NOT_SET: "Clock is not set.",
    UI_ALERT_BRUSH_CHANGE: "Brush change reminder.",
    UI_ALERT_FILTER_CHANGE: "Filter change reminder.",
};

function humanizeToken(token: string): string {
    return token
        .replace(/^UI_(ERROR|ALERT)_/, "")
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function sanitizeRawMessage(message: string): string {
    return message.replace(/\s+/g, " ").trim();
}

export function normalizeRobotError(error: ErrorData | null | undefined): NormalizedRobotError | null {
    if (!error?.hasError) return null;

    const raw = error.errorMessage ?? "";
    const tokens = raw.match(/UI_(?:ERROR|ALERT)_[A-Z0-9_]+/g) ?? [];
    const uniqueTokens = [...new Set(tokens)];
    const primaryError = uniqueTokens.find((token) => token.startsWith("UI_ERROR_"));
    const alertTokens = uniqueTokens.filter((token) => token.startsWith("UI_ALERT_") && token !== "UI_ALERT_INVALID");

    if (!primaryError && alertTokens.length === 0) {
        return {
            title: "Robot Attention Needed",
            message: sanitizeRawMessage(raw) || `Robot reported error ${error.errorCode}.`,
        };
    }

    const primaryMessage = primaryError
        ? (ERROR_MESSAGES[primaryError] ?? `${humanizeToken(primaryError)}.`)
        : `Robot reported error ${error.errorCode}.`;

    if (alertTokens.length === 0) {
        return {
            title: "Robot Attention Needed",
            message: primaryMessage,
        };
    }

    const alertMessage = alertTokens.map((token) => ALERT_MESSAGES[token] ?? `${humanizeToken(token)}.`).join(" ");

    return {
        title: "Robot Attention Needed",
        message: `${primaryMessage} Also reported: ${alertMessage}`,
    };
}
