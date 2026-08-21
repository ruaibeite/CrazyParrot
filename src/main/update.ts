import { app } from 'electron'
import type { UpdateInfo } from '../shared/types'

const RELEASE_PAGE = 'https://github.com/ruaibeite/CrazyParrot/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/ruaibeite/CrazyParrot/releases/latest'

function versionParts(value:string):number[] {
  return value.replace(/^v/i,'').split(/[.+-]/).slice(0,3).map(part=>Number.parseInt(part,10)||0)
}

export function isNewerVersion(candidate:string,current:string):boolean {
  const a=versionParts(candidate),b=versionParts(current)
  for(let index=0;index<Math.max(a.length,b.length);index++) { const delta=(a[index]??0)-(b[index]??0);if(delta!==0)return delta>0 }
  return false
}

export async function checkForUpdates():Promise<UpdateInfo> {
  const currentVersion=app.getVersion()
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8_000)
  try {
    const response=await fetch(LATEST_RELEASE_API,{headers:{accept:'application/vnd.github+json','user-agent':'CrazyParrot'},signal:controller.signal})
    if(!response.ok)throw new Error(`GitHub returned ${response.status}`)
    const release=await response.json() as {tag_name?:string;html_url?:string;published_at?:string}
    const latestVersion=release.tag_name?.replace(/^v/i,'')
    if(!latestVersion)throw new Error('Latest release did not include a version tag')
    return {currentVersion,latestVersion,available:isNewerVersion(latestVersion,currentVersion),releaseUrl:release.html_url??RELEASE_PAGE,...(release.published_at?{publishedAt:release.published_at}:{})}
  } catch(error) {
    return {currentVersion,available:false,releaseUrl:RELEASE_PAGE,error:error instanceof Error?error.message:String(error)}
  } finally { clearTimeout(timeout) }
}

export { RELEASE_PAGE }
