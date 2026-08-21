import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'

export class CredentialStore {
  constructor(private path:string) {}
  private async read():Promise<Record<string,string>> { try{return JSON.parse(await readFile(this.path,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e} }
  async set(id:string,value:string):Promise<void> {
    if(!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用')
    const data=await this.read(); data[id]=safeStorage.encryptString(value).toString('base64')
    await mkdir(dirname(this.path),{recursive:true}); await writeFile(this.path,JSON.stringify(data),{mode:0o600})
  }
  async get(id:string):Promise<string> {
    const data=await this.read(); const encrypted=data[id]; if(!encrypted)throw new Error('找不到 API 凭据')
    return safeStorage.decryptString(Buffer.from(encrypted,'base64'))
  }
  async remove(id:string):Promise<void> { const data=await this.read();delete data[id];await writeFile(this.path,JSON.stringify(data),{mode:0o600}) }
}
