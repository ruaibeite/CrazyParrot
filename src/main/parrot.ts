import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from './database'
import type { ComplianceViolation, ParrotAudit, ParrotAuditIssue, ParrotAuditLevel, ParrotDraftInput, ParrotIssue, ParrotStatus, ProjectParrot } from '../shared/types'

export const README_SECTIONS = [
  ['项目目标','目标'],['目标用户','用户'],['核心功能','功能'],['非目标','不做'],['技术栈','技术'],['开发命令','启动'],['完成标准','验收']
]
export const AGENT_SECTIONS = [
  ['开发命令','命令'],['测试要求','测试'],['代码规范','规范'],['依赖管理','依赖'],['受保护路径','保护'],['禁止操作','禁止'],['UI 与业务语义','业务语义'],['完成规则','完成']
]

export function contentHash(readme:string,agents:string):string {
  return createHash('sha256').update(readme.replace(/\r\n/g,'\n').trim()).update('\0').update(agents.replace(/\r\n/g,'\n').trim()).digest('hex')
}

function sectionIssues(file:'README.md'|'AGENTS.md',text:string,groups:string[][]):ParrotIssue[] {
  if (!text.trim()) return [{file,message:`${file} 不能为空`,severity:'error'}]
  return missingSections(text,groups).map(section=>({file,section,message:`缺少“${section}”章节`,severity:'error' as const}))
}

/** 缺失章节主名列表（validateParrot 与 auditParrot 共用，防校验/评分口径分裂）。 */
export function missingSections(text:string,groups:string[][]):string[] {
  return groups.filter(group=>!group.some(name=>new RegExp(`^#{1,4}\\s+.*${name}`,'mi').test(text))).map(group=>group[0]??'必填')
}

const bullets=(section:string)=>section.split('\n').map(v=>v.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean)
function extract(text:string,names:string[]):string[] {
  const headings=[...text.matchAll(/^#{1,4}\s+(.+)$/gm)]
  const found=headings.find(h=>names.some(n=>h[1]?.includes(n)))
  if (!found || found.index===undefined) return []
  const start=found.index+found[0].length
  const next=headings.find(h=>(h.index??0)>start)
  return bullets(text.slice(start,next?.index??text.length))
}

export function parseParrot(readme:string,agents:string,version=''):ProjectParrot {
  const commandLines=[...extract(readme,['开发命令','启动']),...extract(agents,['开发命令'])]
  return {
    goals:extract(readme,['项目目标','目标']), nonGoals:extract(readme,['非目标','不做']),
    stack:extract(readme,['技术栈','技术']),
    commands:commandLines.map((line,i)=>({name:`命令 ${i+1}`,command:line.replace(/^`|`$/g,'')})),
    constraints:[...extract(agents,['代码规范']),...extract(agents,['禁止操作']),...extract(agents,['UI 与业务语义','业务语义'])],
    protectedPaths:extract(agents,['受保护路径','保护']),
    acceptanceRules:[...extract(readme,['完成标准','验收']),...extract(agents,['完成规则'])],
    approvedVersion:version
  }
}

export function validateParrot(readme:string,agents:string,approvedHash?:string):ParrotStatus {
  const hash=contentHash(readme,agents)
  const issues=[...sectionIssues('README.md',readme,README_SECTIONS),...sectionIssues('AGENTS.md',agents,AGENT_SECTIONS)]
  if (/不需要测试|禁止测试/i.test(agents) && /必须测试|运行测试/i.test(agents)) issues.push({file:'parrot',message:'测试规则存在互相冲突的描述',severity:'error'})
  const parrot=parseParrot(readme,agents,approvedHash===hash?hash:'')
  if (!parrot.commands.length) issues.push({file:'parrot',message:'至少需要填写一条开发或测试命令',severity:'warning'})
  return {valid:!issues.some(i=>i.severity==='error'),approved:approvedHash===hash,currentHash:hash,...(approvedHash?{approvedHash}:{}),issues,parrot,readme,agents}
}

async function readOrEmpty(path:string):Promise<string> { try{return await readFile(path,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw e} }
export async function getParrotStatus(db:AppDatabase,projectId:string):Promise<ParrotStatus> {
  const project=db.getProject(projectId); if(!project) throw new Error('项目不存在')
  return validateParrot(await readOrEmpty(join(project.path,'README.md')),await readOrEmpty(join(project.path,'AGENTS.md')),project.parrotApprovedHash)
}
export async function saveParrot(db:AppDatabase,projectId:string,readme:string,agents:string):Promise<ParrotStatus> {
  const project=db.getProject(projectId); if(!project) throw new Error('项目不存在')
  await writeFile(join(project.path,'README.md'),readme,'utf8'); await writeFile(join(project.path,'AGENTS.md'),agents,'utf8')
  return getParrotStatus(db,projectId)
}
export async function approveParrot(db:AppDatabase,projectId:string):Promise<ParrotStatus> {
  const status=await getParrotStatus(db,projectId); if(!status.valid) throw new Error('项目 Parrot 仍有必填项缺失')
  db.approveParrot(projectId,status.currentHash,status.readme,status.agents)
  return getParrotStatus(db,projectId)
}

export function generateParrotDraft(i:ParrotDraftInput):{readme:string;agents:string} {
  const list=(v:string,fallback:string)=>v.split(/\n|,/).map(x=>x.trim()).filter(Boolean).map(x=>`- ${x}`).join('\n')||`- ${fallback}`
  const readme=`# ${i.name}\n\n## 项目目标\n${list(i.goals,'请填写项目目标')}\n\n## 目标用户\n${list(i.audience,'请填写目标用户')}\n\n## 核心功能\n${list(i.features,'请填写核心功能')}\n\n## 非目标\n${list(i.nonGoals,'请填写首版明确不做的内容')}\n\n## 技术栈\n${list(i.stack,'请填写技术栈')}\n\n## 开发命令\n${list(i.commands,'请填写启动、构建与测试命令')}\n\n## 完成标准\n- 功能符合上述范围\n- 相关测试通过\n- 不遗留未经说明的风险\n`
  const agents=`# AGENTS.md\n\n## 开发命令\n${list(i.commands,'请填写开发和测试命令')}\n\n## 测试要求\n- 修改后运行受影响范围的测试\n- 无法测试时必须说明原因和人工验证步骤\n\n## 代码规范\n${list(i.constraints,'遵循现有代码风格，保持改动聚焦')}\n\n## 依赖管理\n- 添加生产依赖前必须获得用户批准\n- 优先复用项目现有依赖\n\n## 受保护路径\n- .env\n- *.key\n- *.pem\n\n## 禁止操作\n- 不得泄露或提交凭据\n- 不得执行破坏性 Git 命令\n- 不得访问项目目录之外的文件\n\n## UI 与业务语义\n- 保持现有产品语义和视觉行为，除非任务明确要求改变\n\n## 完成规则\n- 提供实际文件变更、命令退出码和测试结果\n- 变更不得违反 README 与本文件的约束\n`
  return {readme,agents}
}

/** 受保护路径匹配（与 agent.ts assertWritable 同口径，pattern 清洗整体搬移防漂移）。 */
export const DEFAULT_PROTECTED_PATTERNS = ['.env', '.env.local', '.env.production', '*.key', '*.pem', '*.p12']
export function isProtectedMatch(normalizedPath: string, pattern: string): boolean {
  const normalized = pattern.replace(/^`|`$/g, '').trim().replaceAll('\\', '/')
  if (!normalized) return false
  return normalized.startsWith('*.')
    ? normalizedPath.endsWith(normalized.slice(1))
    : normalizedPath === normalized || normalizedPath.startsWith(`${normalized.replace(/\/$/, '')}/`)
}

/** 任务改动 vs 当前 Parrot 的合规校验：受保护路径命中 + 未批准时改动 Parrot 文件。 */
export function checkCompliance(parrot: ProjectParrot, approved: boolean, paths: string[]): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  for (const raw of paths) {
    const path = raw.replaceAll('\\', '/')
    for (const pattern of [...DEFAULT_PROTECTED_PATTERNS, ...parrot.protectedPaths]) {
      if (isProtectedMatch(path, pattern)) { violations.push({ path, reason: 'protected', message: `路径 ${path} 受项目 Parrot 保护，Agent 不得写入` }); break }
    }
    if (!approved && (path === 'README.md' || path === 'AGENTS.md')) violations.push({ path, reason: 'unapproved-parrot-change', message: `${path} 属于 Parrot 文件，当前 Parrot 未确认` })
  }
  return violations
}

const PLACEHOLDER_RE = /(请填写|请补充|待补充|待完善|待定|TODO|FIXME|TBD|xxx|举例|示例|placeholder|for example|e\.g\.)/i
const COMMENT_COMMAND_RE = /^\s*(#|\/\/|;)/
const TEST_BAN_RE = /不需要测试|禁止测试/i
const TEST_REQ_RE = /必须测试|运行测试/i

/** Parrot 体检：100 分制健康度评分，全正则+计数，deterministic。 */
export function auditParrot(readme: string, agents: string): ParrotAudit {
  const issues: ParrotAuditIssue[] = []
  const docs: Array<['README.md' | 'AGENTS.md', string[][]]> = [['README.md', README_SECTIONS], ['AGENTS.md', AGENT_SECTIONS]]
  const docText = (file: 'README.md' | 'AGENTS.md') => file === 'README.md' ? readme : agents
  const emptyDoc = !readme.trim() && !agents.trim()

  // 章节完整性 30：每缺一章 -2
  const missing: Array<{ file: string; section: string }> = []
  for (const [file, groups] of docs) {
    const gone = docText(file).trim() ? missingSections(docText(file), groups) : groups.map(group => group[0] ?? '必填')
    gone.forEach(section => missing.push({ file, section }))
  }
  const sectionsScore = Math.max(0, 30 - 2 * missing.length)
  missing.forEach(m => issues.push({ item: 'sections', message: `缺少“${m.section}”章节`, suggestion: `在 ${m.file} 中添加“${m.section}”章节` }))

  // 内容质量 25：占位符 bullet 每条 -3；单 bullet 章节（内容过薄）每个 -2
  let placeholderBullets = 0, thinSections = 0
  for (const [file, groups] of docs) {
    for (const group of groups) {
      const items = extract(docText(file), group)
      placeholderBullets += items.filter(bullet => PLACEHOLDER_RE.test(bullet)).length
      if (items.length === 1) thinSections++
    }
  }
  const qualityScore = emptyDoc ? 0 : Math.max(0, 25 - 3 * placeholderBullets - 2 * thinSections)
  if (placeholderBullets) issues.push({ item: 'quality', message: `${placeholderBullets} 条内容含占位符（请填写/TODO 等）`, suggestion: '补充具体内容，移除占位词' })
  if (thinSections) issues.push({ item: 'quality', message: `${thinSections} 个章节仅有一行内容`, suggestion: '为关键章节补充细节' })

  // 命令可执行性 20：无命令 -20；命令含占位符或为注释行每条 -4（按去重后的唯一命令计）
  const uniqueCommands = [...new Set(parseParrot(readme, agents).commands.map(command => command.command))]
  let commandDeduct = 0
  if (!uniqueCommands.length) commandDeduct = 20
  else for (const command of uniqueCommands) if (!command || PLACEHOLDER_RE.test(command) || COMMENT_COMMAND_RE.test(command)) commandDeduct += 4
  const commandsScore = Math.max(0, 20 - commandDeduct)
  if (!uniqueCommands.length) issues.push({ item: 'commands', message: '没有任何开发或测试命令', suggestion: '在 README 的“开发命令”中填写可执行命令，如 npm test' })

  // 保护力度 15：无用户受保护路径 -10；禁止操作章节空 -5
  const protectedPaths = parseParrot(readme, agents).protectedPaths
  const bannedOps = extract(agents, ['禁止操作'])
  const protectionScore = Math.max(0, 15 - (protectedPaths.length === 0 ? 10 : 0) - (bannedOps.length === 0 ? 5 : 0))
  if (!protectedPaths.length) issues.push({ item: 'protection', message: '未声明任何受保护路径', suggestion: '在 AGENTS.md“受保护路径”中列出 .env、密钥文件等' })
  if (!bannedOps.length) issues.push({ item: 'protection', message: '“禁止操作”章节为空', suggestion: '写明不得执行的操作，如提交凭据、破坏性 Git 命令' })

  // 测试要求 10：缺失 -6；占位 -4；规则矛盾 -10（可叠加，clamp）
  const testBullets = extract(agents, ['测试要求'])
  let testDeduct = 0
  if (!testBullets.length) testDeduct += 6
  if (testBullets.some(bullet => PLACEHOLDER_RE.test(bullet))) testDeduct += 4
  const testConflict = TEST_BAN_RE.test(agents) && TEST_REQ_RE.test(agents)
  if (testConflict) testDeduct += 10
  const testsScore = emptyDoc ? 0 : Math.max(0, 10 - testDeduct)
  if (testConflict) issues.push({ item: 'tests', message: '测试规则存在互相冲突的描述', suggestion: '统一为“必须测试”或明确说明不测试的原因' })

  const score = Math.min(100, sectionsScore + qualityScore + commandsScore + protectionScore + testsScore)
  const level: ParrotAuditLevel = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor'
  return { score, level, items: [
    { key: 'sections', score: sectionsScore, max: 30 },
    { key: 'quality', score: qualityScore, max: 25 },
    { key: 'commands', score: commandsScore, max: 20 },
    { key: 'protection', score: protectionScore, max: 15 },
    { key: 'tests', score: testsScore, max: 10 }
  ], issues }
}
