/**
 * Engine management: install, record, report, prune.
 *
 * Policy, in one place, because the whole point of this file is that it is
 * boring and predictable:
 *
 *  - **Never auto-update.** `doctor` and `engine status` will tell you an
 *    engine has drifted and print the command; they will not act on it. An
 *    automation that silently swaps the browser under a test suite is not a
 *    feature.
 *  - **Never download without consent.** At a terminal, a first run with no
 *    engine installs one after printing what it is about to fetch and how big
 *    it is. In CI it exits 3 and prints the command.
 *  - **One version per directory**, so `engine prune` is `rm -rf` of the
 *    directories that are not current, and cannot half-delete a live install.
 *
 * The freshness check fetches metadata only — a few hundred bytes of JSON from
 * the Chrome-for-Testing feed. No binary is ever fetched except by an explicit
 * `engine install` / `engine update`, or the consented first-run path.
 */
import { Browser, computeExecutablePath, install } from '@puppeteer/browsers'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import type { Config } from './config.ts'
import { SetupError } from './pure/errors.ts'
import { engineDir } from './pure/paths.ts'
import {
  mayAutoInstall,
  resolveEngine,
  type EngineProbe,
  type EngineResolution,
  type PathKind,
} from './pure/resolve.ts'
import {
  isDrifted,
  isVersionString,
  LAST_KNOWN_GOOD_URL,
  parseEngineManifest,
  parseEngineRef,
  pickChannelVersion,
  sortVersionsDesc,
  type Channel,
  type EngineManifest,
} from './pure/versions.ts'

/**
 * The size quoted in the pre-download consent notice. Deliberately an estimate
 * of the *download*, which is not the same quantity as the extracted engine on
 * disk — that measured 193MB for 152.0.7977.64 on 2026-09-01, and the docs
 * round it to ~190MB. See AGENTS.md, "What this is", before reconciling them.
 */
export const ENGINE_DOWNLOAD_MB = 180

export const nodeProbe: EngineProbe = {
  kind(path: string): PathKind {
    try {
      const st = statSync(path)
      if (st.isDirectory()) return 'dir'
      if (st.isFile()) return 'file'
      return 'other'
    } catch {
      return 'missing'
    }
  },
  executable(path: string): boolean {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  realpath: (path: string) => realpathSync(path),
}

export function executablePathFor(cfg: Config, version: string): string {
  return computeExecutablePath({
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: version,
    cacheDir: engineDir(cfg.root, version),
  })
}

export function readManifest(cfg: Config): EngineManifest | null {
  try {
    return parseEngineManifest(readFileSync(cfg.engineManifest, 'utf8'))
  } catch {
    return null
  }
}

export function writeManifest(cfg: Config, manifest: EngineManifest): void {
  mkdirSync(cfg.root, { recursive: true })
  writeFileSync(cfg.engineManifest, JSON.stringify(manifest, null, 2) + '\n')
}

/** Version directories that actually contain a usable binary. */
export function listInstalled(cfg: Config): string[] {
  let names: string[]
  try {
    names = readdirSync(cfg.engines, { withFileTypes: true })
      .filter(e => e.isDirectory() && isVersionString(e.name))
      .map(e => e.name)
  } catch {
    return []
  }
  return sortVersionsDesc(names.filter(v => nodeProbe.kind(executablePathFor(cfg, v)) === 'file'))
}

/** Metadata fetch. Small, cached by nobody, and allowed to fail. */
export async function fetchChannelVersion(channel: Channel, timeoutMs = 5000): Promise<string> {
  let payload: unknown
  try {
    const res = await fetch(LAST_KNOWN_GOOD_URL, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = await res.json()
  } catch (e) {
    throw new SetupError(
      `could not reach the Chrome-for-Testing version feed (${(e as Error).message})`,
    )
  }
  return pickChannelVersion(payload, channel)
}

export interface InstallOutcome {
  version: string
  channel: Channel | 'pinned'
  executablePath: string
  alreadyPresent: boolean
}

export async function installEngine(
  cfg: Config,
  ref: string,
  onNotice: (line: string) => void = () => {},
): Promise<InstallOutcome> {
  const parsed = parseEngineRef(ref)
  const version =
    parsed.kind === 'version' ? parsed.version : await fetchChannelVersion(parsed.channel)
  const channel = parsed.kind === 'version' ? ('pinned' as const) : parsed.channel

  const dest = engineDir(cfg.root, version)
  const expected = executablePathFor(cfg, version)
  const alreadyPresent = nodeProbe.kind(expected) === 'file'

  if (!alreadyPresent) {
    onNotice(
      `browsebrowsebrowse: installing chrome-headless-shell ${version} (~${ENGINE_DOWNLOAD_MB}MB) into ${dest}`,
    )
    mkdirSync(dest, { recursive: true })
    await install({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: version,
      cacheDir: dest,
    })
  }

  const manifest: EngineManifest = { version, channel, installedAt: new Date().toISOString() }
  writeManifest(cfg, manifest)
  return { version, channel, executablePath: expected, alreadyPresent }
}

/** Drops every installed engine except the current one. Returns what it removed. */
export function pruneEngines(cfg: Config): { removed: string[]; kept: string | null } {
  const manifest = readManifest(cfg)
  const kept = manifest?.version ?? null
  const removed: string[] = []
  for (const version of listInstalled(cfg)) {
    if (version === kept) continue
    rmSync(engineDir(cfg.root, version), { recursive: true, force: true })
    removed.push(version)
  }
  return { removed, kept }
}

export function resolve(cfg: Config, pinnedVersion?: string): EngineResolution {
  return resolveEngine({
    chromePath: cfg.chromePath,
    pinnedVersion: pinnedVersion ?? cfg.engineVersion,
    manifest: readManifest(cfg),
    executablePathFor: v => executablePathFor(cfg, v),
    probe: nodeProbe,
  })
}

export interface ResolvedEngine {
  executablePath: string
  source: 'CHROME_PATH' | 'cache'
  version?: string
}

/**
 * The path every browser-touching command goes through.
 *
 * On a miss it either installs (interactive, with a printed notice) or refuses
 * with exit 3 and the exact command — never a silent engine download.
 */
export async function ensureEngine(
  cfg: Config,
  opts: { pinnedVersion?: string | undefined; noInstall?: boolean } = {},
  onNotice: (line: string) => void = line => process.stderr.write(line + '\n'),
): Promise<ResolvedEngine> {
  const first = resolve(cfg, opts.pinnedVersion)
  if (first.ok) return strip(first)
  if (first.reason === 'chrome-path') throw new SetupError(first.message)

  const wanted = first.version
  const allowed = mayAutoInstall({
    ci: cfg.ci,
    stderrIsTty: process.stderr.isTTY === true,
    optOut: cfg.noInstall || opts.noInstall === true,
  })
  const command = `bbb engine install ${wanted ?? 'stable'}`
  if (!allowed) {
    throw new SetupError(
      `${first.message}.\n` +
        `Refusing to download ~${ENGINE_DOWNLOAD_MB}MB unprompted in a non-interactive session.\n` +
        `Run:  ${command}`,
    )
  }

  await installEngine(cfg, wanted ?? 'stable', onNotice)
  const second = resolve(cfg, opts.pinnedVersion)
  if (!second.ok) throw new SetupError(`${second.message} (after installing)`) // pragma: no cover
  return strip(second)
}

function strip(r: Extract<EngineResolution, { ok: true }>): ResolvedEngine {
  const out: ResolvedEngine = { executablePath: r.executablePath, source: r.source }
  if (r.version !== undefined) out.version = r.version
  return out
}

export interface EngineStatus {
  installed: string[]
  current: string | null
  channel: Channel | 'pinned' | null
  executablePath: string | null
  source: 'CHROME_PATH' | 'cache' | null
  latest: string | null
  /** Which channel `latest` came from. A pinned engine is measured against stable. */
  latestChannel: Channel
  drifted: boolean
  feedError: string | null
  updateCommand: string | null
}

/**
 * Reports; never acts. `latest` is null when the feed could not be reached,
 * which is a normal offline outcome and not an error.
 */
export async function engineStatus(cfg: Config): Promise<EngineStatus> {
  const manifest = readManifest(cfg)
  const resolution = resolve(cfg)
  const channel = manifest?.channel ?? null

  const latestChannel: Channel = channel === 'pinned' || channel === null ? 'stable' : channel
  let latest: string | null = null
  let feedError: string | null = null
  try {
    latest = await fetchChannelVersion(latestChannel)
  } catch (e) {
    feedError = (e as Error).message
  }

  const current = manifest?.version ?? null
  const drifted = current !== null && latest !== null && isDrifted(current, latest)
  return {
    installed: listInstalled(cfg),
    current,
    channel,
    executablePath: resolution.ok ? resolution.executablePath : null,
    source: resolution.ok ? resolution.source : null,
    latest,
    latestChannel,
    drifted,
    feedError,
    updateCommand: drifted ? 'bbb engine update' : null,
  }
}

/** True when the engine directory tree exists at all. Used by `doctor`. */
export function cacheExists(cfg: Config): boolean {
  return existsSync(cfg.engines)
}
