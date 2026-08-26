# AGENTS.md

Guidance for coding agents working in this repo. Lives here rather than in
per-machine agent memory so it travels with the repo and applies in any
checkout. `CLAUDE.md` is a symlink to this file, and `.claude/` is a symlink to
`.agents/`.

## What this is

`browsebrowsebrowse` (`bbb`) is a headless-Chrome CLI for coding agents, and the
sibling of `domdomdom`, which does DOM work with no browser at all. The
two share a deliberate surface — JS on stdin, `--json` producing one line of
`{ok, result, logs}`, `--timeout`, `--viewport`, `--user-agent`, and exit codes
`0` ok / `1` eval / `2` timeout / `3` setup — so that an agent that can drive
one can drive the other with no new rules. **Don't drift that surface without
changing both.**

Most of `skills/browsebrowsebrowse/SKILL.md` is about routing *away* from this
tool towards `domdomdom`. That is on purpose: `bbb` costs a 180MB engine,
~0.8-1.2s cold, and ~180MB resident while daemonised, and most page work needs
none of it. Note domdomdom ships `domdomdom` on every version and gained a `ddd`
alias in 0.3.0, so a command written against `ddd` breaks on older installs.
Write `domdomdom` unless the newer version is confirmed.

## Releasing to npm

**Releases are normally the agent's to run, not the maintainer's.** The whole
sequence is automated; drive it from the repo:

```sh
gh workflow run release.yml -f bump=patch|minor|major
gh run watch
```

CI then runs: quality gate → Node smoke test → packed-tarball smoke test →
engine install → integration tests → `npm version` (bump + `chore(release):
vX.Y.Z` commit + annotated tag) → push → `npm publish` via Trusted Publishing
(OIDC) → build the plugin channel and advance `release`.

**`release.yml` and `test.yml` must gate on the same checks.** They drifted once
— `test.yml` grew a step `release.yml` didn't have — and a release broke on
something PR CI had never run. Add a gate to one, add it to the other.

Invariants — these are the ways to get it wrong:

- **Never hand-edit `version` in `package.json`.** CI owns it. Don't pre-bump a
  version "ready for release" either; the workflow bumps from whatever is on
  main, so a manual bump double-bumps.
- **`.claude-plugin/plugin.json` tracks `package.json`.** They're one artifact
  on one cadence — the plugin manifest ships inside the npm tarball — so the
  `version` npm lifecycle script syncs and stages it during `npm version`,
  landing both in the same release commit. Don't set it by hand; a test asserts
  they match, so drift fails CI.

  This is load-bearing, not hygiene: `plugin.json`'s `version` is the cache key
  Claude Code uses to decide whether a plugin update is available. If it stops
  changing, `/plugin update` silently skips the plugin and users stay on an old
  build no matter what else moves.
- **The `plugin` branch is the plugin channel, and it is *built*, not
  fast-forwarded.** The marketplace repo pins `ref: plugin`, and after a
  successful publish the workflow runs `scripts/build-plugin-channel.mjs` and
  pushes the result. Don't push to it by hand — that would ship plugin content
  for a version that isn't on npm.

  The script assembles a tree with git plumbing (`ls-tree` → `mktree` →
  `commit-tree`) containing **exactly** `.claude-plugin/`, `skills/`,
  `README.md` and `LICENSE`, and commits it as a child of the current channel
  tip. A child, not a rewrite: the push stays an ordinary fast-forward, so
  nothing ever needs `--force`, and the channel keeps a linear history of its
  own. It shares no history with `main` — the commit body records the source
  commit if you need to tie them together. If `plugin` doesn't exist (a fresh
  fork), the first commit is an orphan.
- **The plugin channel ships no `package.json` and no lockfile, deliberately.**
  Claude Code runs a dependency install in a plugin's root when it finds *both*
  a `package.json` and a supported lockfile — `bun.lock`/`bun.lockb` →
  `bun install --frozen-lockfile --ignore-scripts`, `package-lock.json`/
  `npm-shrinkwrap.json` → `npm ci --ignore-scripts`. With a `package.json` and
  no lockfile it is skipped, silently, with no log entry.

  The old channel was `git push origin HEAD:plugin`, so it carried the whole
  dev tree including `bun.lock`, and every single plugin install materialised
  ~46-50MB of `node_modules`. Those deps exist so a plugin's hooks and MCP
  servers can load them. **This plugin ships skills only — no hooks, no MCP
  servers** — so not one byte of it was ever loadable. `.claude-plugin/` is the
  only file a plugin actually requires; nothing requires a `package.json`, and
  nothing requires the channel `ref` to share history with the default branch.

  Dropping the manifest rather than only the lockfile is the point: with no
  `package.json` in the tree, a future maintainer cannot silently reintroduce
  the install by restoring a lockfile. `test/unit/packaging.test.ts` builds the
  channel in a throwaway repo and asserts the exact path set plus the absence of
  a `package.json` and any lockfile. **Don't "restore" the dev tree** — the
  files it would add (`cli.ts`, `test/`, `scripts/`, tsconfigs, `AGENTS.md`) are
  read by nobody in the plugin cache and one of them costs 46MB per user.
- **The plugin channel and the npm channel ship different content, on
  purpose.** The plugin cache is a git clone of the built `plugin` branch:
  the manifest and the skill, and never a built binary — `dist/` is gitignored
  and isn't in the channel tree either way. The npm tarball is the mirror
  image: `files:` ships `dist/` (built at pack time via `prepack`) plus the
  plugin manifest, not the raw `.ts`.

  This is a trap for a future agent: "the plugin has no `dist/`" reads like a
  packaging bug, and the obvious "fix" — un-gitignoring `dist/` — would ship
  build artifacts into a channel that was never meant to carry them, for no
  benefit. The plugin's job is delivering the skill, not making `bbb` runnable.

  It is also why the skill states the install command (`npm i -g
  browsebrowsebrowse`) and the `bunx` fallback explicitly. `domdomdom`'s skill
  originally assumed the binary was on PATH and it never was; a packaging test
  here asserts both strings are present so the same gap can't reopen.
- **Never rename `.github/workflows/release.yml`.** npm's trusted publisher is
  keyed to repo *and workflow filename*. Renaming it breaks publishing with an
  auth error at the final step, after the version has already been bumped and
  pushed.
- `workflow_dispatch` only appears once the workflow is on the **default
  branch**. A release can't be triggered from a feature branch.
- Releases refuse to run anywhere but `main`.
- Publishing depends on a trusted publisher configured on npmjs.com (package →
  Settings → Trusted Publisher). That's a maintainer action; Claude can't do it.
- If `main` is branch-protected, the bot's `git push --follow-tags` fails
  *after* the bump but *before* publish. The workflow identity needs a bypass.

## Checks

```sh
bun run quality           # tsc --noEmit + coverage-gated unit tests
bun run test:integration  # the browser-touching suite (needs an engine)
bun run smoke:node        # runs the CLI from the checkout under Node
bun run smoke:pack        # packs, installs the tarball, runs it under Node, Bun AND Deno
bun run build             # compile dist/ (runs automatically via prepack)
```

- **Coverage is enforced at 100%** (lines + functions), but only over
  `src/pure/` — everything `bun test test/unit` loads. Bun instruments what it
  transpiles, so scoping the gated run to `test/unit` is what scopes the
  threshold; nothing under `src/` proper is ever loaded there.

  That split is the design, not a compromise. Browser-touching code is covered
  by `test/integration`, which drives a real Chrome and is **not** gated.
  Chasing 100% across a process-spawning, CDP-speaking codebase would mean
  testing mocks of Chrome rather than Chrome. **Don't add mock-based tests to
  raise the number.** If you add a pure module, it must reach 100%; if you add
  browser code, it gets an integration test.

  Note the threshold keys in `bunfig.toml` are plural (`lines`/`functions`) —
  bun silently ignores the singular spellings, gating nothing. Verified by
  adding an uncovered function and watching the exit code.
- **`bun test --config X` needs the `=`.** `bun test --config=bunfig.integration.toml`
  applies the file; `bun test --config bunfig.integration.toml` silently does
  not, and the integration suite runs under the coverage gate instead. It looks
  identical apart from a coverage table appearing.
- **The toolchain is Bun-only. Never add a step that requires Node locally.**
  Scripts run under `bun`, the build shells out to `bunx tsc`, and packing uses
  `bun pm pack` / `bun add`. Node is a *target* runtime, not a build dependency.
- **One runtime story, and it is true.** `engines` claims `node >=22.12.0` and
  nothing else — that is puppeteer-core's own floor, asserted against its
  `package.json` by a test — and the shipped shebang is `#!/usr/bin/env -S node`.
  That is the honest scope of the shebang, which is the only thing the package
  controls.

  Three runtimes execute the built CLI and `smoke:pack` gates all three: Node
  through the shebang, Bun through its own loader (`bunx browsebrowsebrowse`),
  and Deno through `deno run -A` (`deno install -g` writes its own `/bin/sh`
  shim that execs `deno run npm:browsebrowsebrowse`, so the shebang is never
  consulted there either). Running under a runtime is not the same as `engines`
  claiming it: a Bun-only box with no Node on PATH cannot execute the installed
  bin *directly*, `bunx` is the answer there, and `engines` must not pretend
  otherwise. Don't add `bun` or `deno` keys to `engines`; a test asserts `node`
  is the only one.

  Deno support is measured, not assumed. Despite spawning Chrome through
  `node:child_process`, speaking CDP over a websocket and probing ports with
  `node:net`, the whole surface works under Deno 2.9 node-compat — `eval`,
  `shot`, `pdf`, `html`, `text`, `run`, and the full `serve`/`stop` daemon
  lifecycle, verified against a real engine. If that ever regresses, narrow the
  claim in the README and the skill rather than leaving a skill that tells an
  agent to run something broken.
- **PR CI never downloads an engine.** `smoke:node` and `smoke:pack` assert
  things that hold with no Chrome installed (help, `engine list`, the
  `--no-install` refusal, the CHROME_PATH-is-a-directory rejection). The
  integration job installs one explicitly. Keep that separation: a 180MB
  download on every PR is a tax on every change.
- **Test the artifact, not the checkout.** `smoke:node` runs the CLI from the
  repo, where Node's type stripping is permitted. That difference hid a bug in
  domdomdom that shipped three times — Node refuses to strip types under
  `node_modules`, so a `.ts` bin threw on every npm+Node install with CI green
  throughout. This package ships compiled JS, and `smoke:pack` installs the real
  tarball and gates on all three runtimes. When you change anything about packaging,
  trust `smoke:pack` and nothing else.
- **`dist/` is built, gitignored, and never hand-edited.** `prepack` builds it,
  so `npm pack` and `npm publish` always compile fresh. Source stays `.ts`.

## Things that bite in this codebase

- **Never launch Chrome through a file symlink.** Chrome resolves `icudtl.dat`
  and its other resources relative to its own executable path; through a symlink
  it looks in the link's directory and dies with `icudtl.dat not found in
  bundle`. `resolveEngine()` `realpath`s everything it returns so no caller can
  forget, and a test asserts it. An earlier prototype maintained a `current`
  symlink to save disk; it broke on every Playwright revision rotation. Don't
  bring it back.
- **A `CHROME_PATH` pointing at a directory must be rejected, not spawned.**
  Spawning a directory fails as `EACCES`, which reads like a permissions problem
  and sends you looking somewhere else entirely. Covered in both the unit tests
  and `smoke:node`.
- **`goto()` navigates exactly once.** The obvious implementation — ask for
  `networkidle2`, and on timeout re-navigate with `domcontentloaded` — is what
  the prototype did, and it fails on precisely the pages it is meant to rescue:
  a page holding six connections open has exhausted Chrome's per-host socket
  pool, so the second navigation can't get a socket and times out too. One
  navigation, then a *separate* `waitForNetworkIdle` that is allowed to fail.
- **`page.evaluate(string)` evaluates an expression, not a function.** Handing
  it `() => (...)` serialises the function itself and the caller gets `{}`.
  `wrapForReturn()` produces an async IIFE expression for that reason.
- **`bbb run` realpaths the script before importing it.** On macOS `/tmp` and
  `/var` are symlinks, and Bun's loader caches a resolution root from the first
  dynamic import — a second import through the symlinked path then fails with
  "Cannot find module" for a file that plainly exists.
- **`run`'s argv split is positional.** `bbb`'s own flags come before the script
  path; everything after belongs to the script. That is why the parser is
  hand-rolled instead of `node:util`'s `parseArgs`, which would reject the
  script's flags as unknown.
- **Notices go to stderr, never stdout.** `--json` promises exactly one line,
  and `bbb html url > page.html` promises a file that is HTML.
- **`bbb stop` waits for the port to close.** SIGTERM returns immediately, so a
  `stop` that reported success straight away would let the next command attach
  to a browser halfway through shutting down.
- **Never auto-update the engine.** `doctor` and `engine status` fetch version
  *metadata* and print a command; they must never fetch a binary. Auto-install
  happens only on a first run at an interactive terminal, never in CI.
