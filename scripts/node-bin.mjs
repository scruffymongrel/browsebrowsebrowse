// Locates a Node binary for the checks that genuinely need one.
//
// The toolchain runs on Bun — nothing here should require Node to be installed
// locally. But Node is the *target* runtime (the shipped bin's shebang is
// node, and engines.node is >=22.12, puppeteer-core's own floor), so some
// checks have to actually execute it.
//
// Note this can't use process.execPath: under Bun that's the bun binary.
import { execFileSync } from 'node:child_process'

export function findNode() {
  try {
    return execFileSync('which', ['node'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

// Returns a Node path, or null when the caller should skip.
//
// Skipping is a local-convenience affordance only. Under CI a missing Node is a
// hard failure: "setup-node didn't run" must not look the same as "passed".
export function requireNodeOrSkip(what) {
  const node = findNode()
  if (node) return node

  if (process.env.CI) {
    console.error(`${what}: no node on PATH and CI is set — refusing to skip silently`)
    process.exit(1)
  }

  console.log(`${what}: SKIPPED — no node on PATH (CI gates this; local Bun-only setups don't need it)`)
  return null
}
