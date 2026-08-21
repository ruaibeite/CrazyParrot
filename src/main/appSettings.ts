import { app } from 'electron'
import { z } from 'zod'
import type { AppLanguagePreference, AppPreferences, HistoryPolicy, TaskPolicy } from '../shared/types'
import { languageFromLocale, type AppLanguage } from '../shared/locale'
import type { AppDatabase } from './database'

const PREFERENCES_KEY = 'app_preferences'
const TASK_POLICY_KEY = 'task_policy'
const HISTORY_POLICY_KEY = 'history_policy'

export const preferencesSchema = z.object({ language: z.enum(['system', 'zh', 'en']) })
export const taskPolicySchema = z.object({
  maxTotalTokens: z.number().int().min(10_000).max(10_000_000),
  maxEstimatedCostUsd: z.number().min(0).max(10_000)
})
export const historyPolicySchema = z.object({ retentionDays: z.number().int().min(1).max(3650) })

const DEFAULT_PREFERENCES: AppPreferences = { language: 'system' }
const DEFAULT_TASK_POLICY: TaskPolicy = { maxTotalTokens: 200_000, maxEstimatedCostUsd: 0 }
const DEFAULT_HISTORY_POLICY: HistoryPolicy = { retentionDays: 180 }

function readSetting<T>(db: AppDatabase, key: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = db.getSetting(key)
  if (!raw) return fallback
  try { const parsed = schema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : fallback } catch { return fallback }
}

export class AppSettingsService {
  constructor(private db: AppDatabase) {}

  preferences(): AppPreferences { return readSetting(this.db, PREFERENCES_KEY, preferencesSchema, DEFAULT_PREFERENCES) }
  savePreferences(input: AppPreferences): AppPreferences { const value = preferencesSchema.parse(input); this.db.saveSetting(PREFERENCES_KEY, JSON.stringify(value)); return value }
  language(): AppLanguage {
    const preference: AppLanguagePreference = this.preferences().language
    return preference === 'system' ? languageFromLocale(app.getLocale()) : preference
  }
  taskPolicy(): TaskPolicy { return readSetting(this.db, TASK_POLICY_KEY, taskPolicySchema, DEFAULT_TASK_POLICY) }
  saveTaskPolicy(input: TaskPolicy): TaskPolicy { const value = taskPolicySchema.parse(input); this.db.saveSetting(TASK_POLICY_KEY, JSON.stringify(value)); return value }
  historyPolicy(): HistoryPolicy { return readSetting(this.db, HISTORY_POLICY_KEY, historyPolicySchema, DEFAULT_HISTORY_POLICY) }
  saveHistoryPolicy(input: HistoryPolicy): HistoryPolicy { const value = historyPolicySchema.parse(input); this.db.saveSetting(HISTORY_POLICY_KEY, JSON.stringify(value)); return value }
}
