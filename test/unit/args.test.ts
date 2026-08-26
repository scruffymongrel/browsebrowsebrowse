import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_TIMEOUT,
  DEFAULT_VIEWPORT,
  parseCli,
  parseViewport,
  peekVerb,
  resolveViewport,
  tokenize,
} from '../../src/pure/args.ts'
import { UsageError } from '../../src/pure/errors.ts'

describe('tokenize', () => {
  test('separates options from positionals', () => {
    const { options, positionals } = tokenize(['shot', 'https://x', 'out.png', '--full'])
    expect(positionals).toEqual(['shot', 'https://x', 'out.png'])
    expect(options.get('full')).toBe(true)
  })

  test('accepts --name value and --name=value', () => {
    expect(tokenize(['--wait', '#app']).options.get('wait')).toBe('#app')
    expect(tokenize(['--wait=#app']).options.get('wait')).toBe('#app')
  })

  test('-h is the only short flag', () => {
    expect(tokenize(['-h']).options.get('help')).toBe(true)
    expect(() => tokenize(['-x'])).toThrow(UsageError)
  })

  test('a lone dash is a positional, not a flag', () => {
    expect(tokenize(['-']).positionals).toEqual(['-'])
  })

  test('unknown options are refused rather than ignored', () => {
    expect(() => tokenize(['--nope'])).toThrow(/unknown option --nope/)
  })

  test('a boolean flag given a value is a usage error', () => {
    expect(() => tokenize(['--full=yes'])).toThrow(/takes no value/)
  })

  test('a value flag at the end of argv is a usage error', () => {
    expect(() => tokenize(['--wait'])).toThrow(/needs a value/)
  })

  test('-- ends option parsing', () => {
    const { positionals } = tokenize(['run', 's.mjs', '--', '--full'])
    expect(positionals).toEqual(['run', 's.mjs', '--full'])
  })

  // The reason this parser is hand-rolled: `bbb run script --verbose` has to
  // hand --verbose to the script, and a whole-argv parser would reject it.
  test('stopAfter hands the tail through verbatim', () => {
    const { options, positionals } = tokenize(['--json', 'run', 's.mjs', '--verbose', '-q'], 2)
    expect(options.get('json')).toBe(true)
    expect(positionals).toEqual(['run', 's.mjs', '--verbose', '-q'])
  })
})

describe('peekVerb', () => {
  test('finds the verb past leading flags', () => {
    expect(peekVerb(['--json', '--timeout', '5000', 'run', 's.mjs'])).toBe('run')
    expect(peekVerb(['--timeout=5000', 'shot'])).toBe('shot')
  })
  test('handles -- and an empty argv', () => {
    expect(peekVerb(['--', 'run'])).toBe('run')
    expect(peekVerb([])).toBeUndefined()
    expect(peekVerb(['--json'])).toBeUndefined()
  })
})

describe('parseViewport / resolveViewport', () => {
  test('WxH', () => {
    expect(parseViewport('1024x768')).toEqual({ width: 1024, height: 768 })
    expect(parseViewport(' 800X600 ')).toEqual({ width: 800, height: 600 })
  })
  test('anything else is a usage error', () => {
    expect(() => parseViewport('big')).toThrow(/must be WxH/)
  })
  test('defaults when nothing is given', () => {
    expect(resolveViewport(new Map())).toEqual(DEFAULT_VIEWPORT)
  })
  // Both spellings exist for a reason (--w/--h is the frozen `shot` surface,
  // --viewport is the convention shared with domdomdom). Having them disagree
  // silently would be worse than picking a winner.
  test('--w and --h beat --viewport', () => {
    const options = new Map<string, string | true>([
      ['viewport', '1024x768'],
      ['w', '400'],
    ])
    expect(resolveViewport(options)).toEqual({ width: 400, height: 768 })
  })
  test('a non-integer dimension is a usage error', () => {
    expect(() => resolveViewport(new Map([['h', '3.5']]))).toThrow(/non-negative integer/)
    expect(() => resolveViewport(new Map([['h', '-2']]))).toThrow(/non-negative integer/)
  })
})

describe('parseCli', () => {
  test('a page verb with defaults', () => {
    const a = parseCli(['shot', 'https://x', 'o.png'])
    expect(a.verb).toBe('shot')
    expect(a.args).toEqual(['https://x', 'o.png'])
    expect(a.timeout).toBe(DEFAULT_TIMEOUT)
    expect(a.viewport).toEqual(DEFAULT_VIEWPORT)
    expect(a.json).toBe(false)
    expect(a.sub).toBeUndefined()
  })

  test('collects every documented flag', () => {
    const a = parseCli([
      'shot', 'https://x',
      '--json', '--full',
      '--wait', '#app',
      '--timeout', '5000',
      '--viewport', '800x600',
      '--user-agent', 'bot/1',
      '--engine-version', '152.0.7977.64',
      '--port', '9999',
      '--no-install',
    ])
    expect(a).toMatchObject({
      json: true,
      full: true,
      wait: '#app',
      timeout: 5000,
      viewport: { width: 800, height: 600 },
      userAgent: 'bot/1',
      engineVersion: '152.0.7977.64',
      port: 9999,
      noInstall: true,
    })
  })

  test('no argv at all is help, not an error', () => {
    expect(parseCli([]).verb).toBe('help')
    expect(parseCli(['--help']).verb).toBe('help')
  })

  test('flags with no verb are a usage error', () => {
    expect(() => parseCli(['--json'])).toThrow(/no command given/)
  })

  test('an unknown verb lists the real ones', () => {
    expect(() => parseCli(['screenshot'])).toThrow(/unknown command "screenshot"/)
  })

  describe('engine subcommands', () => {
    test('are split off the arguments', () => {
      const a = parseCli(['engine', 'install', 'stable'])
      expect(a).toMatchObject({ verb: 'engine', sub: 'install', args: ['stable'] })
    })
    test('a missing one is a usage error', () => {
      expect(() => parseCli(['engine'])).toThrow(/needs a subcommand/)
    })
    test('an unknown one is a usage error', () => {
      expect(() => parseCli(['engine', 'nuke'])).toThrow(/unknown engine subcommand/)
    })
    test('engine --help is help, not a missing subcommand', () => {
      expect(parseCli(['engine', '--help']).help).toBe(true)
    })
  })

  test('run keeps the script argv intact', () => {
    const a = parseCli(['run', 'crawl.mjs', '--depth', '3', '--json'])
    expect(a.verb).toBe('run')
    // --json after the script belongs to the script, not to bbb.
    expect(a.json).toBe(false)
    expect(a.args).toEqual(['crawl.mjs', '--depth', '3', '--json'])
  })

  test('bbb flags still work before the script', () => {
    const a = parseCli(['--json', 'run', 'crawl.mjs', '--depth', '3'])
    expect(a.json).toBe(true)
    expect(a.args).toEqual(['crawl.mjs', '--depth', '3'])
  })

  test('a bad --timeout is a usage error', () => {
    expect(() => parseCli(['shot', 'x', '--timeout', 'soon'])).toThrow(/non-negative integer/)
  })
})
