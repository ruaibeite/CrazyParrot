import { access, lstat, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { z } from 'zod'
import type { AppDatabase } from './database'
import type { CredentialStore } from './credentials'
import type { SnapshotService } from './snapshot'
import type { ReceiptService } from './receipt'
import type { AgentService } from './agent'
import { approveParrot, auditParrot, checkCompliance, generateParrotDraft, getParrotStatus, saveParrot, validateParrot } from './parrot'
import { ParrotOptimizeService, optimizeInputSchema } from './parrot-ai'
import { AppearanceService, appearanceInputSchema } from './appearance'
import { AppSettingsService, historyPolicySchema, preferencesSchema, taskPolicySchema } from './appSettings'
import { FileIndexCache } from './fileIndex'
import { checkForUpdates, RELEASE_PAGE } from './update'
import { ProviderClient } from './provider'
import { resolveInside } from './security'
import { readLimitedTextFile } from './fileAccess'
import { IPC } from '../shared/ipc'
import { formatReceiptMarkdown } from './receipt'
import type { ProviderInput, ProviderProfile } from '../shared/types'

const id=z.string().min(1).max(200)
const providerSchema=z.object({
  id:z.string().optional(),name:z.string().min(1).max(100),protocol:z.enum(['openai-chat','anthropic-messages']),
  baseUrl:z.string().url(),model:z.string().min(1).max(200),apiKey:z.string().optional(),customHeaders:z.record(z.string(),z.string()).optional(),
  thinkingEnabled:z.boolean(),reasoningEffort:z.enum(['high','max']),maxContext:z.number().int().positive().max(2_000_000),
  taskBudget:z.number().int().positive().max(1_000_000),timeoutMs:z.number().int().min(1000).max(600_000),
  inputPricePerMillion:z.number().min(0).max(100_000),outputPricePerMillion:z.number().min(0).max(100_000)
})

function assertApiUrl(value:string):void {
  const url=new URL(value)
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname))throw new Error('远程 API 必须使用 HTTPS')
  if(url.username||url.password)throw new Error('API 地址不能包含用户名或密码')
}

export function registerIpc(db:AppDatabase,credentials:CredentialStore,snapshots:SnapshotService,receipts:ReceiptService,agent:AgentService,optimizer:ParrotOptimizeService,appearance:AppearanceService,settings:AppSettingsService):void {
  const fileIndex=new FileIndexCache()
  ipcMain.handle(IPC.APP_VERSION,()=>app.getVersion())
  ipcMain.handle(IPC.OPEN_PATH,async(_e,path:unknown)=>{const p=z.string().parse(path);if(!db.listProjects().some(project=>project.path===p))throw new Error('只能在 Finder 中打开已添加的项目根目录');const error=await shell.openPath(p);if(error)throw new Error(error)})
  ipcMain.handle(IPC.APP_PREFERENCES,()=>settings.preferences())
  ipcMain.handle(IPC.APP_PREFERENCES_SAVE,(_e,raw:unknown)=>settings.savePreferences(preferencesSchema.parse(raw)))
  ipcMain.handle(IPC.APP_TASK_POLICY,()=>settings.taskPolicy())
  ipcMain.handle(IPC.APP_TASK_POLICY_SAVE,(_e,raw:unknown)=>settings.saveTaskPolicy(taskPolicySchema.parse(raw)))
  ipcMain.handle(IPC.APP_HISTORY_POLICY,()=>settings.historyPolicy())
  ipcMain.handle(IPC.APP_HISTORY_POLICY_SAVE,(_e,raw:unknown)=>settings.saveHistoryPolicy(historyPolicySchema.parse(raw)))
  ipcMain.handle(IPC.APP_HISTORY_CLEANUP,async()=>{
    const cutoff=new Date(Date.now()-settings.historyPolicy().retentionDays*86_400_000).toISOString();const ids=db.listCompletedTaskIdsBefore(cutoff);let reclaimedSnapshots=0
    for(const taskId of ids){try{await snapshots.remove(taskId);reclaimedSnapshots++}catch{}db.deleteTask(taskId)}
    db.vacuum();return {removedTasks:ids.length,reclaimedSnapshots}
  })
  ipcMain.handle(IPC.APP_DIAGNOSTICS_EXPORT,async()=>{
    const focused=BrowserWindow.getFocusedWindow();const options={title:'Export CrazyParrot diagnostics',defaultPath:`CrazyParrot-diagnostics-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'JSON',extensions:['json']}]};const result=focused?await dialog.showSaveDialog(focused,options):await dialog.showSaveDialog(options)
    if(result.canceled||!result.filePath)return null
    const diagnostics={schemaVersion:1,createdAt:new Date().toISOString(),app:{version:app.getVersion(),platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node},database:db.diagnosticSummary(),snapshots:await snapshots.storage(),providers:db.listProviders().map(provider=>({protocol:provider.protocol,verified:Boolean(provider.verifiedAt),hasInputPricing:provider.inputPricePerMillion>0,hasOutputPricing:provider.outputPricePerMillion>0})),note:'This package intentionally excludes project paths, prompts, source code, API endpoints, credentials, and raw task output.'}
    await writeFile(result.filePath,JSON.stringify(diagnostics,null,2),{encoding:'utf8',mode:0o600});return {path:result.filePath,createdAt:diagnostics.createdAt}
  })
  ipcMain.handle(IPC.APP_UPDATE_CHECK,()=>checkForUpdates())
  ipcMain.handle(IPC.APP_RELEASE_OPEN,async()=>{await shell.openExternal(RELEASE_PAGE)})
  ipcMain.handle(IPC.APPEARANCE_GET,()=>appearance.get())
  ipcMain.handle(IPC.APPEARANCE_SAVE,async(_e,raw:unknown)=>{const saved=await appearance.save(appearanceInputSchema.parse(raw));nativeTheme.themeSource=saved.theme;return saved})
  ipcMain.handle(IPC.APPEARANCE_CHOOSE_BACKGROUND,()=>appearance.chooseBackground(BrowserWindow.getFocusedWindow()))
  ipcMain.handle(IPC.PROJECT_LIST,()=>db.listProjects())
  ipcMain.handle(IPC.PROJECT_LIST_ARCHIVED,()=>db.listArchivedProjects())
  ipcMain.handle(IPC.PROJECT_GET,(_e,projectId:unknown)=>db.getProject(id.parse(projectId)))
  ipcMain.handle(IPC.PROJECT_CHOOSE,async(_e,mode:unknown)=>{
    z.enum(['new','import']).parse(mode)
    const options={title:mode==='new'?'选择或创建项目目录':'导入本地项目',properties:['openDirectory','createDirectory'] as Array<'openDirectory'|'createDirectory'>}
    const focused=BrowserWindow.getFocusedWindow();const result=focused?await dialog.showOpenDialog(focused,options):await dialog.showOpenDialog(options)
    return result.canceled?null:result.filePaths[0]??null
  })
  ipcMain.handle(IPC.PROJECT_ADD,async(_e,pathValue:unknown)=>{
    const path=await realpath(z.string().parse(pathValue));if(!(await stat(path)).isDirectory())throw new Error('选择的路径不是目录')
    const existing=db.getProjectByPath(path);if(existing){if(existing.archivedAt)db.restoreProject(existing.id);return db.getProject(existing.id)!}
    const now=new Date().toISOString();let hasGit=true;try{await access(join(path,'.git'))}catch{hasGit=false}
    const project={id:crypto.randomUUID(),name:basename(path)||path,path,createdAt:now,updatedAt:now,hasGit};db.saveProject(project);return project
  })
  ipcMain.handle(IPC.PROJECT_ARCHIVE,(_e,rawProjectId:unknown)=>{
    const projectId=id.parse(rawProjectId);if(!db.getProject(projectId))throw new Error('项目不存在')
    if(db.hasActiveTasksForProject(projectId))throw new Error('项目仍有进行中、待发送或可恢复的任务，无法归档')
    db.archiveProject(projectId)
  })
  ipcMain.handle(IPC.PROJECT_RESTORE,(_e,rawProjectId:unknown)=>{
    const projectId=id.parse(rawProjectId);if(!db.getProject(projectId))throw new Error('项目不存在')
    db.restoreProject(projectId)
  })
  ipcMain.handle(IPC.PROJECT_REMOVE,async(_e,rawProjectId:unknown)=>{
    const projectId=id.parse(rawProjectId);const project=db.getProject(projectId);if(!project)throw new Error('项目不存在')
    if(!project.archivedAt)throw new Error('请先归档项目，再从 CrazyParrot 移除记录')
    if(db.hasActiveTasksForProject(projectId))throw new Error('项目仍有进行中的任务，无法移除')
    for(const snapshot of db.listSnapshots(projectId))await snapshots.remove(snapshot.taskId)
    db.deleteProject(projectId)
  })
  ipcMain.handle(IPC.PROJECT_FILES,async(_e,projectId:unknown,pathValue:unknown,refreshValue:unknown)=>{
    const project=db.getProject(id.parse(projectId));if(!project)throw new Error('项目不存在')
    const requested=pathValue?z.string().max(2000).parse(pathValue):'.';const refresh=z.boolean().optional().parse(refreshValue);const directory=await resolveInside(project.path,requested,false)
    return fileIndex.get(project.id,requested,async()=>{
      if(!(await stat(directory)).isDirectory())throw new Error('目标不是目录')
      const entries=await readdir(directory,{withFileTypes:true});const output:import('../shared/types').ProjectFileEntry[]=[]
      for(const entry of entries){
        if(['.git','node_modules','dist','out','build','.cache'].includes(entry.name))continue
        const absolute=join(directory,entry.name);const itemStat=await lstat(absolute);const path=relative(project.path,absolute).replaceAll('\\','/')
        const type:import('../shared/types').ProjectFileEntry['type']=entry.isSymbolicLink()?'symlink':entry.isDirectory()?'directory':'file'
        output.push({name:entry.name,path,type,...(type==='file'?{size:itemStat.size}:{})})
      }
      return output.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:b.type==='directory'?1:0)
    },refresh)
  })
  ipcMain.handle(IPC.PROJECT_READ_FILE,async(_e,projectId:unknown,pathValue:unknown)=>{
    const project=db.getProject(id.parse(projectId));if(!project)throw new Error('项目不存在')
    const requested=z.string().min(1).max(2000).parse(pathValue);const path=await resolveInside(project.path,requested,false)
    const file=await readLimitedTextFile(path,1024*1024)
    return {path:requested,size:file.size,truncated:file.truncated,binary:file.binary,content:file.binary?'':file.content}
  })
  ipcMain.handle(IPC.PARROT_STATUS,(_e,projectId:unknown)=>getParrotStatus(db,id.parse(projectId)))
  ipcMain.handle(IPC.PARROT_GENERATE,(_e,input:unknown)=>generateParrotDraft(z.object({name:z.string(),goals:z.string(),audience:z.string(),features:z.string(),nonGoals:z.string(),stack:z.string(),commands:z.string(),constraints:z.string()}).parse(input)))
  ipcMain.handle(IPC.PARROT_SAVE,(_e,projectId:unknown,readme:unknown,agentsText:unknown)=>saveParrot(db,id.parse(projectId),z.string().parse(readme),z.string().parse(agentsText)))
  ipcMain.handle(IPC.PARROT_APPROVE,async(_e,projectId:unknown)=>{const key=id.parse(projectId);const result=await approveParrot(db,key);db.saveDecision(key,`确认项目 Parrot 版本 ${result.currentHash.slice(0,12)}`);return result})
  ipcMain.handle(IPC.PARROT_VALIDATE,(_e,readme:unknown,agentsText:unknown)=>{const result=validateParrot(z.string().max(200_000).parse(readme),z.string().max(200_000).parse(agentsText));return {valid:result.valid,issues:result.issues}})
  ipcMain.handle(IPC.PARROT_AI_OPTIMIZE,(_e,raw:unknown)=>optimizer.start(optimizeInputSchema.parse(raw)))
  ipcMain.handle(IPC.PARROT_COMPLIANCE,async(_e,projectId:unknown,paths:unknown)=>{
    const status=await getParrotStatus(db,id.parse(projectId))
    return {violations:checkCompliance(status.parrot,status.approved,z.array(z.string().min(1).max(2000)).max(1000).parse(paths)),checkedHash:status.currentHash}
  })
  ipcMain.handle(IPC.PARROT_AUDIT,(_e,readme:unknown,agentsText:unknown)=>auditParrot(z.string().max(200_000).parse(readme),z.string().max(200_000).parse(agentsText)))
  ipcMain.handle(IPC.PROVIDER_LIST,()=>db.listProviders())
  ipcMain.handle(IPC.PROVIDER_SAVE,async(_e,raw:unknown)=>{
    const input=providerSchema.parse(raw) as ProviderInput;assertApiUrl(input.baseUrl)
    const existing=input.id?db.getProvider(input.id):null;const providerId=input.id??crypto.randomUUID();const credentialId=existing?.encryptedCredentialId??crypto.randomUUID()
    if(input.apiKey)await credentials.set(credentialId,input.apiKey);else if(!existing)throw new Error('新配置必须填写 API 密钥')
    const connectionUnchanged=Boolean(existing&& !input.apiKey && existing.protocol===input.protocol&&existing.baseUrl===input.baseUrl&&existing.model===input.model&&JSON.stringify(existing.customHeaders??{})===JSON.stringify(input.customHeaders??{}))
    const profile:ProviderProfile={id:providerId,name:input.name,protocol:input.protocol,baseUrl:input.baseUrl,model:input.model,encryptedCredentialId:credentialId,
      thinkingEnabled:input.thinkingEnabled,reasoningEffort:input.reasoningEffort,maxContext:input.maxContext,taskBudget:input.taskBudget,timeoutMs:input.timeoutMs,inputPricePerMillion:input.inputPricePerMillion,outputPricePerMillion:input.outputPricePerMillion,
      ...(input.customHeaders?{customHeaders:input.customHeaders}:{}),...(connectionUnchanged&&existing?.verifiedAt?{verifiedAt:existing.verifiedAt}:{})}
    db.saveProvider(profile);return profile
  })
  ipcMain.handle(IPC.PROVIDER_REMOVE,async(_e,providerId:unknown)=>{const key=id.parse(providerId);if(db.hasActiveTasksForProvider(key))throw new Error('该模型仍有排队、执行中、待确认或可恢复的任务，不能删除');const p=db.getProvider(key);if(p)await credentials.remove(p.encryptedCredentialId);db.removeProvider(key)})
  ipcMain.handle(IPC.PROVIDER_TEST,async(_e,raw:unknown)=>{
    const input=providerSchema.parse(raw) as ProviderInput;assertApiUrl(input.baseUrl)
    const existing=input.id?db.getProvider(input.id):null;const apiKey=input.apiKey||(existing?await credentials.get(existing.encryptedCredentialId):'');if(!apiKey)throw new Error('请填写 API 密钥')
    const profile=temporaryProfile(input,existing);const models=await new ProviderClient(profile,apiKey).listModels()
    if(existing){profile.verifiedAt=new Date().toISOString();db.saveProvider(profile)}
    return {ok:true,message:`连接成功，发现 ${models.length} 个模型`,models}
  })
  ipcMain.handle(IPC.PROVIDER_MODELS,async(_e,raw:unknown)=>{
    const input=providerSchema.parse(raw) as ProviderInput;const existing=input.id?db.getProvider(input.id):null;const apiKey=input.apiKey||(existing?await credentials.get(existing.encryptedCredentialId):'');if(!apiKey)throw new Error('请填写 API 密钥')
    return new ProviderClient(temporaryProfile(input,existing),apiKey).listModels()
  })
  ipcMain.handle(IPC.TASK_LIST,(_e,projectId:unknown)=>db.listTasks(id.parse(projectId)))
  ipcMain.handle(IPC.TASK_EVENTS,(_e,taskId:unknown)=>db.listEvents(id.parse(taskId)))
  ipcMain.handle(IPC.TASK_CREATE,(_e,projectId:unknown,prompt:unknown,providerId:unknown,mode:unknown,parentTaskId:unknown)=>agent.create(id.parse(projectId),z.string().min(2).max(20_000).parse(prompt),id.parse(providerId),z.enum(['ask','plan','edit']).parse(mode),parentTaskId===undefined?undefined:id.parse(parentTaskId)))
  ipcMain.handle(IPC.TASK_REORDER,(_e,projectId:unknown,taskIds:unknown)=>agent.reorder(id.parse(projectId),z.array(id).max(100).parse(taskIds)))
  ipcMain.handle(IPC.TASK_COMPACT,(_e,taskId:unknown)=>agent.compact(id.parse(taskId)))
  ipcMain.handle(IPC.TASK_APPROVE,(_e,taskId:unknown)=>agent.approve(id.parse(taskId)))
  ipcMain.handle(IPC.TASK_RESUME,(_e,taskId:unknown)=>agent.resumeInterrupted(id.parse(taskId)))
  ipcMain.handle(IPC.TASK_CANCEL,(_e,taskId:unknown)=>agent.cancel(id.parse(taskId)))
  ipcMain.handle(IPC.TASK_REVERT,(_e,taskId:unknown)=>agent.revert(id.parse(taskId)))
  ipcMain.handle(IPC.RECEIPT_LIST,(_e,projectId:unknown)=>db.listReceiptSummaries(id.parse(projectId)))
  ipcMain.handle(IPC.RECEIPT_GET,(_e,taskId:unknown)=>receipts.get(id.parse(taskId)))
  ipcMain.handle(IPC.RECEIPT_DRIFT,(_e,taskId:unknown)=>receipts.drift(id.parse(taskId)))
  ipcMain.handle(IPC.RECEIPT_EXPORT,async(_e,taskId:unknown,formatValue:unknown)=>{
    const taskKey=id.parse(taskId);const format=z.enum(['json','markdown']).parse(formatValue);const detail=receipts.get(taskKey)
    if(!detail)throw new Error('Change Receipt is unavailable for this legacy task')
    const extension=format==='json'?'json':'md';const options={title:'Export Change Receipt',defaultPath:`CrazyParrot-receipt-${taskKey.slice(0,8)}.${extension}`,filters:[{name:format==='json'?'JSON':'Markdown',extensions:[extension]}]}
    const focused=BrowserWindow.getFocusedWindow();const result=focused?await dialog.showSaveDialog(focused,options):await dialog.showSaveDialog(options)
    if(result.canceled||!result.filePath)return null
    const body=format==='json'?JSON.stringify(detail.receipt,null,2):formatReceiptMarkdown(detail.receipt)
    await writeFile(result.filePath,body,{encoding:'utf8',mode:0o600})
    return {path:result.filePath,format,receiptHash:detail.receipt.receiptHash}
  })
  ipcMain.handle(IPC.SNAPSHOT_LIST,(_e,projectId:unknown)=>db.listSnapshots(projectId?z.string().parse(projectId):undefined))
  ipcMain.handle(IPC.SNAPSHOT_REMOVE,(_e,taskId:unknown)=>snapshots.remove(id.parse(taskId)))
  ipcMain.handle(IPC.SNAPSHOT_DIFF_CONTENT,(_e,taskId:unknown,pathValue:unknown)=>snapshots.readDiffContent(id.parse(taskId),z.string().min(1).max(2000).parse(pathValue)))
  ipcMain.handle(IPC.SNAPSHOT_POLICY,()=>snapshots.policy())
  ipcMain.handle(IPC.SNAPSHOT_POLICY_SAVE,(_e,raw:unknown)=>snapshots.savePolicy(z.object({retentionDays:z.number().int().min(1).max(3650),maxBytes:z.number().int().min(100*1024*1024).max(1024*1024*1024*1024)}).parse(raw)))
  ipcMain.handle(IPC.SNAPSHOT_STORAGE,()=>snapshots.storage())
  ipcMain.handle(IPC.DECISION_LIST,(_e,projectId:unknown)=>db.listDecisions(id.parse(projectId)))
  ipcMain.handle(IPC.DECISION_ADD,(_e,projectId:unknown,content:unknown)=>db.saveDecision(id.parse(projectId),z.string().min(2).max(5000).parse(content)))
  ipcMain.handle(IPC.DECISION_REMOVE,(_e,decisionId:unknown)=>db.removeDecision(id.parse(decisionId)))
}

function temporaryProfile(input:ProviderInput,existing:ProviderProfile|null):ProviderProfile {
  return {id:input.id??'temporary',name:input.name,protocol:input.protocol,baseUrl:input.baseUrl,model:input.model,
    encryptedCredentialId:existing?.encryptedCredentialId??'temporary',thinkingEnabled:input.thinkingEnabled,reasoningEffort:input.reasoningEffort,
    maxContext:input.maxContext,taskBudget:input.taskBudget,timeoutMs:input.timeoutMs,inputPricePerMillion:input.inputPricePerMillion,outputPricePerMillion:input.outputPricePerMillion,...(input.customHeaders?{customHeaders:input.customHeaders}:{}),...(existing?.verifiedAt?{verifiedAt:existing.verifiedAt}:{})}
}
