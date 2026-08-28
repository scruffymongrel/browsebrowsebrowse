/**
 * The dual-target switch.
 *
 * Tests that exercise the *entry points* import them from here rather than from
 * `../cli.ts` / `../index.ts` directly, so the same suite can run twice: once
 * against the TypeScript source, once against the compiled `dist/` that users
 * actually install. `BBB_TEST_DIST=1` picks the built target.
 *
 * Why bother: the suite has only ever exercised `.ts` source while npm ships
 * something else. That exact gap is how a broken npm+Node install survived
 * three releases of domdomdom with CI green. `smoke:pack` proves the built
 * binary *runs*; this proves it still *behaves*.
 *
 * Scope, deliberately: only `index.ts` and `cli.ts` are indirected. The gate
 * exists to catch packaging, bundling and module-resolution differences, and
 * those show up at the entry points and in the spawn / dynamic-import paths —
 * not in pure functions. `test/unit/*` therefore keeps importing `src/pure/*`
 * directly and is NOT a target for this indirection: those modules are bundled
 * into `dist/` and are exercised through the entry points anyway, so a
 * fifteen-module re-export would add surface without adding signal. Don't
 * "complete" it later.
 *
 * The import specifiers are computed rather than literal so `tsc` doesn't try
 * to resolve `dist/`, which exists only after a build.
 */
import { fileURLToPath } from 'node:url'
import type { CliIO } from '../cli.ts'

const useDist = process.env.BBB_TEST_DIST === '1'

const indexSpecifier = useDist ? '../dist/index.js' : '../index.ts'
const cliSpecifier = useDist ? '../dist/cli.js' : '../cli.ts'

const index = (await import(
  useDist ? '../dist/index.js' : '../index.ts'
)) as typeof import('../index.ts')

const cli = (await import(
  useDist ? '../dist/cli.js' : '../cli.ts'
)) as typeof import('../cli.ts')

/** 'dist' or 'src' — handy when a failure only reproduces against one target. */
export const TARGET: 'dist' | 'src' = useDist ? 'dist' : 'src'

/**
 * Absolute paths to the two modules actually under test.
 *
 * A test that *names* a module on disk — spawning the bin as a child process,
 * symlinking it, feeding it to `isEntrypoint()` — cannot be redirected by this
 * file's imports. Hardcoding `resolve(root, 'cli.ts')` in one of those is the
 * over-fit: it stays green under `BBB_TEST_DIST=1` while still exercising the
 * source, which is a gate that passes for the wrong reason. Use these instead.
 */
export const INDEX_PATH = fileURLToPath(new URL(indexSpecifier, import.meta.url))
export const CLI_PATH = fileURLToPath(new URL(cliSpecifier, import.meta.url))

export const { loadConfig, resolveEngine, goto, withSession } = index
export const { runCli } = cli
export type { CliIO }
