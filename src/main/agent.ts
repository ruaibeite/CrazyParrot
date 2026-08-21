import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawn as spawnChild } from 'node:child_process'
import { dirname, relative } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { AppDatabase } from './database'
import type { CredentialStore } from './credentials'
import type { SnapshotService } from './snapshot'
import type { ReceiptService } from './receipt'
import { approveParrot, DEFAULT_PROTECTED_PATTERNS, getParrotStatus, isProtectedMatch } from './parrot'
import { classifyCommand, isUnattendedCommand, resolveInside } from './security'
import { commandResultForModel } from './commandResult'
import { buildCommandEnvironment, commandStartFailureMessage } from './commandExecution'
import { readLimitedTextFile } from './fileAccess'
import { fitMessagesToContext, truncateProjectInstruction } from './contextBudget'
import { ProviderClient, type AgentMessage, type ToolDefinition, type UnifiedToolCall } from './provider'
import { buildTaskPlan } from './planning'
import { isToolAllowedForMode } from './taskMode'
import type { AppSettingsService } from './appSettings'
import { IPC } from '../shared/ipc'
import type { AgentEvent, CommandEvidence, EvidenceBundle, ProjectRecord, TaskExecutionState, TaskMode, TaskRecord, TestEvidence } from '../shared/types'

const TOOLS:ToolDefinition[]=[
  {name:'read_file',description:'读取项目内 UTF-8 文本文件',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
  {name:'list_files',description:'列出项目内目录内容',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
  {name:'search_files',description:'在项目文本文件中搜索字符串',inputSchema:{type:'object',properties:{query:{type:'string'},path:{type:'string'}},required:['query']}},
  {name:'write_file',description:'写入完整文件内容。仅在必要时使用，路径必须在项目内',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}},
  {name:'replace_in_file',description:'对文件做唯一的精确文本替换',inputSchema:{type:'object',properties:{path:{type:'string'},oldText:{type:'string'},newText:{type:'string'}},required:['path','oldText','newText']}},
  {name:'run_command',description:'在项目根目录运行非交互命令',inputSchema:{type:'object',properties:{command:{type:'string'},reason:{type:'string'}},required:['command','reason']}}
]
const READ_ONLY_TOOLS=TOOLS.filter(tool=>['read_file','list_files','search_files'].includes(tool.name))

interface TerminalHandle { kill():void }
interface RunningTask { cancelled:boolean; controller:AbortController; terminals:Set<TerminalHandle> }
class PauseForApproval extends Error {}
class InvalidToolArguments extends Error {}

/** Keep malformed provider tool payloads recoverable instead of failing a task. */
export function parseToolArguments(value:string):Record<string,unknown> {
  const trimmed=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')
  const parsed=JSON.parse(trimmed||'{}') as unknown
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Tool arguments must be a JSON object')
  return parsed as Record<string,unknown>
}

export class AgentService {
  private running=new Map<string,RunningTask>()
  constructor(private db:AppDatabase,private credentials:CredentialStore,private snapshots:SnapshotService,private receipts:ReceiptService,private window:()=>BrowserWindow|null,private settings:AppSettingsService) {}

  private tr(zh:string,en:string):string { return this.settings.language()==='zh'?zh:en }

  private emit(taskId:string,type:AgentEvent['type'],message:string,payload?:unknown,persist=true):void {
    const event:AgentEvent={taskId,type,message,at:new Date().toISOString(),...(payload===undefined?{}:{payload})}
    if(persist)this.db.saveEvent(taskId,type,message,payload)
    this.window()?.webContents.send(IPC.AGENT_EVENT,event)
  }

  async create(projectId:string,prompt:string,providerId:string,mode:TaskMode,parentTaskId?:string):Promise<TaskRecord> {
    const project=this.db.getProject(projectId); if(!project)throw new Error('项目不存在')
    let parrot=await getParrotStatus(this.db,projectId)
    if(!parrot.valid)throw new Error('必须先完成 README.md 与 AGENTS.md')
    // Existing projects often already contain complete parrot files but were
    // imported before an approval hash existed in the local database. Treat a
    // valid pair as approved on first use so the task flow does not dead-end
    // behind a confirmation screen the user cannot find.
    if(!parrot.approved)parrot=await approveParrot(this.db,projectId)
    const provider=this.db.getProvider(providerId); if(!provider?.verifiedAt)throw new Error('必须先配置并成功测试模型连接')
    const parent=parentTaskId?this.db.getTask(parentTaskId):null
    if(parentTaskId&&(!parent||parent.projectId!==projectId))throw new Error('无法继续此对话')
    const detected=buildTaskPlan(prompt,parrot.parrot)
    const plan=mode==='edit'?detected:{...detected,commands:[],riskLevel:'low' as const}
    const riskLevel=plan.riskLevel
    const existingTasks=this.db.listTasks(projectId)
    const shouldQueue=existingTasks.some(item=>['queued','planning','running','awaiting_approval','interrupted'].includes(item.status))
    const needsTaskApproval=!shouldQueue&&mode==='edit'&&riskLevel!=='low'
    const initialStatus=mode==='plan'?'planning':'running';const now=new Date().toISOString(); const task:TaskRecord={id:crypto.randomUUID(),projectId,...(parentTaskId?{parentTaskId}:{}),prompt,mode,status:shouldQueue?'queued':needsTaskApproval?'awaiting_approval':initialStatus,...(shouldQueue?{queueOrder:this.db.nextTaskQueueOrder(projectId)}:{}),...(needsTaskApproval?{pendingApproval:{kind:'task',reason:this.tr(`该任务风险等级为 ${riskLevel}，需要确认后执行`,`This task is ${riskLevel} risk and requires approval`)}}:{}),parrotHash:parrot.currentHash,riskLevel,plan,createdAt:now,updatedAt:now}
    this.db.saveTask(task,providerId)
    if(shouldQueue){this.emit(task.id,'status',this.tr('待发送，前方还有任务','Queued for sending'));return task}
    if(mode==='edit'){
      try { await this.snapshots.create(task.id,projectId,project.path);this.emit(task.id,'status',this.tr('已保存快照','Snapshot saved')) }
      catch(error) {
        task.status='failed';task.error=(error as Error).message;task.updatedAt=new Date().toISOString();this.db.saveTask(task);await this.finalizeReceipt(task.id);this.emit(task.id,'error',task.error);void this.startNext(projectId);return task
      }
    } else this.emit(task.id,'status',mode==='ask'?this.tr('Ask 模式：只读分析','Ask mode: read-only analysis'):this.tr('Plan 模式：只读规划','Plan mode: read-only planning'))
    if(task.status==='running'||task.status==='planning')void this.execute(task.id)
    else this.emit(task.id,'approval',this.tr(`该任务风险等级为 ${riskLevel}，需要确认后执行`,`This task is ${riskLevel} risk and requires approval`),plan)
    return task
  }

  async approve(taskId:string):Promise<TaskRecord> {
    const task=this.db.getTask(taskId);if(!task)throw new Error('任务不存在')
    if(task.status!=='awaiting_approval')return task
    if(task.plan.parrotConflicts.length) {
      const status=await getParrotStatus(this.db,task.projectId)
      if(!status.approved)throw new Error('项目 Parrot 已变化，请先重新确认 Parrot')
      task.plan=buildTaskPlan(task.prompt,status.parrot);task.riskLevel=task.plan.riskLevel
      if(task.plan.parrotConflicts.length)throw new Error('任务仍与项目 Parrot 冲突，请调整任务或先修改 README/AGENTS')
    }
    const executionState=task.executionState
    if(task.pendingApproval)task.approvals=[...(task.approvals??[]),{kind:task.pendingApproval.kind,reason:task.pendingApproval.reason,approvedAt:new Date().toISOString(),...(task.pendingApproval.paths?{paths:task.pendingApproval.paths}:{}),...(task.pendingApproval.command?{command:task.pendingApproval.command}:{})}]
    if(task.pendingApproval?.kind==='budget')task.budgetOverride=true
    if(task.pendingApproval?.kind==='file-change'||task.pendingApproval?.kind==='change-scope')task.scopeChangeApproved=true
    delete task.pendingApproval
    task.status='running';task.updatedAt=new Date().toISOString();this.db.saveTask(task)
    this.db.saveDecision(task.projectId,task.plan.commands.length?`批准任务与命令：${task.plan.commands.map(c=>c.command).join('；')}`:`批准 ${task.riskLevel} 风险任务：${task.prompt}`,task.id)
    this.emit(taskId,'status',this.tr('计划已批准，开始执行','Plan approved. Starting execution.'));void this.execute(taskId,executionState);return task
  }

  async cancel(taskId:string):Promise<void> {
    const running=this.running.get(taskId);if(running){running.cancelled=true;running.controller.abort();for(const terminal of running.terminals)terminal.kill()}
    const task=this.db.getTask(taskId);if(task){task.status='cancelled';task.updatedAt=new Date().toISOString();this.db.saveTask(task);if(!running){await this.finalizeReceipt(task.id);void this.startNext(task.projectId)}this.emit(taskId,'status',this.tr('任务已停止','Task stopped'))}
  }

  async resumeInterrupted(taskId:string):Promise<TaskRecord> {
    const task=this.db.getTask(taskId);if(!task)throw new Error('任务不存在')
    if(task.status!=='interrupted'||!task.executionState)throw new Error(this.tr('该任务没有可恢复的执行检查点','This task has no recoverable execution checkpoint'))
    const project=this.db.getProject(task.projectId);const provider=this.db.getProvider(task.providerId)
    if(!project||!provider?.verifiedAt)throw new Error(this.tr('项目或已验证模型不可用，无法恢复任务','The project or verified model is unavailable, so this task cannot be resumed'))
    task.status=task.mode==='plan'?'planning':'running';delete task.error;task.updatedAt=new Date().toISOString();this.db.saveTask(task)
    this.emit(task.id,'status',this.tr('正在从安全检查点恢复','Resuming from the last safe checkpoint'));void this.execute(task.id,task.executionState)
    return task
  }

  async reorder(projectId:string,taskIds:string[]):Promise<TaskRecord[]> {
    const project=this.db.getProject(projectId);if(!project)throw new Error('项目不存在')
    this.db.reorderQueuedTasks(projectId,taskIds)
    return this.db.listTasks(projectId)
  }

  async resume():Promise<void> {
    for(const project of this.db.listProjects()) {
      const tasks=this.db.listTasks(project.id)
      for(const task of tasks.filter(item=>item.status==='planning'||item.status==='running')) {
        task.status=task.executionState?'interrupted':'failed';task.error=task.executionState?this.tr('应用重启时任务已暂停，可从最近安全检查点恢复','The app restarted while this task was running. Resume it from the latest safe checkpoint.'):this.tr('应用重启时任务未完成，请重新发送','The task was interrupted when the app restarted. Send it again.');task.updatedAt=new Date().toISOString();this.db.saveTask(task);if(task.status==='failed')await this.finalizeReceipt(task.id);this.emit(task.id,task.executionState?'status':'error',task.error)
      }
      await this.startNext(project.id)
    }
  }

  private async startNext(projectId:string):Promise<void> {
    if(this.db.listTasks(projectId).some(item=>['planning','running','awaiting_approval','interrupted'].includes(item.status)))return
    const next=this.db.listTasks(projectId).find(item=>item.status==='queued');if(!next)return
    const needsTaskApproval=next.mode==='edit'&&next.riskLevel!=='low'
    next.status=next.mode==='plan'?'planning':next.mode!=='edit'||next.riskLevel==='low'?'running':'awaiting_approval';if(needsTaskApproval&&!next.pendingApproval)next.pendingApproval={kind:'task',reason:this.tr(`该任务风险等级为 ${next.riskLevel}，需要确认后执行`,`This task is ${next.riskLevel} risk and requires approval`)};next.updatedAt=new Date().toISOString();this.db.saveTask(next)
    if(next.mode==='edit'){const project=this.db.getProject(projectId);if(!project)return;try{await this.snapshots.create(next.id,projectId,project.path);this.emit(next.id,'status',this.tr('已保存快照','Snapshot saved'))}catch(error){next.status='failed';next.error=(error as Error).message;next.updatedAt=new Date().toISOString();this.db.saveTask(next);await this.finalizeReceipt(next.id);this.emit(next.id,'error',next.error);void this.startNext(projectId);return}}
    if(next.status==='running'||next.status==='planning')void this.execute(next.id)
    else this.emit(next.id,'approval',this.tr(`该任务风险等级为 ${next.riskLevel}，需要确认后执行`,`This task is ${next.riskLevel} risk and requires approval`),next.plan)
  }

  private async execute(taskId:string,resumeState?:TaskExecutionState):Promise<void> {
    const task=this.db.getTask(taskId);if(!task)return
    const project=this.db.getProject(task.projectId);const provider=this.db.getProvider(task.providerId)
    if(!project||!provider){
      task.status='failed';task.error=!project?this.tr('项目不存在，无法执行任务','Project no longer exists; task cannot run'):this.tr('模型配置已删除，任务无法执行','The model configuration was removed; task cannot run');task.updatedAt=new Date().toISOString();this.db.saveTask(task);await this.finalizeReceipt(task.id);this.emit(taskId,'error',task.error);void this.startNext(task.projectId);return
    }
    const state:RunningTask={cancelled:false,controller:new AbortController(),terminals:new Set()};this.running.set(taskId,state)
    const commands:CommandEvidence[]=resumeState?.commands??[]
    try {
      const parrot=await getParrotStatus(this.db,project.id); const key=await this.credentials.get(provider.encryptedCredentialId);const client=new ProviderClient(provider,key,state.controller.signal)
      const context=this.contextMessages(task.parentTaskId)
      const system=this.systemPrompt(project,parrot.parrot,task.mode,provider.maxContext)+(context.summary?`\n\n${this.tr('此前对话摘要（仅保留已确认事实）','Previous conversation summary (confirmed facts only)')}:\n${context.summary}`:'')
      const messages:AgentMessage[]=resumeState?.messages??[{role:'system',content:system},...context.messages,{role:'user',content:task.prompt}]
      this.saveCheckpoint(task,messages,resumeState?.pendingToolCalls??[],commands)
      this.emit(taskId,'status',this.tr('正在分析','Analyzing'))
      if(resumeState?.pendingToolCalls.length)await this.executeToolCalls(task,project,resumeState.pendingToolCalls,messages,commands,state,parrot.parrot.protectedPaths)
      let contextLimitReported=false
      for(let turn=0;turn<20;turn++) {
        if(state.cancelled)throw new Error('任务已由用户停止')
        if(this.overBudget(task))this.pauseForBudget(task,messages,commands)
        const requestContext=fitMessagesToContext(messages,provider.maxContext)
        if(requestContext.trimmed&&!contextLimitReported){contextLimitReported=true;this.emit(taskId,'status',this.tr('已按模型上下文上限压缩请求历史','Request history trimmed to the configured model context limit'))}
        const result=await client.complete(requestContext.messages,task.mode==='edit'?TOOLS:READ_ONLY_TOOLS,event=>{
          if(event.type==='text'&&event.text)this.emit(taskId,'text',event.text,undefined,false)
          if(event.type==='reasoning'&&event.text)this.emit(taskId,'reasoning',event.text,undefined,false)
        })
        this.recordUsage(task,provider,result.usage)
        if(result.content)this.db.saveEvent(taskId,'text',result.content,undefined)
        if(result.reasoning)this.db.saveEvent(taskId,'reasoning',result.reasoning,undefined)
        messages.push({role:'assistant',content:result.content,toolCalls:result.toolCalls})
        this.saveCheckpoint(task,messages,result.toolCalls,commands)
        if(!result.toolCalls.length)break
        await this.executeToolCalls(task,project,result.toolCalls,messages,commands,state,parrot.parrot.protectedPaths)
      }
      const evidence=await this.buildEvidence(task,commands)
      task.status='completed';task.evidence=evidence;delete task.executionState;delete task.pendingApproval;task.updatedAt=new Date().toISOString();this.db.saveTask(task);await this.finalizeReceipt(task.id)
      this.emit(taskId,'evidence',this.tr('任务执行完成','Task completed'),evidence)
    } catch(error) {
      if(error instanceof PauseForApproval)return
      if(!task.evidence){try{task.evidence=await this.buildEvidence(task,commands)}catch{ /* Preserve the terminal result even if supplementary evidence cannot be collected. */ }}
      task.status=state.cancelled?'cancelled':'failed';task.error=(error as Error).message;task.updatedAt=new Date().toISOString();this.db.saveTask(task);await this.finalizeReceipt(task.id)
      this.emit(taskId,'error',(error as Error).message)
    } finally {
      this.running.delete(taskId)
      if(task.status!=='awaiting_approval')void this.startNext(task.projectId)
    }
  }

  private async executeToolCalls(task:TaskRecord,project:ProjectRecord,calls:UnifiedToolCall[],messages:AgentMessage[],commands:CommandEvidence[],state:RunningTask,protectedPaths:string[]):Promise<void> {
    for(let index=0;index<calls.length;index++) {
      if(state.cancelled)throw new Error('任务已由用户停止')
      const call=calls[index]!
      try {
        const output=await this.runTool(task,project,call,commands,state,protectedPaths)
        messages.push({role:'tool',toolCallId:call.id,content:output})
      } catch(error) {
        if(error instanceof InvalidToolArguments) {
          messages.push({role:'tool',toolCallId:call.id,content:error.message})
          this.emit(task.id,'status',this.tr('工具参数格式无效，正在请求 Agent 修正后重试','Tool arguments were invalid; asking the agent to correct and retry'))
          this.saveCheckpoint(task,messages,calls.slice(index+1),commands)
          continue
        }
        if(error instanceof PauseForApproval)this.saveCheckpoint(task,messages,calls.slice(index),commands)
        throw error
      }
      this.saveCheckpoint(task,messages,calls.slice(index+1),commands)
    }
  }

  async compact(taskId:string):Promise<TaskRecord> {
    const task=this.db.getTask(taskId);if(!task)throw new Error('任务不存在')
    if(['planning','running','awaiting_approval'].includes(task.status))throw new Error(this.tr('任务结束后才能压缩上下文','Wait for the task to finish before compacting context'))
    if(task.contextSummary)return task
    const provider=this.db.getProvider(task.providerId);if(!provider)throw new Error('模型配置不存在')
    const key=await this.credentials.get(provider.encryptedCredentialId);const client=new ProviderClient(provider,key)
    const context=this.contextMessages(task.id);const transcript=[context.summary?`${this.tr('已有摘要','Existing summary')}:\n${context.summary}`:'',...context.messages.map(message=>`${message.role==='user'?this.tr('用户','User'):this.tr('助手','Assistant')}:\n${message.content}`)].filter(Boolean).join('\n\n')
    if(!transcript.trim())throw new Error(this.tr('没有可压缩的上下文','There is no context to compact'))
    const instruction=this.tr('将这段编码对话压缩成可供后续模型继续工作的上下文。必须保留用户目标、已确认决定、重要文件路径、已执行命令和结果、未完成事项与约束。删除寒暄、重复内容和逐步推理。使用简洁的结构化文本。','Compress this coding conversation for another model turn. Preserve user goals, confirmed decisions, important file paths, commands and results, open work, and constraints. Remove greetings, repetition, and step-by-step reasoning. Use concise structured text.')
    const result=await client.complete([{role:'system',content:instruction},{role:'user',content:transcript.slice(-300_000)}],[])
    const summary=result.content.trim();if(!summary)throw new Error(this.tr('模型未返回上下文摘要','The model returned no context summary'))
    task.contextSummary=summary;task.updatedAt=new Date().toISOString();this.db.saveTask(task)
    this.emit(task.id,'status',this.tr('上下文已压缩','Context compacted'))
    return task
  }

  private contextMessages(endTaskId?:string):{summary:string;messages:AgentMessage[]} {
    if(!endTaskId)return {summary:'',messages:[]}
    const chain:Array<TaskRecord&{providerId:string}>=[];const seen=new Set<string>();let current=this.db.getTask(endTaskId)
    while(current&&!seen.has(current.id)&&chain.length<100){seen.add(current.id);chain.unshift(current);current=current.parentTaskId?this.db.getTask(current.parentTaskId):null}
    let summaryIndex=-1
    for(let index=0;index<chain.length;index++)if(chain[index]?.contextSummary)summaryIndex=index
    const summary=summaryIndex>=0?chain[summaryIndex]?.contextSummary??'':'';const messages:AgentMessage[]=[]
    for(const item of chain.slice(summaryIndex+1)) {
      messages.push({role:'user',content:item.prompt})
      // Unverified model narration must not become a standing instruction for a
      // later turn (for example, “I will also update README”).
      const answer=item.contextSummary?.trim()??''
      if(answer)messages.push({role:'assistant',content:answer})
    }
    return {summary,messages}
  }

  private systemPrompt(project:ProjectRecord,parrot:import('../shared/types').ProjectParrot,mode:TaskMode,maxContext:number):string {
    const chinese=this.settings.language()==='zh'
    const modeRule=chinese?(mode==='ask'?'当前为 Ask 模式：只能读取、搜索和解释，不得修改文件或运行命令。直接回答问题并引用相关文件路径。':mode==='plan'?'当前为 Plan 模式：只读探索，不修改文件、不创建快照、不运行命令。输出清晰的实施计划：目标、已检查文件、建议变更、风险、验证步骤和需确认的问题。方案不得写成“已完成”。':'当前为 Edit 模式：先读取相关实现文件，再做最小修改，最后运行适当测试。'):(mode==='ask'?'Ask mode: only read, search, and explain. Do not modify files or run commands. Answer directly and cite relevant paths.':mode==='plan'?'Plan mode: inspect read-only. Do not modify files, create a snapshot, or run commands. Return an implementation plan with goal, inspected files, proposed changes, risks, validation, and decisions needed. Never present the plan as completed work.':'Edit mode: read the relevant implementation files, make the smallest appropriate change, then run suitable tests.')
    const base=chinese?'你是 CrazyParrot 本地编码 Agent。必须遵守项目 Parrot，不得泄露密钥、编造结果或扩大任务范围。使用清晰的 Markdown，并使用简体中文回复。Git 仅用于增强 Diff 展示，不是项目或任务的前提；遇到“不是 Git 仓库”时，必须继续通过文件系统完成原任务，不能将其视为阻塞。':'You are the CrazyParrot local coding agent. Follow the project Parrot; never expose credentials, invent results, or expand scope. Use clear Markdown and reply in English. Git only enhances diff presentation; it is never a project or task prerequisite. If Git reports that the directory is not a repository, continue the requested work through the filesystem instead of treating it as a blocker.'
    const documentationRule=chinese?'README.md 和 AGENTS.md 是项目治理文件，默认只读。除非用户明确要求更新项目文档、README 或 AGENTS，否则绝不修改它们，也不要为了“文档同步”而改它们。UI、HTML、CSS 或代码任务只修改已发现的实现文件。长 HTML/CSS/SVG 修改优先用 write_file 写完整文件；replace_in_file 只用于短且唯一的替换。工具参数必须是严格 JSON；收到参数格式错误后，修正 JSON 或改用更短的 write_file 重试。':'README.md and AGENTS.md are project-governance files and are read-only by default. Never change them, or "sync documentation", unless the user explicitly asks to update project docs, README, or AGENTS. UI, HTML, CSS, and code work must change only discovered implementation files. For large HTML/CSS/SVG edits, prefer write_file with the complete file; use replace_in_file only for short unique replacements. Tool arguments must be strict JSON. After a format error, correct the JSON or use a shorter write_file call and retry.'
    const rules=[...parrot.goals.map(goal=>`goal: ${goal}`),...parrot.nonGoals.map(goal=>`non-goal: ${goal}`),...parrot.constraints.map(rule=>`constraint: ${rule}`),...parrot.acceptanceRules.map(rule=>`acceptance: ${rule}`),...parrot.commands.map(command=>`project command: ${command.command}`)].join('\n')
    const limit=Math.max(2_000,Math.min(12_000,Math.floor(maxContext*.1)))
    return `${base}\nProject root: ${project.path}\n${modeRule}\n${documentationRule}\n\nProject rules summary:\n${truncateProjectInstruction(rules,limit)}`
  }

  private async runTool(task:TaskRecord,project:ProjectRecord,call:UnifiedToolCall,commands:CommandEvidence[],state:RunningTask,protectedPaths:string[]):Promise<string> {
    if(!isToolAllowedForMode(task.mode,call.name))throw new Error(`${task.mode.toUpperCase()} 模式不允许调用 ${call.name}`)
    let args:Record<string,unknown>;try{args=parseToolArguments(call.arguments)}catch{throw new InvalidToolArguments(`工具 ${call.name} 参数不是有效 JSON。请只发送严格 JSON；长 HTML/CSS/SVG 内容请改用 write_file，避免 replace_in_file 的大段 oldText/newText。`)}
    this.emit(task.id,'tool',`${call.name}: ${args.path??args.command??args.query??''}`,args)
    if(call.name==='read_file'){
      const result=await readLimitedTextFile(await resolveInside(project.path,String(args.path)),200_000)
      if(result.binary)return '[binary file: preview unavailable]'
      return `${result.content}${result.truncated?'\n\n[truncated after 200 KB]':''}`
    }
    if(call.name==='list_files')return (await readdir(await resolveInside(project.path,String(args.path??'.')),{withFileTypes:true})).map(e=>`${e.isDirectory()?'dir ':'file'} ${e.name}`).join('\n')
    if(call.name==='search_files')return this.search(project.path,String(args.path??'.'),String(args.query))
    if(call.name==='write_file'){const path=await resolveInside(project.path,String(args.path));const rel=relative(project.path,path);this.assertWritable(task,rel,protectedPaths);this.requireWriteScopeApproval(task,rel,String(args.content));await mkdir(dirname(path),{recursive:true});await writeFile(path,String(args.content),'utf8');task.changedPaths=[...(task.changedPaths??[]),rel].filter((value,index,items)=>items.indexOf(value)===index);return `已写入 ${rel}`}
    if(call.name==='replace_in_file'){
      const path=await resolveInside(project.path,String(args.path));this.assertWritable(task,relative(project.path,path),protectedPaths);const old=String(args.oldText),current=await readFile(path,'utf8');const count=current.split(old).length-1
      if(count!==1)throw new Error(`精确替换要求匹配 1 次，实际 ${count} 次`);const rel=relative(project.path,path);this.requireWriteScopeApproval(task,rel,String(args.newText));await writeFile(path,current.replace(old,String(args.newText)),'utf8');task.changedPaths=[...(task.changedPaths??[]),rel].filter((value,index,items)=>items.indexOf(value)===index);return `已更新 ${rel}`
    }
    if(call.name==='run_command'){
      const command=String(args.command);const actual=classifyCommand(command);const approved=task.plan.commands.some(c=>c.command===command)
      if(!isUnattendedCommand(command)&&!approved){
        const rank={low:0,medium:1,high:2};if(rank[actual]>rank[task.riskLevel])task.riskLevel=actual
        task.plan={...task.plan,riskLevel:task.riskLevel,commands:[...task.plan.commands,{command,reason:String(args.reason??'模型请求运行命令')}]};task.status='awaiting_approval';task.pendingApproval={kind:'command',reason:String(args.reason??'模型请求运行命令'),command};task.updatedAt=new Date().toISOString();this.db.saveTask(task)
        this.emit(task.id,'approval',`模型请求运行 ${actual} 风险命令，请确认具体命令`,{command,reason:args.reason,risk:actual});throw new PauseForApproval('等待命令审批')
      }
      return this.runCommand(task.id,project.path,command,commands,state)
    }
    throw new Error(`不支持的工具：${call.name}`)
  }

  private assertWritable(task:TaskRecord,path:string,protectedPaths:string[]):void {
    const normalized=path.replaceAll('\\','/')
    if(['README.md','AGENTS.md'].includes(normalized)&&!task.plan.allowParrotEdits)
      throw new Error(this.tr(`${normalized} 是项目治理文件。用户未明确要求更新文档，Agent 不得修改。`,`${normalized} is a project-governance file. The user did not explicitly request a documentation update, so the agent may not modify it.`))
    if([...DEFAULT_PROTECTED_PATTERNS,...protectedPaths].some(pattern=>isProtectedMatch(normalized,pattern)))
      throw new Error(`路径 ${normalized} 受项目 Parrot 保护，Agent 不得写入`)
  }

  private saveCheckpoint(task:TaskRecord,messages:AgentMessage[],pendingToolCalls:UnifiedToolCall[],commands:CommandEvidence[]):void {
    task.executionState={messages,pendingToolCalls,commands};task.updatedAt=new Date().toISOString();this.db.saveTask(task)
  }

  private recordUsage(task:TaskRecord,provider:ReturnType<AppDatabase['getProvider']>&{},usage:{input:number;output:number}|undefined):void {
    if(!usage)return
    const current=task.usage??{inputTokens:0,outputTokens:0,requests:0,estimatedCostUsd:0,tokenLimit:this.settings.taskPolicy().maxTotalTokens,costLimitUsd:this.settings.taskPolicy().maxEstimatedCostUsd}
    current.inputTokens+=usage.input;current.outputTokens+=usage.output;current.requests++
    current.estimatedCostUsd+=usage.input/1_000_000*provider.inputPricePerMillion+usage.output/1_000_000*provider.outputPricePerMillion
    task.usage=current
  }

  private overBudget(task:TaskRecord):boolean {
    if(task.budgetOverride||!task.usage)return false
    const usage=task.usage;return usage.inputTokens+usage.outputTokens>=usage.tokenLimit||(usage.costLimitUsd>0&&usage.estimatedCostUsd>=usage.costLimitUsd)
  }

  private pauseForBudget(task:TaskRecord,messages:AgentMessage[],commands:CommandEvidence[]):never {
    const usage=task.usage!;task.status='awaiting_approval';task.pendingApproval={kind:'budget',reason:this.tr(`任务已达到预算：${usage.inputTokens+usage.outputTokens.toLocaleString()} tokens，约 $${usage.estimatedCostUsd.toFixed(4)}。批准后将忽略此任务的预算上限。`,`This task reached its budget: ${(usage.inputTokens+usage.outputTokens).toLocaleString()} tokens, about $${usage.estimatedCostUsd.toFixed(4)}. Approval will ignore the budget limit for this task.`)};this.saveCheckpoint(task,messages,[],commands);this.emit(task.id,'approval',task.pendingApproval.reason,{risk:'medium',kind:'budget',usage});throw new PauseForApproval('等待预算批准')
  }

  private requireWriteScopeApproval(task:TaskRecord,path:string,content:string):void {
    if(task.scopeChangeApproved)return
    const current=task.changedPaths??[];const next=current.includes(path)?current:[...current,path]
    const isSensitiveConfig=/(?:^|\/)(?:package\.json|(?:pnpm|package-lock|yarn)\.lock|tsconfig(?:\..+)?\.json|vite\.config\.[^/]+|Dockerfile|docker-compose[^/]*\.ya?ml)$/i.test(path)
    const needsApproval=isSensitiveConfig||content.length>200_000||next.length>=8
    if(!needsApproval)return
    const reason=isSensitiveConfig?this.tr(`将修改配置或锁文件：${path}` ,`The agent wants to modify a configuration or lock file: ${path}`):content.length>200_000?this.tr(`将写入较大文件（${Math.ceil(content.length/1024)} KB）：${path}`,`The agent wants to write a large file (${Math.ceil(content.length/1024)} KB): ${path}`):this.tr(`本任务即将修改 ${next.length} 个文件`, `This task is about to modify ${next.length} files`)
    task.status='awaiting_approval';task.pendingApproval={kind:next.length>=8?'change-scope':'file-change',reason,paths:next};task.updatedAt=new Date().toISOString();this.db.saveTask(task);this.emit(task.id,'approval',reason,{risk:'medium',kind:task.pendingApproval.kind,paths:next});throw new PauseForApproval('等待文件变更范围批准')
  }

  private async search(root:string,start:string,query:string):Promise<string> {
    const base=await resolveInside(root,start);const results:string[]=[];let visited=0;const deadline=Date.now()+4_000
    const walk=async(path:string,depth:number):Promise<void>=>{
      if(depth>16||visited>=5_000||results.length>=200||Date.now()>deadline)return
      let entries
      try { entries=await readdir(path,{withFileTypes:true}) } catch { return }
      for(const e of entries){
        if(visited>=5_000||results.length>=200||Date.now()>deadline)return
        if(['.git','node_modules','dist','build','out','.cache','coverage'].includes(e.name)||e.isSymbolicLink())continue
        const p=`${path}/${e.name}`;visited++
        if(e.isDirectory()){await walk(p,depth+1);continue}
        if(!e.isFile())continue
        try {
          const text=await readLimitedTextFile(p,512*1024)
          if(text.binary)continue
          text.content.split('\n').forEach((line,i)=>{if(line.includes(query)&&results.length<200)results.push(`${relative(root,p)}:${i+1}: ${line.slice(0,300)}`)})
        } catch {}
      }
    }
    await walk(base,0)
    const suffix=visited>=5_000||Date.now()>deadline?'\n\n[搜索已达到安全上限，仅返回部分结果]':''
    return (results.join('\n')||'没有找到匹配内容')+suffix
  }

  private runCommand(taskId:string,cwd:string,command:string,evidence:CommandEvidence[],state:RunningTask):Promise<string> {
    if(process.platform==='win32')return this.runWindowsCommand(taskId,cwd,command,evidence,state)
    return new Promise(resolve=>{
      const startedAt=new Date().toISOString();const environment=buildCommandEnvironment(process.env);let output='';let settled=false
      const append=(text:string)=>{output+=text;if(output.length>500_000)output=output.slice(-500_000);this.emit(taskId,'terminal',text,{command},false)}
      const finish=(terminal:TerminalHandle|undefined,exitCode:number|null)=>{if(settled)return;settled=true;if(terminal)state.terminals.delete(terminal);this.db.saveEvent(taskId,'terminal',output,{command,exitCode});const item:CommandEvidence={command,exitCode,output:stripAnsi(output),startedAt,endedAt:new Date().toISOString()};evidence.push(item);resolve(commandResultForModel(item))}
      const runStandardShell=(ptyError:unknown)=>{
        append(this.tr(`交互终端启动失败：${commandStartFailureMessage(ptyError)}。已自动改用标准 shell 继续执行。\n`,`Interactive terminal failed to start: ${commandStartFailureMessage(ptyError)}. Retrying with the standard shell.\n`))
        try {
          const terminal=spawnChild('/bin/zsh',['-lc',command],{cwd,env:environment,windowsHide:true})
          state.terminals.add(terminal)
          terminal.stdout?.on('data',data=>append(data.toString()))
          terminal.stderr?.on('data',data=>append(data.toString()))
          terminal.once('error',error=>{append(this.tr(`标准 shell 启动失败：${commandStartFailureMessage(error)}\n`,`Standard shell failed to start: ${commandStartFailureMessage(error)}\n`));finish(terminal,127)})
          terminal.once('close',exitCode=>finish(terminal,exitCode??1))
        } catch(error) {
          append(this.tr(`标准 shell 启动失败：${commandStartFailureMessage(error)}\n`,`Standard shell failed to start: ${commandStartFailureMessage(error)}\n`))
          finish(undefined,127)
        }
      }
      try {
        const pty=require('node-pty') as typeof import('node-pty');const terminal=pty.spawn('/bin/zsh',['-lc',command],{cwd,env:environment,cols:100,rows:30})
        state.terminals.add(terminal)
        terminal.onData(append)
        terminal.onExit(({exitCode})=>finish(terminal,exitCode))
      } catch(error) { runStandardShell(error) }
    })
  }

  private runWindowsCommand(taskId:string,cwd:string,command:string,evidence:CommandEvidence[],state:RunningTask):Promise<string> {
    return new Promise(resolve=>{
      const startedAt=new Date().toISOString();let output='';let settled=false;const shell=process.env.ComSpec||'cmd.exe';const environment=buildCommandEnvironment(process.env)
      const append=(data:Buffer|string)=>{const text=typeof data==='string'?data:data.toString();output+=text;if(output.length>500_000)output=output.slice(-500_000);this.emit(taskId,'terminal',text,{command},false)}
      const finish=(terminal:TerminalHandle|undefined,exitCode:number|null)=>{if(settled)return;settled=true;if(terminal)state.terminals.delete(terminal);this.db.saveEvent(taskId,'terminal',output,{command,exitCode});const item:CommandEvidence={command,exitCode,output:stripAnsi(output),startedAt,endedAt:new Date().toISOString()};evidence.push(item);resolve(commandResultForModel(item))}
      try {
        const terminal=spawnChild(shell,['/d','/s','/c',command],{cwd,env:environment,windowsHide:true})
        state.terminals.add(terminal)
        terminal.stdout?.on('data',append);terminal.stderr?.on('data',append)
        terminal.once('error',error=>{append(this.tr(`命令 shell 启动失败：${commandStartFailureMessage(error)}\n`,`Command shell failed to start: ${commandStartFailureMessage(error)}\n`));finish(terminal,127)})
        terminal.once('close',exitCode=>finish(terminal,exitCode??1))
      } catch(error) {
        append(this.tr(`命令 shell 启动失败：${commandStartFailureMessage(error)}\n`,`Command shell failed to start: ${commandStartFailureMessage(error)}\n`))
        finish(undefined,127)
      }
    })
  }

  private async buildEvidence(task:TaskRecord,commands:CommandEvidence[]):Promise<EvidenceBundle> {
    if(task.mode!=='edit')return {changedFiles:[],commands:[],tests:[],parrotReview:{compliant:true,issues:[]},snapshotAvailable:false,remainingRisks:[]}
    const snapshotEvidence=await this.snapshots.evidence(task.id);const changes=snapshotEvidence.changes;const status=await getParrotStatus(this.db,task.projectId)
    const tests:TestEvidence[]=commands.filter(c=>/\b(test|lint|typecheck|build)\b/i.test(c.command)).map(c=>({...c,passed:c.exitCode===0}))
    return {changedFiles:changes,fileHashes:snapshotEvidence.fileHashes,commands,tests,parrotReview:{compliant:status.valid&&(status.approved||!changes.some(c=>['README.md','AGENTS.md'].includes(c.path))),issues:status.issues.map(i=>i.message)},snapshotAvailable:true,remainingRisks:tests.length?[]:[this.tr('Agent 未运行可识别的测试命令，请人工验证','No recognized test command was run. Manual verification is required.')]}
  }

  async revert(taskId:string):Promise<EvidenceBundle> {
    const task=this.db.getTask(taskId);if(!task)throw new Error('任务不存在');if(task.mode!=='edit')throw new Error('Ask 和 Plan 模式没有可回退的文件变更');const reverted=await this.snapshots.restore(taskId)
    const evidence:EvidenceBundle={changedFiles:reverted,commands:[],tests:[],parrotReview:{compliant:true,issues:[]},snapshotAvailable:true,remainingRisks:[]}
    task.status='reverted';task.evidence=evidence;task.updatedAt=new Date().toISOString();this.db.saveTask(task);await this.finalizeReceipt(task.id);this.emit(taskId,'evidence',this.tr('已恢复到任务开始前状态','Restored the pre-task state'),evidence);return evidence
  }

  private async finalizeReceipt(taskId:string):Promise<void> {
    try { await this.receipts.finalize(taskId) }
    catch(error) { this.emit(taskId,'status',this.tr('变更凭证暂不可用；任务结果未受影响','Change Receipt is temporarily unavailable; the task result is unaffected'),{receiptError:(error as Error).message}) }
  }
}

const stripAnsi=(v:string)=>v.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,'')
