import { open } from 'node:fs/promises'

export interface LimitedFileContent {
  size:number
  binary:boolean
  truncated:boolean
  content:string
}

/** 只读取文件头，避免预览或模型工具把大文件一次性装入内存。 */
export async function readLimitedTextFile(path:string,limit:number):Promise<LimitedFileContent> {
  const handle=await open(path,'r')
  try {
    const info=await handle.stat()
    if(!info.isFile())throw new Error('目标不是文件')
    const bytesToRead=Math.min(info.size,limit)
    const buffer=Buffer.alloc(bytesToRead)
    const {bytesRead}=bytesToRead?await handle.read(buffer,0,bytesToRead,0):{bytesRead:0}
    const data=buffer.subarray(0,bytesRead)
    return {
      size:info.size,
      binary:data.subarray(0,Math.min(bytesRead,8192)).includes(0),
      truncated:info.size>bytesRead,
      content:data.toString('utf8')
    }
  } finally { await handle.close() }
}
