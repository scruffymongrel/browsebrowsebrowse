/**
 * The three error kinds the CLI can report, as classes.
 *
 * The exit-code contract (0 ok / 1 eval / 2 timeout / 3 setup) is mirrored from
 * domdomdom so the two tools can be driven by the same agent logic. Classifying
 * by an explicit class rather than by sniffing the message is what makes that
 * contract reliable: a page whose own JS throws `new Error('request timeout')`
 * must still exit 1, not 2.
 */

/** Bad input, bad environment, nothing ran. Exit 3. */
export class SetupError extends Error {
  readonly kind = 'setup' as const
  constructor(message: string) {
    super(message)
    this.name = 'SetupError'
  }
}

/** Navigation, selector or script wait exceeded its budget. Exit 2. */
export class BrowseTimeoutError extends Error {
  readonly kind = 'timeout' as const
  constructor(message: string) {
    super(message)
    this.name = 'BrowseTimeoutError'
  }
}

/** Usage error — a SetupError raised before any browser work is attempted. */
export class UsageError extends SetupError {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}
