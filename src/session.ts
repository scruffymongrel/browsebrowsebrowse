/**
 * Getting a page, and getting to a URL.
 *
 * Attaching is automatic: if a daemon is listening on the CDP port we connect
 * to it, otherwise we launch a cold browser with a throwaway profile and close
 * it again. Callers never choose; there is no flag.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import type { Config } from './config.ts'
import { daemonAlive, effectivePort, endpointFor, extraChromeArgs, isHeadlessShell } from './daemon.ts'
import { ensureEngine, type ResolvedEngine } from './engine.ts'
import type { Viewport } from './pure/args.ts'
import { statusFromResponse } from './pure/http.ts'
import type { LogEntry, LogLevel } from './pure/output.ts'

/**
 * How long to keep watching a page after a `domcontentloaded` fallback.
 *
 * Fixed, not adaptive. The fallback exists because the page never goes idle —
 * asking "has it gone idle yet" a second time would just burn the same budget
 * again.
 */
export const SETTLE_MS = 350

export type SessionMode = 'cold' | 'daemon'

export interface SessionOptions {
  viewport: Viewport
  timeout: number
  userAgent?: string | undefined
  engineVersion?: string | undefined
  noInstall?: boolean | undefined
}

export interface Session {
  browser: Browser
  page: Page
  logs: LogEntry[]
  mode: SessionMode
  engine: ResolvedEngine
}

const CONSOLE_LEVELS: Record<string, LogLevel> = {
  log: 'log',
  debug: 'debug',
  info: 'info',
  error: 'error',
  warning: 'warn',
  warn: 'warn',
}

export function consoleLevel(type: string): LogLevel {
  return CONSOLE_LEVELS[type] ?? 'log'
}

export function isTimeout(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError'
}

/**
 * Runs `fn` with a page, then tidies up completely: a cold run leaves no
 * browser process and no profile directory behind, and a daemon run leaves the
 * daemon exactly as it found it.
 */
export async function withSession<T>(
  cfg: Config,
  opts: SessionOptions,
  fn: (session: Session) => Promise<T>,
): Promise<{ value: T; logs: LogEntry[]; mode: SessionMode }> {
  const engine = await ensureEngine(cfg, {
    pinnedVersion: opts.engineVersion,
    noInstall: opts.noInstall === true,
  })

  const port = effectivePort(cfg)
  const useDaemon = await daemonAlive(port)

  let browser: Browser
  let profileDir: string | null = null
  if (useDaemon) {
    browser = await puppeteer.connect({ browserURL: endpointFor(port) })
  } else {
    // A fresh profile per run is what "clean room" means: no cookies, no
    // history, no service workers carried over from the last command.
    profileDir = mkdtempSync(join(tmpdir(), 'bbb-profile-'))
    browser = await puppeteer.launch({
      // Already realpath'd by the resolver — Chrome finds icudtl.dat relative
      // to its own executable, so launching through a symlink is fatal.
      executablePath: engine.executablePath,
      headless: isHeadlessShell(engine.executablePath) ? 'shell' : true,
      userDataDir: profileDir,
      args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...extraChromeArgs()],
    })
  }

  const logs: LogEntry[] = []
  const page = await browser.newPage()
  page.setDefaultTimeout(opts.timeout)
  page.setDefaultNavigationTimeout(opts.timeout)
  await page.setViewport(opts.viewport)
  if (opts.userAgent) await page.setUserAgent(opts.userAgent)
  page.on('console', msg => logs.push({ level: consoleLevel(msg.type()), message: msg.text() }))
  page.on('pageerror', err => {
    logs.push({ level: 'error', message: (err as Error)?.message ?? String(err) })
  })

  const mode: SessionMode = useDaemon ? 'daemon' : 'cold'
  try {
    const value = await fn({ browser, page, logs, mode, engine })
    return { value, logs, mode }
  } finally {
    await page.close().catch(() => {})
    if (useDaemon) {
      await browser.disconnect().catch(() => {})
    } else {
      await browser.close().catch(() => {})
      if (profileDir) rmSync(profileDir, { recursive: true, force: true })
    }
  }
}

export type NavigationStrategy = 'wait-selector' | 'networkidle2' | 'domcontentloaded'

/**
 * What one navigation produced: how it settled, and the main document's final
 * HTTP status (null when there wasn't one — see `statusFromResponse`).
 */
export interface Navigation {
  strategy: NavigationStrategy
  status: number | null
}

/** networkidle2, spelled out: at most two connections open, quiet for 500ms. */
const IDLE_CONCURRENCY = 2
const IDLE_TIME = 500

/**
 * Navigate, coping with pages that never go idle.
 *
 * `networkidle2` is the right wait for an ordinary app page and completely
 * wrong for a streaming one: an SSE connection, a long-poll or an open
 * WebSocket means the network never quiets down, so the wait burns the whole
 * timeout and then fails on a page that rendered fine a second in.
 *
 * Every path here navigates **once**, with `domcontentloaded`, and then decides
 * separately how long to keep watching. The obvious alternative — ask for
 * `networkidle2` and re-navigate on timeout — is what the prototype did, and it
 * breaks on exactly the pages it is meant to rescue: a page holding six
 * connections open has exhausted Chrome's per-host socket pool, so the second
 * navigation cannot get a socket and times out too. One navigation also means
 * no double page load, no doubled side effects, and no lost `--wait` race.
 *
 * A `domcontentloaded` that times out is a real failure and propagates, which
 * the CLI reports as exit 2.
 *
 * The navigation's own response is the only honest source of the status — it is
 * the main document's, after redirects, and reading it costs nothing extra. A
 * second request to "check" the URL would be a different request and could get
 * a different answer.
 */
export async function goto(
  page: Page,
  url: string,
  opts: { wait?: string | undefined; timeout: number },
): Promise<Navigation> {
  const started = Date.now()
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout })
  const status = statusFromResponse(response)
  const remaining = () => Math.max(IDLE_TIME, opts.timeout - (Date.now() - started))

  // A named selector is both faster and a real assertion about what rendered.
  if (opts.wait) {
    await page.waitForSelector(opts.wait, { timeout: remaining() })
    return { strategy: 'wait-selector', status }
  }

  try {
    await page.waitForNetworkIdle({
      idleTime: IDLE_TIME,
      concurrency: IDLE_CONCURRENCY,
      timeout: remaining(),
    })
    return { strategy: 'networkidle2', status }
  } catch (error) {
    if (!isTimeout(error)) throw error
    // It is streaming. Give late-rendering JS a moment, then take what we have.
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
    return { strategy: 'domcontentloaded', status }
  }
}
