import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { SnapshotService } from '../../src/main/snapshot'

describe('task snapshots',()=>{
  it('restores modified, deleted and newly-created files without Git',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');await mkdir(project)
    await writeFile(join(project,'keep.txt'),'before');await writeFile(join(project,'delete.txt'),'original')
    const db=new AppDatabase(join(temp,'test.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    const task={id:'t1',projectId:'p1',prompt:'edit',mode:'edit' as const,status:'running' as const,riskLevel:'low' as const,plan:{summary:'edit',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low' as const},createdAt:now,updatedAt:now}
    db.saveTask(task,'provider');const snapshots=new SnapshotService(join(temp,'snapshots'),db);await snapshots.create('t1','p1',project)
    await writeFile(join(project,'keep.txt'),'after');await writeFile(join(project,'new.txt'),'new');await import('node:fs/promises').then(fs=>fs.rm(join(project,'delete.txt')))
    const diff=await snapshots.diff('t1');expect(diff.map(d=>d.type).sort()).toEqual(['added','deleted','modified'])
    await snapshots.restore('t1')
    expect(await readFile(join(project,'keep.txt'),'utf8')).toBe('before');expect(await readFile(join(project,'delete.txt'),'utf8')).toBe('original')
    await expect(readFile(join(project,'new.txt'))).rejects.toThrow()
  })
  it('reads before/after text for modified, added and deleted files',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');await mkdir(project)
    await writeFile(join(project,'keep.txt'),'line1\nbefore\n');await writeFile(join(project,'remove.txt'),'old')
    const db=new AppDatabase(join(temp,'test.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t1',projectId:'p1',prompt:'edit',mode:'edit',status:'running',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'p')
    const snapshots=new SnapshotService(join(temp,'snapshots'),db);await snapshots.create('t1','p1',project)
    await writeFile(join(project,'keep.txt'),'line1\nafter\n');await writeFile(join(project,'new.txt'),'fresh');await import('node:fs/promises').then(fs=>fs.rm(join(project,'remove.txt')))
    const modified=await snapshots.readDiffContent('t1','keep.txt')
    expect(modified.type).toBe('modified');expect(modified.oldText).toBe('line1\nbefore\n');expect(modified.newText).toBe('line1\nafter\n')
    const added=await snapshots.readDiffContent('t1','new.txt')
    expect(added.type).toBe('added');expect(added.oldText).toBe('');expect(added.newText).toBe('fresh')
    const deleted=await snapshots.readDiffContent('t1','remove.txt')
    expect(deleted.type).toBe('deleted');expect(deleted.oldText).toBe('old');expect(deleted.newText).toBe('')
  })
  it('builds diff and receipt hashes from the same current project state',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');await mkdir(project);await writeFile(join(project,'keep.txt'),'before')
    const db=new AppDatabase(join(temp,'test.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t1',projectId:'p1',prompt:'edit',mode:'edit',status:'running',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'p')
    const snapshots=new SnapshotService(join(temp,'snapshots'),db);await snapshots.create('t1','p1',project);await writeFile(join(project,'keep.txt'),'after');await writeFile(join(project,'new.txt'),'new')
    const evidence=await snapshots.evidence('t1')
    expect(evidence.changes.map(change=>change.type).sort()).toEqual(['added','modified'])
    expect(evidence.fileHashes.map(change=>change.type).sort()).toEqual(['added','modified'])
    expect(evidence.fileHashes.find(change=>change.path==='keep.txt')?.beforeHash).not.toBe(evidence.fileHashes.find(change=>change.path==='keep.txt')?.afterHash)
  })
  it('excludes dependency directories',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');await mkdir(join(project,'node_modules'),{recursive:true});await writeFile(join(project,'node_modules','x'),'x')
    const db=new AppDatabase(join(temp,'test.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t1',projectId:'p1',prompt:'edit',mode:'edit',status:'running',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'p')
    const result=await new SnapshotService(join(temp,'snapshots'),db).create('t1','p1',project)
    expect(result.excludedPaths.some(e=>e.path==='node_modules')).toBe(true)
  })
  it('replaces a hostile directory symlink without writing outside the project',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');const outside=join(temp,'outside');await mkdir(join(project,'src'),{recursive:true});await mkdir(outside)
    await writeFile(join(project,'src','keep.txt'),'before');await writeFile(join(outside,'keep.txt'),'outside')
    const db=new AppDatabase(join(temp,'test.sqlite'));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t1',projectId:'p1',prompt:'edit',mode:'edit',status:'running',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'p')
    const snapshots=new SnapshotService(join(temp,'snapshots'),db);await snapshots.create('t1','p1',project)
    await import('node:fs/promises').then(fs=>fs.rm(join(project,'src'),{recursive:true}));await symlink(outside,join(project,'src'))
    await snapshots.restore('t1')
    expect(await readFile(join(project,'src','keep.txt'),'utf8')).toBe('before')
    expect(await readFile(join(outside,'keep.txt'),'utf8')).toBe('outside')
  })
  it('refuses a new snapshot when deduplicated disk usage would exceed the policy',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'cp-snapshot-'));const project=join(temp,'project');await mkdir(project);await writeFile(join(project,'large.txt'),'four')
    const db=new AppDatabase(join(temp,'test.sqlite'));db.saveSetting('snapshot_policy',JSON.stringify({retentionDays:30,maxBytes:1}));const now=new Date().toISOString();db.saveProject({id:'p1',name:'demo',path:project,createdAt:now,updatedAt:now,hasGit:false})
    db.saveTask({id:'t1',projectId:'p1',prompt:'edit',mode:'edit',status:'running',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now},'p')
    const snapshots=new SnapshotService(join(temp,'snapshots'),db)
    await expect(snapshots.create('t1','p1',project)).rejects.toThrow('空间不足')
    expect(db.listSnapshots('p1')).toHaveLength(0)
  })
})
