import { beforeEach, describe, expect, it } from 'vitest'
import { EVT } from '../src/EVT'
import { store } from '../src/store/Store'

const META = {
  postKey: 'patreon/u1/999',
  service: 'patreon',
  creator: 'artist',
  creatorId: 'u1',
  postId: '999',
  title: 't',
  published: '',
  fileCount: 2,
  pending: false,
}

const FILES = [
  {
    fileUrl: 'https://x/1.png',
    fileName: '1.png',
    ext: 'png',
    kind: 'image' as const,
  },
  {
    fileUrl: 'https://x/2.png',
    fileName: '2.png',
    ext: 'png',
    kind: 'image' as const,
  },
]

describe('store', () => {
  // setup.ts 的 beforeEach 會清空事件監聽（隔離測試），所以直接調 reset()
  beforeEach(() => {
    store.reset()
  })

  it('一帖展開為多條 Result，id 全域唯一', () => {
    store.addResult(META, FILES)
    expect(store.resultMeta).toHaveLength(1)
    expect(store.resultMeta[0].id).toBe('patreon/u1/999')
    expect(store.result.map((r) => r.id)).toEqual([
      'patreon/u1/999#0',
      'patreon/u1/999#1',
    ])
    expect(store.downloadCount['patreon/u1/999']).toBe(2)
  })

  it('重複 postKey 去重', () => {
    store.addResult(META, FILES)
    store.addResult(META, FILES)
    expect(store.resultMeta).toHaveLength(1)
    expect(store.result).toHaveLength(2)
  })

  it('addResult 觸發 addResult 事件', () => {
    let got = 0
    const listener = () => got++
    EVT.on('addResult', listener)
    store.addResult(META, FILES)
    EVT.off('addResult', listener)
    expect(got).toBe(1)
  })

  it('removeWorkById 移除並觸發 resultChange', () => {
    store.addResult(META, FILES)
    let changed = 0
    const listener = () => changed++
    EVT.on('resultChange', listener)
    expect(store.removeWorkById(['patreon/u1/999'])).toBe(true)
    EVT.off('resultChange', listener)
    expect(store.result).toHaveLength(0)
    expect(store.resultMeta).toHaveLength(0)
    expect(changed).toBe(1)
    // 移除後可重新加入（去重表同步清理）
    store.addResult(META, FILES)
    expect(store.result).toHaveLength(2)
  })

  it('loadSnapshot 重建去重表與下載計數', () => {
    store.addResult(META, FILES)
    const results = JSON.parse(JSON.stringify(store.result))
    const metas = JSON.parse(JSON.stringify(store.resultMeta))

    store.reset()
    store.loadSnapshot(results, metas)
    expect(store.result).toHaveLength(2)
    expect(store.resultMeta).toHaveLength(1)
    expect(store.downloadCount['patreon/u1/999']).toBe(2)

    // 去重表已同步：同 postKey 再加入應被忽略
    store.addResult(META, FILES)
    expect(store.resultMeta).toHaveLength(1)
    expect(store.result).toHaveLength(2)

    // removeWorkById 也能刪掉載入的帖子
    expect(store.removeWorkById(['patreon/u1/999'])).toBe(true)
    expect(store.result).toHaveLength(0)
    expect(store.resultMeta).toHaveLength(0)
  })

  it('reset 清空並記錄頁面類型', () => {
    store.addResult(META, FILES)
    store.reset()
    expect(store.result).toHaveLength(0)
    expect(store.pageType).toBe('other')
  })
})
