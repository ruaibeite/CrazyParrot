import { z } from 'zod'
import type { AppDatabase } from './database'
import type { CredentialStore } from './credentials'
import { ProviderClient } from './provider'
import { getParrotStatus, validateParrot, README_SECTIONS, AGENT_SECTIONS } from './parrot'
import type { AppSettingsService } from './appSettings'
import { IPC } from '../shared/ipc'
import type { AgentMessage } from './provider'
import type { ParrotOptimizeEvent, ParrotOptimizeInput, ParrotOptimizeTarget } from '../shared/types'

export const optimizeInputSchema = z.object({
  projectId: z.string().min(1).max(200),
  target: z.enum(['readme', 'agents']),
  text: z.string().max(200_000),
  instruction: z.string().max(2000).optional(),
  providerId: z.string().min(1).max(200).optional()
}).transform(input => ({
  projectId: input.projectId, target: input.target, text: input.text,
  ...(input.instruction ? { instruction: input.instruction } : {}),
  ...(input.providerId ? { providerId: input.providerId } : {})
}))

/** Parrot 文档 AI 优化的系统提示（纯函数，便于单测）。 */
export function buildOptimizeMessages(target: ParrotOptimizeTarget, text: string, instruction: string | undefined, lang: 'zh' | 'en'): AgentMessage[] {
  const sections = target === 'readme' ? README_SECTIONS : AGENT_SECTIONS
  const file = target === 'readme' ? 'README.md' : 'AGENTS.md'
  const headings = sections.map(section => {
    const aliases = section.slice(1).filter(Boolean)
    return aliases.length ? `## ${section[0]}（或"${aliases.join('"、"')}"）` : `## ${section[0]}`
  }).join('\n')
  const system = lang === 'zh'
    ? `你是资深软件文档工程师，负责重写项目 Parrot 文件 ${file} 的完整内容。\n\n必须包含以下全部章节（可调整顺序，不得删减）：\n${headings}\n\n语言：与现有文档语言保持一致（简体中文）。\n\n输出要求：\n1. 输出必须是完整 Markdown 文件内容，不得使用代码围栏包裹，不得添加任何解释性文字。\n2. 不得截断、不得使用省略号代替内容，所有章节都必须有实际内容。\n3. 用户提供的优化指令优先级最高；没有指令时，在保持现有内容的基础上完善、精炼并补全缺失章节。\n4. 保持与项目实际相符，不要凭空捏造不存在的功能或命令。`
    : `You are a senior software documentation engineer rewriting the complete content of the project Parrot file ${file}.\n\nYou MUST include all of the following sections (order may vary, but none may be omitted):\n${headings}\n\nLanguage: match the existing document's language (English).\n\nOutput rules:\n1. Output the complete Markdown file content only — no code fences, no explanatory text.\n2. Never truncate; never use ellipses to replace content; every section must contain real content.\n3. The user's optimization instruction takes priority; without one, refine, tighten and fill in missing sections while keeping existing content.\n4. Stay faithful to the actual project — do not invent features or commands that do not exist.`
  const user = `当前 ${file} 全文：\n${text}${instruction ? `\n\n优化指令：${instruction}` : ''}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

interface SenderWindow { isDestroyed(): boolean; webContents: { isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void } }

/**
 * AI 优化 Parrot 文档的流式服务。
 * 复用 ProviderClient（无状态、空 tools 已由 compact 验证）；事件经 webContents.send 推给 renderer。
 * 注意：ProviderClient 无外部取消能力，丢弃后旧流仍会跑完、消耗 token，但 renderer 会按 runId 屏蔽事件。
 */
export class ParrotOptimizeService {
  private readonly active = new Map<string, string>()
  constructor(private db: AppDatabase, private credentials: CredentialStore, private window: () => SenderWindow | null, private settings: AppSettingsService) {}

  start(input: ParrotOptimizeInput): { runId: string } {
    const project = this.db.getProject(input.projectId)
    if (!project) throw new Error('项目不存在')
    const provider = input.providerId ? this.db.getProvider(input.providerId) : this.db.listProviders().find(p => p.verifiedAt)
    if (!provider?.verifiedAt) throw new Error('必须先配置并成功测试模型连接')
    const key = `${input.projectId}:${input.target}`
    if (this.active.has(key)) throw new Error('该文件正在优化中')
    const runId = crypto.randomUUID()
    this.active.set(key, runId)
    void this.run(input, provider, runId, project.parrotApprovedHash).catch(error => {
      this.send({ runId, projectId: input.projectId, target: input.target, type: 'error', error: (error as Error).message })
    }).finally(() => { this.active.delete(key) })
    return { runId }
  }

  private async run(input: ParrotOptimizeInput, provider: NonNullable<ReturnType<AppDatabase['getProvider']>>, runId: string, approvedHash: string | undefined): Promise<void> {
    const key = await this.credentials.get(provider.encryptedCredentialId)
    const client = new ProviderClient(provider, key)
    const lang = this.settings.language()
    const messages = buildOptimizeMessages(input.target, input.text, input.instruction, lang)
    let output = ''
    let lastUsage: { output: number } | undefined
    await client.complete(messages, [], event => {
      if (event.type === 'text' && event.text) { output += event.text; this.send({ runId, projectId: input.projectId, target: input.target, type: 'text', text: event.text }) }
      if (event.type === 'usage' && event.usage) lastUsage = event.usage
    })
    const current = await getParrotStatus(this.db, input.projectId)
    const other = input.target === 'readme' ? current.agents : current.readme
    const result = validateParrot(input.target === 'readme' ? output : other, input.target === 'agents' ? output : other, approvedHash)
    const outputLimit = Math.min(provider.taskBudget, provider.protocol === 'anthropic-messages' ? 16384 : provider.taskBudget)
    const truncated = Boolean(lastUsage && lastUsage.output >= outputLimit * 0.98)
    this.send({ runId, projectId: input.projectId, target: input.target, type: 'done', issues: result.issues, truncated })
  }

  private send(event: ParrotOptimizeEvent): void {
    const win = this.window()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.PARROT_AI_OPTIMIZE_EVENT, event)
  }
}
