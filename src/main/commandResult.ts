import type { CommandEvidence } from '../shared/types'

/**
 * 命令结束（包括非零退出或启动失败）都是 Agent 可恢复的工具结果。
 * Agent 应基于输出选择替代方案，而不是让单条命令终止整个任务。
 */
export function commandResultForModel(result: CommandEvidence): string {
  const exitCode = result.exitCode === null ? 'unknown' : String(result.exitCode)
  const outcome = result.exitCode === 0
    ? 'Command completed successfully.'
    : 'Command completed with a non-zero exit code. Inspect the output, then continue with an appropriate alternative or explain the blocker. Do not blindly repeat the same command.'
  const gitUnavailable = /fatal:\s*not a git repository/i.test(result.output)
    ? '\nGit metadata is unavailable for this project. Git is optional: continue with filesystem inspection and the requested work; do not treat this as a task blocker.'
    : ''
  const output = result.output.slice(-50_000) || '(no output)'
  return `${outcome}${gitUnavailable}\nCommand: ${result.command}\nExit code: ${exitCode}\nOutput:\n${output}`
}
