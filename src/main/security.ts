import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { RiskLevel } from '../shared/types'

export async function resolveInside(root:string, candidate:string, allowMissing=true):Promise<string> {
  const rootReal = await realpath(root)
  const target = resolve(rootReal, candidate)
  assertInside(rootReal,target)
  try {
    assertInside(rootReal,await realpath(target),'符号链接指向项目外部')
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    let ancestor=dirname(target)
    while(ancestor!==rootReal&&ancestor!==dirname(ancestor)) {
      try { assertInside(rootReal,await realpath(ancestor),'符号链接指向项目外部');break }
      catch(ancestorError) { if((ancestorError as NodeJS.ErrnoException).code!=='ENOENT')throw ancestorError;ancestor=dirname(ancestor) }
    }
  }
  return target
}

function assertInside(root:string,target:string,message='路径超出项目范围'):void {
  const rel=relative(root,target)
  if(rel.startsWith('..')||isAbsolute(rel))throw new Error(message)
}

const HIGH = /\b(rm\s+-rf|sudo|mkfs|dd\s+if=|git\s+(reset\s+--hard|push\s+--force|clean\s+-f)|DROP\s+(TABLE|DATABASE)|deploy|publish)\b/i
const MEDIUM = /\b(npm|pnpm|yarn|bun|pip|cargo)\s+(install|add|update)|\b(curl|wget|ssh|scp)\b|\b(migrate|prisma|docker)\b/i
const SHELL_CONTROL = /[|;&`$<>\r\n]/

/**
 * 只有可预期的本地查看和验证命令可免审批。其余命令（包括 node -e、
 * python -c 与所有 shell 组合）一律进入审批流，而不是依赖黑名单猜测。
 */
const UNATTENDED_COMMANDS:RegExp[]=[
  /^git\s+(?:status(?:\s+--(?:short|porcelain(?:=v\d+)?|branch|untracked-files=(?:no|normal|all)))*|diff(?:\s+--(?:stat|name-only|name-status|cached))*|log(?:\s+--oneline(?:\s+-\d+)?)?|branch\s+--show-current|rev-parse\s+--show-toplevel|ls-files)\s*$/i,
  /^(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|lint|typecheck|build))(?:\s+--\s+[\w./:=,@-]+)*\s*$/i,
  /^(?:npx\s+)?(?:tsc\s+--noEmit|vitest(?:\s+run)?|eslint\s+[\w./*=-]+|pytest(?:\s+[\w./:=@-]+)*|go\s+test(?:\s+[\w./=-]+)*|cargo\s+(?:test|check)(?:\s+[\w./=-]+)*|php\s+-l\s+[\w./-]+)\s*$/i
]

export function isUnattendedCommand(command:string):boolean {
  const normalized=command.trim()
  return Boolean(normalized)&&!SHELL_CONTROL.test(normalized)&&UNATTENDED_COMMANDS.some(pattern=>pattern.test(normalized))
}

export function classifyCommand(command:string):RiskLevel {
  if (HIGH.test(command)) return 'high'
  if (MEDIUM.test(command)) return 'medium'
  return isUnattendedCommand(command)?'low':'medium'
}

export function classifyTask(prompt:string):RiskLevel {
  if (HIGH.test(prompt) || /删除|发布|部署|数据库迁移|密钥|凭据|项目外/.test(prompt)) return 'high'
  if (MEDIUM.test(prompt) || /安装依赖|跨模块|构建配置|联网/.test(prompt)) return 'medium'
  return 'low'
}

export function assertSafeShell(command:string, approvedRisk:RiskLevel):void {
  const actual = classifyCommand(command)
  const rank={low:0,medium:1,high:2}
  if (rank[actual] > rank[approvedRisk]) throw new Error(`命令风险从 ${approvedRisk} 扩大为 ${actual}，需要重新审批`)
}
