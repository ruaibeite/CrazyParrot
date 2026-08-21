import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE } from '../../src/shared/appearance'
import { appearanceInputSchema } from '../../src/main/appearance'

describe('appearance preferences', () => {
  it('uses a dark, image-free default appearance', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ theme: 'dark', customCss: '', backgroundOpacity: 18 })
  })

  it('keeps a valid background id and rejects paths', () => {
    const backgroundId = '27ba5d0f-6c2a-4cf5-9bda-b0a0ebd8e6ff.webp'
    expect(appearanceInputSchema.parse({ theme: 'light', customCss: '.app-shell{}', backgroundOpacity: 48, backgroundId })).toEqual({ theme: 'light', customCss: '.app-shell{}', backgroundOpacity: 48, backgroundId })
    expect(appearanceInputSchema.safeParse({ theme: 'dark', customCss: '', backgroundOpacity: 18, backgroundId: '../../secret.png' }).success).toBe(false)
  })

  it('omits an empty optional background id', () => {
    expect(appearanceInputSchema.parse({ theme: 'dark', customCss: '', backgroundOpacity: 0, backgroundId: undefined })).toEqual({ theme: 'dark', customCss: '', backgroundOpacity: 0 })
  })
})
