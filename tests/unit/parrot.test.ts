import { describe, expect, it } from 'vitest'
import { checkCompliance, contentHash, DEFAULT_PROTECTED_PATTERNS, generateParrotDraft, isProtectedMatch, parseParrot, validateParrot } from '../../src/main/parrot'

describe('project parrot',()=>{
  it('rejects empty documents',()=>{
    const result=validateParrot('','')
    expect(result.valid).toBe(false)
    expect(result.issues.some(i=>i.file==='README.md')).toBe(true)
  })
  it('generates a complete approvable draft',()=>{
    const draft=generateParrotDraft({name:'Demo',goals:'ship safely',audience:'developers',features:'local tasks',nonGoals:'cloud sync',stack:'TypeScript',commands:'npm test',constraints:'small changes'})
    const result=validateParrot(draft.readme,draft.agents)
    expect(result.valid).toBe(true)
    expect(result.parrot.commands.length).toBeGreaterThan(0)
    expect(validateParrot(draft.readme,draft.agents,result.currentHash).approved).toBe(true)
  })
  it('normalizes line endings for the approval hash',()=>{
    expect(contentHash('a\r\n','b\r\n')).toBe(contentHash('a\n','b\n'))
  })
})

describe('isProtectedMatch',()=>{
  it('matches default patterns exactly and by suffix',()=>{
    expect(isProtectedMatch('.env','.env')).toBe(true)
    expect(isProtectedMatch('.env.local','.env.local')).toBe(true)
    expect(isProtectedMatch('config/.env','.env')).toBe(false) // 精确匹配，不按名称模糊命中
    expect(isProtectedMatch('secrets/id_rsa.key','*.key')).toBe(true)
    expect(isProtectedMatch('certs/server.pem','*.pem')).toBe(true)
    expect(isProtectedMatch('certs/server.pem','*.p12')).toBe(false)
    expect(isProtectedMatch('notes.env','*.env')).toBe(true) // *.ext 按后缀匹配，任何以 .env 结尾都命中
  })
  it('matches user directory prefixes and cleans patterns like assertWritable',()=>{
    expect(isProtectedMatch('configs/app.json','configs/')).toBe(true)
    expect(isProtectedMatch('configs','configs/')).toBe(false) // 目录 pattern 匹配内部文件，不匹配目录自身
    expect(isProtectedMatch('configs/app.json','configs')).toBe(true)
    expect(isProtectedMatch('secret.key','`secret.key`')).toBe(true) // 反引号清洗
    expect(isProtectedMatch('secret.key',' secret.key ')).toBe(true) // trim
    expect(isProtectedMatch('a/b/secret.key','a\\b\\secret.key')).toBe(true) // pattern 反斜杠归一化（path 归一化在调用层）
    expect(isProtectedMatch('anything','')).toBe(false) // 空 pattern 跳过
    expect(isProtectedMatch('anything','   ')).toBe(false)
  })
  it('keeps equivalence with the old assertWritable rule set',()=>{
    // 旧实现：normalized.startsWith('*.') ? endsWith : exact || dirPrefix —— 逐条核对内置清单
    const cases:[string,boolean][]=[
      ['.env',true],['.env.local',true],['.env.production',true],
      ['env.js',false],['.env/keys.json',true],['src/.env',false],
      ['a.key',true],['a/b/c.pem',true],['a.p12',true],['a.pem.bak',false],['apem',false],
      ['dir/file.txt',false],['./x.key',true],['x.key.txt',false]
    ]
    for(const [path,expected] of cases){
      const normalized=path.replaceAll('\\','/')
      expect(DEFAULT_PROTECTED_PATTERNS.some(pattern=>isProtectedMatch(normalized,pattern)),path).toBe(expected)
    }
  })
})

describe('checkCompliance',()=>{
  const fullDraft=generateParrotDraft({name:'Demo',goals:'g',audience:'a',features:'f',nonGoals:'n',stack:'t',commands:'npm test',constraints:'c'})
  const parrot=parseParrot(fullDraft.readme,fullDraft.agents) // 含默认受保护路径 .env/*.key/*.pem
  it('flags protected paths including user-defined ones',()=>{
    const violations=checkCompliance(parrot,true,['.env','certs/app.pem','src/main.ts','deploy/secret.yaml'])
    expect(violations.map(v=>v.path)).toEqual(['.env','certs/app.pem'])
    expect(violations[0]).toMatchObject({reason:'protected'})
    expect(violations[0]?.message).toContain('受项目 Parrot 保护')
  })
  it('flags README/AGENTS changes only when unapproved',()=>{
    expect(checkCompliance(parrot,false,['README.md','AGENTS.md','src/x.ts']).map(v=>v.reason)).toEqual(['unapproved-parrot-change','unapproved-parrot-change'])
    expect(checkCompliance(parrot,true,['README.md'])).toHaveLength(0)
  })
  it('can report both reasons for one path',()=>{
    const violations=checkCompliance(parrot,false,['.env','README.md'])
    expect(violations.find(v=>v.path==='.env')?.reason).toBe('protected')
    expect(violations.find(v=>v.path==='README.md')?.reason).toBe('unapproved-parrot-change')
  })
  it('handles empty paths and backslash normalization',()=>{
    expect(checkCompliance(parrot,false,[])).toHaveLength(0)
    expect(checkCompliance(parrot,true,['configs\\server.key']).map(v=>v.path)).toEqual(['configs/server.key'])
  })
  it('deduplicates per path even with multiple matching patterns',()=>{
    const custom=parseParrot(fullDraft.readme,fullDraft.agents.replace('## 受保护路径','## 受保护路径\n- .env')) // 用户重复声明 .env
    const violations=checkCompliance(custom,true,['.env'])
    expect(violations.filter(v=>v.path==='.env')).toHaveLength(1)
  })
})
