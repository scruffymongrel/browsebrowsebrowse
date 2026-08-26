import { describe, expect, test } from 'bun:test'
import {
  cacheRoot,
  daemonLogPath,
  daemonManifestPath,
  daemonProfileDir,
  engineDir,
  engineManifestPath,
  enginesDir,
} from '../../src/pure/paths.ts'

const HOME = '/home/a'

describe('cacheRoot', () => {
  // Outside node_modules on purpose: a ~180MB binary there is re-downloaded on
  // every reinstall and duplicated per project.
  test('is a user-level cache, not a project one', () => {
    expect(cacheRoot({}, HOME)).toBe('/home/a/.cache/browsebrowsebrowse')
  })
  test('BBB_CACHE_DIR overrides it', () => {
    expect(cacheRoot({ BBB_CACHE_DIR: '/scratch' }, HOME)).toBe('/scratch')
  })
  test('a blank override is ignored', () => {
    expect(cacheRoot({ BBB_CACHE_DIR: '  ' }, HOME)).toBe('/home/a/.cache/browsebrowsebrowse')
  })
})

test('the cache layout', () => {
  const root = cacheRoot({}, HOME)
  expect(enginesDir(root)).toBe('/home/a/.cache/browsebrowsebrowse/engines')
  // One version per directory, so `engine prune` is a directory removal and
  // cannot half-delete a live install.
  expect(engineDir(root, '152.0.7977.64')).toBe(
    '/home/a/.cache/browsebrowsebrowse/engines/152.0.7977.64',
  )
  expect(engineManifestPath(root)).toBe('/home/a/.cache/browsebrowsebrowse/engine.json')
  expect(daemonProfileDir(root)).toBe('/home/a/.cache/browsebrowsebrowse/profile')
  expect(daemonManifestPath(root)).toBe('/home/a/.cache/browsebrowsebrowse/daemon.json')
  expect(daemonLogPath(root)).toBe('/home/a/.cache/browsebrowsebrowse/daemon.log')
})
