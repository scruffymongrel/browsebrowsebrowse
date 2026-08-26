// Smoke-tests the CLI under Node, from the checkout.
//
// The bun:test suite can only exercise Bun, but Node is the *target* runtime:
// the shipped bin's shebang is node, and engines.node is >=22.12 (puppeteer-
// core's own floor). Without this, a Node-only break — a module-resolution
// difference, a syntax Node's type stripping refuses — would only surface for
// a user.
//
// Deliberately engine-free. Everything asserted here works with no Chrome
// installed and no network, so CI never downloads 180MB to check that the
// module graph loads. The browser itself is covered by test/integration.
//
// KNOWN GAP — this runs the .ts from the repo, which is NOT how users get it.
// See scripts/smoke-pack.mjs for the installed-tarball path.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireNodeOrSkip } from './node-bin.mjs'

const node = requireNodeOrSkip('node smoke')
if (!node) process.exit(0)

const cache = mkdtempSync(join(tmpdir(), 'bbb-smoke-'))
const env = { ...process.env, BBB_CACHE_DIR: cache, CHROME_PATH: '' }

// stdio is spelled out because execFileSync inherits the child's stderr by
// default — the expected SETUP ERROR output would otherwise scroll past as if
// something had gone wrong.
function run(args, { expectCode = 0, envOverride = env } = {}) {
  try {
    const stdout = execFileSync(node, ['cli.ts', ...args], {
      env: envOverride,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (expectCode !== 0) throw new Error(`expected exit ${expectCode}, got 0`)
    return { stdout, stderr: '', code: 0 }
  } catch (e) {
    if (e.status === undefined) throw e
    if (e.status !== expectCode) {
      throw new Error(`${args.join(' ')}: expected exit ${expectCode}, got ${e.status}\n${e.stderr}`)
    }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status }
  }
}

let failed = false
const check = (what, fn) => {
  try {
    fn()
    console.log(`node smoke: ${what} ok`)
  } catch (e) {
    console.error(`node smoke: ${what} FAILED — ${e.message}`)
    failed = true
  }
}

try {
  check('--help exits 0', () => {
    const { stdout } = run(['--help'])
    if (!stdout.includes('browsebrowsebrowse')) throw new Error('help text missing')
  })

  check('engine list --json on an empty cache', () => {
    const { stdout } = run(['engine', 'list', '--json'])
    const parsed = JSON.parse(stdout)
    if (!parsed.ok || parsed.result.installed.length !== 0) {
      throw new Error(`unexpected: ${stdout.trim()}`)
    }
  })

  // The anti-surprise-download contract, asserted rather than documented.
  check('--no-install refuses to fetch and exits 3', () => {
    const { stderr } = run(['shot', 'https://example.com', '--no-install'], { expectCode: 3 })
    if (!stderr.includes('bbb engine install')) {
      throw new Error(`expected the install command in stderr, got: ${stderr}`)
    }
  })

  // Spawning a directory fails as EACCES, which reads like a permissions
  // problem and sends you looking in the wrong place entirely.
  check('a directory in CHROME_PATH is rejected, not spawned', () => {
    const { stderr } = run(['engine', 'path'], {
      expectCode: 3,
      envOverride: { ...env, CHROME_PATH: cache },
    })
    if (!stderr.includes('directory')) throw new Error(`expected a directory error, got: ${stderr}`)
  })
} finally {
  rmSync(cache, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
