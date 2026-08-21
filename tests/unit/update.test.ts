import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../../src/main/update'

describe('release version comparison', () => {
  it('compares semantic release tags without treating suffixes as upgrades', () => {
    expect(isNewerVersion('v0.1.5', '0.1.4')).toBe(true)
    expect(isNewerVersion('0.1.4', '0.1.4')).toBe(false)
    expect(isNewerVersion('0.1.3', '0.1.4')).toBe(false)
    expect(isNewerVersion('v1.0.0-beta.1', '0.9.9')).toBe(true)
  })
})
