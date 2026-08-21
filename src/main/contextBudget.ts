import type { AgentMessage } from './provider'

const messageSize=(message:AgentMessage):number=>message.content.length+(message.toolCallId?.length??0)+(message.toolCalls??[]).reduce((total,call)=>total+call.id.length+call.name.length+call.arguments.length,0)
const totalSize=(messages:AgentMessage[]):number=>messages.reduce((total,message)=>total+messageSize(message),0)

/**
 * 将 Provider 的 maxContext 实际用于请求上下文。字符数是保守近似值：先保留
 * system 和最新的完整用户轮次，必要时再压缩单条超长内容，而不是无界累积历史。
 */
export function fitMessagesToContext(messages:AgentMessage[],maxContext:number):{messages:AgentMessage[];trimmed:boolean} {
  const budget=Math.max(16_000,Math.min(maxContext,2_000_000)*3)
  if(totalSize(messages)<=budget)return {messages,trimmed:false}
  const system=messages[0]?.role==='system'?messages.slice(0,1):[]
  let body=messages.slice(system.length)
  while(body.length>1&&totalSize([...system,...body])>budget) {
    const nextUser=body.findIndex((message,index)=>index>0&&message.role==='user')
    if(nextUser<0)break
    body=body.slice(nextUser)
  }
  let output=[...system,...body]
  if(totalSize(output)>budget) {
    const excess=totalSize(output)-budget
    const candidateIndex=output.length>1?1:0
    const candidate=output[candidateIndex]
    if(candidate) {
      const nextLength=Math.max(1_000,candidate.content.length-excess)
      const head=Math.ceil(nextLength*.7);const tail=Math.max(0,nextLength-head)
      const content=candidate.content.length>nextLength?`${candidate.content.slice(0,head)}\n\n[内容因上下文上限被截断]\n\n${candidate.content.slice(-tail)}`:candidate.content
      output=output.map((message,index)=>index===candidateIndex?{...message,content}:message)
    }
  }
  return {messages:output,trimmed:true}
}

export function truncateProjectInstruction(text:string,maxChars:number):string {
  if(text.length<=maxChars)return text
  const head=Math.ceil(maxChars*.75);const tail=Math.max(0,maxChars-head)
  return `${text.slice(0,head)}\n\n[项目说明过长，已截断]\n\n${text.slice(-tail)}`
}
