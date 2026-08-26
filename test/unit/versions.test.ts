import { describe, expect, test } from 'bun:test'
import { SetupError } from '../../src/pure/errors.ts'
import {
  compareVersions,
  isChannel,
  isDrifted,
  isVersionString,
  parseEngineManifest,
  parseEngineRef,
  pickChannelVersion,
  sortVersionsDesc,
} from '../../src/pure/versions.ts'

// The shape the Chrome-for-Testing feed actually returns, trimmed.
const FEED = {
  timestamp: '2026-08-25T08:04:31.789Z',
  channels: {
    Stable: { channel: 'Stable', version: '152.0.7977.64', revision: '1521234' },
    Beta: { channel: 'Beta', version: '153.0.8000.1', revision: '1530000' },
  },
}

describe('compareVersions', () => {
  test('compares component-wise, not lexically', () => {
    // The bug this exists to prevent: "152.0.7977.64" < "152.0.800" as strings,
    // which would report a newer engine as stale.
    expect(compareVersions('152.0.7977.64', '152.0.800.0')).toBe(1)
    expect(compareVersions('152.0.800.0', '152.0.7977.64')).toBe(-1)
  })

  test('treats missing components as zero', () => {
    expect(compareVersions('152.0', '152.0.0.0')).toBe(0)
    expect(compareVersions('152', '152.0.0.1')).toBe(-1)
  })

  test('is zero for equal versions', () => {
    expect(compareVersions('1.2.3.4', '1.2.3.4')).toBe(0)
  })
})

test('isDrifted is true only when upstream is strictly newer', () => {
  expect(isDrifted('152.0.7977.64', '152.0.7977.65')).toBe(true)
  expect(isDrifted('152.0.7977.64', '152.0.7977.64')).toBe(false)
  expect(isDrifted('152.0.7977.65', '152.0.7977.64')).toBe(false)
})

test('isVersionString accepts 1-4 dotted integers only', () => {
  expect(isVersionString('152')).toBe(true)
  expect(isVersionString('152.0.7977.64')).toBe(true)
  expect(isVersionString('152.0.7977.64.1')).toBe(false)
  expect(isVersionString('stable')).toBe(false)
})

test('isChannel', () => {
  expect(isChannel('stable')).toBe(true)
  expect(isChannel('nightly')).toBe(false)
})

describe('parseEngineRef', () => {
  test('channels are case-insensitive', () => {
    expect(parseEngineRef('Stable')).toEqual({ kind: 'channel', channel: 'stable' })
  })
  test('exact builds', () => {
    expect(parseEngineRef(' 152.0.7977.64 ')).toEqual({ kind: 'version', version: '152.0.7977.64' })
  })
  test('anything else is a setup error', () => {
    expect(() => parseEngineRef('latest')).toThrow(SetupError)
  })
})

describe('pickChannelVersion', () => {
  test('finds a capitalised channel key', () => {
    expect(pickChannelVersion(FEED, 'stable')).toBe('152.0.7977.64')
    expect(pickChannelVersion(FEED, 'beta')).toBe('153.0.8000.1')
  })
  test('a missing channel is loud, not undefined', () => {
    expect(() => pickChannelVersion(FEED, 'canary')).toThrow(/canary/)
  })
  test('a non-version value is rejected', () => {
    expect(() => pickChannelVersion({ channels: { Stable: { version: 42 } } }, 'stable')).toThrow(
      SetupError,
    )
  })
  test('a payload with no channels object is rejected', () => {
    expect(() => pickChannelVersion({}, 'stable')).toThrow(/channels/)
    expect(() => pickChannelVersion(null, 'stable')).toThrow(/channels/)
  })
})

describe('parseEngineManifest', () => {
  test('reads version and channel', () => {
    const m = parseEngineManifest(
      JSON.stringify({ version: '152.0.7977.64', channel: 'stable', installedAt: 'x' }),
    )
    expect(m).toEqual({ version: '152.0.7977.64', channel: 'stable', installedAt: 'x' })
  })

  test('an unknown channel degrades to "pinned" rather than failing', () => {
    const m = parseEngineManifest(JSON.stringify({ version: '1.2.3' }))
    expect(m).toEqual({ version: '1.2.3', channel: 'pinned', installedAt: '' })
  })

  // A hand-edited or truncated manifest must read as "nothing installed", not
  // crash every command in the CLI.
  test('corrupt input is treated as absent', () => {
    expect(parseEngineManifest('{ not json')).toBeNull()
    expect(parseEngineManifest('null')).toBeNull()
    expect(parseEngineManifest(JSON.stringify({ version: 'stable' }))).toBeNull()
  })
})

test('sortVersionsDesc is newest first and does not mutate', () => {
  const input = ['151.0.1.0', '152.0.7977.64', '152.0.800.0']
  expect(sortVersionsDesc(input)).toEqual(['152.0.7977.64', '152.0.800.0', '151.0.1.0'])
  expect(input[0]).toBe('151.0.1.0')
})
