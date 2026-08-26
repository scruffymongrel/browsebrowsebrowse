/**
 * The optional persistent browser.
 *
 * Cold is the default and stays the default: a throwaway profile, a browser
 * that is closed when the command ends, nothing left running. That is what
 * makes a `bbb` invocation reproducible and safe to put in CI.
 *
 * `bbb serve` starts a daemon with a persistent profile, and from then on every
 * command uses it automatically — no flag, no config file. The mental model is
 * one line long:
 *
 *   cold   = clean room  (fresh profile, no cookies, no history, no leftovers)
 *   daemon = session     (logins and cookies survive between commands)
 *
 * Auto-attach is the whole point. A flag would mean remembering to pass it, and
 * the failure mode of forgetting — "why is it asking me to log in again" — is
 * exactly the thing the daemon exists to avoid.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Config } from './config.ts'
import { SetupError } from './pure/errors.ts'

export interface DaemonManifest {
  pid: number
  port: number
  executablePath: string
  startedAt: string
}

export function readDaemonManifest(cfg: Config): DaemonManifest | null {
  try {
    const m = JSON.parse(readFileSync(cfg.daemonManifest, 'utf8')) as Partial<DaemonManifest>
    if (typeof m.pid !== 'number' || typeof m.port !== 'number') return null
    return {
      pid: m.pid,
      port: m.port,
      executablePath: String(m.executablePath ?? ''),
      startedAt: String(m.startedAt ?? ''),
    }
  } catch {
    return null
  }
}

/** An explicit BBB_PORT wins; otherwise trust whatever `serve` recorded. */
export function effectivePort(cfg: Config): number {
  if (cfg.portExplicit) return cfg.port
  return readDaemonManifest(cfg)?.port ?? cfg.port
}

export function endpointFor(port: number): string {
  return `http://127.0.0.1:${port}`
}

/**
 * Liveness is asked of CDP, not of the pidfile: a stale manifest pointing at a
 * recycled pid would otherwise make every command try to attach to something
 * that is not a browser.
 */
export async function daemonAlive(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`${endpointFor(port)}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

/** chrome-headless-shell is headless by construction; full Chrome needs telling. */
export function isHeadlessShell(executablePath: string): boolean {
  return /headless[-_]shell/i.test(basename(executablePath))
}

export function extraChromeArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.BBB_CHROME_ARGS ?? '').trim()
  const args = extra ? extra.split(/\s+/) : []
  // Chrome's sandbox cannot initialise as uid 0, which is the norm inside
  // containers. Adding this only for root keeps the sandbox on everywhere else.
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox')
  return args
}

export interface StartResult {
  port: number
  pid: number
  endpoint: string
  alreadyRunning: boolean
  executablePath: string
}

export async function startDaemon(
  cfg: Config,
  executablePath: string,
  waitMs = 20_000,
): Promise<StartResult> {
  const port = effectivePort(cfg)
  if (await daemonAlive(port)) {
    const m = readDaemonManifest(cfg)
    return {
      port,
      pid: m?.pid ?? 0,
      endpoint: endpointFor(port),
      alreadyRunning: true,
      executablePath: m?.executablePath ?? executablePath,
    }
  }

  mkdirSync(cfg.profile, { recursive: true })
  mkdirSync(cfg.root, { recursive: true })
  const log = openSync(cfg.daemonLog, 'a')
  const child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${cfg.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      ...(isHeadlessShell(executablePath) ? [] : ['--headless=new']),
      ...extraChromeArgs(),
    ],
    { detached: true, stdio: ['ignore', log, log] },
  )
  child.unref()

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (await daemonAlive(port)) {
      const manifest: DaemonManifest = {
        pid: child.pid ?? 0,
        port,
        executablePath,
        startedAt: new Date().toISOString(),
      }
      writeFileSync(cfg.daemonManifest, JSON.stringify(manifest, null, 2) + '\n')
      return {
        port,
        pid: manifest.pid,
        endpoint: endpointFor(port),
        alreadyRunning: false,
        executablePath,
      }
    }
    await new Promise(r => setTimeout(r, 120))
  }

  throw new SetupError(
    `daemon did not come up on ${endpointFor(port)} within ${waitMs}ms. See ${cfg.daemonLog}`,
  )
}

export interface StopResult {
  stopped: boolean
  pid: number | null
}

/**
 * Stops the daemon and waits for the port to actually close.
 *
 * Waiting matters: SIGTERM returns immediately, so a `stop` that reported
 * success straight away would let the very next command find a still-listening
 * port and silently attach to a browser that is halfway through shutting down.
 * SIGKILL is the backstop for a browser wedged mid-render.
 */
export async function stopDaemon(cfg: Config, waitMs = 5000): Promise<StopResult> {
  const manifest = readDaemonManifest(cfg)
  const clear = () => {
    if (existsSync(cfg.daemonManifest)) rmSync(cfg.daemonManifest, { force: true })
  }
  if (!manifest) {
    clear()
    return { stopped: false, pid: null }
  }

  let stopped = false
  try {
    process.kill(manifest.pid, 'SIGTERM')
    stopped = true
  } catch {
    /* already gone; clearing the manifest below is still the right move */
  }

  const deadline = Date.now() + waitMs
  let escalated = false
  while (Date.now() < deadline) {
    if (!(await daemonAlive(manifest.port, 300))) break
    if (!escalated && Date.now() > deadline - waitMs / 2) {
      escalated = true
      try {
        process.kill(manifest.pid, 'SIGKILL')
      } catch {
        /* raced with its own exit */
      }
    }
    await new Promise(r => setTimeout(r, 100))
  }

  clear()
  return { stopped, pid: manifest.pid }
}

export interface DaemonStatus {
  running: boolean
  port: number
  endpoint: string
  pid: number | null
  profile: string
  startedAt: string | null
  executablePath: string | null
}

export async function daemonStatus(cfg: Config): Promise<DaemonStatus> {
  const port = effectivePort(cfg)
  const manifest = readDaemonManifest(cfg)
  return {
    running: await daemonAlive(port),
    port,
    endpoint: endpointFor(port),
    pid: manifest?.pid ?? null,
    profile: cfg.profile,
    startedAt: manifest?.startedAt || null,
    executablePath: manifest?.executablePath || null,
  }
}
