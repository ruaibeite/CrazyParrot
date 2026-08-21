import { describe, expect, it } from 'vitest'
import { appendAgentEvent, appendAgentEvents, conversationEvents, nextTerminalWrite, taskConversation } from '../../src/shared/events'
import type { AgentEvent, TaskRecord } from '../../src/shared/types'

const event=(type:AgentEvent['type'],message:string):AgentEvent=>({taskId:'task-1',type,message,at:new Date().toISOString()})

describe('stream event aggregation',()=>{
  it('combines consecutive model tokens into one assistant message',()=>{
    let events:AgentEvent[]=[]
    for(const token of ['新建','或','导入','任意','本地','项目'])events=appendAgentEvent(events,event('text',token))
    expect(events).toHaveLength(1)
    expect(events[0]?.message).toBe('新建或导入任意本地项目')
  })

  it('combines a streamed batch without mutating the existing history',()=>{
    const history=[event('status','working')]
    const result=appendAgentEvents(history,[event('text','first '),event('text','second'),event('terminal','ok\\n'),event('terminal','done\\n')])
    expect(history).toHaveLength(1)
    expect(result.map(item=>item.message)).toEqual(['working','first second','ok\\ndone\\n'])
  })

  it('starts a new assistant message after a tool event',()=>{
    let events=[event('text','先读取')]
    events=appendAgentEvent(events,event('tool','read_file'))
    events=appendAgentEvent(events,event('text','读取完成'))
    expect(events.map(item=>item.type)).toEqual(['text','tool','text'])
  })

  it('combines consecutive terminal chunks without swallowing status events',()=>{
    let events:AgentEvent[]=[]
    events=appendAgentEvent(events,event('terminal','line 1\n'))
    events=appendAgentEvent(events,event('terminal','line 2\n'))
    events=appendAgentEvent(events,event('status','done'))
    expect(events).toHaveLength(2)
    expect(events[0]?.message).toBe('line 1\nline 2\n')
  })

  it('computes incremental terminal writes and falls back to rewrite for new sessions',()=>{
    expect(nextTerminalWrite('', 'hello\n')).toEqual({kind:'rewrite',text:'hello\n'})
    expect(nextTerminalWrite('hello\n', 'hello\nworld\n')).toEqual({kind:'append',text:'world\n'})
    expect(nextTerminalWrite('old block', 'new block')).toEqual({kind:'rewrite',text:'new block'})
    expect(nextTerminalWrite('a', 'ab')).toEqual({kind:'append',text:'b'})
  })

  it('keeps model reasoning while removing evidence payloads and duplicate assistant text',()=>{
    const events=[event('status','working'),event('reasoning','inspect files'),event('text','final answer'),event('evidence','final answer'),event('text','final   answer')]
    expect(conversationEvents(events).map(item=>item.type)).toEqual(['status','reasoning','text'])
  })

  it('builds a conversation from linked tasks only',()=>{
    const now=new Date().toISOString();const task=(id:string,parentTaskId?:string):TaskRecord=>({id,projectId:'p',...(parentTaskId?{parentTaskId}:{}),prompt:id,mode:'ask',status:'completed',riskLevel:'low',plan:{summary:'',affectedPaths:[],commands:[],acceptanceChecks:[],parrotConflicts:[],riskLevel:'low'},createdAt:now,updatedAt:now})
    const tasks=[task('other'),task('third','second'),task('first'),task('second','first')]
    expect(taskConversation(tasks,'third').map(item=>item.id)).toEqual(['first','second','third'])
    expect(taskConversation(tasks)).toEqual([])
  })
})
