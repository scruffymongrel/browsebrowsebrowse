---
name: browsebrowsebrowse
description: Use when a task genuinely needs a real rendering engine — screenshots, PDFs, layout and computed styles, clicking/scrolling/typing, multi-step navigation flows, or streaming pages (SSE/htmx/long-poll) that only settle once JS has run. browsebrowsebrowse is a headless-Chrome CLI installed as `bbb` (and `browsebrowsebrowse`), driven from Bash with `--json`, no MCP server and no persistent connection. Cold by default (throwaway profile, nothing left running); `bbb serve` turns on a persistent session. Reach for this INSTEAD of Playwright or a browser MCP — but first check whether the `domdomdom` CLI will do, because for DOM queries, extraction and `window.*` smoke tests it is roughly 4x faster and needs no browser at all.
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
| Time         | ~200–300ms           | ~0.8–1.2s           | ~0.7s                  |
| Disk         | none                 | ~180MB engine       | ~180MB engine          |
| Memory       | in-process           | transient           | ~180MB RSS, resident   |

Measured on a trivial page, so treat them as floors. That is roughly a 4x latency difference cold, plus a 180MB download `domdomdom` never needs. Note the daemon buys less than you would expect on a simple page — most of the residual is process startup, not the browser — so start one for **session persistence**, not as a speed fix. "It's a webpage" is not a reason to reach for `bbb`. "I need to see what it looks like, or interact with it" is.

Route to **claude-in-chrome** when the answer depends on being *this user*: an authenticated dashboard, a page behind SSO, something already open in a tab. `bbb` cold is a clean room with no cookies; `bbb serve` builds up its own session, not the user's.

## Install (the plugin does NOT put `bbb` on PATH)

Installing this plugin ships the skill, not the binary — the plugin cache is a git clone with `dist/` gitignored, so there is nothing runnable in it. Install the CLI separately:

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

Check with `bbb doctor`. On first use `bbb` needs a Chrome engine (~180MB, one-time, shared across all projects): at a terminal it installs one after printing a notice; anywhere non-interactive it exits 3 and prints `bbb engine install stable`. It **never** downloads unprompted in CI.

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

Shared flags, identical to `domdomdom`: `--json` &middot; `--timeout <ms>` &middot; `--viewport WxH` &middot; `--user-agent <s>`.

JS goes in on **stdin**, never as an argument — same as `domdomdom`, and for the same reason (shell quoting is where agent-written commands break):

```sh
echo 'document.title' | bbb eval https://example.com --json
```

Single-line expressions auto-return. Multi-line code: write `return` yourself. `await` works at the top level.

## Output shape

Human by default; `--json` gives one line. Branch on `.ok`.

```json
{ "ok": true,  "result": <any>, "logs": [{"level":"log"|"warn"|"error"|"info"|"debug","message":"..."}] }
{ "ok": false, "error": { "kind": "eval"|"timeout"|"setup", "message": "...", "stack": "..." }, "logs": [] }
```

Exit codes: `0` ok &middot; `1` eval error &middot; `2` timeout &middot; `3` setup/usage. Use the exit code as a cheap pre-check before parsing.

Without `--json`: the result goes to stdout (strings verbatim, so `bbb html url > page.html` works), page `console.*` to stderr as `[log]`/`[warn]`/…, errors to stderr.

## The gotcha that will bite you: streaming pages

`bbb` waits for `networkidle2` by default, which is right for an ordinary page and **wrong for anything streaming**. An SSE connection, an open WebSocket or an htmx long-poll means the network never goes quiet, so the wait burns the whole `--timeout` on a page that rendered fine a second in.

**Use `--wait <selector>`** — it skips network-idle entirely, waits for `domcontentloaded`, then waits for the element you actually care about. Faster *and* a real assertion about what rendered:

```sh
bbb shot http://localhost:3000/stream out.png --wait '[data-done]'
echo 'document.querySelectorAll("li").length' | bbb eval http://localhost:3000/feed --wait 'li:nth-child(5)'
```

Without `--wait`, a network-idle timeout falls back to `domcontentloaded` plus a short settle rather than failing — so a screenshot still comes out, it just costs the full timeout first. Naming a selector is always better.

## Cold vs daemon

**cold = clean room. daemon = session.**

Cold is the default: throwaway profile, no cookies, no history, browser closed at the end, no process left behind. Reproducible, and safe in CI.

```sh
bbb serve     # persistent profile; every later command uses it automatically
bbb status
bbb stop      # back to cold
```

There is no flag to attach — if a daemon is running, commands use it. Start one when a login has to survive between commands, or when a heavy page would otherwise be launched from scratch each time. Stop it when you are done; it holds ~180MB.

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

- **Exit 2 on a page that clearly loads** — streaming. Add `--wait <selector>`.
- **Exit 3, "no Chrome engine installed"** — run the `bbb engine install` command it printed. Expected in CI; never automatic there.
- **Exit 3 mentioning `CHROME_PATH`** — it points at a directory or a missing file. It must be the executable itself.
- **`ok: true` but `result` is `undefined`** — multi-line code needs an explicit `return`.
- **Cookies/logins not persisting** — that's cold mode working as designed. `bbb serve` first.
- **Anything else** — `bbb doctor` reports engine, daemon, drift and what to run.
