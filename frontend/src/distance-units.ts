export type DistanceUnit = "meters" | "feet";

const METERS_TO_FEET = 3.28084;
const SQUARE_METERS_TO_SQUARE_FEET = 10.7639;

export function loadDistanceUnit(): DistanceUnit {
    return localStorage.getItem("distanceUnit") === "feet" ? "feet" : "meters";
}

export function formatDistance(
    meters: number,
    unit: DistanceUnit,
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
    const value = unit === "feet" ? meters * METERS_TO_FEET : meters;
    return `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit === "feet" ? "ft" : "m"}`;
}

export function formatArea(
    squareMeters: number,
    unit: DistanceUnit,
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
    const value = unit === "feet" ? squareMeters * SQUARE_METERS_TO_SQUARE_FEET : squareMeters;
    return `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit === "feet" ? "ft\u00b2" : "m\u00b2"}`;
}
