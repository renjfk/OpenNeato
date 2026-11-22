#!/usr/bin/env node
// Screenshot a running OpenNeato dev server with Playwright.
//
// Installs Playwright and its Chromium into a temp directory on first use so the
// repository never grows a Playwright dev dependency. See SKILL.md for usage.
//
//   node preview-shot.mjs <url> <out.png> [options]
//
// Options: --eval <js>, --click <selector>, --wait <ms>, --mobile,
//          --dark | --light, --full-page, --playwright-dir <dir>

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function usage(message) {
    if (message) console.error(message);
    console.error(
        "usage: node preview-shot.mjs <url> <out.png> [--eval <js>] [--click <selector>] " +
            "[--wait <ms>] [--mobile] [--dark|--light] [--full-page] [--playwright-dir <dir>]",
    );
    process.exit(1);
}

function parseArgs(argv) {
    const opts = { wait: 5000, mobile: false, dark: false, fullPage: false };
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--eval":
                opts.eval = argv[++i];
                break;
            case "--click":
                opts.click = argv[++i];
                break;
            case "--wait":
                opts.wait = Number(argv[++i]);
                break;
            case "--mobile":
                opts.mobile = true;
                break;
            case "--dark":
                opts.dark = true;
                break;
            case "--light":
                opts.dark = false;
                break;
            case "--full-page":
                opts.fullPage = true;
                break;
            case "--playwright-dir":
                opts.playwrightDir = argv[++i];
                break;
            default:
                if (arg.startsWith("--")) usage(`unknown option: ${arg}`);
                positional.push(arg);
        }
    }
    opts.url = positional[0];
    opts.out = positional[1];
    if (!opts.url || !opts.out) usage("url and output path are required");
    if (!Number.isFinite(opts.wait) || opts.wait < 0) usage("--wait must be a non-negative number");
    return opts;
}

function loadPlaywright(dir) {
    const requireFromDir = createRequire(path.join(dir, "index.js"));
    return requireFromDir("playwright");
}

function ensurePlaywright(dir) {
    if (!dir) dir = path.join(os.tmpdir(), "opencode-playwright");
    const marker = path.join(dir, "node_modules", "playwright", "package.json");
    if (existsSync(marker)) return loadPlaywright(dir);

    console.error(`[preview-shot] installing Playwright into ${dir}`);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(path.join(dir, "package.json"))) {
        writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: "opencode-playwright", private: true, type: "commonjs" }, null, 2) + "\n",
        );
    }
    execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", "playwright"], {
        cwd: dir,
        stdio: "inherit",
    });
    execFileSync("npx", ["playwright", "install", "chromium"], { cwd: dir, stdio: "inherit" });
    return loadPlaywright(dir);
}

const opts = parseArgs(process.argv.slice(2));
const { chromium } = ensurePlaywright(opts.playwrightDir);

const browser = await chromium.launch();
const context = await browser.newContext({
    ...(opts.mobile
        ? { viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 }),
    colorScheme: opts.dark ? "dark" : "light",
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
});

await page.goto(opts.url, { waitUntil: "networkidle" });
await page.waitForTimeout(opts.wait);

if (opts.click) {
    await page.click(opts.click);
    await page.waitForTimeout(1200);
}
if (opts.eval) {
    await page.evaluate(opts.eval);
    await page.waitForTimeout(1200);
}

mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
await page.screenshot({ path: opts.out, fullPage: opts.fullPage });
await browser.close();

console.log(`saved ${opts.out}`);
if (errors.length > 0) {
    console.error(`page errors:\n${errors.join("\n")}`);
    process.exitCode = 1;
}
