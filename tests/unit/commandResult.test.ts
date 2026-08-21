import { describe, expect, it } from 'vitest'
import { commandResultForModel } from '../../src/main/commandResult'

describe('command result handoff', () => {
  it('returns a non-zero exit to the model instead of treating it as a task-level error', () => {
    const result = commandResultForModel({
      command: 'git status',
      exitCode: 128,
      output: 'fatal: not a git repository',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z'
    })

    expect(result).toContain('non-zero exit code')
    expect(result).toContain('Exit code: 128')
    expect(result).toContain('fatal: not a git repository')
    expect(result).toContain('Git is optional')
  })

  it('keeps successful command results distinguishable', () => {
    const result = commandResultForModel({
      command: 'npm test',
      exitCode: 0,
      output: 'all tests passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z'
    })

    expect(result).toContain('completed successfully')
    expect(result).toContain('Exit code: 0')
  })
})
