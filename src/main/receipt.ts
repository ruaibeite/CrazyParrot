import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { AppDatabase } from './database'
import type { SnapshotService } from './snapshot'
import { resolveInside } from './security'
import type { ChangeReceipt, ChangeReceiptDetail, ReceiptDrift, ReceiptDriftFile, ReceiptFileHash, TaskApproval, TaskRecord } from '../shared/types'

const PRIVACY_NOTICE='This receipt contains relative paths and redacted metadata only. It excludes credentials, source-file contents, full project paths, raw terminal output, and model reasoning. AI request context is sent only to the provider selected by the user.'
const RECEIPT_STATUSES=new Set(['completed','failed','cancelled','reverted'])

/** Stable JSON is deliberately small and dependency-free so a receipt hash can be reproduced. */
export function canonicalJson(value:unknown):string {
  if(value===null||typeof value==='boolean'||typeof value==='number'||typeof value==='string')return JSON.stringify(value)
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`
  if(typeof value==='object'){
    const object=value as Record<string,unknown>
    return `{${Object.keys(object).filter(key=>object[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  throw new Error(`Unsupported receipt value: ${typeof value}`)
}

export function hashReceipt(payload:Omit<ChangeReceipt,'receiptHash'>):string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export function redactReceiptText(value:string,maxLength=2_000):string {
  const withoutCode=value.replace(/```[\s\S]*?```/g,'[redacted code excerpt]')
  const redacted=withoutCode
    .replace(/^\s*(?:const|let|var|function|class|import|export|interface|type)\b.*$/gmi,'[redacted code excerpt]')
    .replace(/\b(authorization\s*:\s*)(?:bearer\s+)?[^\s,;]+/gi,'$1Bearer [redacted]')
    .replace(/(?:\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|bearer)\b\s*[:=]\s*)([^\s,;]+)/gi,'$1[redacted]')
    .replace(/\b(?:sk|rk|pk|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g,'[redacted]')
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|var|Volumes)\/)[^\s'"`]+/g,'[redacted-path]')
  return redacted.length>maxLength?`${redacted.slice(0,maxLength)}…`:redacted
}

export function redactReceiptCommand(value:string,projectPath?:string):string {
  const withoutProject=projectPath?value.split(projectPath).join('[redacted-project]'):value
  return redactReceiptText(withoutProject,1_000)
    .replace(/(--(?:api[-_]?key|token|password|secret)\s+)([^\s]+)/gi,'$1[redacted]')
    .replace(/(authorization\s*:\s*bearer\s+)([^\s'"\\]+)/gi,'$1[redacted]')
    .replace(/([?&](?:token|api[_-]?key|key|secret)=)([^&\s]+)/gi,'$1[redacted]')
}

export function formatReceiptMarkdown(receipt:ChangeReceipt):string {
  const lines=[
    '# CrazyParrot Change Receipt',
    '',
    `- Receipt hash: \`${receipt.receiptHash}\``,
    `- Task: \`${receipt.taskId}\``,
    `- Status: **${receipt.status}**`,
    `- Created: ${receipt.createdAt}`,
    `- Captured: ${receipt.capturedAt}`,
    '',
    '## Goal',
    '',
    receipt.goal,
    '',
    '## What changed',
    '',
    ...(receipt.files.length?receipt.files.map(file=>`- \`${file.path}\` — ${file.type}; before \`${file.beforeHash??'absent'}\`, after \`${file.afterHash??'absent'}\``):['- No tracked file changes.']),
    '',
    '## Why it was allowed',
    '',
    `- Risk: **${receipt.riskLevel}**`,
    `- Provider: ${receipt.provider?`${receipt.provider.name} / ${receipt.provider.model}`:'not available'}`,
    `- Parrot: ${receipt.parrot.approved?'approved':'not approved'}${receipt.parrot.hash?` (\`${receipt.parrot.hash}\`)`:''}`,
    ...(receipt.approvals.length?receipt.approvals.map(item=>`- ${item.kind} approved at ${item.approvedAt}: ${item.reason}`):['- No explicit approval was required.']),
    '',
    '## Verification',
    '',
    `- ${receipt.verification.summary}`,
    `- Tests: ${receipt.tests.length?`${receipt.tests.filter(test=>test.passed).length}/${receipt.tests.length} passed`:'not run'}`,
    ...(receipt.usage?[`- Usage: ${receipt.usage.inputTokens.toLocaleString()} input tokens, ${receipt.usage.outputTokens.toLocaleString()} output tokens, ${receipt.usage.requests} request${receipt.usage.requests===1?'':'s'}, estimated $${receipt.usage.estimatedCostUsd.toFixed(4)}.`]:[]),
    ...(receipt.tests.length?receipt.tests.map(test=>`- ${test.passed?'PASS':'FAIL'} \`${test.command}\` (exit ${test.exitCode??'unknown'})`):[]),
    '',
    '## Executed commands',
    '',
    ...(receipt.commands.length?receipt.commands.map(command=>`- \`${command.command}\` (exit ${command.exitCode??'unknown'})`):['- No commands were executed.']),
    '',
    '## Undo',
    '',
    receipt.rollback.snapshotId?`Restore snapshot \`${receipt.rollback.snapshotId}\`${receipt.rollback.manifestHash?` (manifest \`${receipt.rollback.manifestHash}\`)`:''}.`:'No snapshot was created for this read-only task.',
    '',
    '## Privacy',
    '',
    receipt.privacyNotice,
    ''
  ]
  return lines.join('\n')
}

function requiredApprovals(task:TaskRecord):ChangeReceipt['intent']['requiredApprovals'] {
  const values=new Set(task.approvals?.map(item=>item.kind)??[])
  if(task.mode==='edit'&&task.riskLevel!=='low')values.add('task')
  return [...values]
}

function testStatus(tests:ChangeReceipt['tests']):ChangeReceipt['verification']['testStatus'] {
  if(!tests.length)return 'not-run'
  return tests.every(test=>test.passed)?'passed':'failed'
}

function verificationSummary(status:ChangeReceipt['status'],tests:ChangeReceipt['tests'],parrotCompliant:boolean):string {
  const testResult=testStatus(tests)
  const testText=testResult==='not-run'?'No test command was recorded.':testResult==='passed'?`${tests.length} recorded test command${tests.length===1?'':'s'} passed.`:'One or more recorded test commands failed.'
  const finalText=status==='reverted'?'The workspace baseline is the restored snapshot.':status==='completed'?'The task completed.':status==='cancelled'?'The task was cancelled; inspect workspace drift before relying on its result.':'The task failed; inspect workspace drift before relying on its result.'
  return `${finalText} ${testText} Parrot review: ${parrotCompliant?'compliant':'issues recorded'}.`
}

function toReceiptFiles(files:ReceiptFileHash[]):ReceiptFileHash[] {
  return files.map(file=>({path:file.path.replaceAll('\\','/'),type:file.type,beforeHash:file.beforeHash,afterHash:file.afterHash}))
}

function receiptPath(value:string,projectPath:string):string {
  const normalized=value.replaceAll('\\','/')
  const root=projectPath.replaceAll('\\','/').replace(/\/+$/,'')
  if(normalized===root||normalized.startsWith(`${root}/`))return normalized.slice(root.length).replace(/^\/+/, '')||'.'
  if(/^(?:[A-Za-z]:\/|\/)/.test(normalized))return '[redacted-path]'
  return normalized
}

export class ReceiptService {
  constructor(private db:AppDatabase,private snapshots:SnapshotService) {}

  async finalize(taskId:string):Promise<ChangeReceipt|null> {
    const task=this.db.getTask(taskId)
    if(!task||!RECEIPT_STATUSES.has(task.status))return null
    const status=task.status as ChangeReceipt['status']
    const existing=this.db.getReceipt(taskId)
    // Records created before this feature have no execution Parrot hash. Do not
    // synthesize a misleading receipt for them; the UI labels them as legacy.
    if(!existing&&!task.parrotHash)return null
    if(existing&&status!=='reverted')return existing
    if(status==='reverted'&&existing){
      const updated=this.withHash({...existing,status,capturedAt:new Date().toISOString(),verification:{...existing.verification,workspaceBaseline:'snapshot',summary:verificationSummary('reverted',existing.tests,existing.verification.parrotCompliant)},remainingRisks:[]})
      this.db.saveReceipt(updated)
      return updated
    }
    const project=this.db.getProject(task.projectId)
    if(!project)throw new Error('Receipt cannot be created because its project no longer exists')
    const provider=this.db.getProvider(task.providerId)
    const snapshot=this.db.listSnapshots(task.projectId).find(item=>item.taskId===task.id)
    const evidence=task.evidence
    const files=evidence?.fileHashes??(snapshot?await this.snapshots.receiptFileHashes(task.id):[])
    const tests=(evidence?.tests??[]).map(test=>({command:redactReceiptCommand(test.command,project.path),exitCode:test.exitCode,startedAt:test.startedAt,endedAt:test.endedAt,passed:test.passed}))
    const parrotCompliant=evidence?.parrotReview.compliant??true
    const receipt=this.withHash({
      schemaVersion:1,
      taskId:task.id,
      projectId:task.projectId,
      createdAt:task.createdAt,
      capturedAt:new Date().toISOString(),
      status,
      goal:redactReceiptText(task.prompt.split(project.path).join('[redacted-project]')),
      mode:task.mode,
      riskLevel:task.riskLevel,
      provider:provider?{name:redactReceiptText(provider.name,200),model:redactReceiptText(provider.model,200),protocol:provider.protocol}:null,
      parrot:{hash:task.parrotHash??null,approved:Boolean(task.parrotHash)},
      intent:{summary:redactReceiptText(task.plan.summary.split(project.path).join('[redacted-project]')),predictedPaths:task.plan.affectedPaths.map(path=>receiptPath(path,project.path)).slice(0,200),commands:task.plan.commands.map(command=>({command:redactReceiptCommand(command.command,project.path),reason:redactReceiptText(command.reason.split(project.path).join('[redacted-project]'),500)})),acceptanceChecks:task.plan.acceptanceChecks.map(check=>redactReceiptText(check.split(project.path).join('[redacted-project]'),500)),requiredApprovals:requiredApprovals(task)},
      approvals:(task.approvals??[]).map(approval=>this.redactApproval(approval,project.path)),
      files:toReceiptFiles(files),
      commands:(evidence?.commands??[]).map(command=>({command:redactReceiptCommand(command.command,project.path),exitCode:command.exitCode,startedAt:command.startedAt,endedAt:command.endedAt})),
      tests,
      ...(task.usage?{usage:{...task.usage}}:{}),
      remainingRisks:(evidence?.remainingRisks??[]).map(risk=>redactReceiptText(risk.split(project.path).join('[redacted-project]'),500)),
      verification:{summary:verificationSummary(status,tests,parrotCompliant),parrotCompliant,testStatus:testStatus(tests),workspaceBaseline:status==='reverted'?'snapshot':'after-task'},
      rollback:snapshot?{snapshotId:task.id,manifestHash:snapshot.manifestHash}:{},
      privacyNotice:PRIVACY_NOTICE
    })
    this.db.saveReceipt(receipt)
    return receipt
  }

  get(taskId:string):ChangeReceiptDetail|null {
    const receipt=this.db.getReceipt(taskId)
    if(!receipt)return null
    return {receipt,snapshotPresent:this.db.listSnapshots(receipt.projectId).some(item=>item.taskId===taskId)}
  }

  async drift(taskId:string):Promise<ReceiptDrift> {
    const receipt=this.db.getReceipt(taskId)
    if(!receipt)throw new Error('Change Receipt is unavailable for this legacy task')
    const project=this.db.getProject(receipt.projectId)
    const checkedAt=new Date().toISOString()
    if(!project)return {taskId,checkedAt,state:'unavailable',files:receipt.files.map(file=>({path:file.path,expectedHash:this.expectedHash(receipt,file),currentHash:null,status:'unavailable'}))}
    const files=await Promise.all(receipt.files.map(file=>this.checkFile(project.path,receipt,file)))
    const state=files.some(file=>['changed','missing','unexpected'].includes(file.status))?'drifted':files.some(file=>file.status==='unavailable')?'unavailable':'in-sync'
    return {taskId,checkedAt,state,files}
  }

  private withHash(receipt:Omit<ChangeReceipt,'receiptHash'>|ChangeReceipt):ChangeReceipt {
    const {receiptHash:_ignored,...payload}=receipt as ChangeReceipt
    return {...payload,receiptHash:hashReceipt(payload)}
  }

  private redactApproval(approval:TaskApproval,projectPath:string):TaskApproval {
    return {...approval,reason:redactReceiptText(approval.reason.split(projectPath).join('[redacted-project]'),500),...(approval.command?{command:redactReceiptCommand(approval.command,projectPath)}:{}),...(approval.paths?{paths:approval.paths.map(path=>receiptPath(path,projectPath)).slice(0,200)}:{})}
  }

  private expectedHash(receipt:ChangeReceipt,file:ReceiptFileHash):string|null {
    return receipt.verification.workspaceBaseline==='snapshot'?file.beforeHash:file.afterHash
  }

  private async checkFile(projectPath:string,receipt:ChangeReceipt,file:ReceiptFileHash):Promise<ReceiptDriftFile> {
    const expectedHash=this.expectedHash(receipt,file)
    try {
      const target=await resolveInside(projectPath,file.path,false)
      let stat
      try { stat=await lstat(target) } catch(error) {
        if((error as NodeJS.ErrnoException).code==='ENOENT')return {path:file.path,expectedHash,currentHash:null,status:expectedHash?'missing':'in-sync'}
        return {path:file.path,expectedHash,currentHash:null,status:'unavailable'}
      }
      if(!stat.isFile())return {path:file.path,expectedHash,currentHash:null,status:expectedHash?'changed':'unexpected'}
      const currentHash=createHash('sha256').update(await readFile(target)).digest('hex')
      if(!expectedHash)return {path:file.path,expectedHash,currentHash,status:'unexpected'}
      return {path:file.path,expectedHash,currentHash,status:currentHash===expectedHash?'in-sync':'changed'}
    } catch { return {path:file.path,expectedHash,currentHash:null,status:'unavailable'} }
  }
}
