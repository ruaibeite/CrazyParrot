import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyCommand, classifyTask, isUnattendedCommand, resolveInside } from '../../src/main/security'

describe('security boundaries',()=>{
  it('classifies command risk',()=>{
    expect(classifyCommand('npm test')).toBe('low')
    expect(classifyCommand('npm install zod')).toBe('medium')
    expect(classifyCommand('git reset --hard')).toBe('high')
    expect(classifyCommand('node -e "process.exit()"')).toBe('medium')
    expect(classifyCommand('git status | head')).toBe('medium')
    expect(isUnattendedCommand('npm test')).toBe(true)
    expect(isUnattendedCommand('npm test; rm -rf /tmp/x')).toBe(false)
    expect(classifyTask('部署并删除旧数据库')).toBe('high')
  })
  it('blocks paths outside the project and escaping symlinks',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cp-sec-'));await mkdir(join(root,'src'))
    await expect(resolveInside(root,'../outside')).rejects.toThrow('项目范围')
    await symlink(tmpdir(),join(root,'escape'))
    await expect(resolveInside(root,'escape')).rejects.toThrow('项目外部')
    await expect(resolveInside(root,'escape/nested/new.ts')).rejects.toThrow('项目外部')
    await expect(resolveInside(root,'src/new.ts')).resolves.toBe(join(await realpath(root),'src/new.ts'))
  })
})
