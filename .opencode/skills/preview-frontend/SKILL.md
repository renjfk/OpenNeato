---
name: preview-frontend
description: Use when asked to preview, screenshot, or visually verify OpenNeato frontend changes, mock UI states, map/history rendering, themes, or real robot sessions in the web UI.
---

# Preview the Frontend

Run the Preact frontend against the mock API, drive it with Playwright, and capture
screenshots. Use this for UI reviews, visual regressions, and "show me what it looks
like" requests.

## Setup

`node_modules` and the generated `types.generated.ts` are not shared between
worktrees, so bootstrap once per worktree:

```bash
cd frontend
[ -d node_modules ] || npm ci
[ -f src/types.generated.ts ] || npm run gen:types
```

Start the dev server in the background and confirm it is up:

```bash
cd frontend && npm run dev > /tmp/opencode-neato-dev.log 2>&1 &
sleep 5 && grep -E "ready|Local" /tmp/opencode-neato-dev.log
```

The UI is at `http://localhost:5173/`. Routes are hash-based, e.g.
`http://localhost:5173/#/history` and
`http://localhost:5173/#/history/<session-file>.jsonl`.

## Mock sessions

The mock server loads every `frontend/mock/mapdata-*.jsonl` at startup and serves
them through `/api/history`. Session order in the UI is by `session.time`, newest
first, so give a demo fixture a recent timestamp to put it on top.

- Restart the dev server after adding or editing fixtures; they are cached at
  startup.
- Keep `SCENARIO` in `frontend/mock/server.js` at `"ok"` before committing.
- Do not commit throwaway fixtures or mock-only changes. For previews, work in a
  temporary worktree (`tools.opencode.worktree_create`, then
  `tools.opencode.session_move`).

## Real sessions from a robot

The device serves session JSONL decompressed over HTTP, including `.jsonl.hs`
files:

```bash
curl -sS http://neato.local/api/history | jq -r '.[] | [.name, .session.time, .summary.snapshots, .summary.areaCovered] | @tsv' | sort -k2 -nr
curl -sS "http://neato.local/api/history/<name>" -o frontend/mock/mapdata-real-<n>.jsonl
```

If the UI needs a field the installed firmware does not record yet (for example
RSSI), inject synthetic values with `jq` along the real path and say clearly that
the extra field is synthesized. Keep the original header and summary lines.

## Screenshots

`scripts/preview-shot.mjs` installs Playwright into
`$TMPDIR/opencode-playwright` on first use (browser included) and never touches the
repository's dependencies. Point it at the running dev server:

```bash
node .opencode/skills/preview-frontend/scripts/preview-shot.mjs \
  "http://localhost:5173/#/history" /tmp/opencode/history-list.png

node .opencode/skills/preview-frontend/scripts/preview-shot.mjs \
  "http://localhost:5173/#/history/mapdata-real-01.jsonl" /tmp/opencode/signal.png \
  --eval "[...document.querySelectorAll('.history-layer-switch button')][1].click()"

node .opencode/skills/preview-frontend/scripts/preview-shot.mjs \
  "http://localhost:5173/#/history/mapdata-real-01.jsonl" /tmp/opencode/signal-mobile.png \
  --eval "document.querySelector('.history-layer-switch button:nth-of-type(2)').click()" \
  --mobile --dark
```

Options:

| Flag | Meaning |
| --- | --- |
| `--eval "<js>"` | Run JS in the page after load (clicks, state, scroll) |
| `--click "<selector>"` | Playwright click on one element |
| `--wait <ms>` | Settle time after load, default `5000` |
| `--mobile` | 390x900 viewport, DPR 2, touch |
| `--dark` / `--light` | Emulated color scheme, default light |
| `--full-page` | Capture the whole scrollable page |
| `--playwright-dir <dir>` | Override the temp Playwright install |

The script prints page errors and console errors; treat them as failures.

## Notes

- Playwright emulates **light** by default. Check both themes when adding colors
  or canvas layers; the previous manual Chrome workflow defaulted to dark and hid
  light-theme contrast problems.
- Map canvases have a loading/reveal animation (~2s). The default 5s wait lands on
  the settled map; lower it only if you intentionally want the animation.
- Canvas content is invisible to text-based page fetches. Use the screenshot script.
- Kill the dev server when done (`pkill -f vite`); the Playwright browser exits with
  the script.
- The temp Playwright install is roughly 250 MB and is reused across sessions.
