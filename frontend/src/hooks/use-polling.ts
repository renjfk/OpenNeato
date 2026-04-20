import { useEffect, useRef, useState } from "preact/hooks";
import { normalizeError } from "../utils";

export interface PollResult<T> {
    data: T | null;
    error: string | null;
}

// Polls continuously: waits for the previous request to complete, then waits
// at least intervalMs before starting the next one. Never overlaps requests.
// Pauses when the browser tab is hidden and resumes immediately on return.
// Pass intervalMs <= 0 to disable polling (returns null data/error).
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    useEffect(() => {
        if (intervalMs <= 0) {
            setData(null);
            setError(null);
            return;
        }

        let active = true;
        let timer: ReturnType<typeof setTimeout>;
        let polling = false; // true while a fetch is in-flight

        const poll = async () => {
            if (document.hidden) return;
            polling = true;
            const start = Date.now();
            try {
                const result = await fetcherRef.current();
                if (active) {
                    setData(result);
                    setError(null);
                }
            } catch (e) {
                if (active) {
                    setData(null);
                    setError(normalizeError(e, "fetch failed"));
                }
            }
            polling = false;
            if (active && !document.hidden) {
                const elapsed = Date.now() - start;
                const delay = Math.max(0, intervalMs - elapsed);
                timer = setTimeout(poll, delay);
            }
        };

        const onVisibilityChange = () => {
            if (!active) return;
            if (document.hidden) {
                // Tab went to background — cancel pending timer
                clearTimeout(timer);
            } else if (!polling) {
                // Tab returned — poll immediately
                poll();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        poll();

        return () => {
            active = false;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [intervalMs]);

    return { data, error };
}
