/**
 * Shared setup for the browser-touching suite.
 *
 * These tests need a real Chrome, which is exactly why they are not in the
 * coverage-gated run: covering this code with mocks would produce a green
 * number that proves nothing about whether Chrome launches.
 *
 * Locally they skip with a notice when no engine is available. Under CI they
 * refuse to skip — a suite that quietly does nothing is worse than one that
 * fails, and CI installs an engine explicitly before running them.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/config.ts'
import { resolve as resolveEngine } from '../../src/engine.ts'

export interface Scratch {
  env: NodeJS.ProcessEnv
  dir: string
  cleanup: () => void
}

/** A cache dir of its own, so tests never touch the developer's real engines. */
export function scratch(extra: NodeJS.ProcessEnv = {}): Scratch {
  const dir = mkdtempSync(join(tmpdir(), 'bbb-it-'))
  return {
    dir,
    env: {
      ...process.env,
      BBB_CACHE_DIR: dir,
      // A free-ish port per scratch, so a stray daemon from another run or
      // another project cannot be mistaken for this one's.
      BBB_PORT: String(9400 + Math.floor(Math.random() * 500)),
      ...extra,
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * An engine to test against: whatever CHROME_PATH names, otherwise whatever is
 * in the real cache. Returns null when there is nothing to run.
 */
export function findEngine(): string | null {
  const resolution = resolveEngine(loadConfig(process.env))
  return resolution.ok ? resolution.executablePath : null
}

export const ENGINE = findEngine()

if (!ENGINE) {
  if (process.env.CI) {
    console.error(
      'integration: no Chrome engine and CI is set — refusing to skip silently.\n' +
        'Run `bun run cli.ts engine install stable` first.',
    )
    process.exit(1)
  }
  console.log(
    'integration: SKIPPED — no Chrome engine.\n' +
      '  Install one:   bun run cli.ts engine install stable\n' +
      '  Or borrow one: CHROME_PATH=/path/to/chrome-headless-shell bun run test:integration',
  )
}
