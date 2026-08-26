import { expect, test } from 'bun:test'
import { BrowseTimeoutError, SetupError, UsageError } from '../../src/pure/errors.ts'

// The exit-code contract is classified by class, not by message text, so the
// classes have to keep their names and their `kind` markers.
test('each error carries its kind and its name', () => {
  const setup = new SetupError('bad input')
  expect(setup).toBeInstanceOf(Error)
  expect(setup.kind).toBe('setup')
  expect(setup.name).toBe('SetupError')
  expect(setup.message).toBe('bad input')

  const timeout = new BrowseTimeoutError('slow')
  expect(timeout.kind).toBe('timeout')
  expect(timeout.name).toBe('BrowseTimeoutError')

  // A usage error is a setup error raised before any browser work is attempted;
  // the CLI prints help for it, so it has to stay distinguishable.
  const usage = new UsageError('no command given')
  expect(usage).toBeInstanceOf(SetupError)
  expect(usage.kind).toBe('setup')
  expect(usage.name).toBe('UsageError')
})
