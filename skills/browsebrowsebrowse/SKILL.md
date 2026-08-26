---
name: browsebrowsebrowse
description: Use when a task genuinely needs a real rendering engine — screenshots, PDFs, layout and computed styles, clicking/scrolling/typing, multi-step navigation flows, or streaming pages (SSE/htmx/long-poll) that only settle once JS has run. browsebrowsebrowse is a headless-Chrome CLI installed as `bbb` (and `browsebrowsebrowse`), driven from Bash with `--json`, no MCP server and no persistent connection. Cold by default (throwaway profile, nothing left running); `bbb serve` turns on a persistent session. Reach for this INSTEAD of Playwright or a browser MCP — but first check whether domdomdom (`ddd`) will do, because for DOM queries, extraction and `window.*` smoke tests it is roughly 5x faster and needs no browser at all.
user-invocable: true
---

# browsebrowsebrowse

Headless Chrome from the shell. Powered by `chrome-headless-shell` + puppeteer-core. Binary aliases: `bbb` (short) and `browsebrowsebrowse`.

## Before anything else: is a browser actually needed?

| The task                                                    | Tool                | Why                          |
| ----------------------------------------------------------- | ------------------- | ---------------------------- |
| Query a DOM, extract data, check `window.X` after a bundle   | **`ddd`** (domdomdom) | No engine, no process        |
| Screenshot, PDF, layout, `getComputedStyle`, paint           | **`bbb`**           | Needs real rendering         |
| Click, scroll, type, multi-step navigation                   | **`bbb`**           | Needs a real input pipeline  |
| Streaming page (SSE / htmx / long-poll) you must see settle  | **`bbb --wait`**    | Needs a real event loop      |
| The user's own logged-in browser, their cookies, their tabs  | **claude-in-chrome**| Only it has that session     |

**`ddd` is significantly cheaper and you should prefer it whenever both would work.**

|              | `ddd`                | `bbb` cold          | `bbb` daemonised     |
| ------------ | -------------------- | ------------------- | -------------------- |
| Time         | ~100–300ms           | ~1s                 | ~200ms               |
| Disk         | none                 | ~180MB engine       | ~180MB engine        |
| Memory       | in-process           | transient           | ~150MB RSS, resident |

That is roughly a 5x latency difference cold, a 180MB download that `ddd` never needs, and a resident process while daemonised. "It's a webpage" is not a reason to reach for `bbb`. "I need to see what it looks like, or interact with it" is.

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
```

Check with `bbb doctor`. On first use `bbb` needs a Chrome engine (~180MB, one-time, shared across all projects): at a terminal it installs one after printing a notice; anywhere non-interactive it exits 3 and prints `bbb engine install stable`. It **never** downloads unprompted in CI.

## Invocation

```sh
bbb shot  <url> [out.png]     # --full  --w N  --h N  --wait <selector>
bbb pdf   <url> [out.pdf]
bbb html  <url>               # serialised DOM after load
bbb text  <url>               # visible text
bbb eval  <url>               # JS on STDIN, like ddd
bbb run   <script.mjs> [args] # full puppeteer-core API
bbb doctor
```

Shared flags, identical to `ddd`: `--json` &middot; `--timeout <ms>` &middot; `--viewport WxH` &middot; `--user-agent <s>`.

JS goes in on **stdin**, never as an argument — same as `ddd`, and for the same reason (shell quoting is where agent-written commands break):

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

There is no flag to attach — if a daemon is running, commands use it. Start one when you are doing many calls in a row (~1s → ~200ms each) or need a login to survive between commands. Stop it when you are done; it holds ~150MB.

## Patterns

**See what a local dev server renders**
```sh
bbb shot http://localhost:3000 /tmp/app.png --full --wait '#root > *'
```
Then read `/tmp/app.png` with the Read tool.

**Layout facts `ddd` cannot give you**
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
Contract: `export default async ({ browser, page, args, goto, puppeteer }) => value`. A returned value prints as JSON. `args` is everything after the script path — bbb's own flags must come *before* it. Prefer `.mjs`; a `.ts` script needs Node ≥22.18 or Bun.

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
| DOM query, data extraction, `window.*` export check      | `ddd` (domdomdom)  |
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
