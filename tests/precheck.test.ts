import { describe, expect, it, vi } from 'vitest'

import { precheckExisting } from '../src/download/Precheck'

function mkResults(n: number): any[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
}

const nameOf = (r: any) => `kemono/${r.id}.png`

describe('precheckExisting', () => {
  it('只比對狀態為 -1 的項目', async () => {
    const results = mkResults(4)
    const checkRecord = vi.fn(async () => true)
    const existsMany = vi.fn(async () => new Set<string>())
    const out = await precheckExisting({
      results,
      states: [1, -1, 0, -1],
      useRecord: true,
      useFolder: true,
      checkRecord,
      existsMany,
      nameOf,
    })
    expect(out.byRecord).toEqual([1, 3])
    expect(checkRecord).toHaveBeenCalledTimes(2)
    expect(existsMany).not.toHaveBeenCalled()
  })

  it('記錄命中的不送去資料夾比對，其餘整批只呼叫一次', async () => {
    const results = mkResults(4)
    const checkRecord = vi.fn(async (r: any) => r.id === 'r0')
    const existsMany = vi.fn(
      async (_paths: string[]) => new Set(['kemono/r2.png'])
    )
    const out = await precheckExisting({
      results,
      states: [-1, -1, -1, -1],
      useRecord: true,
      useFolder: true,
      checkRecord,
      existsMany,
      nameOf,
    })
    expect(out.byRecord).toEqual([0])
    expect(out.byFolder).toEqual([2])
    expect(existsMany).toHaveBeenCalledTimes(1)
    expect(existsMany.mock.calls[0][0]).toEqual([
      'kemono/r1.png',
      'kemono/r2.png',
      'kemono/r3.png',
    ])
  })

  it('existsMany 回 null 時 byFolder 為空', async () => {
    const out = await precheckExisting({
      results: mkResults(2),
      states: [-1, -1],
      useRecord: false,
      useFolder: true,
      checkRecord: vi.fn(async () => true),
      existsMany: vi.fn(async () => null),
      nameOf,
    })
    expect(out.byFolder).toEqual([])
    expect(out.byRecord).toEqual([])
  })

  it('useRecord 關閉時不呼叫 checkRecord', async () => {
    const checkRecord = vi.fn(async () => true)
    const out = await precheckExisting({
      results: mkResults(2),
      states: [-1, -1],
      useRecord: false,
      useFolder: true,
      checkRecord,
      existsMany: vi.fn(async () => new Set(['kemono/r1.png'])),
      nameOf,
    })
    expect(checkRecord).not.toHaveBeenCalled()
    expect(out.byFolder).toEqual([1])
  })

  it('useFolder 關閉時不呼叫 existsMany', async () => {
    const existsMany = vi.fn(async () => new Set<string>())
    const out = await precheckExisting({
      results: mkResults(2),
      states: [-1, -1],
      useRecord: true,
      useFolder: false,
      checkRecord: vi.fn(async (r: any) => r.id === 'r1'),
      existsMany,
      nameOf,
    })
    expect(existsMany).not.toHaveBeenCalled()
    expect(out.byRecord).toEqual([1])
    expect(out.byFolder).toEqual([])
  })

  it('兩個來源都關閉時沒有任何命中', async () => {
    const out = await precheckExisting({
      results: mkResults(3),
      states: [-1, -1, -1],
      useRecord: false,
      useFolder: false,
      checkRecord: vi.fn(async () => true),
      existsMany: vi.fn(async () => new Set(['kemono/r0.png'])),
      nameOf,
    })
    expect(out).toEqual({ byRecord: [], byFolder: [] })
  })

  it('文字檔與其他檔案一視同仁', async () => {
    const results: any[] = [{ id: 't', kind: 'text' }]
    const out = await precheckExisting({
      results,
      states: [-1],
      useRecord: false,
      useFolder: true,
      checkRecord: vi.fn(async () => false),
      existsMany: vi.fn(async () => new Set(['kemono/t.png'])),
      nameOf: () => 'kemono/t.png',
    })
    expect(out.byFolder).toEqual([0])
  })
})
