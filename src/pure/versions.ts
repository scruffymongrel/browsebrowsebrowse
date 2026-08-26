/**
 * Chrome version arithmetic and the Chrome-for-Testing metadata shape.
 *
 * Everything here is pure. The network call that fetches the metadata lives in
 * src/engine.ts; this file only knows how to read what came back and how to
 * compare two version strings — which is the part that decides whether the CLI
 * tells you your engine has drifted, so it is the part that gets tested.
 */
import { SetupError } from './errors.ts'

/** The upstream freshness feed. Metadata only — it never serves binaries. */
export const LAST_KNOWN_GOOD_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'

export const CHANNELS = ['stable', 'beta', 'dev', 'canary'] as const
export type Channel = (typeof CHANNELS)[number]

/** `152.0.7977.64` — four dot-separated integers. */
const VERSION_RE = /^\d+(\.\d+){0,3}$/

export function isVersionString(s: string): boolean {
  return VERSION_RE.test(s)
}

export function isChannel(s: string): s is Channel {
  return (CHANNELS as readonly string[]).includes(s)
}

/**
 * Numeric, component-wise comparison. Returns <0 if a is older than b, 0 if
 * equal, >0 if newer. Missing components count as 0, so `152.0` === `152.0.0.0`.
 *
 * String comparison is wrong here and quietly so: `"152.0.7977.64" < "152.0.800"`
 * lexicographically, which would report a *newer* engine as stale.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = Number(pa[i] ?? 0) - Number(pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** True when `latest` is strictly newer than `installed`. */
export function isDrifted(installed: string, latest: string): boolean {
  return compareVersions(installed, latest) < 0
}

/** What the user asked to install: a channel name or an exact build. */
export type EngineRef =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'version'; version: string }

export function parseEngineRef(ref: string): EngineRef {
  const s = ref.trim().toLowerCase()
  if (isChannel(s)) return { kind: 'channel', channel: s }
  if (isVersionString(s)) return { kind: 'version', version: s }
  throw new SetupError(
    `not a Chrome version or channel: "${ref}" (want e.g. "stable" or "152.0.7977.64")`,
  )
}

/**
 * Pull one channel's version out of last-known-good-versions.json.
 *
 * The feed keys channels with a capital ("Stable"), which is easy to get wrong
 * and produces `undefined` rather than an error, so the lookup is
 * case-insensitive and a miss is loud.
 */
export function pickChannelVersion(payload: unknown, channel: Channel): string {
  const channels = (payload as { channels?: Record<string, { version?: unknown }> } | null)?.channels
  if (!channels || typeof channels !== 'object') {
    throw new SetupError('last-known-good-versions.json had no "channels" object')
  }
  const key = Object.keys(channels).find(k => k.toLowerCase() === channel)
  const version = key === undefined ? undefined : channels[key]?.version
  if (typeof version !== 'string' || !isVersionString(version)) {
    throw new SetupError(`no usable version for channel "${channel}" in the upstream feed`)
  }
  return version
}

/** What `engine.json` holds. `channel` is what was asked for, not a guarantee. */
export interface EngineManifest {
  version: string
  channel: Channel | 'pinned'
  installedAt: string
}

/** Tolerant read: a corrupt or hand-edited manifest is treated as absent. */
export function parseEngineManifest(raw: string): EngineManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const m = parsed as Partial<EngineManifest> | null
  if (!m || typeof m.version !== 'string' || !isVersionString(m.version)) return null
  const channel = typeof m.channel === 'string' && isChannel(m.channel) ? m.channel : 'pinned'
  return {
    version: m.version,
    channel,
    installedAt: typeof m.installedAt === 'string' ? m.installedAt : '',
  }
}

/** Newest first, for `engine list` and for picking a fallback after a prune. */
export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a))
}
