import { describe, expect, it } from 'vitest'
import { languageFromLocale } from '../../src/shared/locale'

describe('system language',()=>{
  it('uses Chinese for Chinese system locales',()=>{
    expect(languageFromLocale('zh-CN')).toBe('zh')
    expect(languageFromLocale('zh-Hant-TW')).toBe('zh')
  })
  it('falls back to English for other locales',()=>{
    expect(languageFromLocale('en-US')).toBe('en')
    expect(languageFromLocale('ja-JP')).toBe('en')
    expect(languageFromLocale(undefined)).toBe('en')
  })
})
