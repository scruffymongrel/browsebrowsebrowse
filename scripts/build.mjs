// Builds dist/ for publishing.
//
// The package ships compiled JS, never .ts. This is not a preference: Node
// refuses to strip types for files under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so a .ts bin throws on every
// npm install even when it runs perfectly from a checkout. domdomdom shipped
// that bug three times with CI green throughout, because the tests ran the
// source. See scripts/smoke-pack.mjs, which installs the real tarball.
//
// Contributors are unaffected: everything in the repo is .ts, and this runs at
// pack/publish time via `prepack`.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

rmSync('dist', { recursive: true, force: true })

// --splitting keeps shared module state in one chunk rather than inlining a
// second copy per entry point.
run('bun', [
  'build', './index.ts', './cli.ts',
  '--outdir', 'dist',
  '--target', 'node',
  '--format', 'esm',
  '--splitting',
  // Real dependencies, installed from package.json rather than inlined.
  '--external', 'puppeteer-core',
  '--external', '@puppeteer/browsers',
])

// Types for library consumers. bunx, not npx: nothing in the local toolchain
// should require Node to be installed.
run('bunx', ['tsc', '-p', 'tsconfig.build.json'])

// Source files import each other with explicit .ts extensions — required, both
// because allowImportingTsExtensions is on and because Node's type stripping
// (see scripts/smoke-node.mjs) refuses extensionless ESM specifiers. Those
// extensions must not survive into the shipped .d.ts: the tarball contains
// dist/src/*.d.ts and no .ts at all, so a consumer following './src/config.ts'
// finds nothing and every exported type silently degrades to `any`.
//
// tsc's `rewriteRelativeImportExtensions` looks like the answer and is a no-op
// for declaration emit under moduleResolution: bundler, so this does it here.
let rewritten = 0
for (const file of walk('dist')) {
  if (!file.endsWith('.d.ts')) continue
  const before = readFileSync(file, 'utf8')
  const after = before.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2')
  if (after !== before) {
    writeFileSync(file, after)
    rewritten++
  }
}

// A silent failure here is invisible until a consumer notices missing types.
for (const file of walk('dist')) {
  if (file.endsWith('.d.ts') && /from\s+['"]\.{1,2}\/[^'"]+\.ts['"]/.test(readFileSync(file, 'utf8'))) {
    throw new Error(`${file} still imports a .ts specifier after the rewrite`)
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

// bun build carries the source shebang through verbatim. dist/cli.js is plain
// JS, so any type-stripping flag would be meaningless there; --no-warnings
// keeps puppeteer's experimental-feature chatter off stderr, which matters
// because stderr is part of the output contract (captured page console.*).
const cli = 'dist/cli.js'
writeFileSync(
  cli,
  readFileSync(cli, 'utf8').replace(/^#![^\n]*/, '#!/usr/bin/env -S node --no-warnings'),
)

console.log('built dist/')
