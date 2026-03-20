import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
    const isDev = command === "serve";
    const serverHost = "localhost";
    const serverPort = 5173;
    return {
        plugins: [preact(), ...(isDev ? [require("./mock/server.js").mockApiPlugin()] : [])],
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
