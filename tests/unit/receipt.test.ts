import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { canonicalJson, formatReceiptMarkdown, hashReceipt, ReceiptService, redactReceiptCommand, redactReceiptText } from '../../src/main/receipt'
import { SnapshotService } from '../../src/main/snapshot'
import type { ChangeReceipt, TaskRecord } from '../../src/shared/types'

const plan={summary:'Change one file',affectedPaths:['src/app.ts'],commands:[{command:'npm test',reason:'verify'}],acceptanceChecks:['tests pass'],parrotConflicts:[],riskLevel:'low' as const}
function receipt(overrides:Partial<ChangeReceipt>={}):ChangeReceipt {
  const payload:Omit<ChangeReceipt,'receiptHash'>={schemaVersion:1,taskId:'t',projectId:'p',createdAt:'2026-01-01T00:00:00.000Z',capturedAt:'2026-01-01T00:01:00.000Z',status:'completed',goal:'Change app',mode:'edit',riskLevel:'low',provider:{name:'Local',model:'model',protocol:'openai-chat'},parrot:{hash:'abc',approved:true},intent:{summary:'Change',predictedPaths:['src/app.ts'],commands:[],acceptanceChecks:[],requiredApprovals:[]},approvals:[],files:[{path:'src/app.ts',type:'modified',beforeHash:'before',afterHash:'after'}],commands:[{command:'npm test',exitCode:0,startedAt:'2026-01-01T00:00:00.000Z',endedAt:'2026-01-01T00:00:01.000Z'}],tests:[{command:'npm test',exitCode:0,startedAt:'2026-01-01T00:00:00.000Z',endedAt:'2026-01-01T00:00:01.000Z',passed:true}],usage:{inputTokens:10,outputTokens:5,requests:1,estimatedCostUsd:0.01,tokenLimit:100,costLimitUsd:1},remainingRisks:[],verification:{summary:'Verified',parrotCompliant:true,testStatus:'passed',workspaceBaseline:'after-task'},rollback:{snapshotId:'t',manifestHash:'m'},privacyNotice:'Redacted'}
  const next={...payload,...overrides}
  return {...next,receiptHash:hashReceipt(next)}
}

describe('Change Receipts',()=>{
  it('hashes canonical payloads regardless of object key order',()=>{
    expect(canonicalJson({b:2,a:[{z:true,y:null}]})).toBe('{"a":[{"y":null,"z":true}],"b":2}')
    const {receiptHash:_hash,...payload}=receipt()
    expect(hashReceipt(payload)).toBe(hashReceipt({...payload}))
  })
  it('redacts credentials, full paths, and pasted code from export fields',()=>{
    const text=redactReceiptText('apiKey=sk_abcdefghijklmnop at /Users/someone/project\n```ts\nconst secret = 1\n```')
    expect(text).not.toContain('sk_abcdefghijklmnop');expect(text).not.toContain('/Users/someone');expect(text).toContain('[redacted code excerpt]')
    expect(redactReceiptCommand('curl -H "Authorization: Bearer secret-value" --token abc')).not.toContain('secret-value')
    const markdown=formatReceiptMarkdown(receipt({goal:text,commands:[{command:redactReceiptCommand('curl --token abc'),exitCode:0,startedAt:'a',endedAt:'b'}]}))
    expect(markdown).not.toContain('secret-value');expect(markdown).toContain('## Privacy')
  })
  it('captures file hashes, approval history, export-safe receipt fields, and workspace drift',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-receipt-'));const project=join(root,'project');await mkdir(join(project,'src'),{recursive:true});await writeFile(join(project,'src','app.ts'),'before')
    const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p',name:'project',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveProvider({id:'provider',name:'Provider',protocol:'openai-chat',baseUrl:'https://example.com',model:'model',encryptedCredentialId:'credential',thinkingEnabled:false,reasoningEffort:'high',maxContext:1000,taskBudget:1000,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0,verifiedAt:now})
    const task:TaskRecord={id:'t',projectId:'p',parrotHash:'parrot-hash',prompt:'Update /Users/name/private with apiKey=sk_abcdefghijklmnop',mode:'edit',status:'completed',riskLevel:'medium',plan:{...plan,affectedPaths:[join(project,'src','app.ts'),'/outside/project']},approvals:[{kind:'task',reason:'Review src/app.ts',approvedAt:now,paths:['src/app.ts',join(project,'src','app.ts'),'/outside/project']}],evidence:{changedFiles:[],commands:[{command:'npm test',exitCode:0,output:'source output must not export',startedAt:now,endedAt:now}],tests:[{command:'npm test',exitCode:0,output:'source output must not export',startedAt:now,endedAt:now,passed:true}],parrotReview:{compliant:true,issues:[]},snapshotAvailable:true,remainingRisks:[]},createdAt:now,updatedAt:now}
    db.saveTask(task,'provider');const snapshots=new SnapshotService(join(root,'snapshots'),db);await snapshots.create('t','p',project);await writeFile(join(project,'src','app.ts'),'after')
    const receipts=new ReceiptService(db,snapshots);const created=await receipts.finalize('t')
    expect(created?.files).toHaveLength(1);expect(created?.approvals[0]?.kind).toBe('task');expect(created?.goal).not.toContain('/Users/name');expect(created?.goal).not.toContain('sk_abcdefghijklmnop')
    expect(created?.intent.predictedPaths).toEqual(['src/app.ts','[redacted-path]']);expect(created?.approvals[0]?.paths).toEqual(['src/app.ts','src/app.ts','[redacted-path]'])
    expect(db.listReceiptSummaries('p')[0]).toMatchObject({taskId:'t',changedFileCount:1,passedTests:1,totalTests:1})
    const exported=formatReceiptMarkdown(created!);expect(exported).not.toContain('source output must not export')
    expect((await receipts.drift('t')).state).toBe('in-sync')
    await writeFile(join(project,'src','app.ts'),'later')
    expect((await receipts.drift('t')).files[0]?.status).toBe('changed')
    await snapshots.restore('t');task.status='reverted';task.updatedAt=new Date().toISOString();db.saveTask(task);const reverted=await receipts.finalize('t')
    expect(reverted?.status).toBe('reverted');expect(reverted?.files).toHaveLength(1);expect((await receipts.drift('t')).state).toBe('in-sync')
    expect(await readFile(join(project,'src','app.ts'),'utf8')).toBe('before')
  })
  it('creates terminal receipts for failed, cancelled, and no-file-change tasks while leaving legacy tasks unavailable',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-receipt-terminal-'));const project=join(root,'project');await mkdir(project)
    const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p',name:'project',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveProvider({id:'provider',name:'Provider',protocol:'openai-chat',baseUrl:'https://example.com',model:'model',encryptedCredentialId:'credential',thinkingEnabled:false,reasoningEffort:'high',maxContext:1000,taskBudget:1000,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0,verifiedAt:now})
    const snapshots=new SnapshotService(join(root,'snapshots'),db);const receipts=new ReceiptService(db,snapshots)
    for(const status of ['failed','cancelled','completed'] as const){const task:TaskRecord={id:status,projectId:'p',parrotHash:'hash',prompt:`${status} task`,mode:'ask',status,riskLevel:'low',plan,createdAt:now,updatedAt:now};db.saveTask(task,'provider');const result=await receipts.finalize(status);expect(result?.status).toBe(status);expect(result?.files).toEqual([])}
    const legacy:TaskRecord={id:'legacy',projectId:'p',prompt:'old task',mode:'ask',status:'completed',riskLevel:'low',plan,createdAt:now,updatedAt:now};db.saveTask(legacy,'provider')
    expect(await receipts.finalize('legacy')).toBeNull();expect(receipts.get('legacy')).toBeNull()
  })
})
