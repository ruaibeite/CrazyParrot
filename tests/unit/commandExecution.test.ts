import { describe, expect, it } from 'vitest'
import { buildCommandEnvironment, commandStartFailureMessage } from '../../src/main/commandExecution'

describe('command execution environment', () => {
  it('keeps only string environment values before passing them to node-pty', () => {
    const environment = buildCommandEnvironment({ PATH: undefined, SAFE: 'value', EMPTY: undefined })

    expect(environment).toMatchObject({ SAFE: 'value', TERM: 'xterm-256color' })
    expect(environment.PATH).toContain('/usr/bin')
    expect(Object.values(environment).every(value => typeof value === 'string')).toBe(true)
  })

  it('keeps a useful launch error for the fallback command result', () => {
    expect(commandStartFailureMessage(new Error('posix_spawnp failed'))).toBe('posix_spawnp failed')
  })
})
