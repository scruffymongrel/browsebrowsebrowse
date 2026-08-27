/**
 * The verbs. Each one returns a CommandResult, which src/pure/output.ts turns
 * into text or JSON; none of them print, and none of them call process.exit.
 * That split is what lets `--json` be an output concern rather than a second
 * code path per verb.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import type { Page } from 'puppeteer-core'
import type { CliArgs } from './pure/args.ts'
import type { Config } from './config.ts'
import {
  daemonStatus,
  effectivePort,
  endpointFor,
  readDaemonManifest,
  startDaemon,
  stopDaemon,
} from './daemon.ts'
import {
  ENGINE_DOWNLOAD_MB,
  engineStatus,
  ensureEngine,
  installEngine,
  listInstalled,
  pruneEngines,
  readManifest,
  resolve as resolveEngineNow,
} from './engine.ts'
import { HttpError, SetupError, UsageError } from './pure/errors.ts'
import { httpErrorMessage, isHttpFailure } from './pure/http.ts'
import { fail, ok, type CommandResult, type LogEntry } from './pure/output.ts'
import { normaliseUrl } from './pure/url.ts'
import { goto, withSession, type SessionOptions } from './session.ts'

export interface CommandContext {
  cfg: Config
  args: CliArgs
  cwd: string
  stdin: () => Promise<string>
  notice: (line: string) => void
}

function sessionOptions(args: CliArgs): SessionOptions {
  return {
    viewport: args.viewport,
    timeout: args.timeout,
    userAgent: args.userAgent,
    engineVersion: args.engineVersion,
    noInstall: args.noInstall,
  }
}

function requireUrl(ctx: CommandContext, verb: string): string {
  const raw = ctx.args.args[0]
  if (raw === undefined) throw new UsageError(`${verb} needs a URL`)
  return normaliseUrl(raw, ctx.cwd)
}

function outputPath(ctx: CommandContext, fallback: string): string {
  return resolvePath(ctx.cwd, ctx.args.args[1] ?? fallback)
}

/**
 * Every page verb shares this shape: navigate, then produce one value.
 *
 * Failure comes back as a result rather than a throw so that `status` and the
 * page's `logs` survive onto it — a 404 with the site's console output attached
 * says more than a bare error. A usage error still throws: it happens before
 * any of that exists.
 */
async function onPage<T>(
  ctx: CommandContext,
  verb: string,
  fn: (page: Page, url: string) => Promise<T>,
): Promise<CommandResult> {
  const url = requireUrl(ctx, verb)
  let status: number | null = null
  let logs: LogEntry[] = []
  try {
    const outcome = await withSession(ctx.cfg, sessionOptions(ctx.args), async session => {
      logs = session.logs
      const nav = await goto(session.page, url, { wait: ctx.args.wait, timeout: ctx.args.timeout })
      status = nav.status
      // Fail fast: with --fail a bad status IS the answer, so the user's code
      // never runs and no screenshot is taken.
      if (ctx.args.fail && isHttpFailure(status)) {
        throw new HttpError(status as number, httpErrorMessage(status as number, url))
      }
      return fn(session.page, url)
    })
    return ok(outcome.value, outcome.logs, status)
  } catch (error) {
    return fail(error, logs, status)
  }
}

export async function shot(ctx: CommandContext): Promise<CommandResult> {
  const path = outputPath(ctx, 'screenshot.png')
  if (!/\.(png|jpe?g|webp)$/i.test(path)) {
    throw new UsageError(`shot output must end in .png, .jpg or .webp, got ${path}`)
  }
  return onPage(ctx, 'shot', async page => {
    await page.screenshot({ path: path as `${string}.png`, fullPage: ctx.args.full })
    return path
  })
}

export async function pdf(ctx: CommandContext): Promise<CommandResult> {
  const path = outputPath(ctx, 'page.pdf')
  return onPage(ctx, 'pdf', async page => {
    await page.pdf({ path, format: 'A4', printBackground: true })
    return path
  })
}

export function html(ctx: CommandContext): Promise<CommandResult> {
  return onPage(ctx, 'html', page => page.content())
}

export function text(ctx: CommandContext): Promise<CommandResult> {
  return onPage(ctx, 'text', page =>
    page.evaluate(() => document.body?.innerText ?? document.documentElement?.textContent ?? ''),
  )
}

/**
 * JS arrives on stdin, exactly as it does for domdomdom. Same reason: quoting a
 * non-trivial snippet as a shell argument is where agent-written commands go
 * wrong, and a heredoc or a pipe sidesteps it entirely.
 */
export async function evalPage(ctx: CommandContext): Promise<CommandResult> {
  const code = (await ctx.stdin()).trim()
  if (!code) {
    throw new UsageError('eval reads JS from stdin — pipe it in, e.g. echo "document.title" | bbb eval <url>')
  }
  return onPage(ctx, 'eval', page => page.evaluate(wrapForReturn(code)) as Promise<unknown>)
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  body: string,
) => unknown

/**
 * Single expressions get their value returned automatically; anything else is a
 * statement block where the user writes `return` themselves. Same rule as
 * domdomdom, and decided by parsing rather than a regex so that a template
 * literal spanning several lines is not mistaken for a block.
 *
 * The result is an async IIFE *expression*, because puppeteer evaluates a
 * string as an expression: handing it an arrow function would serialise the
 * function itself (arriving as `{}`) rather than call it. Async so that
 * top-level `await` works in both branches.
 */
export function wrapForReturn(code: string): string {
  try {
    new AsyncFunction(`return (${code})`)
    return `(async () => (${code}))()`
  } catch {
    return `(async () => { ${code} })()`
  }
}

/** Resolves symlinks where possible, leaving a missing path alone so the
 *  "could not load" error still names what the user typed. */
function realpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * The escape hatch. `bbb run` hands a script the real puppeteer objects, so the
 * verb list never has to grow a `--click` or a `--scroll-to`.
 *
 *   export default async ({ browser, page, args, goto, puppeteer }) => value
 */
export async function run(ctx: CommandContext): Promise<CommandResult> {
  const script = ctx.args.args[0]
  if (script === undefined) throw new UsageError('run needs a script path')
  // Realpath before importing. On macOS `/tmp` and `/var` are symlinks, and a
  // module graph loaded through one resolves against a directory the loader
  // then cannot find again.
  const abs = realpath(isAbsolute(script) ? script : resolvePath(ctx.cwd, script))

  let mod: { default?: unknown }
  try {
    mod = (await import(pathToFileURL(abs).href)) as { default?: unknown }
  } catch (e) {
    const hint =
      extname(abs) === '.ts'
        ? '\nTypeScript scripts need a runtime that strips types (Node >=22.18, or run bbb under Bun). A .mjs script always works.'
        : ''
    throw new SetupError(`could not load ${abs}: ${(e as Error).message}${hint}`)
  }

  const fn = mod.default
  if (typeof fn !== 'function') {
    throw new SetupError(`${abs} has no default-exported function`)
  }

  const scriptArgs = ctx.args.args.slice(1)
  // A script can navigate many times; the reported status is the last one's,
  // which is the document whose result the script returned.
  let status: number | null = null
  const { value, logs } = await withSession(ctx.cfg, sessionOptions(ctx.args), async session =>
    (fn as (api: unknown) => Promise<unknown>)({
      browser: session.browser,
      page: session.page,
      args: scriptArgs,
      goto: async (u: string) => {
        const target = normaliseUrl(u, ctx.cwd)
        const nav = await goto(session.page, target, {
          wait: ctx.args.wait,
          timeout: ctx.args.timeout,
        })
        status = nav.status
        if (ctx.args.fail && isHttpFailure(status)) {
          throw new HttpError(status as number, httpErrorMessage(status as number, target))
        }
        return nav
      },
      puppeteer,
    }),
  )
  return ok(value, logs, status)
}

export async function serve(ctx: CommandContext): Promise<CommandResult> {
  const engine = await ensureEngine(ctx.cfg, {
    pinnedVersion: ctx.args.engineVersion,
    noInstall: ctx.args.noInstall,
  })
  const started = await startDaemon(ctx.cfg, engine.executablePath)
  return ok({
    ...started,
    profile: ctx.cfg.profile,
    note: 'every bbb command now uses this session automatically; `bbb stop` returns to cold runs',
  })
}

export async function stop(ctx: CommandContext): Promise<CommandResult> {
  const result = await stopDaemon(ctx.cfg)
  return ok({
    ...result,
    endpoint: endpointFor(effectivePort(ctx.cfg)),
    message: result.pid === null ? 'no daemon was recorded' : result.stopped ? 'stopped' : 'daemon was already gone; cleared the manifest',
  })
}

export async function status(ctx: CommandContext): Promise<CommandResult> {
  const daemon = await daemonStatus(ctx.cfg)
  return ok({ ...daemon, mode: daemon.running ? 'daemon (session)' : 'cold (clean room)' })
}

export async function engine(ctx: CommandContext): Promise<CommandResult> {
  const sub = ctx.args.sub
  switch (sub) {
    case 'status':
      return ok(await engineStatus(ctx.cfg))

    case 'install': {
      const ref = ctx.args.args[0] ?? ctx.args.engineVersion ?? 'stable'
      const outcome = await installEngine(ctx.cfg, ref, ctx.notice)
      return ok({ ...outcome, sizeMb: ENGINE_DOWNLOAD_MB })
    }

    case 'update': {
      const manifest = readManifest(ctx.cfg)
      const channel = manifest?.channel && manifest.channel !== 'pinned' ? manifest.channel : 'stable'
      const outcome = await installEngine(ctx.cfg, channel, ctx.notice)
      const previous = manifest?.version ?? null
      return ok({
        ...outcome,
        previous,
        // "Already present" is about the download, not about the answer: an
        // update off a pin can switch to a version that was never removed.
        note: previous === outcome.version ? 'already up to date' : `updated from ${previous ?? 'nothing'}`,
      })
    }

    case 'list': {
      const manifest = readManifest(ctx.cfg)
      return ok({
        root: ctx.cfg.engines,
        current: manifest?.version ?? null,
        installed: listInstalled(ctx.cfg),
      })
    }

    case 'prune':
      return ok(pruneEngines(ctx.cfg))

    case 'path': {
      const resolution = resolveEngineNow(ctx.cfg, ctx.args.engineVersion)
      if (!resolution.ok) throw new SetupError(resolution.message)
      return ok(resolution.executablePath)
    }

    default:
      throw new UsageError('engine needs a subcommand')
  }
}

/**
 * One place to look when something is wrong. Reports and never repairs — a
 * doctor that quietly downloads a browser is not diagnosing, it is acting.
 */
export async function doctor(ctx: CommandContext): Promise<CommandResult> {
  const [eng, daemon] = await Promise.all([engineStatus(ctx.cfg), daemonStatus(ctx.cfg)])
  const problems: string[] = []
  if (!eng.executablePath) {
    problems.push(`no engine resolved — run: bbb engine install stable (~${ENGINE_DOWNLOAD_MB}MB)`)
  }
  if (eng.drifted) {
    problems.push(
      `engine ${eng.current} is behind ${eng.latestChannel} ${eng.latest} — run: bbb engine update`,
    )
  }
  if (eng.feedError) problems.push(`version feed unreachable: ${eng.feedError}`)
  if (eng.installed.length > 1) {
    problems.push(`${eng.installed.length} engines installed — run: bbb engine prune`)
  }
  const stale = readDaemonManifest(ctx.cfg)
  if (stale && !daemon.running) {
    problems.push('a daemon manifest exists but nothing is listening — run: bbb stop')
  }

  return ok({
    version: PACKAGE_VERSION,
    runtime: runtimeName(),
    cacheRoot: ctx.cfg.root,
    engine: eng,
    daemon,
    mode: daemon.running ? 'daemon (session)' : 'cold (clean room)',
    problems,
    healthy: problems.length === 0,
  })
}

/** `process.versions.node` lies under Bun — it reports a Node it emulates. */
function runtimeName(): string {
  const bun = (globalThis as { Bun?: { version?: string } }).Bun
  return bun ? `bun ${bun.version ?? ''}`.trim() : `node ${process.versions.node}`
}

/** Filled in at build time is overkill; reading our own manifest is enough. */
export const PACKAGE_VERSION: string = (() => {
  try {
    const url = new URL('../package.json', import.meta.url)
    return String(JSON.parse(readFileSync(url, 'utf8')).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
})()
