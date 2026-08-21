import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, opendir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { AppDatabase } from './database'
import { resolveInside } from './security'
import type { DiffContent, FileChange, ReceiptFileHash, SnapshotExclusion, SnapshotPolicy, SnapshotStorage, SnapshotSummary } from '../shared/types'

interface ManifestEntry {
  path:string
  type:'file'|'directory'|'symlink'
  mode:number
  size:number
  hash?:string
  linkTarget?:string
}
interface Manifest {
  taskId:string; projectId:string; projectPath:string; createdAt:string
  entries:ManifestEntry[]; excludedPaths:SnapshotExclusion[]; sizeBytes:number
}

export interface SnapshotEvidence {
  changes:FileChange[]
  fileHashes:ReceiptFileHash[]
}

const DEFAULT_EXCLUDED = new Set(['.git','node_modules','out','dist','build','.cache','coverage','.next','.nuxt'])
const MAX_FILE_SIZE = 25 * 1024 * 1024

const hashBuffer=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
const cleanRel=(p:string)=>p.split(sep).join('/')

export class SnapshotService {
  private readonly manifestsDir:string
  private readonly blobsDir:string
  constructor(private root:string,private db:AppDatabase) {
    this.manifestsDir=join(root,'manifests'); this.blobsDir=join(root,'blobs')
  }

  private manifestPath(taskId:string):string { return join(this.manifestsDir,`${taskId}.json`) }

  async create(taskId:string,projectId:string,projectPath:string):Promise<SnapshotSummary> {
    await mkdir(this.manifestsDir,{recursive:true}); await mkdir(this.blobsDir,{recursive:true})
    const manifest=await this.scan(taskId,projectId,projectPath,true)
    const raw=JSON.stringify(manifest)
    const manifestHash=hashBuffer(Buffer.from(raw))
    await writeFile(this.manifestPath(taskId),raw,{mode:0o600})
    const summary:SnapshotSummary={taskId,projectId,manifestHash,createdAt:manifest.createdAt,excludedPaths:manifest.excludedPaths,sizeBytes:manifest.sizeBytes}
    this.db.saveSnapshot(summary)
    await this.prune()
    if((await this.storage()).totalBytes>this.policy().maxBytes) {
      await rm(this.manifestPath(taskId),{force:true});this.db.removeSnapshot(taskId);await this.garbageCollect()
      throw new Error('快照存储空间不足：请清理旧快照或提高空间上限后再执行编辑任务')
    }
    return summary
  }

  private async scan(taskId:string,projectId:string,projectPath:string,persist:boolean):Promise<Manifest> {
    const entries:ManifestEntry[]=[]; const excludedPaths:SnapshotExclusion[]=[]; let sizeBytes=0
    const walk=async(dir:string):Promise<void>=>{
      let handle
      try { handle=await opendir(dir) } catch(error) { excludedPaths.push({path:cleanRel(relative(projectPath,dir))||'.',reason:`无法读取：${(error as Error).message}`}); return }
      for await (const item of handle) {
        const absolute=join(dir,item.name); const rel=cleanRel(relative(projectPath,absolute))
        if (DEFAULT_EXCLUDED.has(item.name)) { excludedPaths.push({path:rel,reason:'默认排除的依赖、版本库或构建目录'}); continue }
        let stat
        try { stat=await lstat(absolute) } catch(error) { excludedPaths.push({path:rel,reason:`无法读取元数据：${(error as Error).message}`}); continue }
        if(stat.isSymbolicLink()) {
          const linkTarget=await readlink(absolute)
          const resolved=resolve(dirname(absolute),linkTarget)
          const projectResolved=resolve(projectPath)+sep
          if(!resolved.startsWith(projectResolved)) excludedPaths.push({path:rel,reason:'指向项目外部的符号链接，仅记录链接本身'})
          entries.push({path:rel,type:'symlink',mode:stat.mode,size:stat.size,linkTarget}); continue
        }
        if(stat.isDirectory()) { entries.push({path:rel,type:'directory',mode:stat.mode,size:0}); await walk(absolute); continue }
        if(!stat.isFile()) { excludedPaths.push({path:rel,reason:'不支持的文件类型'}); continue }
        if(stat.size>MAX_FILE_SIZE) { excludedPaths.push({path:rel,reason:`文件超过 ${MAX_FILE_SIZE/1024/1024}MB`}); continue }
        try {
          const data=await readFile(absolute); const hash=hashBuffer(data); sizeBytes+=data.byteLength
          entries.push({path:rel,type:'file',mode:stat.mode,size:stat.size,hash})
          if(persist) { const blob=join(this.blobsDir,hash); try{await lstat(blob)}catch{await copyFile(absolute,blob);await chmod(blob,0o600)} }
        } catch(error) { excludedPaths.push({path:rel,reason:`无法备份：${(error as Error).message}`}) }
      }
    }
    await walk(projectPath)
    entries.sort((a,b)=>a.path.localeCompare(b.path))
    return {taskId,projectId,projectPath,createdAt:new Date().toISOString(),entries,excludedPaths,sizeBytes}
  }

  private async load(taskId:string):Promise<Manifest> {
    return JSON.parse(await readFile(this.manifestPath(taskId),'utf8')) as Manifest
  }

  async diff(taskId:string):Promise<FileChange[]> {
    const before=await this.load(taskId)
    const after=await this.scan(taskId,before.projectId,before.projectPath,false)
    return this.diffManifests(before,after)
  }

  /**
   * Produces the visible diff and hash-only receipt data from one current-tree
   * scan. Completion previously scanned the project twice for these two views.
   */
  async evidence(taskId:string):Promise<SnapshotEvidence> {
    const before=await this.load(taskId)
    const after=await this.scan(taskId,before.projectId,before.projectPath,false)
    return {changes:await this.diffManifests(before,after),fileHashes:this.receiptHashes(before,after)}
  }

  private async diffManifests(before:Manifest,after:Manifest):Promise<FileChange[]> {
    const left=new Map(before.entries.map(e=>[e.path,e])); const right=new Map(after.entries.map(e=>[e.path,e]))
    const paths=[...new Set([...left.keys(),...right.keys()])].sort(); const changes:FileChange[]=[]
    for(const path of paths) {
      const a=left.get(path), b=right.get(path)
      if(a?.type==='directory'&&b?.type==='directory') continue
      if(!a&&b) changes.push({path,type:'added'})
      else if(a&&!b) changes.push({path,type:'deleted'})
      else if(a&&b&&(a.type!==b.type||a.hash!==b.hash||a.linkTarget!==b.linkTarget||a.mode!==b.mode)) {
        const diff=await this.textDiff(before.projectPath,path,a,b)
        changes.push({path,type:'modified',...(diff?{diff}:{})})
      }
    }
    return changes
  }

  /** Hash-only receipt evidence. It never reads or exposes source contents outside the main process. */
  async receiptFileHashes(taskId:string):Promise<ReceiptFileHash[]> {
    const before=await this.load(taskId)
    const after=await this.scan(taskId,before.projectId,before.projectPath,false)
    return this.receiptHashes(before,after)
  }

  private receiptHashes(before:Manifest,after:Manifest):ReceiptFileHash[] {
    const left=new Map(before.entries.map(entry=>[entry.path,entry]));const right=new Map(after.entries.map(entry=>[entry.path,entry]))
    const files:ReceiptFileHash[]=[]
    for(const path of [...new Set([...left.keys(),...right.keys()])].sort()) {
      const a=left.get(path),b=right.get(path)
      if(a?.type==='directory'&&b?.type==='directory')continue
      if(a?.type===b?.type&&a?.hash===b?.hash&&a?.linkTarget===b?.linkTarget&&a?.mode===b?.mode)continue
      const type:ReceiptFileHash['type']=!a?'added':!b?'deleted':'modified'
      files.push({path,type,beforeHash:a?.type==='file'?a.hash??null:null,afterHash:b?.type==='file'?b.hash??null:null})
    }
    return files
  }

  private async textDiff(projectPath:string,path:string,before?:ManifestEntry,after?:ManifestEntry):Promise<string|undefined> {
    if(before?.type!=='file'||after?.type!=='file'||before.size>200_000||after.size>200_000||!before.hash) return undefined
    try {
      const oldText=await readFile(join(this.blobsDir,before.hash),'utf8'); const newText=await readFile(join(projectPath,path),'utf8')
      if(oldText.includes('\0')||newText.includes('\0'))return undefined
      const oldLines=oldText.split('\n'),newLines=newText.split('\n'); const max=Math.max(oldLines.length,newLines.length); const out:string[]=[]
      for(let i=0;i<max&&out.length<80;i++) if(oldLines[i]!==newLines[i]) { if(oldLines[i]!==undefined)out.push(`- ${i+1}: ${oldLines[i]}`);if(newLines[i]!==undefined)out.push(`+ ${i+1}: ${newLines[i]}`) }
      return out.join('\n')
    } catch { return undefined }
  }

  /** 供 diff 可视化读取指定文件在任务前后的两端文本。 */
  async readDiffContent(taskId:string,path:string):Promise<DiffContent> {
    const manifest=await this.load(taskId)
    const before=manifest.entries.find(entry=>entry.path===path)
    let oldText=''
    if(before?.type==='file'&&before.hash){try{oldText=await readFile(join(this.blobsDir,before.hash),'utf8')}catch{oldText=''}}
    const current=await this.scan(taskId,manifest.projectId,manifest.projectPath,false)
    const after=current.entries.find(entry=>entry.path===path)
    let newText=''
    if(after?.type==='file'){try{newText=await readFile(join(manifest.projectPath,path),'utf8')}catch{newText=''}}
    const type:DiffContent['type']=!before?'added':!after?'deleted':'modified'
    return {type,oldText,newText}
  }

  async restore(taskId:string):Promise<FileChange[]> {
    const changes=await this.diff(taskId); const manifest=await this.load(taskId)
    const root=await realpath(manifest.projectPath)
    const baseline=new Map(manifest.entries.map(e=>[e.path,e]))
    const current=await this.scan(taskId,manifest.projectId,manifest.projectPath,false)
    const additions=current.entries.filter(e=>!baseline.has(e.path)).sort((a,b)=>b.path.length-a.path.length)
    for(const entry of additions) {
      await this.assertSafeRestoreParent(root,entry.path)
      await rm(join(root,entry.path),{recursive:true,force:true})
    }
    const directories=manifest.entries.filter(e=>e.type==='directory').sort((a,b)=>a.path.length-b.path.length)
    for(const entry of directories) {
      await this.assertSafeRestoreParent(root,entry.path)
      const target=join(root,entry.path)
      try { if(!(await lstat(target)).isDirectory())await rm(target,{recursive:true,force:true}) } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error }
      await mkdir(target,{recursive:true}); await chmod(target,entry.mode&0o777)
    }
    for(const entry of manifest.entries.filter(e=>e.type!=='directory')) {
      await this.assertSafeRestoreParent(root,entry.path)
      const target=join(root,entry.path); await mkdir(dirname(target),{recursive:true}); await rm(target,{recursive:true,force:true})
      if(entry.type==='file'&&entry.hash) { await copyFile(join(this.blobsDir,entry.hash),target); await chmod(target,entry.mode&0o777) }
      else if(entry.type==='symlink'&&entry.linkTarget) await symlink(entry.linkTarget,target)
    }
    return changes
  }

  private async assertSafeRestoreParent(root:string,path:string):Promise<void> {
    const parent=dirname(path)
    await resolveInside(root,parent==='.'?'.':parent)
  }

  policy():SnapshotPolicy { const stored=this.db.getSetting('snapshot_policy');return stored?JSON.parse(stored):{retentionDays:30,maxBytes:5*1024*1024*1024} }
  async savePolicy(policy:SnapshotPolicy):Promise<SnapshotPolicy> { this.db.saveSetting('snapshot_policy',JSON.stringify(policy));await this.prune();return policy }

  async storage():Promise<SnapshotStorage> {
    const measure=async(directory:string):Promise<number>=>{
      let bytes=0
      try { for await(const entry of await opendir(directory)){if(entry.isFile())bytes+=(await lstat(join(directory,entry.name))).size} } catch {}
      return bytes
    }
    const [blobBytes,manifestBytes]=await Promise.all([measure(this.blobsDir),measure(this.manifestsDir)])
    return {blobBytes,manifestBytes,totalBytes:blobBytes+manifestBytes}
  }

  private async prune():Promise<void> {
    const policy=this.policy();const items=[...this.db.listSnapshots()].reverse();const cutoff=Date.now()-policy.retentionDays*86_400_000
    for(const item of items) {
      const task=this.db.getTask(item.taskId);const unfinished=task&&['running','awaiting_approval','interrupted'].includes(task.status)
      if(!unfinished&&new Date(item.createdAt).getTime()<cutoff){await rm(this.manifestPath(item.taskId),{force:true});this.db.removeSnapshot(item.taskId)}
    }
    await this.garbageCollect()
    for(const item of [...this.db.listSnapshots()].reverse()) {
      if((await this.storage()).totalBytes<=policy.maxBytes)break
      const task=this.db.getTask(item.taskId);const unfinished=task&&['running','awaiting_approval','interrupted'].includes(task.status)
      if(!unfinished){await rm(this.manifestPath(item.taskId),{force:true});this.db.removeSnapshot(item.taskId);await this.garbageCollect()}
    }
  }

  private async garbageCollect():Promise<void> {
    const used=new Set<string>()
    try { for await(const entry of await opendir(this.manifestsDir)){if(!entry.isFile()||!entry.name.endsWith('.json'))continue;try{const m=JSON.parse(await readFile(join(this.manifestsDir,entry.name),'utf8')) as Manifest;m.entries.forEach(e=>{if(e.hash)used.add(e.hash)})}catch{}} } catch{return}
    try { for await(const entry of await opendir(this.blobsDir))if(entry.isFile()&&!used.has(entry.name))await rm(join(this.blobsDir,entry.name),{force:true}) } catch{return}
  }

  async remove(taskId:string):Promise<void> { await rm(this.manifestPath(taskId),{force:true}); this.db.removeSnapshot(taskId);await this.garbageCollect() }
}
