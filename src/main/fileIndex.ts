import type { ProjectFileEntry } from '../shared/types'

interface CachedDirectory { entries:ProjectFileEntry[]; expiresAt:number }

/** A short-lived directory cache avoids repeated disk reads while expanding a large project tree. */
export class FileIndexCache {
  private entries = new Map<string, CachedDirectory>()
  constructor(private ttlMs=3_000) {}

  async get(projectId:string,path:string,loader:()=>Promise<ProjectFileEntry[]>,refresh=false):Promise<ProjectFileEntry[]> {
    const key=`${projectId}:${path}`
    const cached=this.entries.get(key)
    if(!refresh&&cached&&cached.expiresAt>Date.now())return cached.entries
    const entries=await loader();this.entries.set(key,{entries,expiresAt:Date.now()+this.ttlMs});return entries
  }

  invalidate(projectId:string,path?:string):void {
    const prefix=`${projectId}:`
    for(const key of this.entries.keys())if(key.startsWith(prefix)&&(!path||key===`${prefix}${path}`||key.startsWith(`${prefix}${path}/`)))this.entries.delete(key)
  }
}
