import { describe, expect, it } from 'vitest'
import { auditParrot } from '../../src/main/parrot'

/** 满分文档：15 个章节每个至少 2 条真实内容、真命令、有保护、有禁止、有测试要求。 */
const fullReadme=`# Demo

## 项目目标
- 打造本地优先的开发规范工具
- 保证任务可追溯

## 目标用户
- 独立开发者
- 小团队

## 核心功能
- Parrot 合规校验
- 任务快照与回退

## 非目标
- 不做云端同步
- 不做团队协作

## 技术栈
- Electron
- React

## 开发命令
- npm run dev
- npm test

## 完成标准
- 功能符合范围
- 测试全部通过
`
const fullAgents=`# AGENTS.md

## 开发命令
- npm run dev
- npm test

## 测试要求
- 修改后运行受影响范围的测试
- 无法测试时说明原因

## 代码规范
- 遵循现有代码风格
- 保持改动聚焦

## 依赖管理
- 添加生产依赖前必须获得用户批准
- 优先复用现有依赖

## 受保护路径
- .env
- *.key

## 禁止操作
- 不得泄露或提交凭据
- 不得执行破坏性 Git 命令

## UI 与业务语义
- 保持现有产品语义
- 不改变视觉行为

## 完成规则
- 提供实际文件变更与命令退出码
- 变更不得违反本文件约束
`

describe('auditParrot',()=>{
  it('scores a complete parrot 100/excellent with no issues',()=>{
    const audit=auditParrot(fullReadme,fullAgents)
    expect(audit.score).toBe(100)
    expect(audit.level).toBe('excellent')
    expect(audit.issues).toHaveLength(0)
    expect(audit.items.every(item=>item.score===item.max)).toBe(true)
  })
  it('is deterministic for the same input',()=>{
    expect(auditParrot(fullReadme,fullAgents)).toEqual(auditParrot(fullReadme,fullAgents))
  })
  it('returns score 0 for empty documents without crashing',()=>{
    const audit=auditParrot('','')
    expect(audit.score).toBe(0)
    expect(audit.level).toBe('poor')
    expect(audit.items[0]?.score).toBe(0)
  })
  it('penalizes missing sections by 2 points each',()=>{
    const readme=fullReadme.replace('## 非目标','').replace('- 不做云端同步\n','').replace('- 不做团队协作\n','')
    const audit=auditParrot(readme,fullAgents)
    const missing=audit.items.find(item=>item.key==='sections')
    expect(missing?.score).toBe(30-2) // 只缺“非目标”一章
  })
  it('penalizes placeholder bullets by 3 and thin sections by 2',()=>{
    // 占位符章节保持 2 条 bullet 避免 thin 叠加；非目标/技术栈 故意单 bullet
    const readme=`# Demo

## 项目目标
- 请填写项目目标
- 补充工具定位

## 目标用户
- 待补充
- 补充用户群体

## 核心功能
- 请补充核心功能
- 补充功能细节

## 非目标
- 不做云端同步

## 技术栈
- Electron

## 开发命令
- npm test
- npm run build

## 完成标准
- 功能符合范围
- 测试全部通过
`
    const agents=fullAgents.replace('- 修改后运行受影响范围的测试','- TODO 补充测试命令').replace('- 无法测试时说明原因','- 运行测试并记录结果')
    const audit=auditParrot(readme,agents)
    const quality=audit.items.find(item=>item.key==='quality')
    // 占位符 bullet：项目目标/目标用户/核心功能/测试要求 共 4 条 → -12；单 bullet 章节：非目标/技术栈 共 2 个 → -4
    expect(quality?.score).toBe(25-12-4)
    expect(audit.issues.some(issue=>issue.item==='quality'&&issue.message.includes('占位符'))).toBe(true)
    expect(audit.issues.some(issue=>issue.item==='quality'&&issue.message.includes('仅有一行'))).toBe(true)
  })
  it('penalizes comment-only and placeholder commands by 4 each',()=>{
    const readme=fullReadme.replace('- npm test','- # npm test 注释')
    const audit=auditParrot(readme,fullAgents)
    const commands=audit.items.find(item=>item.key==='commands')
    expect(commands?.score).toBe(20-4) // '# npm test 注释' 命中注释规则；README 与 AGENTS 重复命令去重
  })
  it('penalizes placeholder commands by 4 each, not 20',()=>{
    const readme=fullReadme.replace('## 开发命令\n- npm run dev\n- npm test\n','## 开发命令\n- 请填写命令\n')
    const audit=auditParrot(readme,fullAgents)
    const commands=audit.items.find(item=>item.key==='commands')
    expect(commands?.score).toBe(20-4) // 占位符命令 -4
    expect(audit.issues.some(issue=>issue.item==='commands'&&issue.message.includes('没有任何开发或测试命令'))).toBe(false)
  })
  it('penalizes missing commands section entirely by 20',()=>{
    const readme=fullReadme.replace('## 开发命令\n- npm run dev\n- npm test\n','')
    const agents=fullAgents.replace('## 开发命令\n- npm run dev\n- npm test\n','') // 命令从双文档提取，需都删
    const audit=auditParrot(readme,agents)
    expect(audit.items.find(item=>item.key==='commands')?.score).toBe(0)
    expect(audit.issues.some(issue=>issue.item==='commands'&&issue.message.includes('没有任何开发或测试命令'))).toBe(true)
  })
  it('penalizes protection gaps: no user paths -10, empty banned ops -5',()=>{
    const agents=fullAgents.replace('## 受保护路径\n- .env\n- *.key\n','## 受保护路径\n').replace('## 禁止操作\n- 不得泄露或提交凭据\n- 不得执行破坏性 Git 命令\n','## 禁止操作\n')
    const audit=auditParrot(fullReadme,agents)
    const protection=audit.items.find(item=>item.key==='protection')
    expect(protection?.score).toBe(0) // -10 受保护路径章节为空（无真实路径）+ -5 禁止操作为空
    expect(audit.issues.some(issue=>issue.item==='protection'&&issue.message.includes('未声明任何受保护路径'))).toBe(true)
    expect(audit.issues.some(issue=>issue.item==='protection'&&issue.message.includes('禁止操作'))).toBe(true)
  })
  it('penalizes testing: missing -6, placeholder -4, conflict -10 (deductions do not stack)',()=>{
    const noTests=auditParrot(fullReadme,fullAgents.replace('## 测试要求\n- 修改后运行受影响范围的测试\n- 无法测试时说明原因\n','## 测试要求\n'))
    expect(noTests.items.find(item=>item.key==='tests')?.score).toBe(10-6)
    const placeholder=auditParrot(fullReadme,fullAgents.replace('- 修改后运行受影响范围的测试','- 待补充测试要求'))
    expect(placeholder.items.find(item=>item.key==='tests')?.score).toBe(10-4)
    const conflict=auditParrot(fullReadme,fullAgents.replace('## 测试要求\n- 修改后运行受影响范围的测试','## 测试要求\n- 不需要测试\n- 运行测试'))
    expect(conflict.items.find(item=>item.key==='tests')?.score).toBe(0) // 冲突 -10 封顶；占位与缺失互斥不叠加
    expect(conflict.issues.some(issue=>issue.item==='tests'&&issue.message.includes('冲突'))).toBe(true)
  })
  it('reaches level boundaries at 84/85, 69/70, 49/50',()=>{
    const noReadmeCmd=fullReadme.replace('## 开发命令\n- npm run dev\n- npm test\n\n','')
    const noAgentsCmd=fullAgents.replace('## 开发命令\n- npm run dev\n- npm test\n\n','')
    const emptyTestBody=(agents:string)=>agents.replace('## 测试要求\n- 修改后运行受影响范围的测试\n- 无法测试时说明原因\n','## 测试要求\n')
    const noProtect=fullAgents.replace('## 受保护路径\n- .env\n- *.key\n\n','')
    const emptyBanned=(agents:string)=>agents.replace('## 禁止操作\n- 不得泄露或提交凭据\n- 不得执行破坏性 Git 命令\n','## 禁止操作\n')

    // 85 excellent：缺 4 普通章(-8) + 1 占位符(-3) + 1 注释命令(-4)
    const readme85=fullReadme.replace('## 目标用户\n- 独立开发者\n- 小团队\n\n','').replace('## 核心功能\n- Parrot 合规校验\n- 任务快照与回退\n\n','').replace('## 非目标\n- 不做云端同步\n- 不做团队协作\n\n','').replace('- 打造本地优先的开发规范工具','- 请填写工具定位')
    const agents85=fullAgents.replace('## 代码规范\n- 遵循现有代码风格\n- 保持改动聚焦\n\n','').replace('- npm run dev','- # npm run dev')
    const s85=auditParrot(readme85,agents85)
    expect(s85.score).toBe(85)
    expect(s85.level).toBe('excellent')

    // 84 good：缺 8 普通章(-16)
    const readme84=fullReadme.replace('## 目标用户\n- 独立开发者\n- 小团队\n\n','').replace('## 核心功能\n- Parrot 合规校验\n- 任务快照与回退\n\n','').replace('## 非目标\n- 不做云端同步\n- 不做团队协作\n\n','').replace('## 技术栈\n- Electron\n- React\n\n','')
    const agents84=fullAgents.replace('## 代码规范\n- 遵循现有代码风格\n- 保持改动聚焦\n\n','').replace('## 依赖管理\n- 添加生产依赖前必须获得用户批准\n- 优先复用现有依赖\n\n','').replace('## UI 与业务语义\n- 保持现有产品语义\n- 不改变视觉行为\n\n','').replace('## 完成规则\n- 提供实际文件变更与命令退出码\n- 变更不得违反本文件约束\n','')
    const s84=auditParrot(readme84,agents84)
    expect(s84.score).toBe(84)
    expect(s84.level).toBe('good')

    // 70 good：无命令(20) + 缺 2 命令章(4) + 测试章空(6)
    const s70=auditParrot(noReadmeCmd,emptyTestBody(noAgentsCmd))
    expect(s70.score).toBe(70)
    expect(s70.level).toBe('good')

    // 69 fair：保护章删(10+2) + 测试章空(6) + 规则冲突(10) + 1 占位符(3) + 缺 2 普通章(4)
    const readme69=fullReadme.replace('- 打造本地优先的开发规范工具','- 请填写工具定位').replace('## 目标用户\n- 独立开发者\n- 小团队\n\n','').replace('## 核心功能\n- Parrot 合规校验\n- 任务快照与回退\n\n','')
    const agents69=fullAgents
      .replace('## 受保护路径\n- .env\n- *.key\n\n','')
      .replace('## 测试要求\n- 修改后运行受影响范围的测试\n- 无法测试时说明原因\n','## 测试要求\n')
      .replace('## 禁止操作\n- 不得泄露或提交凭据\n- 不得执行破坏性 Git 命令\n','## 禁止操作\n- 不需要测试\n')
      .replace('## 完成规则\n- 提供实际文件变更与命令退出码','## 完成规则\n- 运行测试\n- 提供实际文件变更与命令退出码')
    const s69=auditParrot(readme69,agents69)
    expect(s69.score).toBe(69)
    expect(s69.level).toBe('fair')

    // 50 fair：无命令(20+4) + 保护章删(10+2) + 测试章空(6) + 禁止章空(5) + 1 占位符(3)
    const readme50=noReadmeCmd.replace('- 打造本地优先的开发规范工具','- 请填写工具定位')
    const agents50=emptyTestBody(noProtect.replace('## 开发命令\n- npm run dev\n- npm test\n\n',''))
    const s50=auditParrot(readme50,emptyBanned(agents50))
    expect(s50.score).toBe(50)
    expect(s50.level).toBe('fair')

    // 49 poor：无命令(20+4) + 保护章删(10+2) + 测试章空(6) + 禁止章空(5) + 2 单 bullet 章节(4)
    const readme49=noReadmeCmd.replace('## 目标用户\n- 独立开发者\n- 小团队\n\n','## 目标用户\n- 独立开发者\n\n').replace('## 核心功能\n- Parrot 合规校验\n- 任务快照与回退\n\n','## 核心功能\n- Parrot 合规校验\n\n')
    const agents49=emptyTestBody(noProtect.replace('## 开发命令\n- npm run dev\n- npm test\n\n',''))
    const s49=auditParrot(readme49,emptyBanned(agents49))
    expect(s49.score).toBe(49)
    expect(s49.level).toBe('poor')
  })
})
