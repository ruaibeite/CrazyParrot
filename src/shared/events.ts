import type { AgentEvent, TaskRecord } from './types'

const MERGEABLE = new Set<AgentEvent['type']>(['text', 'reasoning', 'terminal'])

/** terminal 事件是累积合并的：前缀匹配时只追加增量，否则（新会话块）整体重写。 */
export function nextTerminalWrite(previous: string, next: string): { kind: 'append' | 'rewrite'; text: string } {
  if (previous && next.startsWith(previous)) return { kind: 'append', text: next.slice(previous.length) }
  return { kind: 'rewrite', text: next }
}

export function appendAgentEvent(events: AgentEvent[], incoming: AgentEvent): AgentEvent[] {
  const previous = events.at(-1)
  if (previous && previous.taskId === incoming.taskId && previous.type === incoming.type && MERGEABLE.has(incoming.type)) {
    const merged: AgentEvent = {
      ...previous,
      message: previous.message + incoming.message,
      at: incoming.at,
      ...(incoming.payload === undefined ? {} : { payload: incoming.payload })
    }
    return [...events.slice(0, -1), merged]
  }
  return [...events, incoming]
}

/**
 * Applies a burst of IPC events with one array copy. Streaming providers can
 * emit hundreds of small chunks, so repeatedly cloning the full task history
 * makes long answers increasingly expensive to render.
 */
export function appendAgentEvents(events: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  if (!incoming.length) return events
  const next = [...events]
  for (const event of incoming) {
    const previous = next.at(-1)
    if (previous && previous.taskId === event.taskId && previous.type === event.type && MERGEABLE.has(event.type)) {
      next[next.length - 1] = {
        ...previous,
        message: previous.message + event.message,
        at: event.at,
        ...(event.payload === undefined ? {} : { payload: event.payload })
      }
    } else next.push(event)
  }
  return next
}

export function conversationEvents(events:AgentEvent[]):AgentEvent[] {
  const seenText=new Set<string>()
  return events.filter(event=>{
    if(event.type==='evidence')return false
    if(event.type!=='text')return true
    const normalized=event.message.replace(/\s+/g,' ').trim()
    if(!normalized||seenText.has(normalized))return false
    seenText.add(normalized)
    return true
  })
}

export function taskConversation(tasks:TaskRecord[],endTaskId?:string):TaskRecord[] {
  if(!endTaskId)return []
  const byId=new Map(tasks.map(task=>[task.id,task]));const chain:TaskRecord[]=[];const seen=new Set<string>();let current=byId.get(endTaskId)
  while(current&&!seen.has(current.id)){seen.add(current.id);chain.unshift(current);current=current.parentTaskId?byId.get(current.parentTaskId):undefined}
  return chain
}
