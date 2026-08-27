/**
 * Argument parsing. Pure, and hand-rolled rather than node:util's `parseArgs`
 * for one reason: `bbb run script.ts --verbose` has to hand `--verbose` to the
 * script untouched, and a whole-argv parser would reject it as unknown.
 *
 * The rule is positional: for `run`, bbb's own flags come before the script
 * path and everything from the script path onward belongs to the script. `--`
 * works too, for the case where that reads better.
 */
import { UsageError } from './errors.ts'

export const VERBS = [
  'shot',
  'pdf',
  'html',
  'text',
  'eval',
  'run',
  'serve',
  'stop',
  'status',
  'engine',
  'doctor',
  'help',
] as const
export type Verb = (typeof VERBS)[number]

export const ENGINE_SUBCOMMANDS = [
  'status',
  'install',
  'update',
  'list',
  'prune',
  'path',
] as const
export type EngineSubcommand = (typeof ENGINE_SUBCOMMANDS)[number]

/** Flags that swallow the following token when written as `--flag value`. */
const VALUE_FLAGS = new Set([
  'wait',
  'user-agent',
  'viewport',
  'timeout',
  'w',
  'h',
  'engine-version',
  'port',
])

const BOOL_FLAGS = new Set(['full', 'json', 'help', 'no-install', 'fail'])

const SHORT: Record<string, string> = { h: 'help' }

export interface Tokenized {
  options: Map<string, string | true>
  positionals: string[]
}

/**
 * Split argv into options and positionals.
 *
 * `stopAfter` is the escape hatch for `run`: once that many positionals have
 * been collected, parsing stops and the remainder is passed through verbatim.
 */
export function tokenize(argv: readonly string[], stopAfter = Infinity): Tokenized {
  const options = new Map<string, string | true>()
  const positionals: string[] = []
  let passthrough = false

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string

    if (passthrough || positionals.length >= stopAfter) {
      positionals.push(tok)
      continue
    }

    if (tok === '--') {
      passthrough = true
      continue
    }

    if (tok.startsWith('--')) {
      const body = tok.slice(2)
      const eq = body.indexOf('=')
      const name = eq === -1 ? body : body.slice(0, eq)
      const inline = eq === -1 ? undefined : body.slice(eq + 1)

      if (BOOL_FLAGS.has(name)) {
        if (inline !== undefined) throw new UsageError(`--${name} takes no value`)
        options.set(name, true)
        continue
      }
      if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[i + 1]
        if (value === undefined) throw new UsageError(`--${name} needs a value`)
        if (inline === undefined) i++
        options.set(name, value)
        continue
      }
      throw new UsageError(`unknown option --${name}`)
    }

    if (tok.length > 1 && tok.startsWith('-')) {
      const name = SHORT[tok.slice(1)]
      if (!name) throw new UsageError(`unknown option ${tok}`)
      options.set(name, true)
      continue
    }

    positionals.push(tok)
  }

  return { options, positionals }
}

export interface Viewport {
  width: number
  height: number
}

export interface CliArgs {
  verb: Verb
  /** `engine`'s subcommand. Undefined for every other verb. */
  sub?: EngineSubcommand
  /** Verb arguments: URL, output path, script path, script args. */
  args: string[]
  json: boolean
  full: boolean
  /** `curl --fail`: a non-2xx main document is an error, not a page. */
  fail: boolean
  wait?: string
  timeout: number
  viewport: Viewport
  userAgent?: string
  engineVersion?: string
  port?: number
  noInstall: boolean
  help: boolean
}

export const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 }
export const DEFAULT_TIMEOUT = 30_000

export function parseViewport(s: string): Viewport {
  const m = /^(\d+)x(\d+)$/i.exec(s.trim())
  if (!m) throw new UsageError(`--viewport must be WxH (e.g. 1024x768), got "${s}"`)
  return { width: Number(m[1]), height: Number(m[2]) }
}

function positiveInt(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new UsageError(`--${flag} must be a non-negative integer, got "${value}"`)
  }
  return n
}

function str(options: Map<string, string | true>, name: string): string | undefined {
  const v = options.get(name)
  return typeof v === 'string' ? v : undefined
}

/**
 * `--w` / `--h` are the frozen `shot` spelling and win over `--viewport`, which
 * is the cross-tool convention shared with domdomdom. Supporting both and
 * having them disagree silently would be the worse option.
 */
export function resolveViewport(options: Map<string, string | true>): Viewport {
  const base = (() => {
    const v = str(options, 'viewport')
    return v === undefined ? DEFAULT_VIEWPORT : parseViewport(v)
  })()
  const w = str(options, 'w')
  const h = str(options, 'h')
  return {
    width: w === undefined ? base.width : positiveInt(w, 'w'),
    height: h === undefined ? base.height : positiveInt(h, 'h'),
  }
}

function isVerb(s: string): s is Verb {
  return (VERBS as readonly string[]).includes(s)
}

function isEngineSubcommand(s: string): s is EngineSubcommand {
  return (ENGINE_SUBCOMMANDS as readonly string[]).includes(s)
}

/** First bare token, so we know whether to stop parsing early for `run`. */
export function peekVerb(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string
    if (tok === '--') return argv[i + 1]
    if (!tok.startsWith('-')) return tok
    const name = tok.startsWith('--') ? tok.slice(2).split('=')[0] : SHORT[tok.slice(1)]
    if (name !== undefined && VALUE_FLAGS.has(name) && !tok.includes('=')) i++
  }
  return undefined
}

export function parseCli(argv: readonly string[]): CliArgs {
  const peeked = peekVerb(argv)
  // `run` takes the verb and the script path, then hands the rest to the script.
  const { options, positionals } = tokenize(argv, peeked === 'run' ? 2 : Infinity)

  const rawVerb = positionals[0]
  const help = options.get('help') === true

  if (rawVerb === undefined) {
    if (help || argv.length === 0) {
      return { ...defaults(options, true), verb: 'help', args: [] }
    }
    throw new UsageError('no command given')
  }
  if (!isVerb(rawVerb)) {
    throw new UsageError(`unknown command "${rawVerb}" (try: ${VERBS.join(', ')})`)
  }

  let sub: EngineSubcommand | undefined
  let args = positionals.slice(1)
  if (rawVerb === 'engine' && !help) {
    const rawSub = args[0]
    if (rawSub === undefined) {
      throw new UsageError(`engine needs a subcommand (${ENGINE_SUBCOMMANDS.join(', ')})`)
    }
    if (!isEngineSubcommand(rawSub)) {
      throw new UsageError(
        `unknown engine subcommand "${rawSub}" (try: ${ENGINE_SUBCOMMANDS.join(', ')})`,
      )
    }
    sub = rawSub
    args = args.slice(1)
  }

  const parsed: CliArgs = { ...defaults(options, help), verb: rawVerb, args }
  if (sub !== undefined) parsed.sub = sub
  return parsed
}

function defaults(options: Map<string, string | true>, help: boolean): Omit<CliArgs, 'verb' | 'args'> {
  const timeoutRaw = str(options, 'timeout')
  const portRaw = str(options, 'port')
  const out: Omit<CliArgs, 'verb' | 'args'> = {
    json: options.get('json') === true,
    full: options.get('full') === true,
    fail: options.get('fail') === true,
    timeout: timeoutRaw === undefined ? DEFAULT_TIMEOUT : positiveInt(timeoutRaw, 'timeout'),
    viewport: resolveViewport(options),
    noInstall: options.get('no-install') === true,
    help,
  }
  const wait = str(options, 'wait')
  if (wait !== undefined) out.wait = wait
  const ua = str(options, 'user-agent')
  if (ua !== undefined) out.userAgent = ua
  const ev = str(options, 'engine-version')
  if (ev !== undefined) out.engineVersion = ev
  if (portRaw !== undefined) out.port = positiveInt(portRaw, 'port')
  return out
}
