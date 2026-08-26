/**
 * Output shaping and the exit-code contract, deliberately identical to
 * domdomdom's so that an agent that can drive `ddd` can drive `bbb` with no new
 * parsing rules:
 *
 *   --json  -> one line of {ok, result, logs} on stdout, nothing else
 *   default -> human text on stdout, console.* on stderr
 *   exit     0 ok | 1 eval error | 2 timeout | 3 setup/usage
 *
 * `--json` is optional in both tools. A CLI whose plain output is unreadable
 * teaches people to reach for something else.
 */

export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface LogEntry {
  level: LogLevel
  message: string
}

export type ErrorKind = 'eval' | 'timeout' | 'setup'

export interface CommandError {
  kind: ErrorKind
  message: string
  stack?: string
}

export type CommandResult =
  | { ok: true; result: unknown; logs: LogEntry[] }
  | { ok: false; error: CommandError; logs: LogEntry[] }

export interface Rendered {
  stdout: string
  stderr: string
  code: number
}

export function ok(result: unknown, logs: LogEntry[] = []): CommandResult {
  return { ok: true, result, logs }
}

export function fail(error: unknown, logs: LogEntry[] = []): CommandResult {
  return { ok: false, error: classify(error), logs }
}

/**
 * Classify by an explicit `kind` marker, then by error *name*, and only then
 * fall back to 'eval'.
 *
 * Never by message text: page JS that throws "timeout" of its own is an eval
 * error (exit 1) and must not masquerade as our exit 2.
 */
export function classify(error: unknown): CommandError {
  const kindOf = (error as { kind?: unknown } | null)?.kind
  const name = (error as { name?: unknown } | null)?.name
  const kind: ErrorKind =
    kindOf === 'setup' || kindOf === 'timeout' || kindOf === 'eval'
      ? kindOf
      : name === 'TimeoutError'
        ? 'timeout'
        : 'eval'

  if (error instanceof Error) {
    const out: CommandError = { kind, message: error.message }
    if (error.stack) out.stack = error.stack
    return out
  }
  return { kind, message: String(error) }
}

export function exitCodeFor(result: CommandResult): number {
  if (result.ok) return 0
  if (result.error.kind === 'timeout') return 2
  if (result.error.kind === 'setup') return 3
  return 1
}

/**
 * JSON-stringify-safe. Cycles become "[Circular]"; the values JSON drops
 * silently (functions, undefined, BigInt, Symbol) become tagged strings so an
 * agent sees *something* rather than a missing key.
 */
export function toCloneable(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (t === 'undefined') return '[undefined]'
  if (t === 'bigint') return `[BigInt ${String(value)}]`
  if (t === 'symbol') return `[Symbol ${String(value)}]`
  if (t === 'function') return `[Function ${(value as { name?: string }).name || 'anonymous'}]`

  const obj = value as object
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)

  if (Array.isArray(obj)) return obj.map(v => toCloneable(v, seen))
  if (obj instanceof Error) return { name: obj.name, message: obj.message }
  if (obj instanceof Date) return obj.toISOString()

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = toCloneable(v, seen)
  return out
}

export function renderJson(result: CommandResult): Rendered {
  const payload = result.ok
    ? { ok: true, result: toCloneable(result.result), logs: result.logs }
    : { ok: false, error: result.error, logs: result.logs }
  return { stdout: JSON.stringify(payload) + '\n', stderr: '', code: exitCodeFor(result) }
}

export function renderHuman(result: CommandResult): Rendered {
  let stderr = result.logs.map(l => `[${l.level}] ${l.message}\n`).join('')

  if (!result.ok) {
    const { kind, message, stack } = result.error
    const label = kind === 'timeout' ? 'TIMEOUT' : kind === 'setup' ? 'SETUP ERROR' : 'EVAL ERROR'
    stderr += `${label}: ${kind === 'eval' ? (stack ?? message) : message}\n`
    return { stdout: '', stderr, code: exitCodeFor(result) }
  }

  return { stdout: humanValue(result.result), stderr, code: 0 }
}

/**
 * Strings pass through untouched — `bbb html url > page.html` has to produce a
 * file that is HTML, not a JSON string literal of HTML.
 */
function humanValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.endsWith('\n') ? value : value + '\n'
  return JSON.stringify(toCloneable(value), null, 2) + '\n'
}

export function render(result: CommandResult, json: boolean): Rendered {
  return json ? renderJson(result) : renderHuman(result)
}
