import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('local decision ledger',()=>{
  it('stores project decisions without requiring Git',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    const decision=db.saveDecision('p','Use Electron for the desktop shell')
    expect(db.listDecisions('p')[0]?.content).toContain('Electron')
    db.removeDecision(decision.id)
    expect(db.listDecisions('p')).toHaveLength(0)
  })
  it('archives project records without deleting the project path',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    db.archiveProject('p')
    expect(db.listProjects()).toHaveLength(0)
    expect(db.listArchivedProjects()[0]).toMatchObject({id:'p',path:root})
    db.restoreProject('p')
    expect(db.listProjects()[0]?.id).toBe('p')
    expect(db.listArchivedProjects()).toHaveLength(0)
  })
  it('persists the task interaction mode',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t',projectId:'p',parentTaskId:'parent',contextSummary:'summary',executionState:{messages:[{role:'user',content:'continue'}],pendingToolCalls:[{id:'call-1',name:'run_command',arguments:'{}'}],commands:[]},pendingApproval:{kind:'budget',reason:'limit reached'},usage:{inputTokens:20,outputTokens:10,requests:1,estimatedCostUsd:0.12,tokenLimit:100,costLimitUsd:1},changedPaths:['src/main.ts'],scopeChangeApproved:true,prompt:'explain',mode:'plan',status:'running',riskLevel:'low',plan:{summary:'plan',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'provider')
    expect(db.getTask('t')?.mode).toBe('plan')
    expect(db.getTask('t')?.parentTaskId).toBe('parent')
    expect(db.getTask('t')?.contextSummary).toBe('summary')
    expect(db.getTask('t')?.executionState?.pendingToolCalls[0]?.name).toBe('run_command')
    expect(db.getTask('t')?.pendingApproval?.kind).toBe('budget')
    expect(db.getTask('t')?.usage?.estimatedCostUsd).toBe(0.12)
    expect(db.getTask('t')?.changedPaths).toEqual(['src/main.ts'])
    db.saveEvent('t','text','历史回答',{source:'model'})
    expect(db.listEvents('t')[0]).toMatchObject({taskId:'t',type:'text',message:'历史回答',payload:{source:'model'}})
  })
  it('does not allow deletion of a provider with an active task',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'active',projectId:'p',prompt:'work',mode:'edit',status:'queued',queueOrder:1,riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'provider')
    expect(db.hasActiveTasksForProvider('provider')).toBe(true)
    expect(db.hasActiveTasksForProvider('other')).toBe(false)
    db.saveTask({id:'recoverable',projectId:'p',prompt:'resume',mode:'edit',status:'interrupted',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'provider')
    expect(db.hasActiveTasksForProvider('provider')).toBe(true)
  })
  it('persists and reorders queued tasks before completed history',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    const plan={summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low' as const}
    for(const [id,order] of [['q1',1],['q2',2]] as const)db.saveTask({id,projectId:'p',prompt:id,mode:'ask',status:'queued',queueOrder:order,riskLevel:'low',plan,createdAt:now,updatedAt:now},'provider')
    db.saveTask({id:'done',projectId:'p',prompt:'done',mode:'ask',status:'completed',riskLevel:'low',plan,createdAt:now,updatedAt:now},'provider')
    expect(db.listTasks('p').map(task=>task.id)).toEqual(['q1','q2','done'])
    db.reorderQueuedTasks('p',['q2','q1'])
    expect(db.listTasks('p').map(task=>task.id)).toEqual(['q2','q1','done'])
    expect(db.getTask('q2')?.queueOrder).toBe(1)
  })
  it('does not remove a recoverable task during completed-history cleanup',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'));const db=new AppDatabase(join(root,'db.sqlite'));const old='2020-01-01T00:00:00.000Z'
    db.saveProject({id:'p',name:'project',path:root,createdAt:old,updatedAt:old,hasGit:false})
    const plan={summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low' as const}
    db.saveTask({id:'recoverable',projectId:'p',prompt:'resume',mode:'edit',status:'interrupted',riskLevel:'low',plan,createdAt:old,updatedAt:old},'provider')
    db.saveTask({id:'completed',projectId:'p',prompt:'done',mode:'ask',status:'completed',riskLevel:'low',plan,createdAt:old,updatedAt:old},'provider')
    expect(db.listCompletedTaskIdsBefore('2021-01-01T00:00:00.000Z')).toEqual(['completed'])
    db.deleteTask('recoverable')
    expect(db.getTask('recoverable')?.status).toBe('interrupted')
  })
})

describe('contract → parrot migration',()=>{
  it('renames legacy tables and columns, preserving data',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'))
    const old=new DatabaseSync(join(root,'db.sqlite'))
    old.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, contract_approved_hash TEXT, has_git INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE contract_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, hash TEXT NOT NULL, readme TEXT NOT NULL, agents TEXT NOT NULL, approved_at TEXT NOT NULL);
    `)
    old.prepare('INSERT INTO projects(id,name,path,created_at,updated_at,contract_approved_hash,has_git) VALUES(?,?,?,?,?,?,?)').run('p','project',root,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z','abc123',0)
    old.prepare('INSERT INTO contract_versions(id,project_id,hash,readme,agents,approved_at) VALUES(?,?,?,?,?,?)').run('v1','p','abc123','旧 README','旧 AGENTS','2025-01-01T00:00:00Z')
    old.close()
    const db=new AppDatabase(join(root,'db.sqlite'))
    const tables=db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>
    expect(tables.some(t=>t.name==='contract_versions')).toBe(false)
    expect(tables.some(t=>t.name==='parrot_versions')).toBe(true)
    const version=db.db.prepare("SELECT readme,agents FROM parrot_versions WHERE id='v1'").get() as {readme:string;agents:string}
    expect(version.readme).toBe('旧 README')
    expect(version.agents).toBe('旧 AGENTS')
    expect(db.getProject('p')?.parrotApprovedHash).toBe('abc123') // 旧列 RENAME 后字段可读
    db.approveParrot('p','xyz','新 README','新 AGENTS') // 迁移后新方法正常工作
    expect(db.getProject('p')?.parrotApprovedHash).toBe('xyz')
  })
  it('is idempotent on an already-migrated database',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-db-'))
    const db=new AppDatabase(join(root,'db.sqlite'))
    const now=new Date().toISOString()
    db.saveProject({id:'p',name:'project',path:root,createdAt:now,updatedAt:now,hasGit:false})
    db.approveParrot('p','h1','r','a')
    const reopened=new AppDatabase(join(root,'db.sqlite')) // 二次打开不报错、不丢数据
    expect(reopened.getProject('p')?.parrotApprovedHash).toBe('h1')
  })
})
