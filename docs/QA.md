# Visual QA: fixture screenshots

`scripts/fixture-shots.mjs` (`corepack pnpm qa:shots`) takes a screenshot of every development fixture
(`?fixture=<id>&variant=<v>`) and compares two runs pixel by pixel. It is the before/after gate for UI
refactors (for example the per-game split of `Games.tsx`) and for restyling work.

It starts the renderer dev server (the `dev:web` vite config) on a free port, drives headless Playwright
chromium (no Electron), and always stops the server at the end, also on failure or Ctrl-C. Fixtures and their
variants are discovered from `apps/desktop/src/dev/*.ts` and `apps/desktop/src/main.tsx`, so a new fixture is
picked up automatically; only its hash route may need an entry in the `ROUTES` table at the top of the script
(`--list` prints the discovered fixtures and their routes). Viewport-only variants (`1280x800`, ...) are
skipped: the viewport matrix covers them.

## Workflow

Heavy command: on the shared 8 GB machine run it through the coordinator slot.

```sh
# 1. baseline, on the code before your change
corepack pnpm qa:shots --out .local/shots/before --full
# 2. after your change: capture again and compare
corepack pnpm qa:shots --out .local/shots/after --full --compare .local/shots/before
```

The exit code is 1 when any image differs by more than the threshold, an image is missing, or a fixture
fails to render (error boundary or navigation failure). The table lists each failing image with its pixel
count; red-marked diff images are written to `<out>/diff/`.

## Options

| Option                  | Meaning                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out <dir>`           | Output directory (default `.local/fixture-shots/latest`, wiped at start).                                                                                                                                                         |
| `--compare <dir>`       | Baseline directory from an earlier run.                                                                                                                                                                                           |
| `--only <regex>`        | Filter on `S42/full_table`, e.g. `--only '^S4[2-9]/'` for the game tables.                                                                                                                                                        |
| `--sizes <list>`        | Comma separated `WxH` list, default `1280x800` (`--viewports` is an alias). Add `900x700` for the narrow check.                                                                                                                   |
| `--timeout <s>`         | Per-capture limit, 3-15 s (default 15). A slow capture is reported as FAILED; known unrenderable variants (S50/penalty, S54/saved, S68 invite/invite_created/revoke: the fixtures throw by design) are SKIPPED with a reason.     |
| `--full`                | Also store `<name>-full.png`: the viewport grown to the page's scrollable height (max 2400 px). Use it for tables whose hand or action bar sits below the fold.                                                                   |
| `--theme light\|dark`   | Colour scheme (default `dark`). The app has no light theme yet; the value is applied as `prefers-color-scheme` and `?theme=`.                                                                                                     |
| `--locale tr\|en`       | Forces the interface language through the renderer's `?lang=` query (read by `apps/desktop/src/i18n.ts` `startupLocale`; localStorage is cleared per page, so nothing else interferes) and sets the browser locale. Default `tr`. |
| `--workers <n>`         | Parallel pages (default 2; keep it low on the 8 GB Mac).                                                                                                                                                                          |
| `--max-diff-pixels <n>` | Pixels allowed to differ per image (default 0).                                                                                                                                                                                   |
| `--pixel-tolerance <n>` | Per-channel difference (0-255) still counted as equal (default 0).                                                                                                                                                                |
| `--all`                 | Print every compared row, not only failures.                                                                                                                                                                                      |

## Determinism

Each image is rendered in a fresh browser context with animations disabled, reduced motion, a hidden
caret, fixed `Date.now()`, a seeded `Math.random()`, cleared storage, `Europe/Amsterdam` time zone, forced sRGB
and non-dev-server network requests blocked. Two runs on unchanged code must report 0 differing images; if
they do not, treat that as a bug in the fixture (or the script) before trusting a refactor diff. A fixture
that logs a page error is still captured; the errors are recorded in `<out>/manifest.json`.

## Troubleshooting: every fixture times out

If every capture (the S10 warm-up included) times out, `#root` stays empty and the renderer stops answering
right after the "development fixture" console line, check that Chromium is started with `--in-process-gpu`
(both `scripts/fixture-shots.mjs` and `scripts/capture-reference.mjs` pass it). On macOS, when the Playwright
browser lives on an external volume (here `~/Library/Caches/ms-playwright` links to the external SSD), the
separate GPU child process can hang in dyld `open()` of its own executable. Seen on 2026-10-26 with
chrome-headless-shell 1248 on macOS 27.0.1; a fresh copy on the same SSD also hangs, a copy on the internal
disk does not. Anything that needs the GPU process then blocks the renderer main thread in native code (so a
debugger pause never breaks): here the room join cue (`new Audio().play()` in `room-event-sounds.tsx`), and
also `canPlayType('audio/ogg; codecs=opus')` or `MediaSource.isTypeSupported(...)` on an empty page.
For other Playwright scripts, the alternative is `PLAYWRIGHT_BROWSERS_PATH=<dir on the internal disk>`.

## Limits

- Fixtures show states, not interactions: a screenshot cannot prove that a button works. Click paths stay
  in the e2e specs and manual acceptance on two real clients.
- Only the shell and fixture scenes that the dev fixtures provide are covered; screens without a fixture
  are not.
- `scripts/ui-games-qa.mjs` and `scripts/verify-native-games.mjs` drive an Electron fixture through
  selectors (`.game-catalog`, `.game-tile`, `.game-table`, `.your-hand`, `.okey-tile`, ...) that no longer
  exist in `Games.tsx`/`Kiraathane.tsx`. They are stale and are not a regression gate; use this script instead.
