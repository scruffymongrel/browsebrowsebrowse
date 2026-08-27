// The status/`--fail` decision, and the exit-code contract it feeds.
//
// These are the pure half. Whether Chrome actually reports 404 for a 404 is an
// integration question, and lives in test/integration/http.test.ts against a
// real fixture server — mocking a Response here would prove nothing.
import { describe, expect, test } from 'bun:test'
import { httpErrorMessage, isHttpFailure, statusFromResponse } from '../../src/pure/http.ts'
import { HttpError } from '../../src/pure/errors.ts'
import { classify, exitCodeFor, fail, ok, renderHuman, renderJson } from '../../src/pure/output.ts'
import { parseCli } from '../../src/pure/args.ts'

describe('isHttpFailure', () => {
  test('2xx is not a failure', () => {
    for (const s of [200, 201, 204, 299]) expect(isHttpFailure(s)).toBe(false)
  })

  test('everything else is', () => {
    for (const s of [100, 199, 300, 301, 400, 404, 418, 500, 503]) {
      expect(isHttpFailure(s)).toBe(true)
    }
  })

  // No request happened, so there is nothing to fail on. --fail must be inert
  // rather than fail-closed, or pointing bbb at a local file would break.
  test('null is never a failure', () => {
    expect(isHttpFailure(null)).toBe(false)
  })
})

test('httpErrorMessage names the status and the URL', () => {
  expect(httpErrorMessage(404, 'https://x/y')).toBe('HTTP 404 for https://x/y')
})

describe('statusFromResponse', () => {
  const res = (status: number, url: string) => ({ status: () => status, url: () => url })

  test('an http(s) response reports its status', () => {
    expect(statusFromResponse(res(404, 'http://127.0.0.1:8080/x'))).toBe(404)
    expect(statusFromResponse(res(200, 'https://example.com/'))).toBe(200)
  })

  // page.goto() returns null when the navigation issued no request —
  // about:blank, or a same-document hash change.
  test('a null response is a null status', () => {
    expect(statusFromResponse(null)).toBe(null)
  })

  // Chrome invents a 200 for these. Passing it through would make `status`
  // mean "Chrome could read it", and would let --fail judge a local file.
  test('file: and data: are nulled even though Chrome claims 200', () => {
    expect(statusFromResponse(res(200, 'file:///tmp/page.html'))).toBe(null)
    expect(statusFromResponse(res(200, 'data:text/html,<p>x'))).toBe(null)
    expect(statusFromResponse(res(200, 'about:blank'))).toBe(null)
  })
})

describe('the http error kind', () => {
  test('classify keeps the kind and carries the status through', () => {
    expect(classify(new HttpError(404, 'HTTP 404 for https://x'))).toEqual({
      kind: 'http',
      status: 404,
      message: 'HTTP 404 for https://x',
    })
  })

  // The stack would be bbb's own frames, which say nothing the status and URL
  // don't, and domdomdom's http error carries none either.
  test('no stack is attached, unlike every other kind', () => {
    expect(classify(new HttpError(500, 'x')).stack).toBeUndefined()
    expect(classify(new Error('x')).stack).toBeDefined()
  })

  // Classification is by explicit kind, never by message text — a page whose
  // own JS throws "HTTP 404" is still an eval error.
  test('a lookalike message is still an eval error', () => {
    expect(classify(new Error('HTTP 404 for https://x')).kind).toBe('eval')
  })

  test('a non-Error with a kind still gets its status', () => {
    expect(classify({ kind: 'http', status: 500, message: 'x' })).toEqual({
      kind: 'http',
      status: 500,
      message: '[object Object]',
    })
  })

  test('a non-numeric status is dropped rather than echoed', () => {
    expect(classify({ kind: 'http', status: 'nope' })).toEqual({
      kind: 'http',
      message: '[object Object]',
    })
  })
})

describe('exitCodeFor', () => {
  const codeOf = (kind: string): number =>
    exitCodeFor({ ok: false, error: { kind, message: 'x' } as never, logs: [], status: null })

  test('every kind gets its own diagnostic code', () => {
    expect(exitCodeFor(ok('x'))).toBe(0)
    expect(codeOf('eval')).toBe(1)
    expect(codeOf('timeout')).toBe(2)
    expect(codeOf('setup')).toBe(3)
    expect(codeOf('http')).toBe(4)
  })
})

describe('rendering an http failure', () => {
  const result = fail(new HttpError(404, 'HTTP 404 for https://x'), [], 404)

  test('--json carries status at the top level and inside the error', () => {
    const r = renderJson(result)
    expect(r.code).toBe(4)
    expect(JSON.parse(r.stdout)).toMatchObject({
      ok: false,
      status: 404,
      error: { kind: 'http', status: 404 },
    })
  })

  test('human mode labels it HTTP ERROR and prints no stack', () => {
    const r = renderHuman(result)
    expect(r.code).toBe(4)
    expect(r.stderr).toBe('HTTP ERROR: HTTP 404 for https://x\n')
    expect(r.stdout).toBe('')
  })
})

describe('--fail parsing', () => {
  test('defaults to off — a non-2xx page stays scrapeable', () => {
    expect(parseCli(['html', 'https://x']).fail).toBe(false)
  })

  test('is a boolean flag', () => {
    expect(parseCli(['html', 'https://x', '--fail']).fail).toBe(true)
    expect(parseCli(['--fail', 'eval', 'https://x']).fail).toBe(true)
  })

  test('rejects a value, like the other boolean flags', () => {
    expect(() => parseCli(['html', 'https://x', '--fail=404'])).toThrow('--fail takes no value')
  })
})
