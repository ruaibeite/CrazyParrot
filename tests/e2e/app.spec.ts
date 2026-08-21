import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function createReceiptProject(prefix:string):Promise<string>{
  const projectDir=await mkdtemp(join(tmpdir(),prefix));await mkdir(join(projectDir,'src'))
  await writeFile(join(projectDir,'README.md'),'# Test Project\n\n## 项目目标\n- 测试目标\n\n## 目标用户\n- 开发者\n\n## 核心功能\n- 测试功能\n\n## 非目标\n- 不做\n\n## 技术栈\n- TypeScript\n\n## 开发命令\n- npm test\n\n## 完成标准\n- 测试通过\n')
  await writeFile(join(projectDir,'AGENTS.md'),'# AGENTS.md\n\n## 开发命令\n- npm test\n\n## 测试要求\n- 运行测试\n\n## 代码规范\n- 保持简洁\n\n## 依赖管理\n- 优先内置能力\n\n## 受保护路径\n- .env\n\n## 禁止操作\n- 不泄露密钥\n\n## UI 与业务语义\n- 保持一致\n\n## 完成规则\n- 提供验证结果\n')
  await writeFile(join(projectDir,'src','app.ts'),'export const state = "before"\n')
  return projectDir
}

async function startReceiptModel():Promise<{baseUrl:string;close:()=>Promise<void>}> {
  let completion=0
  const server=createServer((request,response)=>{
    if(request.method==='GET'&&request.url==='/v1/models'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[{id:'receipt-model'}]}));return}
    if(request.method==='POST'&&request.url==='/v1/chat/completions'){
      response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
      completion++
      if(completion===1)response.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'receipt-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'src/app.ts',content:'export const state = "after"\n'})}}]}}]})}\n\n`)
      else response.write(`data: ${JSON.stringify({choices:[{delta:{content:'Updated src/app.ts.'}}],usage:{prompt_tokens:11,completion_tokens:5}})}\n\n`)
      response.end('data: [DONE]\n\n');return
    }
    response.writeHead(404);response.end()
  })
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())})
  const address=server.address();if(!address||typeof address==='string')throw new Error('Unable to bind local receipt model')
  return {baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}

async function startPlanModel():Promise<{baseUrl:string;close:()=>Promise<void>}> {
  const server=createServer((request,response)=>{
    if(request.method==='GET'&&request.url==='/v1/models'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[{id:'plan-model'}]}));return}
    if(request.method==='POST'&&request.url==='/v1/chat/completions'){
      response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
      response.write(`data: ${JSON.stringify({choices:[{delta:{content:'## 实施方案\n\n1. 检查相关实现文件。\n2. 仅在 Edit 模式确认后修改。'}}],usage:{prompt_tokens:7,completion_tokens:9}})}\n\n`)
      response.end('data: [DONE]\n\n');return
    }
    response.writeHead(404);response.end()
  })
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())})
  const address=server.address();if(!address||typeof address==='string')throw new Error('Unable to bind local plan model')
  return {baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}

test('launches the local-first project screen',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-'))
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  await expect(window.getByRole('heading',{name:'项目'})).toBeVisible()
  await expect(window.getByText('未连接')).toBeVisible()
  await expect(window.getByRole('button',{name:'新建'})).toBeVisible()
  await window.getByRole('button',{name:'变更凭证'}).click()
  await expect(window.getByRole('heading',{name:'变更凭证'})).toBeVisible()
  await expect(window.getByRole('heading',{name:'选择项目'})).toBeVisible()
  await window.locator('.sidebar-nav button').first().click()
  await window.getByRole('button',{name:'收起侧边栏'}).click()
  await expect(window.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await expect(window.getByRole('button',{name:'展开侧边栏'})).toBeVisible()
  await window.reload()
  await expect(window.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  expect(await window.evaluate(()=>document.defaultView?.open('https://example.com')===null)).toBe(true)
  await expect(window.getByText('在项目约束内，')).toHaveCount(0)
  await app.close()
})

test('follows an English system locale',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-en-'))
  const app=await electron.launch({args:['--no-sandbox','.','--lang=en-US'],env:{...process.env,LANG:'en_US.UTF-8',LANGUAGE:'en',CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  await expect(window.getByRole('button',{name:'New'})).toBeVisible()
  await expect(window.getByText('Not connected')).toBeVisible()
  await expect(window.getByRole('button',{name:'新建'})).toHaveCount(0)
  await app.close()
})

test('persists an appearance selection and applies the light theme',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-appearance-'))
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  await window.locator('.header-settings').click()
  await expect(window.getByRole('heading',{name:'设置'})).toBeVisible()
  await window.getByRole('button',{name:'外观'}).click()
  await window.getByRole('button',{name:'白色'}).click()
  await window.getByRole('textbox',{name:'自定义 CSS'}).fill('.appearance-page { letter-spacing: .01em; }')
  await window.getByRole('button',{name:'应用外观'}).click()
  await expect(window.locator('html')).toHaveAttribute('data-theme','light')
  await expect.poll(()=>window.locator('#crazyparrot-custom-css').evaluate(node=>node.textContent)).toContain('letter-spacing')
  await window.reload()
  await expect(window.locator('html')).toHaveAttribute('data-theme','light')
  await window.locator('.header-settings').click()
  await window.getByRole('button',{name:'外观'}).click()
  await expect(window.getByRole('textbox',{name:'自定义 CSS'})).toHaveValue(/letter-spacing/)
  await app.close()
})

test('allows a manual interface-language preference from Settings',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-language-'))
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  await window.locator('.header-settings').click()
  await window.getByRole('button',{name:'English'}).click()
  await expect(window.getByRole('heading',{name:'Settings'})).toBeVisible()
  await expect(window.getByRole('button',{name:'System'})).toBeVisible()
  await app.close()
})

test('renders the Monaco file preview in a packaged app',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-monaco-'))
  const projectDir=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-project-'))
  await mkdir(join(projectDir,'src'))
  await writeFile(join(projectDir,'README.md'),'# Test Project\n\n## 项目目标\n- 测试目标\n\n## 目标用户\n- 开发者\n\n## 核心功能\n- 测试功能\n\n## 非目标\n- 不做\n\n## 技术栈\n- TypeScript\n\n## 开发命令\n- npm test\n\n## 完成标准\n- 测试通过\n')
  await writeFile(join(projectDir,'AGENTS.md'),'# AGENTS.md\n\n## 开发命令\n- npm test\n\n## 测试要求\n- 运行测试\n\n## 代码规范\n- 保持简洁\n\n## 依赖管理\n- 优先内置能力\n\n## 受保护路径\n- .env\n\n## 禁止操作\n- 不泄露密钥\n\n## UI 与业务语义\n- 保持一致\n\n## 完成规则\n- 提供验证结果\n')
  await writeFile(join(projectDir,'hello.ts'),'const greeting: string = "hello"\nconsole.log(greeting)\n')
  await writeFile(join(projectDir,'src','nested.ts'),'export const nested = true\n')
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  const errors:string[]=[]
  await expect(window.locator('.monaco-editor')).toHaveCount(0) // Monaco 仅在首次需要编辑/预览时才下载。
  window.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())})
  await window.evaluate(async(path)=>{
    const api=window as unknown as {crazyParrot:{projects:{add(p:string):Promise<{id:string}>};parrot:{approve(id:string):Promise<unknown>}}}
    const project=await api.crazyParrot.projects.add(path)
    await api.crazyParrot.parrot.approve(project.id)
  },projectDir)
  await window.reload()
  await expect(window.getByRole('button',{name:/crazy-parrot-e2e-project/}).first()).toBeVisible({timeout:15_000})
  await window.getByRole('button',{name:/crazy-parrot-e2e-project/}).first().click()
  await expect(window.getByRole('button',{name:'hello.ts'})).toBeVisible({timeout:15_000})
  await expect(window.locator('.breadcrumbs')).toHaveCount(0)
  await window.getByRole('button',{name:'src'}).click()
  await expect(window.getByRole('button',{name:'nested.ts'})).toBeVisible()
  await window.getByRole('button',{name:'hello.ts'}).click()
  const monaco=window.locator('.monaco-editor').first()
  await expect(monaco).toBeVisible({timeout:15_000})
  await expect(monaco).toContainText('greeting')
  const taskModes=window.locator('.mode-switch button')
  await expect(taskModes).toHaveCount(3)
  await taskModes.nth(2).click()
  await expect(taskModes.nth(2)).toHaveAttribute('aria-pressed','true')
  await expect(taskModes.nth(2)).toHaveClass(/active/)
  const workerErrors=errors.filter(text=>/worker|monaco|Uncaught/i.test(text))
  expect(workerErrors,`Monaco worker errors: ${workerErrors.join('\n')}`).toEqual([])
  await app.close()
})

test('keeps Plan read-only and archives a project without touching its files',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-plan-'));const projectDir=await createReceiptProject('crazy-parrot-e2e-plan-project-');const model=await startPlanModel()
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  try {
    const window=await app.firstWindow()
    const setup=await window.evaluate(async({path,baseUrl})=>{
      const api=window as unknown as {crazyParrot:{projects:{add(path:string):Promise<{id:string}>};parrot:{approve(id:string):Promise<unknown>};providers:{save(input:unknown):Promise<{id:string}>;test(input:unknown):Promise<unknown>}}}
      const project=await api.crazyParrot.projects.add(path);await api.crazyParrot.parrot.approve(project.id)
      const profile={name:'Plan test',protocol:'openai-chat',baseUrl,model:'plan-model',apiKey:'test-only',thinkingEnabled:false,reasoningEffort:'high',maxContext:8_000,taskBudget:1_000,timeoutMs:10_000,inputPricePerMillion:0,outputPricePerMillion:0}
      const saved=await api.crazyParrot.providers.save(profile);await api.crazyParrot.providers.test({...profile,id:saved.id,apiKey:''})
      return project
    },{path:projectDir,baseUrl:model.baseUrl})
    await window.reload()
    await window.getByRole('button',{name:/crazy-parrot-e2e-plan-project/}).first().click()
    await window.locator('.composer-toolbar select').selectOption({label:'Plan test · plan-model'})
    await window.locator('.mode-switch button').nth(1).click()
    await window.locator('.composer textarea').fill('规划右侧对话栏的布局优化')
    await window.getByRole('button',{name:'发送'}).click()
    const plan=window.locator('.plan-card.plan-only').first()
    await expect(plan).toBeVisible({timeout:15_000})
    await expect(plan).toContainText('不改文件、不运行命令、不创建快照')
    expect(await readFile(join(projectDir,'src','app.ts'),'utf8')).toContain('before')
    const taskState=await window.evaluate(async(projectId:string)=>{
      const api=window as unknown as {crazyParrot:{tasks:{list(projectId:string):Promise<Array<{mode:string;status:string}> >};snapshots:{list(projectId:string):Promise<unknown[]>}}}
      return {tasks:await api.crazyParrot.tasks.list(projectId),snapshots:await api.crazyParrot.snapshots.list(projectId)}
    },setup.id)
    expect(taskState.tasks.some(task=>task.mode==='plan'&&task.status==='completed')).toBe(true)
    expect(taskState.snapshots).toHaveLength(0)
    await window.evaluate(async(projectId:string)=>{
      const api=window as unknown as {crazyParrot:{projects:{archive(projectId:string):Promise<void>}}}
      await api.crazyParrot.projects.archive(projectId)
    },setup.id)
    await window.reload()
    await expect(window.getByRole('heading',{name:'已归档项目'})).toBeVisible()
    await expect(window.getByRole('button',{name:'恢复'})).toBeVisible()
  } finally { await app.close();await model.close() }
})

test('shows the Parrot health score in the audit card',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-audit-'))
  const projectDir=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-audit-project-'))
  await writeFile(join(projectDir,'README.md'),'# Test Project\n\n## 项目目标\n- 测试目标\n- 更多目标\n\n## 目标用户\n- 开发者\n- 小团队\n\n## 核心功能\n- 测试功能\n- 详细功能\n\n## 非目标\n- 不做\n- 也不做\n\n## 技术栈\n- TypeScript\n- Electron\n\n## 开发命令\n- npm test\n- npm run build\n\n## 完成标准\n- 测试通过\n- 无回归\n')
  await writeFile(join(projectDir,'AGENTS.md'),'# AGENTS.md\n\n## 开发命令\n- npm test\n- npm run build\n\n## 测试要求\n- 运行测试\n- 记录结果\n\n## 代码规范\n- 保持简洁\n- 遵循风格\n\n## 依赖管理\n- 优先内置能力\n- 避免新增依赖\n\n## 受保护路径\n- .env\n- *.key\n\n## 禁止操作\n- 不泄露密钥\n- 不做破坏性操作\n\n## UI 与业务语义\n- 保持一致\n- 不改变行为\n\n## 完成规则\n- 提供验证结果\n- 报告变更\n')
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  const window=await app.firstWindow()
  await window.evaluate(async(path)=>{
    const api=window as unknown as {crazyParrot:{projects:{add(p:string):Promise<{id:string}>};parrot:{approve(id:string):Promise<unknown>}}}
    const project=await api.crazyParrot.projects.add(path)
    await api.crazyParrot.parrot.approve(project.id)
  },projectDir)
  await window.reload()
  await expect(window.getByRole('button',{name:/crazy-parrot-e2e-audit-project/}).first()).toBeVisible({timeout:15_000})
  await window.getByRole('button',{name:/crazy-parrot-e2e-audit-project/}).first().click()
  await window.getByRole('button',{name:/^Parrot/}).click()
  const score=window.locator('.audit-score').first()
  await expect(score).toBeVisible({timeout:15_000})
  await expect(score).toHaveText(/^\d{2,3}$/)
  await expect(window.locator('.audit-item')).toHaveCount(5)
  await app.close()
})

test('creates, reviews, and detects drift for a Change Receipt',async()=>{
  const userData=await mkdtemp(join(tmpdir(),'crazy-parrot-e2e-receipt-'));const projectDir=await createReceiptProject('crazy-parrot-e2e-receipt-project-');const model=await startReceiptModel()
  const app=await electron.launch({args:['--no-sandbox','.'],env:{...process.env,CRAZY_PARROT_USER_DATA:userData}})
  try {
    const window=await app.firstWindow()
    await window.evaluate(async({path,baseUrl})=>{
      const api=window as unknown as {crazyParrot:{projects:{add(path:string):Promise<{id:string}>};parrot:{approve(id:string):Promise<unknown>};providers:{save(input:unknown):Promise<{id:string}>;test(input:unknown):Promise<unknown>}}}
      const project=await api.crazyParrot.projects.add(path);await api.crazyParrot.parrot.approve(project.id)
      const profile={name:'Receipt test',protocol:'openai-chat',baseUrl,model:'receipt-model',apiKey:'test-only',thinkingEnabled:false,reasoningEffort:'high',maxContext:8_000,taskBudget:1_000,timeoutMs:10_000,inputPricePerMillion:0,outputPricePerMillion:0}
      const saved=await api.crazyParrot.providers.save(profile);await api.crazyParrot.providers.test({...profile,id:saved.id,apiKey:''})
    },{path:projectDir,baseUrl:model.baseUrl})
    await window.reload()
    await window.getByRole('button',{name:/crazy-parrot-e2e-receipt-project/}).first().click()
    await window.locator('.composer-toolbar select').selectOption({label:'Receipt test · receipt-model'})
    await window.locator('.mode-switch button').nth(2).click()
    await window.locator('.composer textarea').fill('Update the state constant.')
    await window.getByRole('button',{name:'发送'}).click()
    const receipt=window.locator('.receipt-card').first()
    await expect(receipt).toBeVisible({timeout:15_000})
    await expect(receipt).toContainText('变更凭证')
    expect(await readFile(join(projectDir,'src','app.ts'),'utf8')).toContain('after')
    await window.getByRole('button',{name:'变更凭证'}).click()
    await expect(window.getByRole('heading',{name:'变更凭证'})).toBeVisible()
    await window.getByText('Update the state constant.').click()
    await expect(window.getByText('任务目标与模型')).toBeVisible()
    await expect(window.getByRole('button',{name:'导出 Markdown'})).toBeVisible()
    await writeFile(join(projectDir,'src','app.ts'),'export const state = "drift"\n')
    await window.getByRole('button',{name:'检查工作区'}).click()
    await expect(window.getByText('检测到任务后变更')).toBeVisible()
  } finally { await app.close();await model.close() }
})
