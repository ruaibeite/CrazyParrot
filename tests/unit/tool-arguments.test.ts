import { describe, expect, it } from 'vitest'
import { parseToolArguments } from '../../src/main/agent'

describe('agent tool arguments',()=>{
  it('accepts a fenced JSON object from a provider',()=>{
    expect(parseToolArguments('```json\n{"path":"index.html"}\n```')).toEqual({path:'index.html'})
  })
  it('rejects malformed or non-object arguments for retry',()=>{
    expect(()=>parseToolArguments('{"path":')).toThrow()
    expect(()=>parseToolArguments('[]')).toThrow('JSON object')
  })
})
