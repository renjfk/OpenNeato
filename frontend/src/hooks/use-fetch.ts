import { useEffect, useState } from "preact/hooks";

export interface FetchResult<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
}

// Fetches once on mount (or when deps change). Returns data, error, and loading state.
// Pass a stable fetcher function or wrap in useCallback if it depends on changing values.
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        fetcher()
            .then((result) => {
                if (active) setData(result);
            })
            .catch((e: unknown) => {
                if (active) setError(e instanceof Error ? e.message : "Fetch failed");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, deps);

    return { data, error, loading };
}
