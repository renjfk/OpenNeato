import { render } from "preact";
import { App } from "./app";
import "./style.css";

declare const __DEMO_BUILD__: boolean;

if (__DEMO_BUILD__) {
    const scenario = new URLSearchParams(location.search).get("scenario");
    if (scenario) {
        // biome-ignore lint/suspicious/noDocumentCookie: The Cookie Store API is not universal, and this runs before API calls.
        document.cookie = `openneato_scenario=${encodeURIComponent(scenario)}; Path=/; SameSite=Lax`;
    }

    void import("./analytics").then(({ startAnalytics }) => startAnalytics());
}

const root = document.getElementById("app");
if (root) render(<App />, root);
