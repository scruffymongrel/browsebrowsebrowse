# browsebrowsebrowse

Headless Chrome from the command line, built for coding agents to drive. Screenshots, PDFs, rendered HTML, page JS — and a real puppeteer escape hatch when the verbs run out. Browse, browse, browse!

```sh
bbb shot https://example.com out.png --full
echo 'getComputedStyle(document.querySelector(".card")).display' | bbb eval http://localhost:3000 --json
```

Powered by [`chrome-headless-shell`](https://developer.chrome.com/blog/chrome-headless-shell) and [puppeteer-core](https://pptr.dev). No MCP server, no persistent connection, no framework — a CLI with `--json` output and honest exit codes, driven from a plain shell.

It is the sibling of [domdomdom](https://github.com/scruffymongrel/domdomdom), which does DOM work with **no browser at all**. Read the next section before installing this one.

## Which of the two do you want?

`domdomdom` is roughly 4x faster, needs no 180MB engine and leaves no process running. **When both would work, use `domdomdom`.**

|                                                        | `domdomdom`         | `bbb` (this)                    |
| ------------------------------------------------------ | ------------------- | ------------------------------- |
| DOM queries, extraction, `window.*` smoke tests         | ✅ ~200–300ms       | works, but wasteful             |
| Screenshots, PDF, layout, `getComputedStyle`            | ❌ no rendering     | ✅                              |
| Click, scroll, type, navigation flows                   | ❌                  | ✅                              |
| Streaming pages you need to *see* settle                | ❌                  | ✅ (`--wait`)                   |
| Cost                                                    | none                | ~180MB engine, ~0.8–1.2s cold / ~0.7s daemonised, ~180MB RSS while daemonised |

For anything that needs the user's own logged-in browser session — their cookies, their tabs — neither tool is right; use a browser extension such as claude-in-chrome.

## Install

```sh
npm install -g browsebrowsebrowse    # or: bun add -g browsebrowsebrowse
```

Both `browsebrowsebrowse` and `bbb` are installed. Or run it with no install:

```sh
bunx browsebrowsebrowse shot https://example.com out.png
npx --yes browsebrowsebrowse shot https://example.com out.png
deno run -A npm:browsebrowsebrowse shot https://example.com out.png
```

### Runtimes

`bbb` ships compiled ESM, which three runtimes execute. Each has its own way in, and all three are gated by `bun run smoke:pack` in CI.

| Runtime | Install | Run |
| ------- | ------- | --- |
| **Node ≥ 22.12** | `npm i -g browsebrowsebrowse` | `bbb …` — the shipped bin's shebang is `#!/usr/bin/env -S node`, so this is the shebang path |
| **Bun** | `bun add -g browsebrowsebrowse` | `bunx browsebrowsebrowse …` — Bun's loader runs the file directly and never reads the shebang |
| **Deno ≥ 2** | `deno install -g -A npm:browsebrowsebrowse` | `deno run -A npm:browsebrowsebrowse …` |

`engines` claims **`node >=22.12.0` and nothing else** — puppeteer-core's own floor, asserted against its `package.json` by a test. That is deliberate and it is the honest claim: the shebang is the only thing the package controls, and it can only guarantee Node.

One real gap follows from that. On a **Bun-only machine with no Node on `PATH`**, `bun add -g browsebrowsebrowse` puts `bbb` on `PATH` but running it *directly* fails — the OS resolves the shebang's interpreter before Bun gets a say. Use `bunx browsebrowsebrowse …` there; it bypasses the shebang entirely and is covered by CI.

Deno needs neither Node nor the shebang: `deno install -g` writes its own `#!/bin/sh` shim that execs `deno run -A npm:browsebrowsebrowse`, so the package's shebang is never consulted. It installs one command per invocation, named after the package; for the short alias use `deno install -g -A --name bbb npm:browsebrowsebrowse` (both bins are the same file). Deno's node-compat carries the whole stack — spawning Chrome through `node:child_process`, the CDP websocket, and the daemon's `node:net` port probes — verified end to end against a real engine, not just asserted.

### The engine

`bbb` needs a Chrome engine (`chrome-headless-shell`, ~180MB). It installs one on first use **at an interactive terminal**, after printing what it is about to fetch. Anywhere non-interactive — CI, a pipe, a script — it exits `3` and prints the command instead:

```
SETUP ERROR: no Chrome engine installed.
Refusing to download ~180MB unprompted in a non-interactive session.
Run:  bbb engine install stable
```

A surprise 180MB download in somebody's pipeline is a bug, not a convenience.

Engines live in `~/.cache/browsebrowsebrowse/engines/<version>/` — **outside `node_modules`**, so they survive reinstalls and one copy is shared by every project, global or local. This is the whole point of the `engine` verb: four tools each downloading their own Chrome is how a laptop loses a gigabyte.

```sh
bbb engine status            # what's installed, and whether upstream has moved
bbb engine install [stable|<version>]
bbb engine update            # explicit, always
bbb engine list
bbb engine prune             # drop every engine but the current one
bbb engine path
```

**Nothing ever auto-updates.** `doctor` and `engine status` fetch a few hundred bytes of version metadata from the [Chrome-for-Testing feed](https://googlechromelabs.github.io/chrome-for-testing/), tell you if your engine has drifted, and print the command. They never fetch a binary.

Pin with `--engine-version 152.0.7977.64` or `BBB_ENGINE_VERSION`. Skip the cache entirely by pointing `CHROME_PATH` at an existing Chrome — it must be the executable **file**, not the directory containing it.

## Cold vs daemon

**cold = clean room. daemon = session.**

Cold is the default and needs no flag: a throwaway profile, no cookies, no history, browser closed when the command ends, no process left behind. Reproducible, and safe to put in CI.

```sh
bbb serve      # persistent profile on a CDP port
bbb status
bbb stop       # back to cold
```

While a daemon is running, **every command uses it automatically**. There is no attach flag and no config file, because the failure mode of forgetting one — "why is it asking me to log in again?" — is exactly what the daemon exists to prevent.

Start one when a login has to survive between commands, or when a heavy page would otherwise be launched from scratch each time. On a trivial page the daemon saves less than you might expect — most of the residual is process startup, not the browser. Stop it when you are done; it holds ~180MB.

## CLI

```
bbb shot  <url> [out.png]      screenshot        --full --w N --h N --wait <sel>
bbb pdf   <url> [out.pdf]      print to PDF
bbb html  <url>                serialised DOM after load
bbb text  <url>                visible text
bbb eval  <url>                run JS in the page (JS on stdin)
bbb run   <script.mjs> [args]  full puppeteer-core API

bbb serve | stop | status
bbb engine status | install | update | list | prune | path
bbb doctor
```

A URL argument can be a full URL, a bare host (`example.com` → https, `localhost:3000` → http) or a local file path (`./dist/index.html`).

### Flags

| Flag                     | Effect                                                    |
| ------------------------ | --------------------------------------------------------- |
| `--json`                 | one line of `{ ok, result, logs }` on stdout               |
| `--timeout <ms>`         | navigation/selector budget (default `30000`)               |
| `--viewport <WxH>`       | page viewport (default `1440x900`)                         |
| `--w <n>` / `--h <n>`    | viewport width/height; beat `--viewport`                   |
| `--full`                 | full-page screenshot (`shot`)                              |
| `--wait <selector>`      | wait for a selector instead of network idle                |
| `--user-agent <ua>`      | override `navigator.userAgent`                             |
| `--engine-version <ver>` | use a specific Chrome build for this run                   |
| `--no-install`           | never download an engine; fail with the command instead    |
| `-h, --help`             | help                                                       |

### Output contract

Human by default: result on stdout (strings verbatim, so `bbb html url > page.html` produces HTML), page `console.*` on stderr as `[log]`/`[warn]`/…, errors on stderr.

`--json`: exactly one line, nothing else.

```json
{ "ok": true,  "result": <any>, "logs": [{ "level": "log"|"warn"|"error"|"info"|"debug", "message": "..." }] }
{ "ok": false, "error": { "kind": "eval"|"timeout"|"setup", "message": "...", "stack": "..." }, "logs": [] }
```

**Exit codes:** `0` ok · `1` eval error · `2` timeout · `3` setup/usage error.

All of this is deliberately identical to domdomdom, down to JS arriving on **stdin** rather than as an argument. Two tools that feel like one tool means an agent that learns either can drive both.

### `eval`

```sh
echo 'document.title' | bbb eval https://example.com --json

bbb eval http://localhost:3000 --json <<'JS'
const el = document.querySelector('.card')
const r = el.getBoundingClientRect()
return { w: r.width, h: r.height, display: getComputedStyle(el).display }
JS
```

A single expression auto-returns. Multi-line code needs an explicit `return`. Top-level `await` works either way.

### `run`

```js
// flow.mjs
export default async ({ browser, page, args, goto, puppeteer }) => {
  await goto(args[0])
  await page.click('#open')
  await page.type('#q', 'hello')
  await page.waitForSelector('.results li')
  return page.$$eval('.results li', els => els.map(e => e.textContent))
}
```

```sh
bbb --json run flow.mjs http://localhost:3000 --depth 3
```

A returned value prints as JSON. `args` is everything after the script path — **bbb's own flags must come before it**, since anything after belongs to the script. Prefer `.mjs`; a `.ts` script needs a runtime that handles types (Node ≥22.18, Bun, or Deno).

## Streaming pages: the one gotcha

`bbb` navigates once with `domcontentloaded` and then waits for the network to go idle (at most two open connections, quiet for 500ms). That is right for an ordinary page and **wrong for anything streaming** — an SSE connection, an open WebSocket or an htmx long-poll means the network never quiets down, so the wait burns the whole `--timeout` on a page that rendered fine a second in.

Name a selector instead. It skips the idle wait entirely, and is a real assertion about what rendered:

```sh
bbb shot http://localhost:3000/feed out.png --wait '[data-done]'
```

Without `--wait`, an idle timeout falls back to a short settle rather than failing, so you still get a screenshot — it just costs the full timeout first.

## Two things that will bite you if you fork this

- **Chrome must never be launched through a file symlink.** It resolves `icudtl.dat` and its other resources relative to its own executable path; through a symlink it looks in the link's directory and dies with `icudtl.dat not found in bundle`. The resolver `realpath`s every path it returns so no caller can forget.
- **A `CHROME_PATH` pointing at a directory must be rejected, not spawned.** Spawning a directory fails as `EACCES`, which reads like a permissions problem and sends you looking somewhere else entirely.

Both are encoded as tests, not as comments.

## Environment

| Variable             | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `CHROME_PATH`        | use this executable instead of the cache (never required)   |
| `BBB_CACHE_DIR`      | move the whole cache (engines, profile, manifests)          |
| `BBB_PORT`           | CDP port for the daemon (default `9333`)                    |
| `BBB_ENGINE_VERSION` | pin an engine version                                       |
| `BBB_NO_INSTALL`     | never auto-install, same as `--no-install`                  |
| `BBB_CHROME_ARGS`    | extra Chrome flags, space-separated                         |

## Library

```ts
import { withSession, goto, loadConfig } from 'browsebrowsebrowse'

const cfg = loadConfig()
const { value } = await withSession(cfg, { viewport: { width: 1440, height: 900 }, timeout: 30000 },
  async ({ page }) => {
    await goto(page, 'https://example.com', { timeout: 30000 })
    return page.title()
  })
```

Thin on purpose — the CLI is the product. For anything richer, `bbb run` hands you the real puppeteer objects.

## Agent integration

`browsebrowsebrowse` was built for LLM agents to drive: `--json` plus stdin/stdout-only contracts mean it works behind a plain Bash tool with no MCP server, no persistent connection and no context overhead. The repo ships an [Agent Skill](https://agentskills.io/) at `skills/browsebrowsebrowse/SKILL.md` that teaches an agent **when a real browser is warranted** — most of that skill is about routing away to `domdomdom`.

### Claude Code

```text
/plugin marketplace add scruffymongrel/claude-plugins
/plugin install browsebrowsebrowse@scruffymongrel
```

Restart Claude Code. **The plugin does not put `bbb` on `PATH`** — it ships the skill, not the binary — so install the CLI separately with `npm i -g browsebrowsebrowse`. The skill says so too.

### Keeping the plugin and CLI in sync

browsebrowsebrowse installs as two separate artifacts from one repo at one version: this plugin, which ships the skill only (from the `scruffymongrel` marketplace, pinned to the `release` branch — see AGENTS.md for the channel-split invariant), and the npm package, which ships the `bbb`/`browsebrowsebrowse` binaries. They install and upgrade independently, so they can drift.

**Upgrade both, as a pair:**

- **Plugin** — `/plugin update` in Claude Code (opens the plugin manager; pick `browsebrowsebrowse@scruffymongrel` from the Installed tab), or `claude plugin update browsebrowsebrowse@scruffymongrel` from the shell. Run `/reload-plugins` (or restart) to pick it up in the current session.
- **CLI** — `npm i -g browsebrowsebrowse@latest` / `bun add -g browsebrowsebrowse@latest` / `deno install -g -A npm:browsebrowsebrowse@latest`, reinstalling over the existing global link.

**Which one is stale?** `bbb --version` (or `bbb doctor`'s JSON `version` field) reports the installed CLI's version directly; compare it against the plugin's version, visible from `/plugin`'s Installed tab. The same behavioral check catches it too: if this skill describes a flag or verb `bbb --help` doesn't list, the CLI is behind — upgrade it from npm. If `bbb --help`/`bbb doctor` shows something this doc never mentions, the plugin is behind — update it through `/plugin`.

**One direction only.** The release workflow advances the `release` branch — the plugin channel — only *after* `npm publish` succeeds (see "Releasing" below and AGENTS.md). So npm is never behind the plugin; only the reverse can happen, and only because a user hasn't updated the plugin on their machine yet.

**Quick fix:** `bunx browsebrowsebrowse`, `npx --yes browsebrowsebrowse`, and `deno run -A npm:browsebrowsebrowse` always fetch latest by default, sidestepping CLI staleness entirely — reach for one of these when you're not sure which side has drifted.

### Other agents (Cursor, Aider, Codex CLI, Copilot, …)

The skill follows the [Agent Skills open standard](https://agentskills.io/specification) — `SKILL.md` with YAML frontmatter. After installing, it lives at `$(npm root -g)/browsebrowsebrowse/skills/browsebrowsebrowse/`:

```sh
cp -r "$(npm root -g)/browsebrowsebrowse/skills/browsebrowsebrowse" <your-agent>/skills/
```

For agents without skill support, paste this into your system prompt:

> For screenshots, PDFs, layout/computed styles, clicking and typing, or streaming pages, use `bbb` (browsebrowsebrowse): `bbb shot <url> out.png`, `bbb pdf`, `bbb html`, `bbb text`, and `echo '<js>' | bbb eval <url> --json`. Add `--json` and parse one line of `{ok, result, logs}`; exit codes are 0 ok / 1 eval / 2 timeout / 3 setup. On a streaming page (SSE, htmx, long-poll) always pass `--wait <selector>`. For DOM queries and extraction that need no rendering, use `domdomdom` instead — it is much cheaper.

## Development

```sh
bun install
bun run quality           # tsc --noEmit + the coverage-gated unit tests
bun run test:integration  # the browser-touching suite (needs an engine)
bun run build             # compile dist/ (also runs via prepack)
bun run smoke:node        # run the CLI from the checkout under Node
bun run smoke:pack        # pack, install the tarball, run it under Node, Bun AND Deno
```

`smoke:pack` is the one that matters for packaging: it packs the tarball, installs it into a scratch project, and runs the *installed* binary under all three runtimes — plus both bin aliases through the `node_modules/.bin` shebang path, with only Node on `PATH`. Testing the checkout alone is what let a broken Node install ship three times in the sibling project. Node and Deno skip with a notice when they aren't installed locally, and hard-fail instead when `CI` is set so a missing runtime can't pass silently.

Coverage is enforced at **100% lines and functions**, but deliberately only over `src/pure/` — the argument parser, the engine resolver, URL normalisation, version comparison and output shaping. The browser-touching code is covered by `test/integration/`, which drives a real Chrome and is outside the gate. Chasing 100% across a process-spawning, CDP-speaking codebase would mean testing mocks of Chrome instead of Chrome, and a green number built out of mocks is worse than an honest gap.

To run the integration suite without downloading anything, point it at a Chrome you already have:

```sh
CHROME_PATH=/path/to/chrome-headless-shell bun run test:integration
```

## Releasing

Fully automated; no manual steps and no npm token.

```sh
gh workflow run release.yml -f bump=patch|minor|major
```

CI runs the quality gate, the Node smoke test, the packed-tarball smoke test and the integration suite, then bumps the version, commits, tags, pushes and publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) with provenance. It refuses to run anywhere but `main`. `release.yml` and `test.yml` gate on the same checks on purpose — they drifted once and a release broke on a step PR CI had never run.

The same run fast-forwards the `release` branch, which is the Claude Code plugin channel.

Don't bump `version` in `package.json` by hand — CI owns it, and a manual bump double-bumps. Don't rename `.github/workflows/release.yml` either; npm's trusted publisher is keyed to the repo *and* the workflow filename. See `AGENTS.md` for the full set of release invariants.

## License

[MIT](LICENSE).
