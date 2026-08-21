import { describe, expect, it } from 'vitest'
import { allowsParrotFileEdits, buildTaskPlan } from '../../src/main/planning'
import type { ProjectParrot } from '../../src/shared/types'

const parrot:ProjectParrot={goals:['safe app'],nonGoals:['云端同步'],stack:['TypeScript'],commands:[],constraints:[],protectedPaths:['.env'],acceptanceRules:['测试通过'],approvedVersion:'v1'}

describe('task preflight',()=>{
  it('extracts paths, commands and parrot conflicts before execution',()=>{
    const plan=buildTaskPlan('修改 `src/app.ts`，运行 `npm install zod`，并加入云端同步',parrot)
    expect(plan.affectedPaths).toContain('src/app.ts')
    expect(plan.commands[0]?.command).toBe('npm install zod')
    expect(plan.parrotConflicts[0]?.rule).toBe('云端同步')
    expect(plan.riskLevel).toBe('high')
  })
  it('keeps governance documents locked unless the user explicitly asks to edit them',()=>{
    expect(allowsParrotFileEdits('请更新 README.md 的安装说明')).toBe(true)
    expect(allowsParrotFileEdits('为什么你在修改 readme 文件，不应该是 html 文件吗')).toBe(false)
    const plan=buildTaskPlan('优化右侧对话栏和 HTML 页面布局',parrot)
    expect(plan.allowParrotEdits).toBe(false)
    expect(plan.affectedPaths).toContain('[inspect implementation files first; documentation stays locked]')
  })
})
