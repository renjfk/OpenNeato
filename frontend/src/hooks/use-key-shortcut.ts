import { useEffect } from "preact/hooks";

// Which modifier keys a shortcut requires. Each flag means "this modifier
// must be in the given state". Flags left undefined don't constrain the
// match. `{}` means "no modifiers at all" — the default.
export interface KeyModifiers {
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
    shift?: boolean;
}

export interface KeyShortcutOptions {
    // Key to match — compared against KeyboardEvent.key (e.g. " ", "Escape",
    // "ArrowLeft") and optionally KeyboardEvent.code (e.g. "Space").
    key: string;
    // Optional KeyboardEvent.code alternative when `key` alone is ambiguous
    // (e.g. " " can mean the spacebar or another layout's key).
    code?: string;
    // Required modifier state. Omitted modifiers must be *not held*; set a
    // modifier to `true` to require it, `false` to explicitly forbid it.
    // Pass "any" to skip modifier checking entirely.
    modifiers?: KeyModifiers | "any";
    // When false the shortcut is inert. Useful to toggle the binding based
    // on whether a view or modal is open.
    enabled?: boolean;
    // When true the handler fires even while the user is typing in an
    // input/textarea/select/contentEditable element. Default is false so
    // shortcuts don't steal legitimate text input.
    fireInInputs?: boolean;
    // When true (default) the browser's default action for the key is
    // prevented when the shortcut fires.
    preventDefault?: boolean;
}

function modifiersMatch(e: KeyboardEvent, mods: KeyModifiers | "any" | undefined): boolean {
    if (mods === "any") return true;
    const want = mods ?? {};
    if ((want.ctrl ?? false) !== e.ctrlKey) return false;
    if ((want.meta ?? false) !== e.metaKey) return false;
    if ((want.alt ?? false) !== e.altKey) return false;
    if ((want.shift ?? false) !== e.shiftKey) return false;
    return true;
}

// Binds a single keyboard shortcut at the window level. Intended for simple
// view-scoped accelerators (e.g. space to play/pause, escape to close). For
// complex key handling or focus-scoped bindings use direct addEventListener.
export function useKeyShortcut(handler: (e: KeyboardEvent) => void, options: KeyShortcutOptions) {
    const { key, code, modifiers, enabled = true, fireInInputs = false, preventDefault = true } = options;

    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== key && (!code || e.code !== code)) return;
            if (!modifiersMatch(e, modifiers)) return;
            if (!fireInInputs) {
                const target = e.target as HTMLElement | null;
                if (target) {
                    const tag = target.tagName;
                    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
                        return;
                    }
                }
            }
            if (preventDefault) e.preventDefault();
            handler(e);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [handler, key, code, modifiers, enabled, fireInInputs, preventDefault]);
}
