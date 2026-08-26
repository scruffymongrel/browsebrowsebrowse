import { describe, expect, test } from 'bun:test'
import { SetupError } from '../../src/pure/errors.ts'
import { normaliseUrl } from '../../src/pure/url.ts'

const CWD = '/work/site'

describe('already a URL', () => {
  test('passes through', () => {
    expect(normaliseUrl('https://example.com/a?b=1#c', CWD)).toBe('https://example.com/a?b=1#c')
    expect(normaliseUrl('http://example.com/', CWD)).toBe('http://example.com/')
  })
  test('non-http schemes are left alone', () => {
    expect(normaliseUrl('about:blank', CWD)).toBe('about:blank')
    expect(normaliseUrl('file:///tmp/x.html', CWD)).toBe('file:///tmp/x.html')
    expect(normaliseUrl('data:text/html,<h1>hi</h1>', CWD)).toBe('data:text/html,<h1>hi</h1>')
  })
})

describe('bare hosts', () => {
  // Defaulting a public host to http in 2026 means a wasted redirect at best
  // and a downgraded connection at worst.
  test('get https', () => {
    expect(normaliseUrl('example.com', CWD)).toBe('https://example.com/')
    expect(normaliseUrl('example.com/deep/path', CWD)).toBe('https://example.com/deep/path')
    expect(normaliseUrl('user:pw@example.com/x', CWD)).toBe('https://user:pw@example.com/x')
  })

  // ...but a dev server on localhost almost never speaks TLS.
  test('local hosts get http', () => {
    expect(normaliseUrl('localhost:3000', CWD)).toBe('http://localhost:3000/')
    expect(normaliseUrl('127.0.0.1:8080/x', CWD)).toBe('http://127.0.0.1:8080/x')
    expect(normaliseUrl('0.0.0.0:1234', CWD)).toBe('http://0.0.0.0:1234/')
    expect(normaliseUrl('app.localhost:5173', CWD)).toBe('http://app.localhost:5173/')
    expect(normaliseUrl('printer.local', CWD)).toBe('http://printer.local/')
    expect(normaliseUrl('[::1]:9000', CWD)).toBe('http://[::1]:9000/')
  })

  test('an unterminated IPv6 literal does not hang or throw the wrong error', () => {
    expect(() => normaliseUrl('[::1', CWD)).toThrow(SetupError)
  })
})

describe('local files', () => {
  // Parity with domdomdom, where pointing the tool at ./dist/index.html is the
  // common case.
  test('relative paths become file: URLs against the cwd', () => {
    expect(normaliseUrl('./dist/index.html', CWD)).toBe('file:///work/site/dist/index.html')
    expect(normaliseUrl('../other/x.html', CWD)).toBe('file:///work/other/x.html')
  })
  test('absolute paths are used as-is', () => {
    expect(normaliseUrl('/tmp/page.html', CWD)).toBe('file:///tmp/page.html')
  })
})

describe('rejections', () => {
  test('empty input', () => {
    expect(() => normaliseUrl('   ', CWD)).toThrow(SetupError)
  })
  test('garbage that cannot be a host', () => {
    expect(() => normaliseUrl('http://', CWD)).toThrow(/not a usable URL/)
  })
})
