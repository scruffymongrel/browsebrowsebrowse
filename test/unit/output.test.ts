import { describe, expect, test } from 'bun:test'
import { BrowseTimeoutError, SetupError, UsageError } from '../../src/pure/errors.ts'
import {
  classify,
  exitCodeFor,
  fail,
  ok,
  render,
  renderHuman,
  renderJson,
  toCloneable,
} from '../../src/pure/output.ts'

const LOGS = [
  { level: 'warn' as const, message: 'deprecated' },
  { level: 'log' as const, message: 'hello' },
]

describe('classify', () => {
  test('uses the explicit kind on our own error classes', () => {
    expect(classify(new SetupError('bad')).kind).toBe('setup')
    expect(classify(new UsageError('bad')).kind).toBe('setup')
    expect(classify(new BrowseTimeoutError('slow')).kind).toBe('timeout')
  })

  test("puppeteer's TimeoutError is recognised by name", () => {
    const e = new Error('Navigation timeout of 30000 ms exceeded')
    e.name = 'TimeoutError'
    expect(classify(e).kind).toBe('timeout')
  })

  // The trap this guards: page JS that throws its own "timeout" is an eval
  // error (exit 1) and must not be reported as our exit 2.
  test('never classifies by message text', () => {
    expect(classify(new Error('request timeout')).kind).toBe('eval')
  })

  test('handles non-Error throws', () => {
    expect(classify('kaboom')).toEqual({ kind: 'eval', message: 'kaboom' })
    expect(classify(null)).toEqual({ kind: 'eval', message: 'null' })
  })

  test('carries the stack when there is one', () => {
    expect(classify(new Error('x')).stack).toContain('Error: x')
    const bare = new Error('y')
    bare.stack = ''
    expect(classify(bare).stack).toBeUndefined()
  })
})

describe('exit codes', () => {
  test('mirror domdomdom: 0 ok, 1 eval, 2 timeout, 3 setup', () => {
    expect(exitCodeFor(ok('x'))).toBe(0)
    expect(exitCodeFor(fail(new Error('x')))).toBe(1)
    expect(exitCodeFor(fail(new BrowseTimeoutError('x')))).toBe(2)
    expect(exitCodeFor(fail(new SetupError('x')))).toBe(3)
  })
})

describe('toCloneable', () => {
  test('passes primitives through', () => {
    expect(toCloneable('s')).toBe('s')
    expect(toCloneable(1)).toBe(1)
    expect(toCloneable(true)).toBe(true)
    expect(toCloneable(null)).toBeNull()
  })

  // JSON drops these silently; an agent seeing a missing key cannot tell the
  // difference between "absent" and "unserialisable".
  test('tags the values JSON would drop', () => {
    expect(toCloneable(undefined)).toBe('[undefined]')
    expect(toCloneable(10n)).toBe('[BigInt 10]')
    expect(toCloneable(Symbol('s'))).toBe('[Symbol Symbol(s)]')
    expect(toCloneable(function named() {})).toBe('[Function named]')
    expect(toCloneable(() => {})).toBe('[Function anonymous]')
  })

  test('handles arrays, errors, dates and nesting', () => {
    expect(toCloneable([1, [2]])).toEqual([1, [2]])
    expect(toCloneable(new Error('e'))).toEqual({ name: 'Error', message: 'e' })
    expect(toCloneable(new Date('2026-08-25T00:00:00.000Z'))).toBe('2026-08-25T00:00:00.000Z')
    expect(toCloneable({ a: { b: 1 } })).toEqual({ a: { b: 1 } })
  })

  test('breaks cycles', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(toCloneable(a)).toEqual({ name: 'a', self: '[Circular]' })
  })
})

describe('renderJson', () => {
  test('is exactly one line, with logs attached', () => {
    const r = renderJson(ok({ title: 'x' }, LOGS))
    expect(r.stdout.endsWith('\n')).toBe(true)
    expect(r.stdout.trimEnd().includes('\n')).toBe(false)
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, result: { title: 'x' }, logs: LOGS })
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
  })

  test('failures carry the error and the exit code', () => {
    const r = renderJson(fail(new SetupError('nope'), LOGS))
    expect(JSON.parse(r.stdout).error.kind).toBe('setup')
    expect(r.code).toBe(3)
  })
})

describe('renderHuman', () => {
  // `bbb html url > page.html` has to produce HTML, not a JSON string literal.
  test('strings pass through verbatim', () => {
    expect(renderHuman(ok('<html></html>')).stdout).toBe('<html></html>\n')
    expect(renderHuman(ok('already\n')).stdout).toBe('already\n')
  })

  test('objects are pretty-printed', () => {
    expect(renderHuman(ok({ a: 1 })).stdout).toBe('{\n  "a": 1\n}\n')
  })

  test('nothing is printed for an empty result', () => {
    expect(renderHuman(ok(undefined)).stdout).toBe('')
    expect(renderHuman(ok(null)).stdout).toBe('')
  })

  test('page console output goes to stderr, prefixed', () => {
    expect(renderHuman(ok('x', LOGS)).stderr).toBe('[warn] deprecated\n[log] hello\n')
  })

  test('each error kind gets its own label', () => {
    expect(renderHuman(fail(new BrowseTimeoutError('slow'))).stderr).toContain('TIMEOUT: slow')
    expect(renderHuman(fail(new SetupError('bad'))).stderr).toContain('SETUP ERROR: bad')
    // Eval errors get the stack — that's the one kind where the user's own code
    // is at fault and the line number is the whole answer.
    expect(renderHuman(fail(new Error('boom'))).stderr).toContain('EVAL ERROR: Error: boom')
  })

  test('an eval error with no stack falls back to the message', () => {
    expect(renderHuman(fail('boom')).stderr).toBe('EVAL ERROR: boom\n')
  })

  test('failures print no stdout', () => {
    expect(renderHuman(fail(new SetupError('bad'))).stdout).toBe('')
  })
})

test('render picks the shape from the --json flag', () => {
  expect(render(ok('x'), true).stdout).toBe('{"ok":true,"result":"x","logs":[]}\n')
  expect(render(ok('x'), false).stdout).toBe('x\n')
})
