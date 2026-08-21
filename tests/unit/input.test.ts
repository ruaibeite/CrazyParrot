import { describe, expect, it } from 'vitest'
import { shouldSubmitPrompt } from '../../src/shared/input'

describe('prompt keyboard behavior',()=>{
  it('uses Enter to send and Shift+Enter for a newline',()=>{
    expect(shouldSubmitPrompt('Enter',false,false)).toBe(true)
    expect(shouldSubmitPrompt('Enter',true,false)).toBe(false)
    expect(shouldSubmitPrompt('Enter',false,true)).toBe(false)
    expect(shouldSubmitPrompt('a',false,false)).toBe(false)
  })
})
