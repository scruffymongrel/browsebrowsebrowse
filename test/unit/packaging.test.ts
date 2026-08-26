import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..', '..')
const read = (p: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, p), 'utf8'))

describe('packaging', () => {
  // The npm package and the Claude Code plugin are one artifact on one release
  // cadence — plugin.json ships inside the tarball. The `version` lifecycle
  // script keeps them in step; this catches drift that got in some other way (a
  // hand-edit, a bad merge) on the next CI run rather than at release time.
  //
  // Load-bearing: plugin.json's version is Claude Code's plugin-update cache
  // key. If it stops moving, `/plugin update` silently skips the plugin.
  test('plugin.json version tracks package.json version', () => {
    expect(read('.claude-plugin/plugin.json').version).toBe(read('package.json').version)
  })

  // engines.node claims what the shipped shebang actually runs. puppeteer-core
  // sets the real floor; claiming anything lower would be a lie that only
  // surfaces on a user's machine.
  test('engines.node is not below puppeteer-core’s own floor', () => {
    const pkg = read('package.json') as { engines: Record<string, string> }
    const dep = read('node_modules/puppeteer-core/package.json') as {
      engines: Record<string, string>
    }
    expect(pkg.engines.node).toBe(dep.engines.node)
    // One runtime story, and it matches the shebang the build writes.
    expect(Object.keys(pkg.engines)).toEqual(['node'])
    expect(readFileSync(resolve(root, 'scripts/build.mjs'), 'utf8')).toContain(
      '#!/usr/bin/env -S node',
    )
  })

  test('both bin aliases point at the built CLI', () => {
    const pkg = read('package.json') as { bin: Record<string, string> }
    expect(pkg.bin).toEqual({
      browsebrowsebrowse: 'dist/cli.js',
      bbb: 'dist/cli.js',
    })
  })

  // The plugin cache is a git clone of the `release` branch with dist/
  // gitignored, so installing the plugin never puts `bbb` on PATH. The skill
  // has to say how to install the CLI or it will tell an agent to run a
  // command that does not exist.
  test('the skill documents how to install the binary', () => {
    const skill = readFileSync(resolve(root, 'skills/browsebrowsebrowse/SKILL.md'), 'utf8')
    expect(skill).toContain('npm install -g browsebrowsebrowse')
    expect(skill).toContain('bunx browsebrowsebrowse')
  })

  // The plugin (skill) and the npm package (binary) install and upgrade
  // independently, so they can drift silently. Both docs need to say how to
  // upgrade each one and how to recognise which one is behind.
  test('the skill documents the plugin/CLI upgrade dance', () => {
    const skill = readFileSync(resolve(root, 'skills/browsebrowsebrowse/SKILL.md'), 'utf8')
    expect(skill).toContain('/plugin update')
    expect(skill).toContain('npm i -g browsebrowsebrowse@latest')
  })

  test('the README documents the plugin/CLI upgrade dance', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
    expect(readme).toContain('/plugin update')
    expect(readme).toContain('npm i -g browsebrowsebrowse@latest')
    expect(readme).toMatch(/only \*after\* `npm publish` succeeds/)
  })
})
