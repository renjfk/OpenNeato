// Compares route paths registered in firmware/src/web_server.cpp against the
// paths declared in frontend/api/openapi.yaml. Fails the build if either side
// has paths the other doesn't, so a new route can't ship without spec updates
// (and a deleted route can't linger in the spec).
//
// Routes intentionally omitted from the spec must be listed in IGNORED_PATHS
// below.
//
// Usage: node frontend/scripts/check_api_paths.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const cppPath = path.join(repoRoot, "firmware", "src", "web_server.cpp");
const yamlPath = path.join(__dirname, "..", "api", "openapi.yaml");

// Routes registered in firmware but deliberately undocumented (e.g. diagnostic
// passthroughs that shouldn't be advertised as a stable API).
const IGNORED_PATHS = new Set(["/api/serial"]);

function extractFirmwarePaths() {
    const src = fs.readFileSync(cppPath, "utf8");
    const re = /(?:registerGetRoute|registerPostRoute|loggedRoute|loggedBodyRoute|server\.on)\s*\(\s*"(\/api\/[^"]+)"/g;
    const paths = new Set();
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: classic regex loop
    while ((m = re.exec(src))) {
        if (!IGNORED_PATHS.has(m[1])) paths.add(m[1]);
    }
    return paths;
}

function extractSpecPaths() {
    const src = fs.readFileSync(yamlPath, "utf8");
    const doc = YAML.parse(src);
    const paths = new Set();
    for (const p of Object.keys(doc.paths || {})) {
        // OpenAPI paths use {param} placeholders; firmware paths don't (the
        // handler resolves the trailing segment from request->url()). Compare
        // by the leading static prefix.
        const prefix = p.replace(/\/\{[^}]+\}.*/, "");
        paths.add(prefix);
    }
    return paths;
}

const firmwarePaths = extractFirmwarePaths();
const specPaths = extractSpecPaths();

const missingInSpec = [...firmwarePaths].filter((p) => !specPaths.has(p)).sort();
const missingInFirmware = [...specPaths].filter((p) => !firmwarePaths.has(p)).sort();

if (missingInSpec.length || missingInFirmware.length) {
    process.stderr.write("[check_api_paths] HTTP route surface drift detected:\n");
    if (missingInSpec.length) {
        process.stderr.write(`  registered in firmware but missing from openapi.yaml: ${missingInSpec.join(", ")}\n`);
    }
    if (missingInFirmware.length) {
        process.stderr.write(
            `  declared in openapi.yaml but not registered in firmware: ${missingInFirmware.join(", ")}\n`,
        );
    }
    process.exit(1);
}

process.stdout.write(`[check_api_paths] OK - ${firmwarePaths.size} routes in sync\n`);
