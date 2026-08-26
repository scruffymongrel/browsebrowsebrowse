/**
 * Binds the pure path layout to the real environment. Everything downstream
 * takes a `Config` rather than reading `process.env`, which is what lets the
 * integration tests point a whole run at a scratch directory.
 */
import { homedir } from 'node:os'
import {
  cacheRoot,
  daemonLogPath,
  daemonManifestPath,
  daemonProfileDir,
  engineManifestPath,
  enginesDir,
} from './pure/paths.ts'

/** Default CDP port. Not 9222 — that is Chrome's own, and colliding with a
 *  browser the user launched themselves would be a very confusing bug. */
export const DEFAULT_PORT = 9333

export interface Config {
  root: string
  engines: string
  engineManifest: string
  profile: string
  daemonManifest: string
  daemonLog: string
  port: number
  /** True when BBB_PORT was set, in which case it beats a daemon manifest. */
  portExplicit: boolean
  chromePath: string | undefined
  engineVersion: string | undefined
  ci: boolean
  noInstall: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = cacheRoot(env, homedir())
  const portRaw = Number(env.BBB_PORT)
  const portExplicit = Number.isInteger(portRaw) && portRaw > 0
  return {
    portExplicit,
    root,
    engines: enginesDir(root),
    engineManifest: engineManifestPath(root),
    profile: daemonProfileDir(root),
    daemonManifest: daemonManifestPath(root),
    daemonLog: daemonLogPath(root),
    port: portExplicit ? portRaw : DEFAULT_PORT,
    chromePath: env.CHROME_PATH,
    engineVersion: env.BBB_ENGINE_VERSION,
    ci: Boolean(env.CI),
    noInstall: Boolean(env.BBB_NO_INSTALL),
  }
}
