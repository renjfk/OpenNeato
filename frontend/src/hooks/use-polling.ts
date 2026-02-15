import { useEffect, useRef, useState } from "preact/hooks";

export interface PollResult<T> {
    data: T | null;
    error: string | null;
}

// Polls continuously: waits for the previous request to complete, then waits
// at least intervalMs before starting the next one. Never overlaps requests.
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout>;

        const poll = async () => {
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
                    setError(e instanceof Error ? e.message : "fetch failed");
                }
            }
            if (active) {
                const elapsed = Date.now() - start;
                const delay = Math.max(0, intervalMs - elapsed);
                timer = setTimeout(poll, delay);
            }
        };

        poll();
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [intervalMs]);

    return { data, error };
}
