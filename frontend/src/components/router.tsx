import type { ComponentChildren, VNode } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { useRoute } from "../hooks/use-route";

interface RouterContext {
    path: string;
    navigate: (to: string) => void;
    goBack: (fallback: string) => void;
}

const Ctx = createContext<RouterContext>({ path: "/", navigate: () => {}, goBack: () => {} });

export function useNavigate(): (to: string) => void {
    return useContext(Ctx).navigate;
}

export function useGoBack(): (fallback: string) => void {
    return useContext(Ctx).goBack;
}

export function usePath(): string {
    return useContext(Ctx).path;
}

interface RouterProps {
    children: ComponentChildren;
}

export function Router({ children }: RouterProps) {
    const [path, navigate, goBack] = useRoute();
    return <Ctx.Provider value={{ path, navigate, goBack }}>{children}</Ctx.Provider>;
}

interface RouteProps {
    path: string;
    prefix?: boolean;
    children: ComponentChildren;
}

export function Route({ path, prefix, children }: RouteProps) {
    const current = usePath();
    if (prefix) {
        if (current !== path && !current.startsWith(`${path}/`)) return null;
    } else {
        if (current !== path) return null;
    }
    return children as VNode;
}
