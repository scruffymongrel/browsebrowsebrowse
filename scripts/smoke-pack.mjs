// Smoke-tests the package the way users actually get it: pack it, install the
// tarball into a scratch project, run the installed bin.
//
// This is the check that matters for packaging. scripts/smoke-node.mjs runs the
// source from the checkout, and that difference is exactly where a shipped bug
// hides: Node refuses to strip types under node_modules, so a .ts bin works in
// a clone and throws on every npm install. domdomdom shipped that three times
// with CI green. When you change anything about packaging, trust this and
// nothing else.
//
// `bun pm pack` triggers prepack, so the tarball under test is always freshly
// built. Both runtimes are asserted because both are invoked in the wild — the
// shebang says node, but `bunx bbb` runs it under Bun.
//
// Engine-free by design: nothing here downloads a browser.
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireNodeOrSkip } from './node-bin.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bbb-pack-'))
const cache = join(dir, 'cache')
let failed = false

try {
  execSync(`bun pm pack --destination "${dir}"`, { stdio: 'ignore' })
  const tgz = readdirSync(dir).find(f => f.endsWith('.tgz'))
  if (!tgz) throw new Error('bun pm pack produced no tarball')

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', private: true }))
  execSync(`bun add "${join(dir, tgz)}"`, { cwd: dir, stdio: 'ignore' })

  const bin = join(dir, 'node_modules', 'browsebrowsebrowse', 'dist', 'cli.js')
  const env = { ...process.env, BBB_CACHE_DIR: cache, CHROME_PATH: '' }

  // Node is a target runtime, not a toolchain requirement — skip its half when
  // Node isn't installed. CI always has it, so the gate still holds there.
  const node = requireNodeOrSkip('installed package via node')

  for (const [runtime, argv] of [
    ['bun', ['bun', bin]],
    ...(node ? [['node', [node, bin]]] : []),
  ]) {
    let result
    try {
      const out = execFileSync(argv[0], [...argv.slice(1), 'engine', 'list', '--json'], {
        env,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const parsed = JSON.parse(out)
      result = parsed.ok && Array.isArray(parsed.result.installed) ? 'ok' : `wrong shape: ${out.trim()}`
    } catch (e) {
      const msg = `${e.stderr ?? e.message}`
      result = msg.includes('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')
        ? 'FAILS: Node will not type-strip under node_modules'
        : `FAILS: ${msg.split('\n')[0]}`
    }

    console.log(`installed package via ${runtime}: ${result}`)
    if (result !== 'ok') failed = true

  }

  // The plugin manifest and the skill ship inside the tarball; a `files:` typo
  // would otherwise only be noticed by someone installing the plugin.
  const files = readdirSync(join(dir, 'node_modules', 'browsebrowsebrowse'))
  const wanted = ['dist', 'skills', '.claude-plugin', 'README.md', 'LICENSE']
  const missing = wanted.filter(f => !files.includes(f))
  console.log(`tarball contents: ${missing.length === 0 ? 'ok' : `missing ${missing.join(', ')}`}`)
  if (missing.length > 0) failed = true
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
