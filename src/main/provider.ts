import type { ModelInfo, ProviderProfile } from '../shared/types'

export interface ToolDefinition { name:string; description:string; inputSchema:Record<string,unknown> }
export interface UnifiedToolCall { id:string; name:string; arguments:string }
export interface AgentMessage { role:'system'|'user'|'assistant'|'tool'; content:string; toolCalls?:UnifiedToolCall[]; toolCallId?:string }
export interface ProviderEvent { type:'text'|'reasoning'|'tool'|'usage'; text?:string; toolCall?:UnifiedToolCall; usage?:{input:number;output:number} }
export interface ProviderTurn { content:string; toolCalls:UnifiedToolCall[]; reasoning:string; usage?:{input:number;output:number} }

const trimSlash=(v:string)=>v.replace(/\/+$/,'')
function endpoint(profile:ProviderProfile,path:string):string {
  const base=trimSlash(profile.baseUrl)
  if(profile.protocol==='openai-chat') return `${base}${base.endsWith('/v1')?'':'/v1'}${path}`
  return `${base}${base.endsWith('/v1')?'':'/v1'}${path}`
}

export class ProviderClient {
  constructor(private profile:ProviderProfile,private apiKey:string,private abortSignal?:AbortSignal) {}

  private headers():Record<string,string> {
    const custom=this.profile.customHeaders??{}
    if(this.profile.protocol==='anthropic-messages') return {'content-type':'application/json','x-api-key':this.apiKey,'anthropic-version':'2023-06-01',...custom}
    return {'content-type':'application/json','authorization':`Bearer ${this.apiKey}`,...custom}
  }

  private async request(url:string,init:RequestInit):Promise<Response> {
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),this.profile.timeoutMs)
    const abort=()=>controller.abort()
    if(this.abortSignal?.aborted)abort()
    else this.abortSignal?.addEventListener('abort',abort,{once:true})
    try {
      const response=await fetch(url,{...init,headers:{...this.headers(),...(init.headers??{})},signal:controller.signal})
      if(!response.ok) { const detail=(await response.text()).slice(0,800); throw new Error(`模型 API ${response.status}: ${detail||response.statusText}`) }
      return response
    } finally { clearTimeout(timeout);this.abortSignal?.removeEventListener('abort',abort) }
  }

  async listModels():Promise<ModelInfo[]> {
    const response=await this.request(endpoint(this.profile,'/models'),{method:'GET'})
    const json=await response.json() as {data?:Array<{id:string;display_name?:string;owned_by?:string}>}
    return (json.data??[]).map(m=>({id:m.id,...(m.display_name?{name:m.display_name}:{}),...(m.owned_by?{ownedBy:m.owned_by}:{})}))
  }

  async *stream(messages:AgentMessage[],tools:ToolDefinition[]):AsyncIterable<ProviderEvent> {
    if(this.profile.protocol==='openai-chat') yield* this.streamOpenAI(messages,tools)
    else yield* this.streamAnthropic(messages,tools)
  }

  async complete(messages:AgentMessage[],tools:ToolDefinition[],onEvent?:(event:ProviderEvent)=>void):Promise<ProviderTurn> {
    let content='',reasoning=''; const toolMap=new Map<string,UnifiedToolCall>(); let usage:ProviderTurn['usage']
    for await(const event of this.stream(messages,tools)) {
      onEvent?.(event)
      if(event.type==='text')content+=event.text??''
      if(event.type==='reasoning')reasoning+=event.text??''
      if(event.type==='tool'&&event.toolCall)toolMap.set(event.toolCall.id,event.toolCall)
      if(event.type==='usage')usage=event.usage
    }
    return {content,reasoning,toolCalls:[...toolMap.values()],...(usage?{usage}:{})}
  }

  private async *streamOpenAI(messages:AgentMessage[],tools:ToolDefinition[]):AsyncIterable<ProviderEvent> {
    const body:any={model:this.profile.model,stream:true,stream_options:{include_usage:true},max_tokens:this.profile.taskBudget,messages:messages.map(m=>{
      if(m.role==='assistant'&&m.toolCalls) return {role:'assistant',content:m.content||null,tool_calls:m.toolCalls.map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:t.arguments}}))}
      if(m.role==='tool')return {role:'tool',tool_call_id:m.toolCallId,content:m.content}
      return {role:m.role,content:m.content}
    }),tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),
      tool_choice:'auto'}
    if(new URL(this.profile.baseUrl).hostname.endsWith('deepseek.com')) {
      body.thinking={type:this.profile.thinkingEnabled?'enabled':'disabled'}
      body.reasoning_effort=this.profile.reasoningEffort
    }
    const response=await this.request(endpoint(this.profile,'/chat/completions'),{method:'POST',body:JSON.stringify(body)})
    const calls=new Map<number,UnifiedToolCall>()
    for await(const data of readSse(response)) {
      if(data==='[DONE]')break
      const json=JSON.parse(data) as any; const delta=json.choices?.[0]?.delta??{}
      if(delta.content)yield {type:'text',text:delta.content}
      if(delta.reasoning_content)yield {type:'reasoning',text:delta.reasoning_content}
      for(const part of delta.tool_calls??[]) {
        const prev=calls.get(part.index)??{id:part.id??`call-${part.index}`,name:'',arguments:''}
        if(part.id)prev.id=part.id; if(part.function?.name)prev.name+=part.function.name; if(part.function?.arguments)prev.arguments+=part.function.arguments
        calls.set(part.index,prev)
      }
      if(json.usage)yield {type:'usage',usage:{input:json.usage.prompt_tokens??0,output:json.usage.completion_tokens??0}}
    }
    for(const call of calls.values())yield {type:'tool',toolCall:call}
  }

  private async *streamAnthropic(messages:AgentMessage[],tools:ToolDefinition[]):AsyncIterable<ProviderEvent> {
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')
    const converted:any[]=[]
    for(const m of messages.filter(m=>m.role!=='system')) {
      if(m.role==='assistant')converted.push({role:'assistant',content:[...(m.content?[{type:'text',text:m.content}]:[]),...(m.toolCalls??[]).map(t=>({type:'tool_use',id:t.id,name:t.name,input:safeJson(t.arguments)}))]})
      else if(m.role==='tool')converted.push({role:'user',content:[{type:'tool_result',tool_use_id:m.toolCallId,content:m.content}]})
      else converted.push({role:'user',content:m.content})
    }
    const body:any={model:this.profile.model,system,messages:converted,max_tokens:Math.min(this.profile.taskBudget,16384),stream:true,
      tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema}))}
    if(this.profile.thinkingEnabled)body.thinking={type:'enabled',budget_tokens:4096}
    const response=await this.request(endpoint(this.profile,'/messages'),{method:'POST',body:JSON.stringify(body)})
    const calls=new Map<number,UnifiedToolCall>()
    for await(const data of readSse(response)) {
      const json=JSON.parse(data) as any
      if(json.type==='content_block_start'&&json.content_block?.type==='tool_use') calls.set(json.index,{id:json.content_block.id,name:json.content_block.name,arguments:''})
      if(json.type==='content_block_delta'&&json.delta?.type==='text_delta')yield {type:'text',text:json.delta.text}
      if(json.type==='content_block_delta'&&json.delta?.type==='thinking_delta')yield {type:'reasoning',text:json.delta.thinking}
      if(json.type==='content_block_delta'&&json.delta?.type==='input_json_delta') { const c=calls.get(json.index);if(c)c.arguments+=json.delta.partial_json }
      if(json.type==='message_delta'&&json.usage)yield {type:'usage',usage:{input:json.message?.usage?.input_tokens??0,output:json.usage.output_tokens??0}}
    }
    for(const call of calls.values())yield {type:'tool',toolCall:call}
  }
}

function safeJson(value:string):unknown { try{return JSON.parse(value)}catch{return {}} }
async function* readSse(response:Response):AsyncIterable<string> {
  if(!response.body)throw new Error('模型 API 没有返回响应流')
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer=''
  while(true) {
    const {done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true})
    const chunks=buffer.split(/\r?\n\r?\n/); buffer=chunks.pop()??''
    for(const chunk of chunks) for(const line of chunk.split(/\r?\n/)) if(line.startsWith('data:')) { const data=line.slice(5).trim();if(data)yield data }
  }
  if(buffer.trim())for(const line of buffer.split(/\r?\n/))if(line.startsWith('data:')){const data=line.slice(5).trim();if(data)yield data}
}
