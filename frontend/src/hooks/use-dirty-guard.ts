import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useNavigate, usePath } from "../components/router";

/**
 * Prevents accidental navigation away from a page with unsaved changes.
 * - Intercepts browser close/reload via beforeunload
 * - Intercepts browser back/forward via hashchange (SPA hash routing)
 * - Wraps in-app navigation with a confirm dialog when dirty
 *
 * Returns guardedNavigate (use instead of navigate), the discard dialog state,
 * and a handler to call when the user confirms discarding.
 */
export function useDirtyGuard(isDirty: boolean) {
    const navigate = useNavigate();
    const currentPath = usePath();
    const dirtyRef = useRef(false);
    dirtyRef.current = isDirty;

    // Remember our path so we can restore hash on blocked back/forward
    const pathRef = useRef(currentPath);
    pathRef.current = currentPath;

    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const pendingNav = useRef<string | null>(null);

    // Browser close/reload guard
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (dirtyRef.current) e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    // Browser back/forward guard - intercept hashchange when dirty
    useEffect(() => {
        const handler = () => {
            if (!dirtyRef.current) return;

            // Hash changed while dirty - read where the browser wants to go
            const newHash = location.hash.replace(/^#/, "") || "/";
            const target = newHash.startsWith("/") ? newHash : `/${newHash}`;

            // Restore our current path in the URL (block the navigation)
            const ourHash = `#${pathRef.current}`;
            if (location.hash !== ourHash) {
                history.replaceState(null, "", ourHash);
            }

            // Show confirm dialog with the intended destination
            pendingNav.current = target;
            setShowDiscardConfirm(true);
        };
        window.addEventListener("hashchange", handler);
        return () => window.removeEventListener("hashchange", handler);
    }, []);

    // In-app navigation guard
    const guardedNavigate = useCallback(
        (to: string) => {
            if (isDirty) {
                pendingNav.current = to;
                setShowDiscardConfirm(true);
            } else {
                navigate(to);
            }
        },
        [isDirty, navigate],
    );

    // Called when user confirms discard
    const handleDiscard = useCallback(() => {
        setShowDiscardConfirm(false);
        if (pendingNav.current) {
            navigate(pendingNav.current);
            pendingNav.current = null;
        }
    }, [navigate]);

    return {
        guardedNavigate,
        showDiscardConfirm,
        setShowDiscardConfirm,
        handleDiscard,
    };
}
