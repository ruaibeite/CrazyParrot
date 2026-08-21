import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../../src/main/database'
import { CredentialStore } from '../../src/main/credentials'
import { AppSettingsService } from '../../src/main/appSettings'
import { buildOptimizeMessages, ParrotOptimizeService, optimizeInputSchema } from '../../src/main/parrot-ai'
import { AGENT_SECTIONS, README_SECTIONS } from '../../src/main/parrot'
import type { ParrotOptimizeEvent, ProviderProfile } from '../../src/shared/types'

// vitest node 环境没有 Electron 的 safeStorage/app，mock 为对称加解密
vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

const VALID_README = '# Demo\n\n## 项目目标\n- 目标\n\n## 目标用户\n- 开发者\n\n## 核心功能\n- 功能\n\n## 非目标\n- 不做\n\n## 技术栈\n- TS\n\n## 开发命令\n- npm test\n\n## 完成标准\n- 通过\n'
const VALID_AGENTS = '# AGENTS.md\n\n## 开发命令\n- npm test\n\n## 测试要求\n- 运行\n\n## 代码规范\n- 简洁\n\n## 依赖管理\n- 内置\n\n## 受保护路径\n- .env\n\n## 禁止操作\n- 不泄露\n\n## UI 与业务语义\n- 一致\n\n## 完成规则\n- 验证\n'

const provider = (overrides?: Partial<ProviderProfile>): ProviderProfile => ({
  id: 'prov-1', name: 'custom', protocol: 'openai-chat', baseUrl: 'https://example.com/v1', model: 'model-x',
  encryptedCredentialId: 'cred-1', thinkingEnabled: true, reasoningEffort: 'max', maxContext: 128000, taskBudget: 8000, timeoutMs: 5000,inputPricePerMillion:0,outputPricePerMillion:0,
  verifiedAt: new Date().toISOString(), ...overrides
})

/** 仿 provider.test.ts：OpenAI 风格 SSE 响应，内容逐 chunk 推送，usage 可选。 */
const sseResponse = (chunks: string[], usage?: { input: number; output: number }): Response => {
  const events = chunks.map(chunk => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}`)
  if (usage) events.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output } })}`)
  events.push('data: [DONE]')
  return new Response(events.join('\n\n') + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function setup(providerProfile?: ProviderProfile): Promise<{ sent: ParrotOptimizeEvent[]; service: ParrotOptimizeService }> {
  const temp = await mkdtemp(join(tmpdir(), 'cp-parrot-ai-'))
  const project = join(temp, 'project'); await mkdir(project)
  await writeFile(join(project, 'README.md'), VALID_README)
  await writeFile(join(project, 'AGENTS.md'), VALID_AGENTS)
  const db = new AppDatabase(join(temp, 'test.sqlite'))
  const now = new Date().toISOString()
  db.saveProject({ id: 'p1', name: 'demo', path: project, createdAt: now, updatedAt: now, hasGit: false })
  const credentials = new CredentialStore(join(temp, 'credentials.json'))
  if (providerProfile) { db.saveProvider(providerProfile); await credentials.set(providerProfile.encryptedCredentialId, 'secret') }
  const sent: ParrotOptimizeEvent[] = []
  const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel: string, event: ParrotOptimizeEvent) => { sent.push(event) } } }
  return { sent, service: new ParrotOptimizeService(db, credentials, () => fakeWindow, new AppSettingsService(db)) }
}

describe('buildOptimizeMessages', () => {
  it('lists every required README section in the system prompt', () => {
    const system = buildOptimizeMessages('readme', VALID_README, undefined, 'zh')[0]?.content ?? ''
    for (const section of README_SECTIONS) expect(system).toContain(section[0] ?? '')
  })
  it('lists every required AGENTS section in the system prompt', () => {
    const system = buildOptimizeMessages('agents', VALID_AGENTS, undefined, 'zh')[0]?.content ?? ''
    for (const section of AGENT_SECTIONS) expect(system).toContain(section[0] ?? '')
  })
  it('forbids truncation and code fences', () => {
    const system = buildOptimizeMessages('readme', VALID_README, undefined, 'zh')[0]?.content ?? ''
    expect(system).toContain('不得截断'); expect(system).toContain('代码围栏')
    const en = buildOptimizeMessages('readme', VALID_README, undefined, 'en')[0]?.content ?? ''
    expect(en).toContain('Never truncate'); expect(en).toContain('code fences')
  })
  it('includes the instruction and the original text in the user message', () => {
    const messages = buildOptimizeMessages('readme', VALID_README, '补充部署章节', 'zh')
    const user = messages.at(-1)?.content ?? ''
    expect(user).toContain(VALID_README); expect(user).toContain('补充部署章节')
  })
  it('uses the same language style for zh and en', () => {
    expect(buildOptimizeMessages('agents', VALID_AGENTS, undefined, 'zh')[0]?.content).toContain('资深软件文档工程师')
    expect(buildOptimizeMessages('agents', VALID_AGENTS, undefined, 'en')[0]?.content).toContain('senior software documentation engineer')
  })
})

describe('ParrotOptimizeService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('streams text events chunk by chunk and finishes with a clean done event', async () => {
    const { sent, service } = await setup(provider())
    const half = Math.floor(VALID_README.length / 2)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.tools).toEqual([])
      expect(body.messages.some((m: { content: string }) => typeof m.content === 'string' && m.content.includes('# Demo'))).toBe(true)
      return sseResponse([VALID_README.slice(0, half), VALID_README.slice(half)])
    }))
    const { runId } = service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))
    await vi.waitFor(() => expect(sent.some(event => event.type === 'done')).toBe(true), { timeout: 5000 })
    const texts = sent.filter(event => event.type === 'text')
    expect(texts.map(event => (event as Extract<ParrotOptimizeEvent, { type: 'text' }>).text).join('')).toBe(VALID_README)
    const done = sent.at(-1)
    expect(done).toMatchObject({ runId, projectId: 'p1', target: 'readme', type: 'done', truncated: false })
    expect((done as Extract<ParrotOptimizeEvent, { type: 'done' }>).issues).toEqual([])
  })

  it('reports truncation when output usage approaches the limit', async () => {
    const { sent, service } = await setup(provider({ taskBudget: 8000 }))
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['short'], { input: 10, output: 8000 })))
    service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))
    await vi.waitFor(() => expect(sent.some(event => event.type === 'done')).toBe(true), { timeout: 5000 })
    expect((sent.at(-1) as Extract<ParrotOptimizeEvent, { type: 'done' }>).truncated).toBe(true)
  })

  it('emits an error event for an API failure', async () => {
    const { sent, service } = await setup(provider())
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))
    await vi.waitFor(() => expect(sent.some(event => event.type === 'error')).toBe(true), { timeout: 5000 })
    expect((sent.at(-1) as Extract<ParrotOptimizeEvent, { type: 'error' }>).error).toContain('429')
    expect(sent.some(event => event.type === 'done')).toBe(false)
  })

  it('rejects a second run for the same file while one is active', async () => {
    const { service } = await setup(provider())
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => { /* 挂起，保持 active */ })))
    service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))
    expect(() => service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))).toThrow('正在优化中')
  })

  it('requires a verified provider', async () => {
    const { service } = await setup()
    expect(() => service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))).toThrow('必须先配置')
  })

  it('silently skips sending when the window is destroyed', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'cp-parrot-ai-dead-'))
    const project = join(temp, 'project'); await mkdir(project)
    await writeFile(join(project, 'README.md'), VALID_README)
    const db = new AppDatabase(join(temp, 'test.sqlite'))
    const now = new Date().toISOString()
    db.saveProject({ id: 'p1', name: 'demo', path: project, createdAt: now, updatedAt: now, hasGit: false })
    const profile = provider()
    db.saveProvider(profile)
    const credentials = new CredentialStore(join(temp, 'credentials.json'))
    await credentials.set(profile.encryptedCredentialId, 'secret')
    const sent: ParrotOptimizeEvent[] = []
    const service = new ParrotOptimizeService(db, credentials, () => ({ isDestroyed: () => true, webContents: { isDestroyed: () => true, send: (_channel: string, event: ParrotOptimizeEvent) => { sent.push(event) } } }), new AppSettingsService(db))
    const fetchMock = vi.fn(async () => sseResponse(['ok']))
    vi.stubGlobal('fetch', fetchMock)
    service.start(optimizeInputSchema.parse({ projectId: 'p1', target: 'readme', text: VALID_README }))
    // 无窗口可观测信号，等 fetch 被调用（流已启动）再留出处理余量
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 5000 })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(sent).toEqual([])
  })
})
