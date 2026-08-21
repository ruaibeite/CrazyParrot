export type Protocol = 'openai-chat' | 'anthropic-messages'
export type RiskLevel = 'low' | 'medium' | 'high'
export type TaskMode = 'ask' | 'plan' | 'edit'
export type AppLanguagePreference = 'system' | 'zh' | 'en'
export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'cancelled'
  | 'reverted'

export interface ProviderProfile {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  model: string
  encryptedCredentialId: string
  customHeaders?: Record<string, string>
  thinkingEnabled: boolean
  reasoningEffort: 'high' | 'max'
  maxContext: number
  taskBudget: number
  timeoutMs: number
  /** Optional USD price per one million tokens. Zero means cost is not estimated. */
  inputPricePerMillion: number
  outputPricePerMillion: number
  verifiedAt?: string
}

export interface ProviderInput extends Omit<ProviderProfile, 'id' | 'encryptedCredentialId' | 'verifiedAt'> {
  id?: string
  apiKey?: string
}

export interface ModelInfo { id: string; name?: string; ownedBy?: string }
export interface ConnectionResult { ok: boolean; message: string; models?: ModelInfo[] }

export interface ProjectCommand { name: string; command: string }
export interface ProjectParrot {
  goals: string[]
  nonGoals: string[]
  stack: string[]
  commands: ProjectCommand[]
  constraints: string[]
  protectedPaths: string[]
  acceptanceRules: string[]
  approvedVersion: string
}

export interface ParrotIssue {
  file: 'README.md' | 'AGENTS.md' | 'parrot'
  section?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ParrotStatus {
  valid: boolean
  approved: boolean
  currentHash: string
  approvedHash?: string
  issues: ParrotIssue[]
  parrot: ProjectParrot
  readme: string
  agents: string
}

/** Parrot 体检报告：100 分制健康度评分（auditParrot 纯函数产出）。 */
export type ParrotAuditKey = 'sections' | 'quality' | 'commands' | 'protection' | 'tests'
export type ParrotAuditLevel = 'excellent' | 'good' | 'fair' | 'poor'
export interface ParrotAuditItem { key: ParrotAuditKey; score: number; max: number }
export interface ParrotAuditIssue { item: ParrotAuditKey; message: string; suggestion: string }
export interface ParrotAudit { score: number; level: ParrotAuditLevel; items: ParrotAuditItem[]; issues: ParrotAuditIssue[] }

export interface ProjectRecord {
  id: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
  /** Archived projects stay local but are hidden from the active workspace. */
  archivedAt?: string
  parrotApprovedHash?: string
  hasGit: boolean
}

export interface ProjectFileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
}

export interface ProjectFileContent {
  path: string
  content: string
  size: number
  truncated: boolean
  binary: boolean
}

export interface PlannedCommand { command: string; reason: string }
export interface ParrotConflict { rule: string; explanation: string }
export interface TaskPlan {
  summary: string
  affectedPaths: string[]
  commands: PlannedCommand[]
  acceptanceChecks: string[]
  parrotConflicts: ParrotConflict[]
  riskLevel: RiskLevel
  /** Project instruction files are locked unless the user explicitly asks to edit documentation. */
  allowParrotEdits?: boolean
}

export interface SnapshotExclusion { path: string; reason: string }
export interface TaskSnapshot {
  taskId: string
  projectId: string
  manifestHash: string
  createdAt: string
  excludedPaths: SnapshotExclusion[]
  sizeBytes: number
}

export interface FileChange { path: string; type: 'added' | 'modified' | 'deleted'; diff?: string }
export interface DiffContent { type: 'added' | 'modified' | 'deleted'; oldText: string; newText: string }
export interface CommandEvidence { command: string; exitCode: number | null; output: string; startedAt: string; endedAt: string }
export interface TaskExecutionToolCall { id:string; name:string; arguments:string }
export interface TaskExecutionMessage { role:'system'|'user'|'assistant'|'tool'; content:string; toolCalls?:TaskExecutionToolCall[]; toolCallId?:string }
export interface TaskUsage { inputTokens:number; outputTokens:number; requests:number; estimatedCostUsd:number; tokenLimit:number; costLimitUsd:number }
export interface PendingApproval {
  kind:'task'|'command'|'file-change'|'change-scope'|'budget'
  reason:string
  paths?:string[]
  command?:string
}
export interface TaskApproval {
  kind:PendingApproval['kind']
  reason:string
  approvedAt:string
  paths?:string[]
  command?:string
}
/** 动态审批时保留模型已完成的上下文和待执行工具，避免批准后重跑整个任务。 */
export interface TaskExecutionState { messages:TaskExecutionMessage[]; pendingToolCalls:TaskExecutionToolCall[]; commands:CommandEvidence[] }
export interface TestEvidence extends CommandEvidence { passed: boolean }
export interface ParrotReview { compliant: boolean; issues: string[] }
export interface EvidenceBundle {
  changedFiles: FileChange[]
  /** Hash-only file evidence for a Change Receipt; source contents are never persisted here. */
  fileHashes?:ReceiptFileHash[]
  commands: CommandEvidence[]
  tests: TestEvidence[]
  parrotReview: ParrotReview
  snapshotAvailable: boolean
  remainingRisks: string[]
}

export interface ReceiptFileHash {
  path:string
  type:FileChange['type']
  beforeHash:string|null
  afterHash:string|null
}
export interface ReceiptCommand {
  command:string
  exitCode:number|null
  startedAt:string
  endedAt:string
}
export interface ReceiptTest extends ReceiptCommand { passed:boolean }
export type ReceiptWorkspaceBaseline='after-task'|'snapshot'
export interface ChangeReceipt {
  schemaVersion:1
  taskId:string
  projectId:string
  createdAt:string
  capturedAt:string
  status:Extract<TaskStatus,'completed'|'failed'|'cancelled'|'reverted'>
  goal:string
  mode:TaskMode
  riskLevel:RiskLevel
  provider:{name:string;model:string;protocol:Protocol}|null
  parrot:{hash:string|null;approved:boolean}
  intent:{summary:string;predictedPaths:string[];commands:PlannedCommand[];acceptanceChecks:string[];requiredApprovals:PendingApproval['kind'][]}
  approvals:TaskApproval[]
  files:ReceiptFileHash[]
  commands:ReceiptCommand[]
  tests:ReceiptTest[]
  usage?:TaskUsage
  remainingRisks:string[]
  verification:{summary:string;parrotCompliant:boolean;testStatus:'passed'|'failed'|'not-run';workspaceBaseline:ReceiptWorkspaceBaseline}
  rollback:{snapshotId?:string;manifestHash?:string}
  privacyNotice:string
  receiptHash:string
}
export interface ChangeReceiptSummary {
  taskId:string
  projectId:string
  capturedAt:string
  status:ChangeReceipt['status']
  goal:string
  riskLevel:RiskLevel
  providerModel?:string
  changedFileCount:number
  passedTests:number
  totalTests:number
  receiptHash:string
}
export interface ReceiptDriftFile {
  path:string
  expectedHash:string|null
  currentHash:string|null
  status:'in-sync'|'changed'|'missing'|'unexpected'|'unavailable'
}
export interface ReceiptDrift {
  taskId:string
  checkedAt:string
  state:'in-sync'|'drifted'|'unavailable'
  files:ReceiptDriftFile[]
}
export interface ChangeReceiptDetail { receipt:ChangeReceipt; snapshotPresent:boolean }
export interface ReceiptExport { path:string; format:'json'|'markdown'; receiptHash:string }

/** 任务改动 vs 当前 Parrot 的合规校验结果（checkCompliance 纯函数产出）。 */
export type ComplianceReason = 'protected' | 'unapproved-parrot-change'
export interface ComplianceViolation { path: string; reason: ComplianceReason; message: string }
export interface ComplianceResult { violations: ComplianceViolation[]; checkedHash: string }

export interface TaskRecord {
  id: string
  projectId: string
  parentTaskId?: string
  contextSummary?: string
  /** 已开始任务所依据的 Parrot 内容哈希；保留以便生成可验证凭证。 */
  parrotHash?:string
  prompt: string
  mode: TaskMode
  status: TaskStatus
  /** 仅待发送任务使用；数值越小越先发送。 */
  queueOrder?: number
  executionState?: TaskExecutionState
  pendingApproval?: PendingApproval
  approvals?:TaskApproval[]
  usage?: TaskUsage
  changedPaths?: string[]
  scopeChangeApproved?: boolean
  budgetOverride?: boolean
  riskLevel: RiskLevel
  plan: TaskPlan
  evidence?: EvidenceBundle
  createdAt: string
  updatedAt: string
  error?: string
}

export interface AgentEvent {
  taskId: string
  type: 'status' | 'text' | 'reasoning' | 'tool' | 'terminal' | 'approval' | 'evidence' | 'error'
  message: string
  payload?: unknown
  at: string
}

export type ParrotOptimizeTarget = 'readme' | 'agents'
export interface ParrotOptimizeInput { projectId: string; target: ParrotOptimizeTarget; text: string; instruction?: string; providerId?: string }
export interface ParrotOptimizeTextEvent { runId: string; projectId: string; target: ParrotOptimizeTarget; type: 'text'; text: string }
export interface ParrotOptimizeDoneEvent { runId: string; projectId: string; target: ParrotOptimizeTarget; type: 'done'; issues: ParrotIssue[]; truncated: boolean }
export interface ParrotOptimizeErrorEvent { runId: string; projectId: string; target: ParrotOptimizeTarget; type: 'error'; error: string }
export type ParrotOptimizeEvent = ParrotOptimizeTextEvent | ParrotOptimizeDoneEvent | ParrotOptimizeErrorEvent

export interface ParrotDraftInput {
  name: string
  goals: string
  audience: string
  features: string
  nonGoals: string
  stack: string
  commands: string
  constraints: string
}

export interface SnapshotSummary extends TaskSnapshot { projectName?: string }
export interface SnapshotPolicy { retentionDays: number; maxBytes: number }
export interface HistoryPolicy { retentionDays:number }
export interface AppPreferences { language:AppLanguagePreference }
export interface TaskPolicy { maxTotalTokens:number; maxEstimatedCostUsd:number }
export interface CleanupResult { removedTasks:number; reclaimedSnapshots:number }
export interface UpdateInfo { currentVersion:string; latestVersion?:string; available:boolean; releaseUrl:string; publishedAt?:string; error?:string }
export interface DiagnosticsExport { path:string; createdAt:string }
/** 实际磁盘占用按去重 blob 统计，避免把多个引用同一内容的快照重复相加。 */
export interface SnapshotStorage { blobBytes:number; manifestBytes:number; totalBytes:number }
export interface DecisionRecord { id:string; projectId:string; taskId?:string; content:string; promoted:boolean; createdAt:string }
export type AppearanceTheme = 'dark' | 'light'
export interface AppearanceInput { theme: AppearanceTheme; customCss: string; backgroundOpacity: number; backgroundId?: string }
export interface AppearanceSettings extends AppearanceInput { backgroundUrl?: string }
export interface AppearanceBackground { backgroundId: string; backgroundUrl: string }

export interface CrazyParrotApi {
  app: {
    version(): Promise<string>
    openPath(path: string): Promise<void>
    preferences(): Promise<AppPreferences>
    savePreferences(input: AppPreferences): Promise<AppPreferences>
    taskPolicy(): Promise<TaskPolicy>
    saveTaskPolicy(input: TaskPolicy): Promise<TaskPolicy>
    historyPolicy(): Promise<HistoryPolicy>
    saveHistoryPolicy(input: HistoryPolicy): Promise<HistoryPolicy>
    cleanupHistory(): Promise<CleanupResult>
    exportDiagnostics(): Promise<DiagnosticsExport | null>
    checkForUpdates(): Promise<UpdateInfo>
    openReleasePage(): Promise<void>
  }
  appearance: {
    get(): Promise<AppearanceSettings>
    save(input: AppearanceInput): Promise<AppearanceSettings>
    chooseBackground(): Promise<AppearanceBackground | null>
  }
  projects: {
    list(): Promise<ProjectRecord[]>
    listArchived(): Promise<ProjectRecord[]>
    chooseDirectory(mode: 'new' | 'import'): Promise<string | null>
    add(path: string): Promise<ProjectRecord>
    get(id: string): Promise<ProjectRecord | null>
    archive(id: string): Promise<void>
    restore(id: string): Promise<void>
    remove(id: string): Promise<void>
    files(id: string, path?: string, refresh?: boolean): Promise<ProjectFileEntry[]>
    readFile(id: string, path: string): Promise<ProjectFileContent>
  }
  parrot: {
    status(projectId: string): Promise<ParrotStatus>
    generate(input: ParrotDraftInput): Promise<{ readme: string; agents: string }>
    save(projectId: string, readme: string, agents: string): Promise<ParrotStatus>
    approve(projectId: string): Promise<ParrotStatus>
    validate(readme: string, agents: string): Promise<{ valid: boolean; issues: ParrotIssue[] }>
    aiOptimize(input: ParrotOptimizeInput): Promise<{ runId: string }>
    onParrotOptimize(listener: (event: ParrotOptimizeEvent) => void): () => void
    compliance(projectId: string, paths: string[]): Promise<ComplianceResult>
    audit(readme: string, agents: string): Promise<ParrotAudit>
  }
  providers: {
    list(): Promise<ProviderProfile[]>
    save(input: ProviderInput): Promise<ProviderProfile>
    remove(id: string): Promise<void>
    test(input: ProviderInput): Promise<ConnectionResult>
    models(input: ProviderInput): Promise<ModelInfo[]>
  }
  tasks: {
    list(projectId: string): Promise<TaskRecord[]>
    events(taskId: string): Promise<AgentEvent[]>
    create(projectId: string, prompt: string, providerId: string, mode: TaskMode, parentTaskId?: string): Promise<TaskRecord>
    reorder(projectId: string, taskIds: string[]): Promise<TaskRecord[]>
    compact(taskId: string): Promise<TaskRecord>
    approve(taskId: string): Promise<TaskRecord>
    resume(taskId: string): Promise<TaskRecord>
    cancel(taskId: string): Promise<void>
    revert(taskId: string): Promise<EvidenceBundle>
  }
  receipts: {
    list(projectId:string):Promise<ChangeReceiptSummary[]>
    get(taskId:string):Promise<ChangeReceiptDetail|null>
    drift(taskId:string):Promise<ReceiptDrift|null>
    export(taskId:string,format:'json'|'markdown'):Promise<ReceiptExport|null>
  }
  snapshots: {
    list(projectId?: string): Promise<SnapshotSummary[]>
    remove(taskId: string): Promise<void>
    policy(): Promise<SnapshotPolicy>
    savePolicy(policy: SnapshotPolicy): Promise<SnapshotPolicy>
    storage(): Promise<SnapshotStorage>
    diffContent(taskId: string, path: string): Promise<DiffContent>
  }
  decisions: {
    list(projectId: string): Promise<DecisionRecord[]>
    add(projectId: string, content: string): Promise<DecisionRecord>
    remove(id: string): Promise<void>
  }
  onAgentEvent(listener: (event: AgentEvent) => void): () => void
}

export const PROVIDER_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-chat' as const, baseUrl: 'https://api.deepseek.com', model: '' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai-chat' as const, baseUrl: 'https://api.openai.com/v1', model: '' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages' as const, baseUrl: 'https://api.anthropic.com', model: '' },
  { id: 'custom-openai', name: '自定义 OpenAI 兼容', protocol: 'openai-chat' as const, baseUrl: '', model: '' },
  { id: 'custom-anthropic', name: '自定义 Anthropic 兼容', protocol: 'anthropic-messages' as const, baseUrl: '', model: '' }
]
