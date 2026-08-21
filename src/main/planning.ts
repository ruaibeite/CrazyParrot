import { classifyCommand, classifyTask } from './security'
import type { ProjectParrot, RiskLevel, TaskPlan } from '../shared/types'

const PARROT_FILE_EDIT_RE=/(?:\b(?:更新|修改|编辑|完善|补充|重写|创建)\s*(?:项目)?(?:readme|agents)\.md\b|(?:更新|修改|编辑|完善|补充|重写|创建)\s*(?:项目)?(?:README|AGENTS)\.md\b|\b(?:readme|agents)\.md\s*(?:也要|需要|一并|同时|同步)?\s*(?:更新|修改|编辑|完善|补充|重写)\b|(?:更新|修改|编辑|完善|补充|重写|创建)\s*(?:项目|开发)?文档|文档同步|同步(?:更新|修改)文档|\b(?:update|edit|rewrite)\s+(?:the\s+)?(?:readme|agents)(?:\.md)?\b|\b(?:update|edit|rewrite)\s+(?:the\s+)?(?:project\s+)?documentation\b)/i
const UI_TASK_RE=/(?:\b(?:ui|ux|html|css|scss|tsx|jsx|vue)\b|界面|页面|样式|视觉|布局|按钮|侧边栏|顶部|编辑器|对话栏|菜单)/i

/** Governance documents require explicit user intent, not inferred documentation sync. */
export function allowsParrotFileEdits(prompt:string):boolean { return PARROT_FILE_EDIT_RE.test(prompt) }

export function buildTaskPlan(prompt:string,parrot:ProjectParrot):TaskPlan {
  const quoted=[...prompt.matchAll(/`([^`]+)`/g)].map(m=>m[1]??'').filter(Boolean)
  const pathLike=[...prompt.matchAll(/(?:^|\s)([\w@.-]+(?:\/[\w@. -]+)+\.[\w]+|[\w@.-]+\.(?:ts|tsx|js|jsx|vue|php|py|rs|go|md|json|css|scss|sql))/g)].map(m=>(m[1]??'').trim())
  const commands=quoted.filter(v=>/^(npm|pnpm|yarn|bun|git|cargo|go|php|python|pytest|docker|make)\b/.test(v)).map(command=>({command,reason:'任务描述中明确提到的命令'}))
  const conflicts=[
    ...parrot.nonGoals.filter(rule=>rule.length>2&&prompt.includes(rule)).map(rule=>({rule,explanation:'任务内容命中了 README 中的非目标'})),
    ...parrot.protectedPaths.filter(rule=>rule.length>1&&prompt.includes(rule.replace(/^\*\//,''))).map(rule=>({rule,explanation:'任务可能影响 AGENTS.md 中的受保护路径'}))
  ]
  const levels:RiskLevel[]=[classifyTask(prompt),...commands.map(c=>classifyCommand(c.command)),...(conflicts.length?['high' as const]:[])]
  const rank:Record<RiskLevel,number>={low:0,medium:1,high:2};const riskLevel=levels.sort((a,b)=>rank[b]-rank[a])[0]??'low'
  const explicitPaths=[...new Set([...quoted.filter(v=>/[/.]/.test(v)&&!commands.some(c=>c.command===v)),...pathLike])]
  const affectedPaths=explicitPaths.length?explicitPaths:UI_TASK_RE.test(prompt)?['[inspect implementation files first; documentation stays locked]']:[]
  return {summary:prompt,affectedPaths:affectedPaths.slice(0,20),commands,acceptanceChecks:parrot.acceptanceRules.slice(0,8),parrotConflicts:conflicts,riskLevel,allowParrotEdits:allowsParrotFileEdits(prompt)}
}
