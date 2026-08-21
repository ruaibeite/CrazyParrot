import { describe, expect, it } from 'vitest'
import { isToolAllowedForMode } from '../../src/main/taskMode'

describe('task mode permissions',()=>{
  it.each(['ask','plan'] as const)('%s only permits read-only tools',mode=>{
    expect(isToolAllowedForMode(mode,'read_file')).toBe(true)
    expect(isToolAllowedForMode(mode,'list_files')).toBe(true)
    expect(isToolAllowedForMode(mode,'search_files')).toBe(true)
    expect(isToolAllowedForMode(mode,'write_file')).toBe(false)
    expect(isToolAllowedForMode(mode,'replace_in_file')).toBe(false)
    expect(isToolAllowedForMode(mode,'run_command')).toBe(false)
  })

  it('Edit permits mutation tools',()=>{
    expect(isToolAllowedForMode('edit','write_file')).toBe(true)
    expect(isToolAllowedForMode('edit','run_command')).toBe(true)
  })
})
