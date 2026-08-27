/**
 * The HTTP-status half of the output contract.
 *
 * Duplicated verbatim in domdomdom (its `index.ts` exports the same two
 * functions). That is deliberate: the two CLIs publish one exit-code contract
 * and one JSON shape, and a shared package between them would be a third thing
 * to version. Change one, change the other.
 */

/**
 * Is this status one `--fail` should refuse?
 *
 * `curl --fail`'s rule: 2xx passes, everything else does not. A `null` status
 * means no HTTP request happened at all — a `file:`, `data:` or `about:blank`
 * navigation — so there is nothing to fail on and `--fail` is inert.
 */
export function isHttpFailure(status: number | null): boolean {
  return status !== null && (status < 200 || status > 299)
}

/** The message carried by an `http` error. Same wording in both tools. */
export function httpErrorMessage(status: number, url: string): string {
  return `HTTP ${status} for ${url}`
}

/**
 * The status to report for a navigation, given what puppeteer handed back.
 *
 * Two cases have to be nulled rather than passed through:
 *
 * - `page.goto()` returns `null` when the navigation issued no request at all
 *   (a same-document hash change is the documented one; `about:blank` is the
 *   common one).
 * - Chrome *invents* a 200 for `file:` and `data:` URLs. Measured: a local HTML
 *   file comes back `status() === 200`, `ok() === true`. Reporting that would
 *   make `status` mean "did Chrome manage to read this", which is a different
 *   question from the one the field answers, and would let `--fail` pass
 *   judgement on things that were never fetched.
 */
export function statusFromResponse(
  response: { status: () => number; url: () => string } | null,
): number | null {
  if (!response) return null
  return isHttpUrl(response.url()) ? response.status() : null
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
