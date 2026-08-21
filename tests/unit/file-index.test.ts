import { describe, expect, it, vi } from 'vitest'
import { FileIndexCache } from '../../src/main/fileIndex'

describe('FileIndexCache', () => {
  it('reuses a short-lived listing and lets a refresh bypass the cache', async () => {
    const cache = new FileIndexCache(5_000)
    const loader = vi.fn(async () => [{ name: 'README.md', path: 'README.md', type: 'file' as const, size: 10 }])
    await cache.get('project', '', loader)
    await cache.get('project', '', loader)
    await cache.get('project', '', loader, true)
    expect(loader).toHaveBeenCalledTimes(2)
    cache.invalidate('project')
    await cache.get('project', '', loader)
    expect(loader).toHaveBeenCalledTimes(3)
  })
})
