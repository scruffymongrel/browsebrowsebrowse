import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliIO } from '../../cli.ts'
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

interface Run {
  code: number
  stdout: string
  stderr: string
  json: () => { ok: boolean; result: unknown; error?: { kind: string; message: string } }
}

/** Drives the real CLI in-process, so exit codes and output shape are asserted
 *  on the same code path the binary runs. */
async function bbb(argv: string[], stdin = ''): Promise<Run> {
  let stdout = ''
  let stderr = ''
  const io: CliIO = {
    argv,
    stdin: (async function* () {
      if (stdin) yield stdin
    })(),
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
    env: sc.env,
    cwd: sc.dir,
  }
  const code = await runCli(io)
  return { code, stdout, stderr, json: () => JSON.parse(stdout) }
}

it('page verbs against a real engine', () => {
  test('text returns rendered text', async () => {
    const r = await bbb(['text', fx.url('/'), '--json'])
    expect(r.code).toBe(0)
    expect(String(r.json().result)).toContain('static')
  })

  // The whole reason a real engine is worth 180MB: the DOM reflects what the
  // page's own scripts did, not just what the server sent.
  test('html reflects script-mutated DOM', async () => {
    const r = await bbb(['html', fx.url('/')])
    expect(r.stdout).toContain('id="scripted"')
  })

  test('page console output is captured as logs', async () => {
    const r = await bbb(['text', fx.url('/'), '--json'])
    expect(r.json()).toMatchObject({ logs: [{ level: 'warn', message: 'fixture warning' }] })
  })

  test('eval sees real layout, which is what domdomdom cannot do', async () => {
    const r = await bbb(
      ['eval', fx.url('/'), '--json'],
      'const r = document.querySelector(".card").getBoundingClientRect();\n' +
        'return { w: r.width, h: r.height, display: getComputedStyle(document.querySelector(".card")).display }',
    )
    expect(r.json().result).toEqual({ w: 240, h: 120, display: 'grid' })
  })

  test('eval auto-returns a single expression and honours the viewport', async () => {
    const r = await bbb(['eval', fx.url('/'), '--json', '--viewport', '812x455'], 'innerWidth')
    expect(r.json().result).toBe(812)
  })

  test('--w and --h beat --viewport end to end', async () => {
    const r = await bbb(
      ['eval', fx.url('/'), '--json', '--viewport', '812x455', '--w', '640'],
      '[innerWidth, innerHeight]',
    )
    expect(r.json().result).toEqual([640, 455])
  })

  test('--user-agent reaches the page', async () => {
    const r = await bbb(['eval', fx.url('/'), '--json', '--user-agent', 'bbb-test/1'], 'navigator.userAgent')
    expect(r.json().result).toBe('bbb-test/1')
  })

  test('an error thrown by page JS exits 1, not 2 or 3', async () => {
    const r = await bbb(['eval', fx.url('/'), '--json'], 'throw new Error("page timeout")')
    expect(r.code).toBe(1)
    expect(r.json().error).toMatchObject({ kind: 'eval', message: 'page timeout' })
  })

  test('shot writes a real PNG', async () => {
    const out = join(sc.dir, 'shot.png')
    const r = await bbb(['shot', fx.url('/'), out, '--w', '400', '--h', '300'])
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe(out)
    expect([...readFileSync(out).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test('shot --full works', async () => {
    const out = join(sc.dir, 'full.png')
    expect((await bbb(['shot', fx.url('/'), out, '--full'])).code).toBe(0)
    expect(readFileSync(out).length).toBeGreaterThan(0)
  })

  test('pdf writes a real PDF', async () => {
    const out = join(sc.dir, 'page.pdf')
    expect((await bbb(['pdf', fx.url('/'), out])).code).toBe(0)
    expect(readFileSync(out).subarray(0, 4).toString()).toBe('%PDF')
  })

  test('shot refuses an output name it cannot write', async () => {
    const r = await bbb(['shot', fx.url('/'), join(sc.dir, 'nope.gif'), '--json'])
    expect(r.code).toBe(3)
    expect(r.json().error?.kind).toBe('setup')
  })
})

it('streaming pages', () => {
  // networkidle never fires here — the page keeps more than two requests open
  // forever. --wait is the documented answer, and it must be both correct and
  // quick.
  test('--wait returns as soon as the selector appears', async () => {
    const started = Date.now()
    const r = await bbb(['eval', fx.url('/stream'), '--json', '--wait', '[data-done]'], 'document.querySelector("[data-done]").textContent')
    expect(r.code).toBe(0)
    expect(r.json().result).toBe('settled')
    expect(Date.now() - started).toBeLessThan(8000)
  }, 20_000)

  // Without --wait it still succeeds rather than failing outright: network idle
  // times out, then it falls back to domcontentloaded plus a settle.
  test('without --wait it falls back instead of failing', async () => {
    const r = await bbb(['text', fx.url('/stream'), '--json', '--timeout', '1500'])
    expect(r.code).toBe(0)
    expect(String(r.json().result)).toContain('streaming')
  }, 20_000)
})

it('run, the escape hatch', () => {
  test('drives puppeteer directly and prints the returned value', async () => {
    const script = join(sc.dir, 'flow.mjs')
    await Bun.write(
      script,
      `export default async ({ page, args, goto }) => {
         await goto(args[0])
         await page.click('h1')
         return { heading: await page.$eval('h1', el => el.textContent), args: args.slice(1) }
       }`,
    )
    const r = await bbb(['--json', 'run', script, fx.url('/'), '--depth', '3'])
    expect(r.code).toBe(0)
    expect(r.json().result).toEqual({ heading: 'static', args: ['--depth', '3'] })
  })

  test('a script with no default export is a setup error', async () => {
    const script = join(sc.dir, 'bad.mjs')
    await Bun.write(script, 'export const x = 1')
    // --json before the script: anything after it belongs to the script.
    const r = await bbb(['--json', 'run', script])
    expect(r.code).toBe(3)
    expect(r.json().error?.message).toContain('no default-exported function')
  })
})

it('the daemon', () => {
  test('serve, auto-attach, then stop', async () => {
    expect((await bbb(['status', '--json'])).json().result).toMatchObject({ running: false })

    const served = await bbb(['serve', '--json'])
    expect(served.code).toBe(0)
    expect(served.json().result).toMatchObject({ alreadyRunning: false })

    expect((await bbb(['status', '--json'])).json().result).toMatchObject({
      running: true,
      mode: 'daemon (session)',
    })

    // No flag was passed: an alive daemon is used automatically.
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('bbb-profile-')).length
    const r = await bbb(['text', fx.url('/'), '--json'])
    expect(r.code).toBe(0)
    const after = readdirSync(tmpdir()).filter(n => n.startsWith('bbb-profile-')).length
    expect(after).toBe(before)

    // The session persists across commands; a cold run would not see this.
    await bbb(['eval', fx.url('/'), '--json'], 'localStorage.setItem("k", "v")')
    expect((await bbb(['eval', fx.url('/'), '--json'], 'localStorage.getItem("k")')).json().result).toBe('v')

    expect((await bbb(['serve', '--json'])).json().result).toMatchObject({ alreadyRunning: true })

    expect((await bbb(['stop', '--json'])).json().result).toMatchObject({ stopped: true })
    expect((await bbb(['status', '--json'])).json().result).toMatchObject({ running: false })
  }, 60_000)

  test('stopping when nothing is running is not an error', async () => {
    const r = await bbb(['stop', '--json'])
    expect(r.code).toBe(0)
    expect(r.json().result).toMatchObject({ pid: null })
  })

  // Cold mode's promise: nothing persists and no process is left behind.
  test('a cold run leaves no profile behind', async () => {
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('bbb-profile-'))
    await bbb(['eval', fx.url('/'), '--json'], 'localStorage.setItem("cold", "1")')
    const r = await bbb(['eval', fx.url('/'), '--json'], 'localStorage.getItem("cold")')
    expect(r.json().result).toBeNull()
    const after = readdirSync(tmpdir()).filter(n => n.startsWith('bbb-profile-'))
    expect(after).toEqual(before)
  }, 30_000)
})
