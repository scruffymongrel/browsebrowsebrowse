// HTTP status reporting, `--fail`, and the streaming shape the skill used to
// describe wrongly.
//
// Against a real engine and a real socket. The pure decision logic is unit
// tested; what needs Chrome is whether Chrome tells us the truth — in
// particular that a 302 chain reports the *destination's* status, and that a
// `file:` URL's invented 200 gets nulled before it reaches the output.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, type CliIO } from '../subject.ts'
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
  json: () => any
}

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

it('status in the output', () => {
  test('a 200 reports 200', async () => {
    const r = await bbb(['text', fx.url('/'), '--json'])
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, status: 200 })
  }, 30_000)

  // The regression that motivated the field: a 404 used to be indistinguishable
  // from a success. It is still ok:true — a not-found page is a page — but the
  // status now says so.
  test('a 404 is still ok:true and exit 0, but says 404', async () => {
    const r = await bbb(['eval', fx.url('/404'), '--json'], 'document.title')
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, result: 'not found', status: 404 })
  }, 30_000)

  test('a 500 says 500', async () => {
    const r = await bbb(['text', fx.url('/500'), '--json'])
    expect(r.json()).toMatchObject({ ok: true, status: 500 })
  }, 30_000)

  test('a 302 chain reports the FINAL status, not the redirect', async () => {
    const r = await bbb(['eval', fx.url('/redirect'), '--json'], 'document.title')
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, result: 'Fixture', status: 200 })
  }, 30_000)

  test('a 302 that lands on a 404 reports 404', async () => {
    const r = await bbb(['text', fx.url('/redirect-to-404'), '--json'])
    expect(r.json()).toMatchObject({ status: 404 })
  }, 30_000)

  // Chrome hands back status 200 for a file: URL. Reporting it would make
  // `status` answer a different question from the one it claims to.
  test('a local file reports null, not the 200 Chrome invents', async () => {
    const path = join(sc.dir, 'local.html')
    writeFileSync(path, '<!doctype html><title>local</title><body>local</body>')
    const r = await bbb(['eval', path, '--json'], 'document.title')
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, result: 'local', status: null })
  }, 30_000)

  test('status survives onto a failure', async () => {
    const r = await bbb(['eval', fx.url('/404'), '--json'], 'throw new Error("nope")')
    expect(r.code).toBe(1)
    expect(r.json()).toMatchObject({ ok: false, status: 404, error: { kind: 'eval' } })
  }, 30_000)

  // Verbs that never navigate still carry the key, so the shape is one shape.
  test('a non-navigating verb reports null', async () => {
    const r = await bbb(['status', '--json'])
    expect(r.json()).toMatchObject({ ok: true, status: null })
  }, 30_000)
})

it('--fail', () => {
  test('a 404 becomes exit 4 with an http error', async () => {
    const r = await bbb(['eval', fx.url('/404'), '--json', '--fail'], 'document.title')
    expect(r.code).toBe(4)
    expect(r.json()).toMatchObject({
      ok: false,
      status: 404,
      error: { kind: 'http', status: 404, message: `HTTP 404 for ${fx.url('/404')}` },
    })
  }, 30_000)

  test('a 500 becomes exit 4', async () => {
    const r = await bbb(['text', fx.url('/500'), '--json', '--fail'])
    expect(r.code).toBe(4)
    expect(r.json().error.status).toBe(500)
  }, 30_000)

  test('a 2xx is untouched', async () => {
    const r = await bbb(['eval', fx.url('/'), '--json', '--fail'], 'document.title')
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, status: 200 })
  }, 30_000)

  test('a 302 -> 200 chain is untouched', async () => {
    const r = await bbb(['text', fx.url('/redirect'), '--json', '--fail'])
    expect(r.code).toBe(0)
    expect(r.json().status).toBe(200)
  }, 30_000)

  // Failing fast is the point: the user's JS must not run on a bad status.
  test('the page JS is never evaluated on a non-2xx', async () => {
    const r = await bbb(
      ['eval', fx.url('/404'), '--json', '--fail'],
      'throw new Error("this must not run")',
    )
    expect(r.code).toBe(4)
    expect(r.json().error.kind).toBe('http')
  }, 30_000)

  test('has no effect on a local file, which has no status to fail on', async () => {
    const path = join(sc.dir, 'nofail.html')
    writeFileSync(path, '<!doctype html><title>nofail</title>')
    const r = await bbb(['eval', path, '--json', '--fail'], 'document.title')
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, result: 'nofail', status: null })
  }, 30_000)

  test('human mode labels it HTTP ERROR on stderr', async () => {
    const r = await bbb(['text', fx.url('/404'), '--fail'])
    expect(r.code).toBe(4)
    expect(r.stderr).toContain('HTTP ERROR: HTTP 404 for')
    expect(r.stdout).toBe('')
  }, 30_000)
})

// The skill claimed an SSE page "burns the whole --timeout". It does not, and
// believing that is worse than not knowing: an agent told it will notice a
// problem stops checking for one.
it('streaming pages fail fast and quietly, not slowly', () => {
  test('without --wait an SSE page returns ok:true with nothing, quickly', async () => {
    const started = Date.now()
    const r = await bbb(
      ['eval', fx.url('/sse'), '--json', '--timeout', '15000'],
      'document.querySelectorAll("li").length',
    )
    const elapsed = Date.now() - started
    expect(r.code).toBe(0)
    // ok:true, a short count, and nowhere near the 15s timeout. That is the
    // failure mode: fast, successful-looking, and wrong. How short depends on
    // where the idle window lands relative to the event cadence — which is
    // exactly why an agent cannot spot it from the output.
    expect(r.json().ok).toBe(true)
    expect(r.json().result).toBeLessThan(5)
    expect(elapsed).toBeLessThan(10_000)
  }, 40_000)

  test('with --wait it gets all five items', async () => {
    const r = await bbb(
      ['eval', fx.url('/sse'), '--json', '--timeout', '15000', '--wait', '[data-done]'],
      'document.querySelectorAll("li").length',
    )
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ ok: true, result: 5 })
  }, 40_000)
})
