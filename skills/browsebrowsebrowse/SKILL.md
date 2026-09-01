---
name: browsebrowsebrowse
description: Use when a task genuinely needs a real rendering engine — screenshots, PDFs, layout and computed styles, clicking/scrolling/typing, multi-step navigation flows, or streaming pages (SSE/htmx/long-poll) that only settle once JS has run. browsebrowsebrowse is a headless-Chrome CLI installed as `bbb` (and `browsebrowsebrowse`), driven from Bash with `--json`, no MCP server and no persistent connection. Cold by default (throwaway profile, nothing left running); `bbb serve` turns on a persistent session. Reach for this INSTEAD of Playwright or a browser MCP — but first check whether the `domdomdom` CLI will do, because for DOM queries, extraction and `window.*` smoke tests it is ~3.5x faster (measured 2026-09-01) and needs no browser at all.
user-invocable: true
---

# browsebrowsebrowse

Headless Chrome from the shell. Powered by `chrome-headless-shell` + puppeteer-core. Binary aliases: `bbb` (short) and `browsebrowsebrowse`.

## Before anything else: is a browser actually needed?

| The task                                                    | Tool                | Why                          |
| ----------------------------------------------------------- | ------------------- | ---------------------------- |
| Query a DOM, extract data, check `window.X` after a bundle   | **`domdomdom`**     | No engine, no process        |
| Screenshot, PDF, layout, `getComputedStyle`, paint           | **`bbb`**           | Needs real rendering         |
| Click, scroll, type, multi-step navigation                   | **`bbb`**           | Needs a real input pipeline  |
| Streaming page (SSE / htmx / long-poll) you must see settle  | **`bbb --wait`**    | Needs a real event loop      |
| The user's own logged-in browser, their cookies, their tabs  | **claude-in-chrome**| Only it has that session     |

**`domdomdom` is significantly cheaper and you should prefer it whenever both would work.** Its binary is `domdomdom`; `ddd` is a shorthand alias added in domdomdom 0.3.0. Write `domdomdom` in commands unless you have confirmed a 0.3.0-or-newer install — it works on every version.

|              | `domdomdom`          | `bbb` cold          | `bbb` daemonised       |
| ------------ | -------------------- | ------------------- | ---------------------- |
| Time         | ~0.25s               | ~0.87s              | ~0.74s                 |
| Disk         | none                 | ~190MB engine       | ~190MB engine          |
| Memory       | in-process           | transient           | ~140MB RSS idle, grows |

Measured 2026-09-01 on an Apple M2 (macOS 26.3.1, node 26.3.0, bun 1.4.0, browsebrowsebrowse 0.2.0, domdomdom 0.5.0, Chrome 152.0.7977.64), median of 5 on a trivial page — so treat every figure as a floor, and re-measure before quoting it. Measurements elsewhere in this file carry their own date; an older date means it has not been re-run since.

Two of these need reading carefully. The latency gap is **~3.5x** cold (0.87 / 0.25), on top of an engine `domdomdom` never downloads. And the daemon's memory is not a fixed number — it **grows with the pages you hold open**: ~140MB idle after `serve`, ~168MB after one simple page, ~187MB after three heavy ones.

Note the daemon buys less time than you would expect on a simple page — most of the residual is process startup, not the browser — so start one for **session persistence**, not as a speed fix. "It's a webpage" is not a reason to reach for `bbb`. "I need to see what it looks like, or interact with it" is.

Route to **claude-in-chrome** when the answer depends on being *this user*: an authenticated dashboard, a page behind SSO, something already open in a tab. `bbb` cold is a clean room with no cookies; `bbb serve` builds up its own session, not the user's.

## Install (the plugin does NOT put `bbb` on PATH)

Installing this plugin ships the skill, not the binary — the plugin cache holds this skill and the plugin manifest and nothing else, so there is nothing runnable in it. Install the CLI separately:

```sh
npm install -g browsebrowsebrowse    # or: bun add -g browsebrowsebrowse
```

If a global install isn't available, every command below works with a no-install prefix:

```sh
bunx browsebrowsebrowse shot https://example.com out.png
npx --yes browsebrowsebrowse shot https://example.com out.png
deno run -A npm:browsebrowsebrowse shot https://example.com out.png
```

### Which runtime you are on

The bin ships compiled ESM with a `#!/usr/bin/env -S node` shebang. All three runtimes work, but they get in differently:

| Runtime | Global install | No-install |
| ------- | -------------- | ---------- |
| Node ≥ 22.12 | `npm i -g browsebrowsebrowse`, then `bbb …` | `npx --yes browsebrowsebrowse …` |
| Bun | `bun add -g browsebrowsebrowse`, then `bbb …` — **needs Node also present**, because the OS resolves the shebang | `bunx browsebrowsebrowse …` (no Node needed) |
| Deno ≥ 2 | `deno install -g -A npm:browsebrowsebrowse` — Deno writes its own shim, the shebang is never read | `deno run -A npm:browsebrowsebrowse …` |

One gap worth knowing: on a **Bun-only machine with no Node on `PATH`**, a globally installed `bbb` cannot be run *directly* — use `bunx browsebrowsebrowse …` instead. Everything else in this skill is identical on all three.

`deno install -g` installs one command, named after the package. For the short alias: `deno install -g -A --name bbb npm:browsebrowsebrowse`.

Check with `bbb doctor`. On first use `bbb` needs a Chrome engine (~95MB to download, ~190MB on disk, one-time, shared across all projects — the notices quote both): at a terminal it installs one after printing a notice; anywhere non-interactive it exits 3 and prints `bbb engine install stable`. It **never** downloads unprompted in CI.

### Version drift (plugin vs CLI)

This ships as two independent installs: the plugin (this skill, via `/plugin`) and the CLI (the `bbb`/`browsebrowsebrowse` binary, via npm). They can drift.

- Skill mentions a flag/verb `bbb --help` doesn't have -> CLI is behind. Fix: `npm i -g browsebrowsebrowse@latest` (or `bun add -g`, or prefix any command with `bunx browsebrowsebrowse`/`npx --yes browsebrowsebrowse` to run latest with no install).
- `bbb --help`/`bbb doctor` shows something this skill never mentions -> plugin is behind. Fix: `/plugin update`.

Compare versions directly with `bbb --version` (or `bbb doctor`'s JSON `version` field) against the plugin's version — see README for the full explanation.

## Invocation

```sh
bbb shot  <url> [out.png]     # --full  --w N  --h N  --wait <selector>
bbb pdf   <url> [out.pdf]
bbb html  <url>               # serialised DOM after load
bbb text  <url>               # visible text
bbb eval  <url>               # JS on STDIN, like domdomdom
bbb run   <script.mjs> [args] # full puppeteer-core API
bbb doctor
```

Shared flags, identical to `domdomdom`: `--json` &middot; `--timeout <ms>` &middot; `--viewport WxH` &middot; `--user-agent <s>` &middot; `--fail` (non-2xx is an error, exit 4). `bbb`-only: `--wait <selector>` &middot; `--full` &middot; `--w`/`--h` &middot; `--engine-version` &middot; `--no-install`.

JS goes in on **stdin**, never as an argument — same as `domdomdom`, and for the same reason (shell quoting is where agent-written commands break):

```sh
echo 'document.title' | bbb eval https://example.com --json
```

Single-line expressions auto-return. Multi-line code: write `return` yourself. `await` works at the top level.

## Output shape

Human by default; `--json` gives one line. Branch on `.ok`.

```json
{ "ok": true,  "result": <any>, "logs": [{"level":"log"|"warn"|"error"|"info"|"debug","message":"..."}], "status": <number|null> }
{ "ok": false, "error": { "kind": "eval"|"timeout"|"setup"|"http", "message": "...", "stack": "..." }, "logs": [], "status": <number|null> }
```

Exit codes: `0` ok &middot; `1` eval error &middot; `2` timeout &middot; `3` setup/usage &middot; `4` HTTP error (`--fail` only).

Without `--json`: the result goes to stdout (strings verbatim, so `bbb html url > page.html` works), page `console.*` to stderr as `[log]`/`[warn]`/…, errors to stderr.

### HTTP status is NOT in the exit code

`status` is the main document's **final** status after redirects, and `null` when there wasn't one — a local file, a `data:` URL, `about:blank`, or a verb that never navigates. The key is always present.

**A 404 exits 0 with `ok: true`.** Deliberately: a not-found page is a page, and screenshotting or scraping it is legitimate. But it means *the exit code is not a fetch check* — a missing page hands you the site's "not found" HTML and nothing signals it.

```sh
# Read .status and decide for yourself.
echo 'document.title' | bbb eval https://example.com/maybe --json   # -> {"ok":true,...,"status":404}

# Or let --fail decide: non-2xx becomes ok:false, kind "http", exit 4.
bbb shot https://example.com/maybe out.png --fail --json
# -> {"ok":false,"error":{"kind":"http","status":404,"message":"HTTP 404 for ..."},"logs":[],"status":404}
```

`--fail` is opt-in and modelled on `curl --fail`. With it the status is checked *before* your JS runs and before any screenshot is taken — a non-2xx never gets that far. It has no effect on a local file or `about:blank`, where there is no status to fail on. Identical flag, field and codes in `domdomdom`.

## The gotcha that will bite you: streaming pages return early and look fine

`bbb` waits for `networkidle2` by default, which is right for an ordinary page and **wrong for anything streaming** — SSE, an open WebSocket, an htmx long-poll.

The failure is not slowness. It is **fast, `ok: true`, and silently wrong.**

At `domcontentloaded` the page's own script has not connected its `EventSource` yet, so the network is briefly quiet, `networkidle2` is satisfied *immediately*, and your JS runs before a single event has arrived. Measured 2026-08-26, 3/3, against a local SSE fixture pushing 5 items over 3 seconds, on bun 1.3.14 — before the current toolchain, and not re-run since:

| Command | Result | Time |
| --- | --- | --- |
| `… \| bbb eval …/sse --json` | `{"ok":true,"result":0}` | ~1.3s |
| `… \| bbb eval …/sse --json --wait '[data-done]'` | `{"ok":true,"result":5}` | ~3.8s |

Both say `ok: true`. Both exit 0. The first is an empty answer wearing a success. Nothing in the output distinguishes "the page has no items" from "the page has not been given time to have any" — so **you will not notice, and there is no error to notice.**

**Use `--wait <selector>`** on anything that streams. It skips network-idle entirely, waits for `domcontentloaded`, then waits for the element you actually care about — a real assertion about what rendered:

```sh
bbb shot http://localhost:3000/stream out.png --wait '[data-done]'
echo 'document.querySelectorAll("li").length' | bbb eval http://localhost:3000/feed --wait 'li:nth-child(5)'
```

The rule of thumb: **if the interesting content arrives after the first paint, name it with `--wait`.** A zero, an empty array or a bare skeleton back from a page you know has content is this, every time.

(A page that holds *many* connections open — chatty long-polling — is the other shape: there `networkidle2` genuinely never fires, and `bbb` falls back to `domcontentloaded` plus a short settle rather than failing. That one costs the timeout, but still returns. `--wait` fixes both.)

## Cold vs daemon

**cold = clean room. daemon = session.**

Cold is the default: throwaway profile, no cookies, no history, browser closed at the end, no process left behind. Reproducible, and safe in CI.

```sh
bbb serve     # persistent profile; every later command uses it automatically
bbb status
bbb stop      # back to cold
```

There is no flag to attach — if a daemon is running, commands use it. Start one when a login has to survive between commands, or when a heavy page would otherwise be launched from scratch each time. Stop it when you are done; it holds ~140MB idle and climbs towards ~190MB as pages accumulate (see the cost table above).

## Patterns

**See what a local dev server renders**
```sh
bbb shot http://localhost:3000 /tmp/app.png --full --wait '#root > *'
```
Then read `/tmp/app.png` with the Read tool.

**Layout facts `domdomdom` cannot give you**
```sh
echo 'const el = document.querySelector(".card");
const r = el.getBoundingClientRect();
return { w: r.width, h: r.height, display: getComputedStyle(el).display }' \
  | bbb eval http://localhost:3000 --json
```

**Interaction, via the escape hatch**
```js
// flow.mjs
export default async ({ page, goto }) => {
  await goto('http://localhost:3000')
  await page.click('#open')
  await page.type('#q', 'hello')
  await page.waitForSelector('.results li')
  return page.$$eval('.results li', els => els.map(e => e.textContent))
}
```
```sh
bbb run flow.mjs --json
```
Contract: `export default async ({ browser, page, args, goto, puppeteer }) => value`. A returned value prints as JSON. `args` is everything after the script path — bbb's own flags must come *before* it. Prefer `.mjs`; a `.ts` script needs Node ≥22.18, Bun, or Deno.

`goto(url)` resolves to `{ strategy, status }` — `strategy` is how it settled (`wait-selector` / `networkidle2` / `domcontentloaded`), `status` the final HTTP status or `null`. The last navigation's status is what the command reports, and `--fail` applies to each one.

## Engine management

```sh
bbb engine status     # installed version, and whether upstream has moved
bbb engine install    # stable, or `bbb engine install 152.0.7977.64`
bbb engine update     # explicit; nothing ever auto-updates
bbb engine list
bbb engine prune      # drop every engine but the current one
bbb engine path
```

Engines live in `~/.cache/browsebrowsebrowse/engines/<version>/` — outside `node_modules`, so they survive reinstalls and one copy is shared by every project. `doctor` and `engine status` *report* drift and print the command; they never fetch a binary on their own. Run `bbb engine prune` if `doctor` says several are installed.

`CHROME_PATH` overrides the engine entirely (point it at an existing Chrome to skip the download). It must be the executable **file**, not the directory containing it.

## Don't reach for this when

| Need                                                    | Use instead        |
| ------------------------------------------------------- | ------------------ |
| DOM query, data extraction, `window.*` export check      | `domdomdom`        |
| Parse HTML without executing scripts                     | `linkedom`         |
| The user's real logged-in browser session                | claude-in-chrome   |
| Cross-browser (Firefox/WebKit) checks                    | Playwright         |

## When things go wrong

- **An empty or short result from a page you know has content** — streaming, returning before the stream opened. Add `--wait <selector>`. There is no error; the count is just wrong.
- **Exit 2 on a page that clearly loads** — the other streaming shape (many connections held open). Also `--wait <selector>`.
- **A plausible result from a page you expected to exist** — check `status`. A 404 returns the site's not-found HTML with `ok: true` and exit 0. Re-run with `--fail`.
- **Exit 4** — `--fail` was passed and the page was non-2xx. Nothing ran; nothing was captured.
- **Exit 3, "no Chrome engine installed"** — run the `bbb engine install` command it printed. Expected in CI; never automatic there.
- **Exit 3 mentioning `CHROME_PATH`** — it points at a directory or a missing file. It must be the executable itself.
- **`ok: true` but `result` is `undefined`** — multi-line code needs an explicit `return`.
- **Cookies/logins not persisting** — that's cold mode working as designed. `bbb serve` first.
- **Anything else** — `bbb doctor` reports engine, daemon, drift and what to run.
