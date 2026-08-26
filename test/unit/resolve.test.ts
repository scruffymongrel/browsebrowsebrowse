import { describe, expect, test } from 'bun:test'
import {
  mayAutoInstall,
  resolveEngine,
  type EngineProbe,
  type PathKind,
} from '../../src/pure/resolve.ts'
import type { EngineManifest } from '../../src/pure/versions.ts'

/** A filesystem made of a map, so every branch is reachable without a browser. */
function probeOf(tree: Record<string, PathKind>, nonExecutable: string[] = []): EngineProbe {
  return {
    kind: p => tree[p] ?? 'missing',
    executable: p => !nonExecutable.includes(p),
    // Model the real hazard: the path you asked for is not the path you get.
    realpath: p => p.replace('/link/', '/real/'),
  }
}

const manifest: EngineManifest = {
  version: '152.0.7977.64',
  channel: 'stable',
  installedAt: '2026-08-25T00:00:00.000Z',
}

const cached = '/cache/engines/152.0.7977.64/chrome-headless-shell'
const executablePathFor = (v: string) => `/cache/engines/${v}/chrome-headless-shell`

describe('CHROME_PATH', () => {
  test('is honoured when it points at an executable file', () => {
    const r = resolveEngine({
      chromePath: '/opt/chrome',
      manifest: null,
      executablePathFor,
      probe: probeOf({ '/opt/chrome': 'file' }),
    })
    expect(r).toEqual({ ok: true, executablePath: '/opt/chrome', source: 'CHROME_PATH' })
  })

  // Chrome resolves icudtl.dat relative to its own executable path. Launched
  // through a symlink it looks in the link's directory and dies with
  // "icudtl.dat not found in bundle" — so the resolver realpaths, and the
  // caller cannot forget to.
  test('is realpathed, so Chrome is never launched through a symlink', () => {
    const r = resolveEngine({
      chromePath: '/link/chrome',
      manifest: null,
      executablePathFor,
      probe: probeOf({ '/link/chrome': 'file' }),
    })
    expect(r).toMatchObject({ ok: true, executablePath: '/real/chrome' })
  })

  // Spawning a directory fails as EACCES, which reads like a permissions
  // problem and sends you looking in entirely the wrong place.
  test('a directory is rejected, not spawned', () => {
    const r = resolveEngine({
      chromePath: '/cache/engines/152.0.7977.64',
      manifest,
      executablePathFor,
      probe: probeOf({ '/cache/engines/152.0.7977.64': 'dir' }),
    })
    expect(r).toMatchObject({ ok: false, reason: 'chrome-path' })
    expect(r.ok === false && r.message).toContain('directory')
  })

  test('a missing path is rejected with advice to unset it', () => {
    const r = resolveEngine({
      chromePath: '/nope',
      manifest,
      executablePathFor,
      probe: probeOf({}),
    })
    expect(r.ok === false && r.message).toContain('does not exist')
  })

  test('a non-executable file is rejected', () => {
    const r = resolveEngine({
      chromePath: '/opt/chrome',
      manifest: null,
      executablePathFor,
      probe: probeOf({ '/opt/chrome': 'file' }, ['/opt/chrome']),
    })
    expect(r.ok === false && r.message).toContain('not executable')
  })

  test('a socket or device is rejected like a missing path', () => {
    const r = resolveEngine({
      chromePath: '/dev/null',
      manifest: null,
      executablePathFor,
      probe: probeOf({ '/dev/null': 'other' }),
    })
    expect(r).toMatchObject({ ok: false, reason: 'chrome-path' })
  })

  // "Honoured as a documented override, never required" — an empty or
  // whitespace value is how a shell exports an unset variable, and must not
  // count as a request.
  test('an empty value falls through to the cache', () => {
    const r = resolveEngine({
      chromePath: '   ',
      manifest,
      executablePathFor,
      probe: probeOf({ [cached]: 'file' }),
    })
    expect(r).toMatchObject({ ok: true, source: 'cache', version: '152.0.7977.64' })
  })
})

describe('the engine cache', () => {
  test('uses the version recorded in engine.json', () => {
    const r = resolveEngine({
      manifest,
      executablePathFor,
      probe: probeOf({ [cached]: 'file' }),
    })
    expect(r).toEqual({
      ok: true,
      executablePath: cached,
      source: 'cache',
      version: '152.0.7977.64',
    })
  })

  test('a pin beats the manifest', () => {
    const pinned = executablePathFor('151.0.1.1')
    const r = resolveEngine({
      pinnedVersion: '151.0.1.1',
      manifest,
      executablePathFor,
      probe: probeOf({ [cached]: 'file', [pinned]: 'file' }),
    })
    expect(r).toMatchObject({ ok: true, executablePath: pinned, version: '151.0.1.1' })
  })

  test('nothing recorded means not-installed with no version', () => {
    const r = resolveEngine({ manifest: null, executablePathFor, probe: probeOf({}) })
    expect(r).toEqual({
      ok: false,
      reason: 'not-installed',
      version: undefined,
      message: 'no Chrome engine installed',
    })
  })

  // A pruned or half-deleted cache: the manifest still names a version that is
  // no longer on disk. That has to read as "install this", not as a crash.
  test('a recorded version whose binary is gone is not-installed', () => {
    const r = resolveEngine({ manifest, executablePathFor, probe: probeOf({}) })
    expect(r).toMatchObject({ ok: false, reason: 'not-installed', version: '152.0.7977.64' })
  })

  test('a recorded binary that is not executable is not-installed', () => {
    const r = resolveEngine({
      manifest,
      executablePathFor,
      probe: probeOf({ [cached]: 'file' }, [cached]),
    })
    expect(r).toMatchObject({ ok: false, reason: 'not-installed' })
  })
})

describe('mayAutoInstall', () => {
  // A surprise 180MB download inside someone's pipeline is a bug, not a
  // convenience — so CI never auto-installs however interactive it looks.
  test('never in CI', () => {
    expect(mayAutoInstall({ ci: true, stderrIsTty: true, optOut: false })).toBe(false)
  })
  test('never when opted out', () => {
    expect(mayAutoInstall({ ci: false, stderrIsTty: true, optOut: true })).toBe(false)
  })
  test('not without a terminal to print the notice to', () => {
    expect(mayAutoInstall({ ci: false, stderrIsTty: false, optOut: false })).toBe(false)
  })
  test('yes at an interactive terminal', () => {
    expect(mayAutoInstall({ ci: false, stderrIsTty: true, optOut: false })).toBe(true)
  })
})
