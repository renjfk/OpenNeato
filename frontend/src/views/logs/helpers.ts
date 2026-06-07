// Shared helpers for logs views

// Type badge for log entries
export interface TypeBadge {
    label: string;
    color: string;
}

export function typeBadge(type: string): TypeBadge {
    switch (type) {
        case "boot":
            return { label: "BOOT", color: "blue" };
        case "wifi":
            return { label: "WIFI", color: "green" };
        case "ntp":
            return { label: "NTP", color: "teal" };
        case "command":
            return { label: "CMD", color: "amber" };
        case "request":
            return { label: "HTTP", color: "cyan" };
        case "event":
            return { label: "EVT", color: "pink" };
        case "ota":
            return { label: "OTA", color: "purple" };
        default:
            return { label: type.toUpperCase().slice(0, 4), color: "dim" };
    }
}

function formatResp(raw: string): string {
    // Clean up CRLF/CR to LF, trim trailing whitespace
    return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export interface LogEntry {
    ts: number;
    type: string;
    summary: string;
    resp: string | null;
    /** Drill-down key extracted from the data object (e.g. cmd, path, msg) */
    detail: string | null;
}

/** Map log type -> which data field to use as the drill-down key */
export const DETAIL_KEY: Record<string, string> = {
    command: "cmd",
    request: "path",
    event: "category",
    wifi: "event",
    ntp: "event",
    boot: "reason",
};

export function parseLogLine(line: string): LogEntry | null {
    try {
        const obj = JSON.parse(line);
        // Firmware format: { t, typ, d: {...} }
        const ts = obj.t ?? 0;
        const type = obj.typ ?? "?";
        // Build a human-readable summary from the nested "d" object
        const data = obj.d ?? {};
        const parts: string[] = [];
        let resp: string | null = null;
        for (const [k, v] of Object.entries(data)) {
            if (k === "resp") {
                if (typeof v === "string" && v) resp = formatResp(v);
                continue;
            }
            parts.push(`${k}=${v}`);
        }
        const detailKey = DETAIL_KEY[type];
        const detail = detailKey && typeof data[detailKey] === "string" ? (data[detailKey] as string) : null;
        return { ts, type, summary: parts.join(" "), resp, detail };
    } catch {
        return null;
    }
}
