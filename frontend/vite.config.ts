import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
    plugins: [preact(), ...(command === "serve" ? [require("./mock/server.js").mockApiPlugin()] : [])],
    server: {
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
}));
