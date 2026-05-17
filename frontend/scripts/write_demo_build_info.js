import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mockVersionFromHash } from "../mock/shared-version.js";

function shortHash() {
    const envHash = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
    if (envHash) return envHash.slice(0, 7);

    try {
        return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
    } catch {
        return "dev";
    }
}

writeFileSync("mock/build-info.js", `export const DEMO_VERSION = "${mockVersionFromHash(shortHash())}";\n`);
