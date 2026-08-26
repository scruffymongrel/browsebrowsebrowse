/**
 * Turning what someone typed into something Chrome will navigate to.
 *
 * Pure — the working directory is passed in rather than read — because the
 * interesting cases are all string cases and none of them need a disk.
 */
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SetupError } from './errors.ts'

/** `https://x`, `file:///x`, `data:...`, `about:blank`. */
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:\/\/|data:|about:|file:|chrome:)/i

/** `./x`, `../x`, `/x` — and on Windows `C:\x`. */
const LOOKS_LIKE_PATH = /^(?:\.\.?[/\\]|[/\\])|^[A-Za-z]:[/\\]/

/**
 * Hosts that are almost certainly a local dev server. Everything else gets
 * https: — defaulting a bare `example.com` to http in 2026 means one wasted
 * redirect at best and a downgraded connection at worst.
 */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local')
  )
}

/** The authority component: everything before the first `/`, `?` or `#`. */
function authorityOf(input: string): string {
  const cut = input.search(/[/?#]/)
  const authority = cut === -1 ? input : input.slice(0, cut)
  const at = authority.lastIndexOf('@')
  const hostPort = at === -1 ? authority : authority.slice(at + 1)
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']')
    return close === -1 ? hostPort : hostPort.slice(0, close + 1)
  }
  const colon = hostPort.indexOf(':')
  return colon === -1 ? hostPort : hostPort.slice(0, colon)
}

/**
 * Accepts a URL, a bare host (`example.com`, `localhost:3000`) or a local file
 * path, and returns something Chrome can be handed.
 *
 * Local paths are supported for parity with domdomdom, where pointing the tool
 * at `./dist/index.html` is the common case.
 */
export function normaliseUrl(input: string, cwd: string): string {
  const raw = input.trim()
  if (!raw) throw new SetupError('need a URL (or a path to a local HTML file)')

  if (HAS_SCHEME.test(raw)) return assertParseable(raw, input)

  if (LOOKS_LIKE_PATH.test(raw)) {
    const abs = isAbsolute(raw) ? raw : resolvePath(cwd, raw)
    return pathToFileURL(abs).href
  }

  const scheme = isLocalHost(authorityOf(raw)) ? 'http' : 'https'
  return assertParseable(`${scheme}://${raw}`, input)
}

function assertParseable(candidate: string, original: string): string {
  try {
    return new URL(candidate).href
  } catch {
    throw new SetupError(`not a usable URL: "${original}"`)
  }
}
