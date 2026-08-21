import { describe, expect, it } from 'vitest'
import { fitMessagesToContext, truncateProjectInstruction } from '../../src/main/contextBudget'

describe('provider context budget',()=>{
  it('keeps the system instruction and latest user turn within the configured context',()=>{
    const result=fitMessagesToContext([
      {role:'system',content:'system'},
      {role:'user',content:'old user'},
      {role:'assistant',content:'x'.repeat(80_000)},
      {role:'user',content:'latest user'}
    ],20_000)
    expect(result.trimmed).toBe(true)
    expect(result.messages[0]).toMatchObject({role:'system'})
    expect(result.messages.at(-1)).toMatchObject({role:'user',content:'latest user'})
    expect(result.messages.some(message=>message.content==='old user')).toBe(false)
  })
  it('truncates oversized project guidance while retaining the ending constraints',()=>{
    const text=`start${'x'.repeat(100)}finish`
    const result=truncateProjectInstruction(text,50)
    expect(result).toContain('start')
    expect(result).toContain('finish')
    expect(result).toContain('已截断')
  })
})
