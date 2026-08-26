/**
 * Library surface.
 *
 * Thin on purpose. browsebrowsebrowse is a CLI first — the shape an agent
 * drives is `bbb <verb> ... --json` behind a plain Bash tool, with no MCP
 * server and no persistent connection. What is exported here is the machinery
 * worth reusing from a script: a session, navigation that survives streaming
 * pages, and the engine cache. Anything richer is what `bbb run` is for.
 */
export { loadConfig, DEFAULT_PORT, type Config } from './src/config.ts'

export {
  ensureEngine,
  engineStatus,
  installEngine,
  listInstalled,
  pruneEngines,
  readManifest,
  resolve as resolveEngine,
  ENGINE_DOWNLOAD_MB,
  type EngineStatus,
  type InstallOutcome,
  type ResolvedEngine,
} from './src/engine.ts'

export {
  daemonAlive,
  daemonStatus,
  startDaemon,
  stopDaemon,
  type DaemonStatus,
} from './src/daemon.ts'

export {
  goto,
  withSession,
  SETTLE_MS,
  type NavigationStrategy,
  type Session,
  type SessionMode,
  type SessionOptions,
} from './src/session.ts'

export { normaliseUrl } from './src/pure/url.ts'
export { SetupError, BrowseTimeoutError, UsageError } from './src/pure/errors.ts'
export {
  classify,
  exitCodeFor,
  render,
  toCloneable,
  type CommandResult,
  type LogEntry,
  type LogLevel,
} from './src/pure/output.ts'
export {
  compareVersions,
  isDrifted,
  parseEngineRef,
  pickChannelVersion,
  type Channel,
  type EngineManifest,
} from './src/pure/versions.ts'
