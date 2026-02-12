import { useState, useEffect, useRef } from "preact/hooks";

export interface PollResult<T> {
    data: T | null;
    error: string | null;
}

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    useEffect(() => {
        let active = true;

        const poll = async () => {
            try {
                const result = await fetcherRef.current();
                if (active) {
                    setData(result);
                    setError(null);
                }
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : "fetch failed");
            }
        };

        poll();
        const id = setInterval(poll, intervalMs);
        return () => {
            active = false;
            clearInterval(id);
        };
    }, [intervalMs]);

    return { data, error };
}
