import type { ChargerData, ErrorData, FirmwareVersion, StateData, SystemData } from "./types";

async function get<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

async function post(url: string): Promise<void> {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
    playSound: (id: number) => post(`/api/sound?id=${id}`),
};
