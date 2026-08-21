import type { TaskMode } from '../shared/types'

const READ_ONLY_TOOLS=new Set(['read_file','list_files','search_files'])

export function isToolAllowedForMode(mode:TaskMode,toolName:string):boolean {
  return mode==='edit'||READ_ONLY_TOOLS.has(toolName)
}
