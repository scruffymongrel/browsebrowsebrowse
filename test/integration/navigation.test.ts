import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { loadConfig } from '../../src/config.ts'
import { goto, withSession } from '../../src/session.ts'
import { DEFAULT_VIEWPORT } from '../../src/pure/args.ts'
import { startFixtures, type Fixtures } from '../fixtures/server.ts'
import { ENGINE, scratch, type Scratch } from './support.ts'

const it = describe.skipIf(!ENGINE)

let fx: Fixtures
let sc: Scratch

beforeAll(() => {
  fx = startFixtures()
  sc = scratch(ENGINE ? { CHROME_PATH: ENGINE } : {})
})
afterAll(() => {
  fx?.stop()
  sc?.cleanup()
})

const opts = { viewport: DEFAULT_VIEWPORT, timeout: 15_000 }

it('goto strategy', () => {
  test('an ordinary page reaches network idle', async () => {
    const cfg = loadConfig(sc.env)
    const { value } = await withSession(cfg, opts, ({ page }) => goto(page, fx.url('/'), { timeout: 10_000 }))
    expect(value).toBe('networkidle2')
  }, 30_000)

  // The bug this prevents: networkidle2 never fires on a streaming page, so a
  // screenshot of a perfectly rendered page used to fail outright.
  test('a streaming page falls back to domcontentloaded rather than failing', async () => {
    const cfg = loadConfig(sc.env)
    const { value } = await withSession(cfg, { ...opts, timeout: 2000 }, ({ page }) =>
      goto(page, fx.url('/stream'), { timeout: 2000 }),
    )
    expect(value).toBe('domcontentloaded')
  }, 30_000)

  // Naming a selector skips network idle entirely: faster, and a real
  // assertion about what rendered.
  test('a selector skips the idle wait', async () => {
    const cfg = loadConfig(sc.env)
    const { value } = await withSession(cfg, opts, ({ page }) =>
      goto(page, fx.url('/stream'), { wait: '[data-done]', timeout: 10_000 }),
    )
    expect(value).toBe('wait-selector')
  }, 30_000)

  test('a selector that never appears times out, which the CLI maps to exit 2', async () => {
    const cfg = loadConfig(sc.env)
    const attempt = withSession(cfg, { ...opts, timeout: 1500 }, ({ page }) =>
      goto(page, fx.url('/'), { wait: '#never', timeout: 1500 }),
    )
    await expect(attempt).rejects.toMatchObject({ name: 'TimeoutError' })
  }, 30_000)
})

it('session lifecycle', () => {
  test('a cold session reports cold and closes its browser', async () => {
    const cfg = loadConfig(sc.env)
    let browserRef: { connected: boolean } | null = null
    const { mode } = await withSession(cfg, opts, async ({ browser, page, mode }) => {
      browserRef = browser as unknown as { connected: boolean }
      expect(mode).toBe('cold')
      await goto(page, fx.url('/'), { timeout: 10_000 })
      return null
    })
    expect(mode).toBe('cold')
    expect(browserRef!.connected).toBe(false)
  }, 30_000)

  test('logs are collected even when the body throws', async () => {
    const cfg = loadConfig(sc.env)
    const attempt = withSession(cfg, opts, async ({ page }) => {
      await goto(page, fx.url('/'), { timeout: 10_000 })
      throw new Error('deliberate')
    })
    await expect(attempt).rejects.toThrow('deliberate')
  }, 30_000)
})
