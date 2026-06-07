import { useCallback, useEffect, useRef, useState } from "preact/hooks";

function readHash(): string {
    const hash = location.hash.replace(/^#/, "") || "/";
    return hash.startsWith("/") ? hash : `/${hash}`;
}

export function useRoute(): [string, (path: string) => void, (fallback: string) => void] {
    const [path, setPath] = useState(readHash);
    const previousPath = useRef<string | null>(null);
    const currentPath = useRef(path);

    currentPath.current = path;

    useEffect(() => {
        const sync = () => {
            const next = readHash();
            if (next === currentPath.current) return;
            previousPath.current = currentPath.current;
            setPath(next);
        };
        window.addEventListener("hashchange", sync);
        return () => window.removeEventListener("hashchange", sync);
    }, []);

    const navigate = useCallback((to: string) => {
        const hash = `#${to}`;
        if (location.hash !== hash) {
            previousPath.current = currentPath.current;
            history.pushState(null, "", hash);
            setPath(to);
        }
    }, []);

    const goBack = useCallback(
        (fallback: string) => {
            if (previousPath.current) {
                history.back();
                return;
            }
            navigate(fallback);
        },
        [navigate],
    );

    return [path, navigate, goBack];
}
