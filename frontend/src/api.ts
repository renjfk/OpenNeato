import type { ChargerData, ErrorData, FirmwareVersion, StateData, SystemData, TimezoneData } from "./types";

async function parseError(res: Response): Promise<string> {
    try {
        const data = await res.json();
        if (data.error) return data.error;
    } catch {
        // body not JSON or missing error field
    }
    return `${res.status} ${res.statusText}`;
}

async function get<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await parseError(res));
    return res.json();
}

async function post(url: string): Promise<void> {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) throw new Error(await parseError(res));
}

async function put<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return res.json();
}

export const api = {
    getState: () => get<StateData>("/api/state"),
    getCharger: () => get<ChargerData>("/api/charger"),
    getError: () => get<ErrorData>("/api/error"),
    getSystem: () => get<SystemData>("/api/system"),
    getFirmwareVersion: () => get<FirmwareVersion>("/api/firmware/version"),
    cleanHouse: () => post("/api/clean/house"),
    cleanSpot: () => post("/api/clean/spot"),
    cleanStop: () => post("/api/clean/stop"),
    getTimezone: () => get<TimezoneData>("/api/timezone"),
    setTimezone: (tz: string) => put<TimezoneData>("/api/timezone", { tz }),
    playSound: (id: number) => post(`/api/sound?id=${id}`),
};
