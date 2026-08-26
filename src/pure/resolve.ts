/**
 * Which Chrome binary to launch. Deliberately tiny, and pure: the filesystem is
 * reached through an injected probe so every branch is testable without a
 * 180MB download.
 *
 * An earlier prototype resolved the engine by scanning ms-playwright and
 * .cache/puppeteer for anything chrome-shaped, ranking candidates by the digits
 * in their paths, and maintaining a `current` symlink to whatever won. It saved
 * disk and cost far more than it saved:
 *
 *  - Playwright rotates its revision directory, so the symlink dangled.
 *  - Which engine you got depended on what other tools happened to be
 *    installed, so runs were not reproducible between machines.
 *
 * Two failure modes from that era are encoded here as invariants:
 *
 *  1. **Never launch Chrome through a file symlink.** Chrome locates
 *     `icudtl.dat` and the rest of its resources relative to its own executable
 *     path; through a symlink it resolves to the link's directory and dies with
 *     "icudtl.dat not found in bundle". So every path this returns is
 *     realpath'd — the caller cannot forget.
 *  2. **A CHROME_PATH pointing at a directory must be rejected, not spawned.**
 *     Spawning a directory fails as EACCES, which reads like a permissions
 *     problem and sends you looking in the wrong place entirely.
 */
import type { EngineManifest } from './versions.ts'

export type PathKind = 'missing' | 'file' | 'dir' | 'other'

/** The filesystem, as much of it as resolution needs. */
export interface EngineProbe {
  /** Follows symlinks — a symlink to a file reports 'file'. */
  kind(path: string): PathKind
  executable(path: string): boolean
  /** Fully resolved, symlink-free path. */
  realpath(path: string): string
}

export type EngineResolution =
  | { ok: true; executablePath: string; source: 'CHROME_PATH' | 'cache'; version?: string }
  | { ok: false; reason: 'chrome-path'; message: string }
  | { ok: false; reason: 'not-installed'; version: string | undefined; message: string }

export interface ResolveInput {
  /** `$CHROME_PATH`, honoured as a documented override and never required. */
  chromePath?: string | undefined
  /** `--engine-version` or `$BBB_ENGINE_VERSION`. Beats the manifest. */
  pinnedVersion?: string | undefined
  /** Parsed `engine.json`, or null when nothing is installed yet. */
  manifest: EngineManifest | null
  /** Where a given version's binary would be, if installed. */
  executablePathFor: (version: string) => string
  probe: EngineProbe
}

export function resolveEngine(input: ResolveInput): EngineResolution {
  const { chromePath, pinnedVersion, manifest, executablePathFor, probe } = input

  const override = chromePath?.trim()
  if (override) {
    const kind = probe.kind(override)
    if (kind === 'dir') {
      return {
        ok: false,
        reason: 'chrome-path',
        message: `CHROME_PATH points at a directory: ${override}\nIt must be the Chrome executable itself, not the folder containing it.`,
      }
    }
    if (kind !== 'file') {
      return {
        ok: false,
        reason: 'chrome-path',
        message: `CHROME_PATH does not exist: ${override}\nUnset it to use the engine in the browsebrowsebrowse cache.`,
      }
    }
    if (!probe.executable(override)) {
      return {
        ok: false,
        reason: 'chrome-path',
        message: `CHROME_PATH is not executable: ${override}`,
      }
    }
    return { ok: true, executablePath: probe.realpath(override), source: 'CHROME_PATH' }
  }

  const version = pinnedVersion?.trim() || manifest?.version
  if (!version) {
    return {
      ok: false,
      reason: 'not-installed',
      version: undefined,
      message: 'no Chrome engine installed',
    }
  }

  const candidate = executablePathFor(version)
  if (probe.kind(candidate) !== 'file' || !probe.executable(candidate)) {
    return {
      ok: false,
      reason: 'not-installed',
      version,
      message: `Chrome ${version} is recorded but missing from the cache`,
    }
  }
  return { ok: true, executablePath: probe.realpath(candidate), source: 'cache', version }
}

/**
 * Whether it is acceptable to download ~180MB without being asked.
 *
 * Yes at an interactive terminal, where the user sees the notice and can Ctrl-C.
 * Never in CI: a surprise 180MB fetch in someone's pipeline is a bug, so the
 * non-interactive path exits 3 and prints the command instead.
 *
 * The TTY checked is stderr, not stdout — `bbb text url > page.html` is normal
 * usage and must not be mistaken for automation.
 */
export function mayAutoInstall(opts: {
  ci: boolean
  stderrIsTty: boolean
  optOut: boolean
}): boolean {
  if (opts.optOut) return false
  if (opts.ci) return false
  return opts.stderrIsTty
}
