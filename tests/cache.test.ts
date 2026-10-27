import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVT, type eventNames } from '../src/EVT'
import { toast } from '../src/Toast'
import { states } from '../src/store/States'
import { store } from '../src/store/Store'
import type { Result } from '../src/store/StoreType'

function fakeEl(): any {
  const el: any = {
    style: {},
    dataset: {},
    children: [] as any[],
    textContent: '',
    className: '',
    title: '',
    appendChild(c: any) {
      el.children.push(c)
      return c
    },
    append(...cs: any[]) {
      el.children.push(...cs)
      return el
    },
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    remove: () => {},
  }
  return el
}

function file(id: string, overrides: Partial<Result> = {}): Result {
  return {
    id,
    postKey: 'patreon/u1/999',
    service: 'patreon',
    creator: 'artist',
    creatorId: 'u1',
    postId: '999',
    title: 't',
    published: '2024-01-02T03:04:05',
    fileCount: 2,
    pending: false,
    fileUrl: 'https://x/1.png',
    fileName: '1.png',
    ext: 'png',
    kind: 'image',
    previewOnly: false,
    textData: '',
    fileIndex: 0,
    ...overrides,
  }
}

let mem: Record<string, any>
let crawlCache: typeof import('../src/download/CrawlCache').crawlCache
let MAX_ENTRIES: number
let downloadControl: typeof import('../src/download/DownloadControl').downloadControl

beforeAll(async () => {
  mem = {}
  ;(globalThis as any).chrome.storage.local = {
    get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
    set: async (obj: Record<string, any>) => {
      Object.assign(mem, obj)
    },
  }
  ;(globalThis as any).chrome.runtime.onMessage = { addListener: () => {} }
  const doc = (globalThis as any).document
  doc.createElement = () => fakeEl()
  doc.body = fakeEl()
  ;({ crawlCache, MAX_ENTRIES } = await import('../src/download/CrawlCache'))
  ;({ downloadControl } = await import('../src/download/DownloadControl'))
})

beforeEach(async () => {
  vi.spyOn(downloadControl, 'startDownload').mockResolvedValue(undefined)
  vi.spyOn(downloadControl, 'readyDownload').mockImplementation(() => {})
  vi.spyOn(downloadControl, 'drainAfterCrawl').mockImplementation(() => {})
  vi.spyOn(toast, 'error').mockImplementation(() => {})
  store.result = []
  store.resultMeta = []
  store.waitingIdList = []
  store.remainingDownload = 0
  states.settingInitialized = true
  states.busy = false
  states.downloading = false
  states.downloadPaused = false
  states.quickCrawl = false
  delete (globalThis as any).window.confirm
  for (const e of crawlCache.list()) {
    await crawlCache.remove(e.id)
  }
  mem = {}
})

function seedStore(creator = 'artist', n = 2) {
  store.resultMeta = [file('patreon/u1/999', { id: 'patreon/u1/999', creator })]
  store.result = Array.from({ length: n }, (_, i) =>
    file(`patreon/u1/999#${i}`, { fileIndex: i, creator })
  )
}

describe('crawlCache', () => {
  it('空結果不存', async () => {
    expect(await crawlCache.autoSave()).toBeNull()
    expect(crawlCache.list()).toHaveLength(0)
  })

  it('有結果自動存：標題取創作者、新在前', async () => {
    seedStore()
    const saved = await crawlCache.autoSave()
    expect(saved?.title).toBe('artist')
    // 摘要不帶大陣列
    expect(saved).not.toHaveProperty('results')
    store.resultMeta = [file('fanbox/u2/1', { id: 'fanbox/u2/1' })]
    store.result = [
      file('fanbox/u2/1#0', {
        creator: 'b2',
        creatorId: 'u2',
        service: 'fanbox',
      }),
    ]
    await crawlCache.autoSave()
    const list = crawlCache.list()
    expect(list).toHaveLength(2)
    expect(list[0].title).toBe('b2')
    expect(list[1].title).toBe('artist')
    expect(list[0].postCount).toBe(1)
    expect(list[0].fileCount).toBe(1)
  })

  it('縮圖單帖快抓不存', async () => {
    seedStore()
    states.quickCrawl = true
    expect(await crawlCache.autoSave()).toBeNull()
    expect(crawlCache.list()).toHaveLength(0)
    states.quickCrawl = false
    expect(await crawlCache.autoSave()).not.toBeNull()
    expect(crawlCache.list()).toHaveLength(1)
  })

  it('上限擋下（預設 20 筆）', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      seedStore(`a${i}`, 1)
      expect(await crawlCache.autoSave()).not.toBeNull()
    }
    seedStore('overflow', 1)
    expect(await crawlCache.autoSave()).toBeNull()
    expect(crawlCache.list()).toHaveLength(MAX_ENTRIES)
  })

  it('list 回傳深拷貝：外部修改不污染快取', async () => {
    seedStore()
    await crawlCache.autoSave()
    const list = crawlCache.list()
    list[0].title = 'hacked'
    list[0].results[0].title = 'hacked'
    const fresh = crawlCache.list()
    expect(fresh[0].title).toBe('artist')
    expect(fresh[0].results[0].title).toBe('t')
  })

  it('改名：空字串與未知 id 拒絕', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    expect(await crawlCache.rename(e.id, '  new name  ')).toBe(true)
    expect(crawlCache.list()[0].title).toBe('new name')
    expect(await crawlCache.rename(e.id, '   ')).toBe(false)
    expect(await crawlCache.rename('nope', 'x')).toBe(false)
  })

  it('刪除：存在才刪', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    expect(await crawlCache.remove(e.id)).toBe(true)
    expect(crawlCache.list()).toHaveLength(0)
    expect(await crawlCache.remove(e.id)).toBe(false)
  })

  it('掛載：取代 store、清等待佇列、不開始下載、發 mountChange', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    store.waitingIdList = [{ id: 'x', type: 'post' }]
    store.result = []
    store.resultMeta = []
    const events: any[] = []
    EVT.on('mountChange', (ev) => events.push(ev.detail.data))
    expect(await crawlCache.mount(e.id)).toBe(true)
    expect(store.result).toHaveLength(2)
    expect(store.waitingIdList).toHaveLength(0)
    expect(store.result[0].creator).toBe('artist')
    expect(store.title).toBe('artist')
    expect(store.remainingDownload).toBe(2)
    expect(crawlCache.isMounted(e.id)).toBe(true)
    const mounted = crawlCache.getMounted()
    expect(mounted?.unsaved).toBe(false)
    expect(mounted?.entry?.id).toBe(e.id)
    expect(mounted?.entry).not.toHaveProperty('results')
    expect(events).toEqual([{ manual: true }])
    // 深拷貝：改 store 不污染快取
    store.result[0].title = 'changed'
    expect(crawlCache.list()[0].results[0].title).toBe('t')
    expect(downloadControl.startDownload).not.toHaveBeenCalled()
  })

  it('掛載：下載中或暫停中拒絕，store 不動', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    seedStore('other', 1)
    states.downloading = true
    expect(await crawlCache.mount(e.id)).toBe(false)
    states.downloading = false
    states.downloadPaused = true
    expect(await crawlCache.mount(e.id)).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(store.result).toHaveLength(1)
    expect(store.result[0].creator).toBe('other')
    expect(crawlCache.isMounted(e.id)).toBe(false)
  })

  it('掛載：抓取中（busy）拒絕', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    store.result = []
    states.busy = true
    expect(await crawlCache.mount(e.id)).toBe(false)
    expect(store.result).toHaveLength(0)
  })

  it('掛載：重複掛載同一筆直接回 true 不動 store', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    expect(await crawlCache.mount(e.id)).toBe(true)
    store.result[0].title = 'edited'
    expect(await crawlCache.mount(e.id)).toBe(true)
    expect(store.result[0].title).toBe('edited')
  })

  it('刪除掛載中的快取：閒置時一併卸載並清空 store', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    await crawlCache.mount(e.id)
    expect(await crawlCache.remove(e.id)).toBe(true)
    expect(crawlCache.getMounted()).toBeNull()
    expect(store.result).toHaveLength(0)
    expect(store.resultMeta).toHaveLength(0)
  })

  it('刪除掛載中的快取：下載中拒絕', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    await crawlCache.mount(e.id)
    states.downloading = true
    expect(await crawlCache.remove(e.id)).toBe(false)
    expect(crawlCache.list()).toHaveLength(1)
    expect(store.result).toHaveLength(2)
    expect(crawlCache.isMounted(e.id)).toBe(true)
  })

  it('改名掛載中的快取：同步 store.title', async () => {
    seedStore()
    await crawlCache.autoSave()
    const [e] = crawlCache.list()
    await crawlCache.mount(e.id)
    await crawlCache.rename(e.id, 'renamed')
    expect(store.title).toBe('renamed')
    expect(crawlCache.getMounted()?.entry?.title).toBe('renamed')
  })

  it('持久化：寫入 storage.local', async () => {
    seedStore()
    await crawlCache.autoSave()
    await new Promise((r) => setTimeout(r, 400))
    const saved = mem['pawchiveProCrawlCache']
    expect(Array.isArray(saved)).toBe(true)
    expect(saved).toHaveLength(1)
    expect(saved[0].results).toHaveLength(2)
  })
})

describe('crawlCache 事件路徑', () => {
  const flush = () => new Promise((r) => setTimeout(r, 20))

  // EVT 是模組內的私有匯流排單例；每次重新載入模組（含 EVT）以重新綁定，
  // 並在同一批 import 取得與受測模組相同的 EVT 實例來派發事件
  let evt: typeof EVT
  async function fresh() {
    vi.resetModules()
    evt = (await import('../src/EVT')).EVT
    const st = (await import('../src/store/States')).states
    const sto = (await import('../src/store/Store')).store
    const cache = (await import('../src/download/CrawlCache')).crawlCache
    sto.resultMeta = [file('patreon/u1/999', { id: 'patreon/u1/999' })]
    sto.result = [file('patreon/u1/999#0', { fileIndex: 0 })]
    return { st, cache }
  }

  it('crawlComplete 事件：正常抓取會存', async () => {
    const { st, cache } = await fresh()
    st.quickCrawl = false
    evt.fire('crawlComplete')
    await flush()
    expect(cache.list()).toHaveLength(1)
  })

  it('crawlComplete 事件：快速單帖抓取不存（旗標不會被事件提前復位）', async () => {
    const { st, cache } = await fresh()
    st.quickCrawl = true
    evt.fire('crawlComplete')
    await flush()
    expect(st.quickCrawl).toBe(true)
    expect(cache.list()).toHaveLength(0)
  })

  it('stopCrawl 後觸發 crawlComplete：中止的部分結果不存', async () => {
    const { st, cache } = await fresh()
    st.quickCrawl = false
    evt.fire('stopCrawl')
    evt.fire('crawlComplete')
    await flush()
    expect(cache.list()).toHaveLength(0)
  })
})

describe('crawlComplete 掛載決策', () => {
  const flush = () => new Promise((r) => setTimeout(r, 20))
  let evt: typeof EVT
  const fire = (t: eventNames) => evt.fire(t)

  async function fresh() {
    vi.resetModules()
    evt = (await import('../src/EVT')).EVT
    mem = {}
    const st = (await import('../src/store/States')).states
    const sto = (await import('../src/store/Store')).store
    const settings = (await import('../src/setting/Settings')).settings
    const cache = (await import('../src/download/CrawlCache')).crawlCache
    const dc = (await import('../src/download/DownloadControl')).downloadControl
    const tst = (await import('../src/Toast')).toast
    st.settingInitialized = true
    vi.spyOn(dc, 'readyDownload').mockImplementation(() => {})
    vi.spyOn(dc, 'drainAfterCrawl').mockImplementation(() => {})
    vi.spyOn(tst, 'show').mockImplementation(() => {})
    vi.spyOn(tst, 'success').mockImplementation(() => {})
    vi.spyOn(tst, 'error').mockImplementation(() => {})
    return { st, sto, settings, cache, dc }
  }

  function seed(sto: typeof store, creator: string, n = 1) {
    sto.resultMeta = [file('patreon/u1/999', { id: 'patreon/u1/999', creator })]
    sto.result = Array.from({ length: n }, (_, i) =>
      file('patreon/u1/999#' + i, { fileIndex: i, creator })
    )
  }

  it('autoMountCache 開：新結果存入並掛載，走 readyDownload', async () => {
    const { st, sto, cache, dc } = await fresh()
    st.quickCrawl = false
    seed(sto, 'new')
    fire('crawlComplete')
    await flush()
    const list = cache.list()
    expect(list).toHaveLength(1)
    const mounted = cache.getMounted()
    expect(mounted?.unsaved).toBe(false)
    expect(mounted?.entry?.id).toBe(list[0].id)
    expect(dc.readyDownload).toHaveBeenCalledTimes(1)
    expect(dc.drainAfterCrawl).not.toHaveBeenCalled()
    expect(sto.result[0].creator).toBe('new')
  })

  it('autoMountCache 關：還原原本掛載的快取並保留等待佇列', async () => {
    const { st, sto, settings, cache, dc } = await fresh()
    st.quickCrawl = false
    seed(sto, 'old', 2)
    fire('crawlComplete')
    await flush()
    const oldId = cache.list()[0].id
    expect(cache.isMounted(oldId)).toBe(true)
    vi.mocked(dc.readyDownload).mockClear()

    settings.set('autoMountCache', false)
    fire('crawlStart')
    st.quickCrawl = false
    seed(sto, 'fresh', 1)
    sto.waitingIdList = [{ id: 'q', type: 'post' }]
    fire('crawlComplete')
    await flush()

    expect(cache.list()).toHaveLength(2)
    expect(cache.list()[0].title).toBe('fresh')
    expect(cache.isMounted(oldId)).toBe(true)
    expect(sto.result).toHaveLength(2)
    expect(sto.result[0].creator).toBe('old')
    expect(sto.title).toBe('old')
    expect(sto.waitingIdList).toHaveLength(1)
    expect(dc.drainAfterCrawl).toHaveBeenCalledTimes(1)
    expect(dc.readyDownload).not.toHaveBeenCalled()
  })

  it('autoMountCache 關且原本沒掛載：清空下載區、不掛載', async () => {
    const { st, sto, settings, cache, dc } = await fresh()
    settings.set('autoMountCache', false)
    st.quickCrawl = false
    fire('crawlStart')
    seed(sto, 'fresh', 1)
    fire('crawlComplete')
    await flush()
    expect(cache.list()).toHaveLength(1)
    expect(cache.getMounted()).toBeNull()
    expect(sto.result).toHaveLength(0)
    expect(dc.drainAfterCrawl).toHaveBeenCalledTimes(1)
    expect(dc.readyDownload).not.toHaveBeenCalled()
  })

  it('中途停止的結果：不存快取，直接以未存入狀態掛載', async () => {
    const { st, sto, settings, cache, dc } = await fresh()
    // 即使關閉自動掛載，沒存進快取的結果也一律直接掛載
    settings.set('autoMountCache', false)
    st.quickCrawl = false
    fire('stopCrawl')
    seed(sto, 'partial', 1)
    fire('crawlComplete')
    await flush()
    expect(cache.list()).toHaveLength(0)
    expect(cache.getMounted()).toEqual({ entry: null, unsaved: true })
    expect(sto.result).toHaveLength(1)
    expect(dc.readyDownload).toHaveBeenCalledTimes(1)
  })

  it('未存入的掛載：掛載其他快取前要確認，拒絕則不動', async () => {
    const { st, sto, cache } = await fresh()
    st.quickCrawl = false
    seed(sto, 'saved', 1)
    fire('crawlComplete')
    await flush()
    const id = cache.list()[0].id
    // 新一輪快抓：結果不存、掛載為未存入
    fire('crawlStart')
    st.quickCrawl = true
    seed(sto, 'quick', 1)
    fire('crawlComplete')
    await flush()
    expect(cache.getMounted()?.unsaved).toBe(true)
    ;(globalThis as any).window.confirm = () => false
    expect(await cache.mount(id)).toBe(false)
    expect(sto.result[0].creator).toBe('quick')
    ;(globalThis as any).window.confirm = () => true
    expect(await cache.mount(id)).toBe(true)
    expect(sto.result[0].creator).toBe('saved')
    expect(cache.getMounted()?.unsaved).toBe(false)
  })

  it('空結果：不掛載，交給 readyDownload 收尾', async () => {
    const { st, sto, cache, dc } = await fresh()
    st.quickCrawl = false
    sto.result = []
    sto.resultMeta = []
    fire('crawlComplete')
    await flush()
    expect(cache.getMounted()).toBeNull()
    expect(dc.readyDownload).toHaveBeenCalledTimes(1)
  })

  it('crawlStart 後卸載（store 會被清空）', async () => {
    const { st, sto, cache } = await fresh()
    st.quickCrawl = false
    seed(sto, 'a', 1)
    fire('crawlComplete')
    await flush()
    expect(cache.getMounted()).not.toBeNull()
    fire('crawlStart')
    expect(cache.getMounted()).toBeNull()
  })
})
