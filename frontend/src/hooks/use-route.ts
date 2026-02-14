import { useCallback, useEffect, useState } from "preact/hooks";

function readHash(): string {
    const hash = location.hash.replace(/^#/, "") || "/";
    return hash.startsWith("/") ? hash : `/${hash}`;
}

export function useRoute(): [string, (path: string) => void] {
    const [path, setPath] = useState(readHash);

    useEffect(() => {
        const sync = () => setPath(readHash());
        window.addEventListener("hashchange", sync);
        return () => window.removeEventListener("hashchange", sync);
    }, []);

    const navigate = useCallback((to: string) => {
        const hash = `#${to}`;
        if (location.hash !== hash) {
            history.pushState(null, "", hash);
            setPath(to);
        }
    }, []);

    return [path, navigate];
}
