import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../../api";
import databaseSvg from "../../assets/icons/database.svg?raw";
import { Icon } from "../../components/icon";
import { normalizeError } from "../../utils";
import type { LogEntry } from "./helpers";
import { DETAIL_KEY, formatTimestamp, parseLogLine, typeBadge } from "./helpers";

interface LogsItemViewProps {
    filename: string;
    onError: (msg: string) => void;
}

export function LogsItemView({ filename, onError }: LogsItemViewProps) {
    const [logLines, setLogLines] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter state: empty set = show all, non-empty = show only selected types
    const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
    // Drill-down sub-filter: empty set = show all within type, non-empty = show only selected detail values
    const [activeDetails, setActiveDetails] = useState<Set<string>>(new Set());

    const toggleFilter = useCallback((type: string) => {
        setActiveFilters((prev) => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });
        setActiveDetails(new Set()); // reset drill-down when type filter changes
    }, []);

    const toggleDetail = useCallback((value: string) => {
        setActiveDetails((prev) => {
            const next = new Set(prev);
            if (next.has(value)) next.delete(value);
            else next.add(value);
            return next;
        });
    }, []);

    // Unique types present in the current log, in a stable display order
    const availableTypes = useMemo(() => {
        const order = ["boot", "wifi", "ntp", "command", "request", "event", "ota"];
        const seen = new Set(logLines.map((l) => l.type));
        const sorted = order.filter((t) => seen.has(t));
        for (const t of seen) {
            if (!order.includes(t)) sorted.push(t);
        }
        return sorted;
    }, [logLines]);

    // Available drill-down values when exactly one type filter is active
    const drillDownValues = useMemo(() => {
        if (activeFilters.size !== 1) return [];
        const [type] = activeFilters;
        if (!DETAIL_KEY[type]) return [];
        const counts = new Map<string, number>();
        for (const l of logLines) {
            if (l.type === type && l.detail) {
                counts.set(l.detail, (counts.get(l.detail) ?? 0) + 1);
            }
        }
        // Sort by count descending, then alphabetically
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([value, count]) => ({ value, count }));
    }, [logLines, activeFilters]);

    const filteredLines = useMemo(() => {
        let lines = logLines;
        if (activeFilters.size > 0) {
            lines = lines.filter((l) => activeFilters.has(l.type));
        }
        if (activeDetails.size > 0) {
            lines = lines.filter((l) => l.detail !== null && activeDetails.has(l.detail));
        }
        return lines;
    }, [logLines, activeFilters, activeDetails]);

    // Reset filters and fetch content when filename changes
    useEffect(() => {
        setActiveFilters(new Set());
        setActiveDetails(new Set());
        setLoading(true);
        setLogLines([]);

        api.getLogContent(filename)
            .then((text) => {
                const lines = text
                    .split("\n")
                    .filter((l) => l.trim())
                    .map(parseLogLine)
                    .filter((l): l is NonNullable<typeof l> => l !== null)
                    .reverse();
                setLogLines(lines);
                setLoading(false);
            })
            .catch((e: unknown) => {
                onError(normalizeError(e, "Failed to load log"));
                setLoading(false);
            });
    }, [filename, onError]);

    return (
        <>
            {loading && <div class="logs-empty">Loading...</div>}

            {!loading && logLines.length === 0 && (
                <div class="logs-empty">
                    <Icon svg={databaseSvg} />
                    Empty log
                </div>
            )}

            {!loading && availableTypes.length > 1 && (
                <div class="logs-filter-bar">
                    <button
                        type="button"
                        class={`logs-filter-chip${activeFilters.size === 0 ? " active" : ""}`}
                        onClick={() => {
                            setActiveFilters(new Set());
                            setActiveDetails(new Set());
                        }}
                    >
                        All
                    </button>
                    {availableTypes.map((t) => {
                        const badge = typeBadge(t);
                        return (
                            <button
                                type="button"
                                key={t}
                                class={`logs-filter-chip ${badge.color}${activeFilters.has(t) ? " active" : ""}`}
                                onClick={() => toggleFilter(t)}
                            >
                                {badge.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {!loading && drillDownValues.length > 1 && (
                <div class="logs-filter-bar logs-drilldown-bar">
                    <button
                        type="button"
                        class={`logs-filter-chip logs-drilldown-chip${activeDetails.size === 0 ? " active" : ""}`}
                        onClick={() => setActiveDetails(new Set())}
                    >
                        All ({drillDownValues.reduce((s, d) => s + d.count, 0)})
                    </button>
                    {drillDownValues.map((d) => (
                        <button
                            type="button"
                            key={d.value}
                            class={`logs-filter-chip logs-drilldown-chip${activeDetails.has(d.value) ? " active" : ""}`}
                            onClick={() => toggleDetail(d.value)}
                        >
                            {d.value}
                            <span class="logs-drilldown-count">{d.count}</span>
                        </button>
                    ))}
                </div>
            )}

            {!loading && filteredLines.length > 0 && (
                <div class="logs-entries">
                    {filteredLines.map((line, i) => {
                        const badge = typeBadge(line.type);
                        return (
                            <div class="logs-entry" key={i}>
                                <div class="logs-entry-header">
                                    <span class={`logs-entry-badge ${badge.color}`}>{badge.label}</span>
                                    <span class="logs-entry-time">{formatTimestamp(line.ts)}</span>
                                </div>
                                <div class="logs-entry-body">{line.summary}</div>
                                {line.resp && (
                                    <details class="logs-entry-details">
                                        <summary>response</summary>
                                        <pre class="logs-entry-resp">{line.resp}</pre>
                                    </details>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && filteredLines.length === 0 && logLines.length > 0 && (
                <div class="logs-empty">No matching entries</div>
            )}
        </>
    );
}
