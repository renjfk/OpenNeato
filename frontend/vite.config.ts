import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig(async ({ command }) => {
    const isDev = command === "serve";
    const serverHost = "0.0.0.0";
    const serverPort = 5173;
    const mockApiPlugin = isDev ? (await import("./mock/server.js")).mockApiPlugin : null;
    return {
        plugins: [preact(), ...(mockApiPlugin ? [mockApiPlugin()] : [])],
        define: isDev ? { __GITHUB_API_BASE__: JSON.stringify(`http://${serverHost}:${serverPort}`) } : {},
        server: {
            host: serverHost,
            port: serverPort,
            open: false,
        },
        build: {
            outDir: "dist",
            assetsInlineLimit: 0,
            rollupOptions: {
                output: {
                    entryFileNames: "app.js",
                    assetFileNames: "[name][extname]",
                },
            },
        },
    };
});
