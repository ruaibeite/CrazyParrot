import { access, chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import type { AppDatabase } from './database'
import { DEFAULT_APPEARANCE } from '../shared/appearance'
import type { AppearanceBackground, AppearanceInput, AppearanceSettings } from '../shared/types'

const SETTING_KEY = 'appearance'
const MAX_BACKGROUND_BYTES = 30 * 1024 * 1024
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export const appearanceInputSchema = z.object({
  theme: z.enum(['dark', 'light']),
  customCss: z.string().max(100_000),
  backgroundOpacity: z.number().min(0).max(100),
  backgroundId: z.string().regex(/^[a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|bmp)$/i).optional()
}).transform(input => ({
  theme: input.theme,
  customCss: input.customCss,
  backgroundOpacity: input.backgroundOpacity,
  ...(input.backgroundId ? { backgroundId: input.backgroundId } : {})
}))

export class AppearanceService {
  private readonly backgroundsDir: string

  constructor(private db: AppDatabase, userDataPath: string) {
    this.backgroundsDir = join(userDataPath, 'appearance-backgrounds')
  }

  private stored(): AppearanceInput {
    const raw = this.db.getSetting(SETTING_KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    try {
      const parsed = appearanceInputSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : { ...DEFAULT_APPEARANCE }
    } catch { return { ...DEFAULT_APPEARANCE } }
  }

  private async toSettings(input: AppearanceInput): Promise<AppearanceSettings> {
    if (!input.backgroundId) return { ...input }
    const path = join(this.backgroundsDir, input.backgroundId)
    try {
      const file = await stat(path)
      if (!file.isFile()) throw new Error('not a file')
      return { ...input, backgroundUrl: pathToFileURL(path).toString() }
    } catch {
      const { backgroundId: _backgroundId, ...rest } = input
      return rest
    }
  }

  async get(): Promise<AppearanceSettings> { return this.toSettings(this.stored()) }

  async save(input: AppearanceInput): Promise<AppearanceSettings> {
    if (input.backgroundId) {
      const target = join(this.backgroundsDir, input.backgroundId)
      const file = await stat(target).catch(() => null)
      if (!file?.isFile()) throw new Error('背景图片不存在，请重新选择')
    }
    const previous = this.stored()
    this.db.saveSetting(SETTING_KEY, JSON.stringify(input))
    if (previous.backgroundId && previous.backgroundId !== input.backgroundId) {
      await rm(join(this.backgroundsDir, previous.backgroundId), { force: true })
    }
    return this.toSettings(input)
  }

  async chooseBackground(window: BrowserWindow | null): Promise<AppearanceBackground | null> {
    const options = {
      title: '选择背景图片',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const source = result.filePaths[0]
    if (result.canceled || !source) return null
    const extension = extname(source).toLowerCase()
    if (!EXTENSIONS.has(extension)) throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 BMP 图片')
    const sourceStat = await stat(source)
    if (!sourceStat.isFile() || sourceStat.size > MAX_BACKGROUND_BYTES) throw new Error('背景图片必须是小于 30 MB 的有效图片文件')
    await mkdir(this.backgroundsDir, { recursive: true })
    const backgroundId = `${crypto.randomUUID()}${extension}`
    const destination = join(this.backgroundsDir, backgroundId)
    await copyFile(source, destination)
    await chmod(destination, 0o600)
    await access(destination)
    return { backgroundId, backgroundUrl: pathToFileURL(destination).toString() }
  }
}
