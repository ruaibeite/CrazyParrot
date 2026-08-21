import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }))

import { AppSettingsService } from '../../src/main/appSettings'
import { AppDatabase } from '../../src/main/database'

describe('AppSettingsService', () => {
  it('uses a safe default policy and persists explicit language and task limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-settings-'))
    const settings = new AppSettingsService(new AppDatabase(join(root, 'db.sqlite')))
    expect(settings.preferences()).toEqual({ language: 'system' })
    expect(settings.language()).toBe('en')
    expect(settings.taskPolicy()).toEqual({ maxTotalTokens: 200_000, maxEstimatedCostUsd: 0 })
    settings.savePreferences({ language: 'zh' })
    settings.saveTaskPolicy({ maxTotalTokens: 50_000, maxEstimatedCostUsd: 3.5 })
    settings.saveHistoryPolicy({ retentionDays: 30 })
    expect(settings.language()).toBe('zh')
    expect(settings.taskPolicy()).toEqual({ maxTotalTokens: 50_000, maxEstimatedCostUsd: 3.5 })
    expect(settings.historyPolicy()).toEqual({ retentionDays: 30 })
  })
})
