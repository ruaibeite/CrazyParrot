import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentEvent, ChangeReceipt, ChangeReceiptSummary, DecisionRecord, ProjectRecord, ProviderProfile, SnapshotSummary, TaskRecord } from '../shared/types'

export class AppDatabase {
  readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.migrateParrotRename() // 旧名 → 新名必须发生在 CREATE IF NOT EXISTS 之前，否则 RENAME 与新建表冲突
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        archived_at TEXT, parrot_approved_hash TEXT, has_git INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS parrot_versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, hash TEXT NOT NULL,
        readme TEXT NOT NULL, agents TEXT NOT NULL, approved_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL,
        base_url TEXT NOT NULL, model TEXT NOT NULL, credential_id TEXT NOT NULL,
        custom_headers TEXT NOT NULL DEFAULT '{}', thinking_enabled INTEGER NOT NULL,
        reasoning_effort TEXT NOT NULL, max_context INTEGER NOT NULL,
        task_budget INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, verified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider_id TEXT NOT NULL,
        prompt TEXT NOT NULL, status TEXT NOT NULL, risk_level TEXT NOT NULL,
        plan TEXT NOT NULL, evidence TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manifest_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, excluded_paths TEXT NOT NULL, size_bytes INTEGER NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
        content TEXT NOT NULL, promoted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS change_receipts (
        task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        captured_at TEXT NOT NULL, receipt TEXT NOT NULL, receipt_hash TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_receipts_project ON change_receipts(project_id, captured_at DESC);
    `)
    this.ensureColumn('tasks','mode',"TEXT NOT NULL DEFAULT 'edit'")
    this.ensureColumn('tasks','parent_task_id','TEXT')
    this.ensureColumn('tasks','context_summary','TEXT')
    this.ensureColumn('tasks','queue_order','INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tasks','execution_state','TEXT')
    this.ensureColumn('tasks','pending_approval','TEXT')
    this.ensureColumn('tasks','usage','TEXT')
    this.ensureColumn('tasks','changed_paths','TEXT')
    this.ensureColumn('tasks','scope_change_approved','INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tasks','budget_override','INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tasks','parrot_hash','TEXT')
    this.ensureColumn('tasks','approvals','TEXT')
    this.ensureColumn('projects','archived_at','TEXT')
    this.ensureColumn('providers','input_price_per_million','REAL NOT NULL DEFAULT 0')
    this.ensureColumn('providers','output_price_per_million','REAL NOT NULL DEFAULT 0')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);')
  }

  /** 0.1.4 迁移：contract → parrot 重命名，旧库升级时 RENAME（幂等，不丢数据）。 */
  private migrateParrotRename(): void {
    const oldTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contract_versions'").get()
    if (oldTable) this.db.exec('ALTER TABLE contract_versions RENAME TO parrot_versions')
    const columns = this.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name?: string }>
    if (columns.some(column => column.name === 'contract_approved_hash')) this.db.exec('ALTER TABLE projects RENAME COLUMN contract_approved_hash TO parrot_approved_hash')
  }

  private ensureColumn(table:string,column:string,definition:string):void {
    const columns=this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name?:string}>
    if(!columns.some(item=>item.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  listProjects(): ProjectRecord[] {
    return this.db.prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC').all().map(mapProject)
  }

  listArchivedProjects(): ProjectRecord[] {
    return this.db.prepare('SELECT * FROM projects WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all().map(mapProject)
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    return row ? mapProject(row) : null
  }

  getProjectByPath(path: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path)
    return row ? mapProject(row) : null
  }

  saveProject(project: ProjectRecord): void {
    this.db.prepare(`INSERT INTO projects(id,name,path,created_at,updated_at,archived_at,parrot_approved_hash,has_git)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,
      updated_at=excluded.updated_at,archived_at=excluded.archived_at,parrot_approved_hash=excluded.parrot_approved_hash,has_git=excluded.has_git`)
      .run(project.id, project.name, project.path, project.createdAt, project.updatedAt,project.archivedAt ?? null,
        project.parrotApprovedHash ?? null, project.hasGit ? 1 : 0)
  }

  archiveProject(id:string):void { this.db.prepare('UPDATE projects SET archived_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),new Date().toISOString(),id) }
  restoreProject(id:string):void { this.db.prepare('UPDATE projects SET archived_at=NULL,updated_at=? WHERE id=?').run(new Date().toISOString(),id) }
  deleteProject(id:string):void { this.db.prepare('DELETE FROM projects WHERE id=?').run(id) }
  hasActiveTasksForProject(id:string):boolean {
    const row=this.db.prepare("SELECT 1 AS active FROM tasks WHERE project_id=? AND status IN ('queued','planning','running','awaiting_approval','interrupted') LIMIT 1").get(id) as {active?:number}|undefined
    return Boolean(row?.active)
  }

  approveParrot(projectId: string, hash: string, readme: string, agents: string): void {
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO parrot_versions(id,project_id,hash,readme,agents,approved_at) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(), projectId, hash, readme, agents, now)
    this.db.prepare('UPDATE projects SET parrot_approved_hash=?, updated_at=? WHERE id=?').run(hash, now, projectId)
  }

  listProviders(): ProviderProfile[] {
    return this.db.prepare('SELECT * FROM providers ORDER BY name').all().map(mapProvider)
  }

  getProvider(id: string): ProviderProfile | null {
    const row = this.db.prepare('SELECT * FROM providers WHERE id=?').get(id)
    return row ? mapProvider(row) : null
  }

  saveProvider(p: ProviderProfile): void {
    this.db.prepare(`INSERT INTO providers(id,name,protocol,base_url,model,credential_id,custom_headers,
      thinking_enabled,reasoning_effort,max_context,task_budget,timeout_ms,input_price_per_million,output_price_per_million,verified_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
      protocol=excluded.protocol,base_url=excluded.base_url,model=excluded.model,
      credential_id=excluded.credential_id,custom_headers=excluded.custom_headers,
      thinking_enabled=excluded.thinking_enabled,reasoning_effort=excluded.reasoning_effort,
      max_context=excluded.max_context,task_budget=excluded.task_budget,timeout_ms=excluded.timeout_ms,input_price_per_million=excluded.input_price_per_million,output_price_per_million=excluded.output_price_per_million,
      verified_at=excluded.verified_at`).run(p.id,p.name,p.protocol,p.baseUrl,p.model,p.encryptedCredentialId,
        JSON.stringify(p.customHeaders ?? {}),p.thinkingEnabled?1:0,p.reasoningEffort,p.maxContext,p.taskBudget,p.timeoutMs,p.inputPricePerMillion,p.outputPricePerMillion,p.verifiedAt??null)
  }

  removeProvider(id: string): void { this.db.prepare('DELETE FROM providers WHERE id=?').run(id) }

  hasActiveTasksForProvider(id:string):boolean {
    const row=this.db.prepare("SELECT 1 AS active FROM tasks WHERE provider_id=? AND status IN ('queued','planning','running','awaiting_approval','interrupted') LIMIT 1").get(id) as {active?:number}|undefined
    return Boolean(row?.active)
  }

  saveTask(task: TaskRecord, providerId?: string): void {
    const existing = this.db.prepare('SELECT provider_id,queue_order FROM tasks WHERE id=?').get(task.id) as {provider_id?: string;queue_order?: number}|undefined
    const queueOrder=task.queueOrder??existing?.queue_order??0
    this.db.prepare(`INSERT INTO tasks(id,project_id,provider_id,parent_task_id,context_summary,execution_state,pending_approval,usage,changed_paths,scope_change_approved,budget_override,parrot_hash,approvals,prompt,mode,status,queue_order,risk_level,plan,evidence,error,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_task_id=excluded.parent_task_id,
      context_summary=excluded.context_summary,mode=excluded.mode,status=excluded.status,risk_level=excluded.risk_level,
      queue_order=excluded.queue_order,execution_state=excluded.execution_state,pending_approval=excluded.pending_approval,usage=excluded.usage,changed_paths=excluded.changed_paths,scope_change_approved=excluded.scope_change_approved,budget_override=excluded.budget_override,parrot_hash=excluded.parrot_hash,approvals=excluded.approvals,plan=excluded.plan,evidence=excluded.evidence,error=excluded.error,updated_at=excluded.updated_at`)
      .run(task.id,task.projectId,providerId??existing?.provider_id??'',task.parentTaskId??null,task.contextSummary??null,task.executionState?JSON.stringify(task.executionState):null,task.pendingApproval?JSON.stringify(task.pendingApproval):null,task.usage?JSON.stringify(task.usage):null,task.changedPaths?JSON.stringify(task.changedPaths):null,task.scopeChangeApproved?1:0,task.budgetOverride?1:0,task.parrotHash??null,task.approvals?JSON.stringify(task.approvals):null,task.prompt,task.mode,task.status,queueOrder,task.riskLevel,
        JSON.stringify(task.plan),task.evidence?JSON.stringify(task.evidence):null,task.error??null,task.createdAt,task.updatedAt)
  }

  getTask(id: string): (TaskRecord & {providerId:string}) | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id)
    return row ? mapTask(row) : null
  }

  listTasks(projectId: string): TaskRecord[] {
    return this.db.prepare(`SELECT * FROM tasks WHERE project_id=? ORDER BY
      CASE WHEN status='queued' THEN 0 ELSE 1 END,
      CASE WHEN status='queued' THEN queue_order ELSE 0 END,
      created_at DESC`).all(projectId).map(mapTask)
  }

  nextTaskQueueOrder(projectId:string):number {
    const row=this.db.prepare("SELECT COALESCE(MAX(queue_order),0) AS max_order FROM tasks WHERE project_id=? AND status='queued'").get(projectId) as {max_order?:number}|undefined
    return Number(row?.max_order??0)+1
  }

  reorderQueuedTasks(projectId:string,taskIds:string[]):void {
    const queued=this.db.prepare("SELECT id FROM tasks WHERE project_id=? AND status='queued'").all(projectId) as Array<{id:string}>
    const expected=queued.map(item=>item.id).sort();const received=[...taskIds].sort()
    if(expected.length!==received.length||expected.some((value,index)=>value!==received[index]))throw new Error('只能调整当前项目的待发送任务')
    this.db.exec('BEGIN')
    try {
      const update=this.db.prepare('UPDATE tasks SET queue_order=?,updated_at=? WHERE id=? AND project_id=? AND status=\'queued\'')
      const now=new Date().toISOString();taskIds.forEach((id,index)=>update.run(index+1,now,id,projectId));this.db.exec('COMMIT')
    } catch(error) { this.db.exec('ROLLBACK');throw error }
  }

  saveEvent(taskId:string,type:string,message:string,payload:unknown):void {
    this.db.prepare('INSERT INTO task_events(task_id,type,message,payload,created_at) VALUES(?,?,?,?,?)')
      .run(taskId,type,message,payload===undefined?null:JSON.stringify(payload),new Date().toISOString())
  }

  listEvents(taskId:string):AgentEvent[] {
    return this.db.prepare('SELECT task_id,type,message,payload,created_at FROM task_events WHERE task_id=? ORDER BY id').all(taskId).map(raw=>{
      const row=raw as Row
      return {taskId:str(row.task_id),type:str(row.type) as AgentEvent['type'],message:str(row.message),at:str(row.created_at),...(row.payload?{payload:JSON.parse(str(row.payload))}:{})}
    })
  }

  saveSnapshot(s: SnapshotSummary): void {
    this.db.prepare(`INSERT OR REPLACE INTO snapshots(task_id,project_id,manifest_hash,created_at,excluded_paths,size_bytes)
      VALUES(?,?,?,?,?,?)`).run(s.taskId,s.projectId,s.manifestHash,s.createdAt,JSON.stringify(s.excludedPaths),s.sizeBytes)
  }

  listSnapshots(projectId?:string): SnapshotSummary[] {
    const sql = `SELECT s.*, p.name AS project_name FROM snapshots s JOIN projects p ON p.id=s.project_id
      ${projectId?'WHERE s.project_id=?':''} ORDER BY s.created_at DESC`
    return (projectId?this.db.prepare(sql).all(projectId):this.db.prepare(sql).all()).map(mapSnapshot)
  }

  removeSnapshot(taskId:string):void { this.db.prepare('DELETE FROM snapshots WHERE task_id=?').run(taskId) }
  saveReceipt(receipt:ChangeReceipt):void {
    this.db.prepare(`INSERT INTO change_receipts(task_id,project_id,status,captured_at,receipt,receipt_hash) VALUES(?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET status=excluded.status,captured_at=excluded.captured_at,receipt=excluded.receipt,receipt_hash=excluded.receipt_hash`)
      .run(receipt.taskId,receipt.projectId,receipt.status,receipt.capturedAt,JSON.stringify(receipt),receipt.receiptHash)
  }
  getReceipt(taskId:string):ChangeReceipt|null {
    const row=this.db.prepare('SELECT receipt FROM change_receipts WHERE task_id=?').get(taskId) as {receipt?:string}|undefined
    return row?.receipt?JSON.parse(row.receipt) as ChangeReceipt:null
  }
  listReceiptSummaries(projectId:string):ChangeReceiptSummary[] {
    return (this.db.prepare('SELECT receipt FROM change_receipts WHERE project_id=? ORDER BY captured_at DESC').all(projectId) as Array<{receipt:string}>).map(row=>{
      const receipt=JSON.parse(row.receipt) as ChangeReceipt
      return {taskId:receipt.taskId,projectId:receipt.projectId,capturedAt:receipt.capturedAt,status:receipt.status,goal:receipt.goal,riskLevel:receipt.riskLevel,...(receipt.provider?{providerModel:receipt.provider.model}:{}),changedFileCount:receipt.files.length,passedTests:receipt.tests.filter(test=>test.passed).length,totalTests:receipt.tests.length,receiptHash:receipt.receiptHash}
    })
  }
  getSetting(key:string):string|null { const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value?:string}|undefined;return row?.value??null }
  saveSetting(key:string,value:string):void { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value) }
  saveDecision(projectId:string,content:string,taskId?:string):DecisionRecord {
    const decision:DecisionRecord={id:crypto.randomUUID(),projectId,...(taskId?{taskId}:{}),content,promoted:false,createdAt:new Date().toISOString()}
    this.db.prepare('INSERT INTO decisions(id,project_id,task_id,content,promoted,created_at) VALUES(?,?,?,?,?,?)').run(decision.id,projectId,taskId??null,content,0,decision.createdAt);return decision
  }
  listDecisions(projectId:string):DecisionRecord[] { return this.db.prepare('SELECT * FROM decisions WHERE project_id=? ORDER BY created_at DESC').all(projectId).map(r=>{const row=r as Row;return {id:str(row.id),projectId:str(row.project_id),...(row.task_id?{taskId:str(row.task_id)}:{}),content:str(row.content),promoted:Boolean(row.promoted),createdAt:str(row.created_at)}}) }
  removeDecision(id:string):void { this.db.prepare('DELETE FROM decisions WHERE id=?').run(id) }
  diagnosticSummary():{projects:number;providers:number;tasks:Record<string,number>;events:number;receipts:number} {
    const projects=Number((this.db.prepare('SELECT COUNT(*) AS count FROM projects').get() as {count?:number}).count??0)
    const providers=Number((this.db.prepare('SELECT COUNT(*) AS count FROM providers').get() as {count?:number}).count??0)
    const events=Number((this.db.prepare('SELECT COUNT(*) AS count FROM task_events').get() as {count?:number}).count??0)
    const receipts=Number((this.db.prepare('SELECT COUNT(*) AS count FROM change_receipts').get() as {count?:number}).count??0)
    const tasks:Record<string,number>={}
    for(const row of this.db.prepare('SELECT status,COUNT(*) AS count FROM tasks GROUP BY status').all() as Array<{status:string;count:number}>)tasks[row.status]=Number(row.count)
    return {projects,providers,tasks,events,receipts}
  }
  listCompletedTaskIdsBefore(cutoff:string):string[] { return (this.db.prepare("SELECT id FROM tasks WHERE status IN ('completed','failed','cancelled','reverted') AND updated_at < ?").all(cutoff) as Array<{id:string}>).map(row=>row.id) }
  deleteTask(id:string):void { this.db.prepare("DELETE FROM tasks WHERE id=? AND status IN ('completed','failed','cancelled','reverted')").run(id) }
  vacuum():void { this.db.exec('VACUUM') }
}

type Row = Record<string, unknown>
const str=(v:unknown)=>String(v??'')
function mapProject(r:Row):ProjectRecord { return {id:str(r.id),name:str(r.name),path:str(r.path),createdAt:str(r.created_at),updatedAt:str(r.updated_at),...(r.archived_at?{archivedAt:str(r.archived_at)}:{}),...(r.parrot_approved_hash?{parrotApprovedHash:str(r.parrot_approved_hash)}:{}),hasGit:Boolean(r.has_git)} }
function mapProvider(r:Row):ProviderProfile { return {id:str(r.id),name:str(r.name),protocol:str(r.protocol) as ProviderProfile['protocol'],baseUrl:str(r.base_url),model:str(r.model),encryptedCredentialId:str(r.credential_id),customHeaders:JSON.parse(str(r.custom_headers)||'{}'),thinkingEnabled:Boolean(r.thinking_enabled),reasoningEffort:str(r.reasoning_effort) as 'high'|'max',maxContext:Number(r.max_context),taskBudget:Number(r.task_budget),timeoutMs:Number(r.timeout_ms),inputPricePerMillion:Number(r.input_price_per_million??0),outputPricePerMillion:Number(r.output_price_per_million??0),...(r.verified_at?{verifiedAt:str(r.verified_at)}:{})} }
function mapTask(r:Row):TaskRecord&{providerId:string} { return {id:str(r.id),projectId:str(r.project_id),providerId:str(r.provider_id),...(r.parent_task_id?{parentTaskId:str(r.parent_task_id)}:{}),...(r.context_summary?{contextSummary:str(r.context_summary)}:{}),...(r.parrot_hash?{parrotHash:str(r.parrot_hash)}:{}),...(r.execution_state?{executionState:JSON.parse(str(r.execution_state))}:{}),...(r.pending_approval?{pendingApproval:JSON.parse(str(r.pending_approval))}:{}),...(r.approvals?{approvals:JSON.parse(str(r.approvals))}:{}),...(r.usage?{usage:JSON.parse(str(r.usage))}:{}),...(r.changed_paths?{changedPaths:JSON.parse(str(r.changed_paths))}:{}),...(Boolean(r.scope_change_approved)?{scopeChangeApproved:true}:{}),...(Boolean(r.budget_override)?{budgetOverride:true}:{}),prompt:str(r.prompt),mode:(str(r.mode)||'edit') as TaskRecord['mode'],status:str(r.status) as TaskRecord['status'],...(r.status==='queued'?{queueOrder:Number(r.queue_order??0)}:{}),riskLevel:str(r.risk_level) as TaskRecord['riskLevel'],plan:JSON.parse(str(r.plan)),...(r.evidence?{evidence:JSON.parse(str(r.evidence))}:{}),createdAt:str(r.created_at),updatedAt:str(r.updated_at),...(r.error?{error:str(r.error)}:{})} }
function mapSnapshot(r:Row):SnapshotSummary { return {taskId:str(r.task_id),projectId:str(r.project_id),manifestHash:str(r.manifest_hash),createdAt:str(r.created_at),excludedPaths:JSON.parse(str(r.excluded_paths)),sizeBytes:Number(r.size_bytes),...(r.project_name?{projectName:str(r.project_name)}:{})} }
