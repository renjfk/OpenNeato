import { parseMapData } from "./history-data";
import type {
    ChargerData,
    ErrorData,
    FirmwareVersion,
    HistoryFileInfo,
    LidarScan,
    LogFileInfo,
    ManualStatus,
    MapData,
    SettingsData,
    StateData,
    SystemData,
    UserSettingsData,
} from "./types";

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

async function del(url: string): Promise<void> {
    const res = await fetch(url, { method: "DELETE" });
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

async function sendSerial(cmd: string): Promise<string> {
    const res = await fetch(`/api/serial?cmd=${encodeURIComponent(cmd)}`, { method: "POST" });
    if (!res.ok) throw new Error(await parseError(res));
    return res.text();
}

async function fetchLogText(name: string): Promise<string> {
    const res = await fetch(`/api/logs/${name}`);
    if (!res.ok) throw new Error(await parseError(res));
    return res.text();
}

async function fetchSessionData(filename: string): Promise<MapData[]> {
    const res = await fetch(`/api/history/${filename}`);
    if (!res.ok) throw new Error(await parseError(res));
    const raw = await res.text();
    if (!raw.trim()) return [];
    return parseMapData(raw);
}

function uploadFirmware(file: File, md5: string, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/firmware/update?hash=${md5}`);
        xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                try {
                    const data = JSON.parse(xhr.responseText);
                    reject(new Error(data.error || `${xhr.status} ${xhr.statusText}`));
                } catch {
                    reject(new Error(`${xhr.status} ${xhr.statusText}`));
                }
            }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
    });
}

export const api = {
    getState: () => get<StateData>("/api/state"),
    getCharger: () => get<ChargerData>("/api/charger"),
    getError: () => get<ErrorData>("/api/error"),
    getSystem: () => get<SystemData>("/api/system"),
    getFirmwareVersion: () => get<FirmwareVersion>("/api/firmware/version"),
    cleanHouse: () => post("/api/clean?action=house"),
    cleanSpot: () => post("/api/clean?action=spot"),
    cleanPause: () => post("/api/clean?action=pause"),
    cleanStop: () => post("/api/clean?action=stop"),
    cleanDock: () => post("/api/clean?action=dock"),
    manual: (enable: boolean) => post(`/api/manual?enable=${enable ? 1 : 0}`),
    manualMove: (left: number, right: number, speed: number) =>
        post(`/api/manual/move?left=${left}&right=${right}&speed=${speed}`),
    manualMotors: (brush: boolean, vacuum: boolean, sideBrush: boolean) =>
        post(`/api/manual/motors?brush=${brush ? 1 : 0}&vacuum=${vacuum ? 1 : 0}&sideBrush=${sideBrush ? 1 : 0}`),
    getManualStatus: () => get<ManualStatus>("/api/manual/status"),
    getLidar: () => get<LidarScan>("/api/lidar"),
    lidarRotate: (enable: boolean) => post(`/api/lidar/rotate?enable=${enable ? 1 : 0}`),
    getSettings: () => get<SettingsData>("/api/settings"),
    updateSettings: (patch: Partial<SettingsData>) => put<SettingsData>("/api/settings", patch),
    testNotification: (topic: string) => post(`/api/notifications/test?topic=${encodeURIComponent(topic)}`),
    playSound: (id: number) => post(`/api/sound?id=${id}`),
    robotRestart: () => post("/api/power?action=restart"),
    robotShutdown: () => post("/api/power?action=shutdown"),
    restart: () => post("/api/system/restart"),
    formatFs: () => post("/api/system/format-fs"),
    factoryReset: () => post("/api/system/reset"),
    getLogs: () => get<LogFileInfo[]>("/api/logs"),
    getLogContent: (name: string) => fetchLogText(name),
    deleteLog: (name: string) => del(`/api/logs/${name}`),
    deleteAllLogs: () => del("/api/logs"),
    getHistoryList: () => get<HistoryFileInfo[]>("/api/history"),
    getHistorySession: (filename: string) => fetchSessionData(filename),
    deleteHistorySession: (name: string) => del(`/api/history/${name}`),
    deleteAllHistory: () => del("/api/history"),
    uploadFirmware: (file: File, md5: string, onProgress: (pct: number) => void) =>
        uploadFirmware(file, md5, onProgress),
    setScheduleDay: (day: number, hour: number, minute: number, on: boolean) =>
        put<SettingsData>("/api/settings", {
            [`sched${day}Hour`]: hour,
            [`sched${day}Min`]: minute,
            [`sched${day}On`]: on,
        }),
    setScheduleEnabled: (on: boolean) => put<SettingsData>("/api/settings", { scheduleEnabled: on }),
    getUserSettings: () => get<UserSettingsData>("/api/user-settings"),
    setUserSetting: (key: string, value: string) =>
        post(`/api/user-settings?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`),
    sendSerial: (cmd: string) => sendSerial(cmd),
};
