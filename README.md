# Life OS

A static GitHub Pages app for Lokesh's daily/weekly/monthly journal and planning
system. This repo holds only app code — no journal data lives here or ever will.

## How it works

- The app is plain HTML/CSS/JS (`index.html` + `js/`), no framework, no build step.
- It reads and writes journal/state JSON in the **private** `lokeshmathur-workspace/Claude`
  repo (under `life-os/`) directly from the browser, via the GitHub Contents API,
  authenticated with a fine-grained personal access token you enter once on first
  run (stored only in that browser's `localStorage`).
- This repo is public — GitHub Pages requires that (or a paid plan for a private
  one), and it's safe here because there is nothing private in it: no data, no
  API keys, no tokens. The privacy boundary is the *other* repo being private,
  gated behind your token.
- AI features (quote pick, evening draft) go through a small Cloudflare Worker
  that holds an Anthropic API key server-side — see `worker/README.md` to deploy
  it. Every AI feature has a manual fallback; the app works fully without it.

## Structure

```
index.html       app shell, design tokens (CSS), views mount into #main
js/
  app.js         Today view + settings + wiring
  week.js        Week view (review + plan + rollover)
  month.js       Month view (review + plan + rollover)
  store.js       save/load orchestration, debounced writes, doc cache
  github.js      GitHub Contents API client (sha-based conflict detection)
  derive.js      streaks / weekToDate / monthToDate — ported from scripts/recompute.py
  compact.js     JSON writer matching scripts/sync_from_app.py's formatting exactly
  migrate.js     read-side schema migration (old/new field names)
  ai.js          Cloudflare Worker client + prompt builders
  export.js      OneNote plain-text export, full JSON backup
  constants.js, quotes.js, dateutil.js
worker/          Cloudflare Worker AI proxy — see worker/README.md to deploy
```

## Setup

1. Open the deployed Pages URL.
2. Paste a GitHub fine-grained token scoped to **only** the `Claude` repo,
   `Contents: Read and write`. The app walks you through this on first run.
3. (Optional) Settings → AI features, once the Worker (see `worker/README.md`)
   is deployed.
4. (Optional) Settings → set a PIN — a convenience lock on this device, not the
   real security boundary (that's your token).

The source of truth for what this app is meant to do lives in the private
`Claude` repo, under `lifeos-rebuild/` (`REQUIREMENTS.md`, `DESIGN-SYSTEM.md`,
`DATA-MODEL.md`) and `life-os/docs/DATA_PROTOCOL.md`.
