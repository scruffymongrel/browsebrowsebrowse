/**
 * Where everything lives on disk. Pure: `home` and the environment are passed
 * in, so the layout is testable without touching a real HOME.
 *
 * Engines deliberately live in a user-level cache rather than under
 * node_modules. Two reasons, both learned the hard way:
 *
 *  - A ~180MB binary under node_modules is re-downloaded on every reinstall and
 *    duplicated per project. Four tools each keeping their own copy is how this
 *    machine lost a gigabyte.
 *  - A global install and a project-local install then share one engine instead
 *    of racing to own one.
 */
import { join } from 'node:path'

export interface PathEnv {
  BBB_CACHE_DIR?: string | undefined
  [key: string]: string | undefined
}

/** `~/.cache/browsebrowsebrowse`, or `$BBB_CACHE_DIR` when set (tests use it). */
export function cacheRoot(env: PathEnv, home: string): string {
  const override = env.BBB_CACHE_DIR?.trim()
  if (override) return override
  return join(home, '.cache', 'browsebrowsebrowse')
}

/** Parent of the per-version engine directories. */
export function enginesDir(root: string): string {
  return join(root, 'engines')
}

/**
 * The cache directory handed to @puppeteer/browsers for one engine version.
 * One version per directory, so `engine prune` is a directory removal and
 * cannot half-delete a live install.
 */
export function engineDir(root: string, version: string): string {
  return join(enginesDir(root), version)
}

/** Records the currently selected engine: `{ version, channel, installedAt }`. */
export function engineManifestPath(root: string): string {
  return join(root, 'engine.json')
}

/** Persistent profile — used by the daemon only. Cold runs get a temp dir. */
export function daemonProfileDir(root: string): string {
  return join(root, 'profile')
}

/** Records the running daemon: `{ pid, port, executablePath, startedAt }`. */
export function daemonManifestPath(root: string): string {
  return join(root, 'daemon.json')
}

export function daemonLogPath(root: string): string {
  return join(root, 'daemon.log')
}
