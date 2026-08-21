import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderClient } from '../../src/main/provider'
import type { ProviderProfile } from '../../src/shared/types'

const profile=(baseUrl:string):ProviderProfile=>({id:'p',name:'custom',protocol:'openai-chat',baseUrl,model:'model-x',encryptedCredentialId:'c',thinkingEnabled:true,reasoningEffort:'max',maxContext:128000,taskBudget:8000,timeoutMs:5000,inputPricePerMillion:0,outputPricePerMillion:0})

describe('provider compatibility',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  it('does not send DeepSeek-only fields to a generic OpenAI-compatible API',async()=>{
    let sent:any
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      sent=JSON.parse(String(init.body))
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}})
    }))
    const result=await new ProviderClient(profile('https://example.com/v1'),'secret').complete([{role:'user',content:'hello'}],[])
    expect(result.content).toBe('ok')
    expect(sent.thinking).toBeUndefined()
    expect(sent.reasoning_effort).toBeUndefined()
  })
  it('uses explicit DeepSeek thinking controls only for its official host',async()=>{
    let sent:any
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{sent=JSON.parse(String(init.body));return new Response('data: [DONE]\n\n',{status:200})}))
    await new ProviderClient(profile('https://api.deepseek.com'),'secret').complete([{role:'user',content:'hello'}],[])
    expect(sent.thinking).toEqual({type:'enabled'})
    expect(sent.reasoning_effort).toBe('max')
  })
  it('forwards task cancellation to the provider request',async()=>{
    const controller=new AbortController()
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))))
    const pending=new ProviderClient(profile('https://example.com/v1'),'secret',controller.signal).listModels()
    controller.abort()
    await expect(pending).rejects.toThrow(/Abort/)
  })
})
