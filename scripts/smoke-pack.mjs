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
// built. Every runtime we claim is asserted here, because all three are invoked
// in the wild:
//
//   1. Each runtime handed dist/cli.js explicitly. The shebang says node, but
//      `bunx bbb` and `deno run -A npm:browsebrowsebrowse` never read it — they
//      hand the file to their own loader. Deno's node-compat carries the whole
//      stack: puppeteer-core's node:child_process spawn of Chrome, the CDP
//      websocket, and the daemon's node:net probes all work (verified end to
//      end against a real engine, not just this engine-free assertion).
//   2. The bin aliases (`browsebrowsebrowse`, `bbb`) executed directly through
//      the node_modules/.bin symlink with **only Node** on PATH. That is the
//      shebang path, and node-only is the honest scope of it: a bun-only box
//      with no Node cannot run the installed bin directly. `bunx` covers that
//      box, and engines claims node and nothing else for the same reason.
//
// Engine-free by design: nothing here downloads a browser.
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { requireNodeOrSkip, requireDenoOrSkip } from './runtimes.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bbb-pack-'))
const cache = join(dir, 'cache')
let failed = false

const okShape = out => {
  const parsed = JSON.parse(out)
  return parsed.ok && Array.isArray(parsed.result.installed) ? 'ok' : `wrong shape: ${out.trim()}`
}

try {
  execSync(`bun pm pack --destination "${dir}"`, { stdio: 'ignore' })
  const tgz = readdirSync(dir).find(f => f.endsWith('.tgz'))
  if (!tgz) throw new Error('bun pm pack produced no tarball')

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', private: true }))
  execSync(`bun add "${join(dir, tgz)}"`, { cwd: dir, stdio: 'ignore' })

  const bin = join(dir, 'node_modules', 'browsebrowsebrowse', 'dist', 'cli.js')
  const env = { ...process.env, BBB_CACHE_DIR: cache, CHROME_PATH: '' }

  // Node and Deno are target runtimes, not toolchain requirements — skip their
  // halves when they aren't installed. CI has both, so the gate still holds
  // there.
  const node = requireNodeOrSkip('installed package via node')
  const deno = requireDenoOrSkip('installed package via deno')

  for (const [runtime, argv] of [
    ['bun', ['bun', bin]],
    ...(node ? [['node', [node, bin]]] : []),
    // -A because bbb reads the engine cache, spawns Chrome and opens sockets;
    // Deno's default is deny-all, and the documented invocation is
    // `deno run -A`.
    ...(deno ? [['deno', [deno, 'run', '-A', bin]]] : []),
  ]) {
    let result
    try {
      const out = execFileSync(argv[0], [...argv.slice(1), 'engine', 'list', '--json'], {
        env,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      result = okShape(out)
    } catch (e) {
      const msg = `${e.stderr ?? e.message}`
      result = msg.includes('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')
        ? 'FAILS: the runtime will not type-strip under node_modules'
        : `FAILS: ${msg.split('\n')[0]}`
    }

    console.log(`installed package via ${runtime}: ${result}`)
    if (result !== 'ok') failed = true
  }

  // Second pass: the *bin aliases* themselves, each invoked the way a package
  // manager's PATH entry invokes them — as the node_modules/.bin symlink,
  // executed directly so the OS reads the shebang, rather than
  // `<runtime> path/to/cli.js`. Node's directory is the only runtime on PATH
  // (plus /usr/bin for `env` itself), so this proves the shebang resolves with
  // no other runtime installed, and that `bbb` reaches the same working bin.
  if (node) {
    for (const name of ['browsebrowsebrowse', 'bbb']) {
      const binPath = join(dir, 'node_modules', '.bin', name)
      let result
      try {
        result = okShape(
          execFileSync(binPath, ['engine', 'list', '--json'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              PATH: [dirname(node), '/usr/bin', '/bin'].join(':'),
              BBB_CACHE_DIR: cache,
              CHROME_PATH: '',
            },
          }),
        )
      } catch (e) {
        result = `FAILS: ${(e.stderr ?? e.message).toString().split('\n')[0]}`
      }

      console.log(`bin alias '${name}' via node-only PATH: ${result}`)
      if (result !== 'ok') failed = true
    }
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
