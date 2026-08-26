#!/usr/bin/env -S node --no-warnings
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './src/config.ts'
import * as commands from './src/commands.ts'
import { parseCli } from './src/pure/args.ts'
import { UsageError } from './src/pure/errors.ts'
import { fail, render, type CommandResult } from './src/pure/output.ts'
import { PACKAGE_VERSION } from './src/commands.ts'

const HELP = `browsebrowsebrowse (bbb) — headless Chrome for coding agents

Usage:
  bbb shot  <url> [out.png]      screenshot            --full --w N --h N --wait <sel>
  bbb pdf   <url> [out.pdf]      print to PDF
  bbb html  <url>                serialised DOM after load
  bbb text  <url>                visible text
  bbb eval  <url>                run JS in the page (JS on stdin)
  bbb run   <script.ts> [args]   full puppeteer-core API

  bbb serve                      start the persistent session daemon
  bbb stop                       stop it (back to cold runs)
  bbb status                     is a daemon running?

  bbb engine status              installed engine, and whether it has drifted
  bbb engine install [ref]       install stable (default) or an exact version
  bbb engine update              reinstall the current channel's latest
  bbb engine list                every engine in the cache
  bbb engine prune               drop all but the current engine
  bbb engine path                path to the resolved Chrome binary

  bbb doctor                     everything above, plus what to do about it

Cold vs daemon:
  Cold is the default — throwaway profile, clean room, nothing persists and no
  process is left behind. \`bbb serve\` starts a persistent profile, and from then
  on every command uses it automatically. cold = clean room, daemon = session.

Options:
  --json                    one line of { ok, result, logs } on stdout
  --timeout <ms>            navigation/selector budget (default 30000)
  --viewport <WxH>          page viewport (default 1440x900)
  --w <n> / --h <n>         viewport width/height; beat --viewport
  --full                    full-page screenshot (shot)
  --wait <selector>         wait for a selector instead of network idle
  --user-agent <ua>         override navigator.userAgent
  --engine-version <ver>    use a specific Chrome build for this run
  --no-install              never download an engine; fail with the command instead
  -h, --help                this text

Output (default):
  result             -> stdout (strings verbatim; objects pretty-JSON)
  page console.*     -> stderr, prefixed [log]/[warn]/[error]/[info]/[debug]
  errors             -> stderr (TIMEOUT / SETUP ERROR / EVAL ERROR)

Exit codes: 0 ok | 1 eval error | 2 timeout | 3 setup/usage error

Streaming pages (SSE, htmx, long-poll) never go network-idle. Use --wait <sel>.

env: CHROME_PATH (override the engine)  BBB_PORT  BBB_CACHE_DIR
     BBB_ENGINE_VERSION  BBB_NO_INSTALL  BBB_CHROME_ARGS
`

export interface CliIO {
  argv: string[]
  stdin: AsyncIterable<Buffer | Uint8Array | string>
  stdout: { write(s: string): unknown }
  stderr: { write(s: string): unknown }
  cwd?: string
  env?: NodeJS.ProcessEnv
}

async function readAll(stream: AsyncIterable<Buffer | Uint8Array | string>): Promise<string> {
  const parts: string[] = []
  for await (const chunk of stream) {
    parts.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
  }
  return parts.join('')
}

export async function runCli(io: CliIO): Promise<number> {
  let result: CommandResult
  let json = false

  try {
    const args = parseCli(io.argv)
    json = args.json

    if (args.verb === 'help' || args.help) {
      io.stdout.write(HELP)
      return 0
    }

    const ctx: commands.CommandContext = {
      cfg: loadConfig(io.env ?? process.env),
      args,
      cwd: io.cwd ?? process.cwd(),
      stdin: () => readAll(io.stdin),
      // Notices are progress, not output: they must not pollute a --json line
      // or a redirected `bbb html url > page.html`.
      notice: line => io.stderr.write(line + '\n'),
    }

    switch (args.verb) {
      case 'shot': result = await commands.shot(ctx); break
      case 'pdf': result = await commands.pdf(ctx); break
      case 'html': result = await commands.html(ctx); break
      case 'text': result = await commands.text(ctx); break
      case 'eval': result = await commands.evalPage(ctx); break
      case 'run': result = await commands.run(ctx); break
      case 'serve': result = await commands.serve(ctx); break
      case 'stop': result = await commands.stop(ctx); break
      case 'status': result = await commands.status(ctx); break
      case 'engine': result = await commands.engine(ctx); break
      case 'doctor': result = await commands.doctor(ctx); break
    }
  } catch (error) {
    result = fail(error)
    if (error instanceof UsageError) io.stderr.write(HELP)
  }

  const rendered = render(result, json)
  if (rendered.stderr) io.stderr.write(rendered.stderr)
  if (rendered.stdout) io.stdout.write(rendered.stdout)
  return rendered.code
}

export async function runFromProcess(
  argv: string[] = process.argv.slice(2),
  stdin: AsyncIterable<Buffer | Uint8Array | string> = process.stdin,
  stdout: { write(s: string): unknown } = process.stdout,
  stderr: { write(s: string): unknown } = process.stderr,
  exit: (code: number) => never = ((code: number) => process.exit(code)) as (code: number) => never,
): Promise<never> {
  if (argv[0] === '--version' || argv[0] === '-V') {
    stdout.write(PACKAGE_VERSION + '\n')
    return exit(0)
  }
  let code: number
  try {
    code = await runCli({ argv, stdin, stdout, stderr })
  } catch (e) {
    stderr.write(`FATAL: ${(e as Error).stack ?? String(e)}\n`)
    return exit(3)
  }
  return exit(code)
}

/**
 * True when this file is the process entry point.
 *
 * Compares *real* paths: invoked through a bin symlink, Node sets
 * process.argv[1] to the link while import.meta.url resolves to the target.
 */
export function isEntrypoint(argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntrypoint()) void runFromProcess()
