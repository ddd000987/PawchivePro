/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 抓取快取：crawlComplete 有結果時自動把本輪 store 快照一筆
 * （chrome.storage.local 持久化），用戶可稍後從抓取頁的快取列表「掛載」並下載。
 * 動機：新一輪抓取的 crawlStart 會清空 store，快取是那之前的逃生艙。
 * 掛載＝把某筆快取載入 store 當作目前下載目標；開始下載由用戶到下載頁手動按。
 * 本模組同時擁有「抓取完成後要不要掛載新結果」的決定權。
 */

import { downloadControl } from './DownloadControl'
import { downloadStates } from './DownloadStates'
import { progressBar } from './ProgressBar'
import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'
import { settings } from '../setting/Settings'
import { store } from '../store/Store'
import { states } from '../store/States'
import type { Result } from '../store/StoreType'
import { toast } from '../Toast'

/** storage key（與下載記錄的 pawchiveProDownloadRecord 區分） */
const STORE_KEY = 'pawchiveProCrawlCache'

/** 快取上限筆數（storage.local 約 10MB；大創作者單筆就可能很大） */
const MAX_ENTRIES = 20

export interface CacheEntry {
  id: string
  /** 可改名；預設創作者名 */
  title: string
  service: string
  creatorId: string
  creator: string
  host: string
  postCount: number
  fileCount: number
  createdAt: number
  results: Result[]
  metas: Result[]
}

/** 不含大陣列的快取摘要（給 UI 頻繁刷新用，避免深拷貝整批結果） */
export type CacheSummary = Omit<CacheEntry, 'results' | 'metas'>

/** 目前掛載狀態：entry 為已存入快取的那筆；unsaved＝store 裡是沒進快取的結果 */
export interface MountedInfo {
  entry: CacheSummary | null
  unsaved: boolean
}

class CrawlCache {
  private entries: CacheEntry[] = []
  private loadPromise: Promise<void> | null = null
  private saveTimer = 0
  /** 目前掛載的快取 id */
  private mountedId: string | null = null
  /** store 裡的結果沒有對應快取（單帖快抓、中途停止、快取已滿） */
  private mountedUnsaved = false
  /** crawlStart 前掛載的快取 id：不自動掛載新結果時要還原它 */
  private prevMountedId: string | null = null

  constructor() {
    this.bindEvents()
    void this.ensureLoaded()
  }

  private bindEvents() {
    // 新一輪抓取會清空 store，原本掛載的結果隨之消失
    EVT.on(EVT.list.crawlStart, () => {
      if (this.mountedId) {
        this.prevMountedId = this.mountedId
      }
      this.mountedId = null
      this.mountedUnsaved = false
      this.fireMountChange(false)
    })
    EVT.on(EVT.list.crawlComplete, () => {
      // quickCrawl／stopCrawl 必須在任何 await 之前同步擷取：之後旗標可能已被下一輪改寫
      void this.onCrawlComplete(states.quickCrawl, states.stopCrawl)
    })
  }

  private fireMountChange(manual: boolean): void {
    EVT.fire('mountChange', { manual })
  }

  /** 抓取完成：先存快取，再決定新結果要不要掛載，最後交還給下載流程 */
  private async onCrawlComplete(
    quick: boolean,
    stopped: boolean
  ): Promise<void> {
    const autoMount = settings.get('autoMountCache')
    const prevId = this.prevMountedId
    this.prevMountedId = null
    // 不自動掛載時由這裡提示「未掛載」，autoSave 不重複彈 toast
    const entry = await this.autoSave({ quick, stopped, silent: !autoMount })

    if (store.result.length === 0) {
      // 這輪什麼都沒抓到：還原原本掛載的快取，不要讓下載區平白變空
      const prev = prevId
        ? this.entries.find((e) => e.id === prevId)
        : undefined
      if (prev) {
        this.applyToStore(prev.results, prev.metas, prev.title, true)
        this.mountedId = prev.id
        this.mountedUnsaved = false
        this.fireMountChange(false)
        // 不走 readyDownload：那會對還原的快取自動開始下載
        downloadControl.drainAfterCrawl()
        return
      }
      this.mountedId = null
      this.mountedUnsaved = false
      this.fireMountChange(false)
      // 空結果的收尾（收進度條、排下一輪）交給 DownloadControl
      downloadControl.readyDownload()
      return
    }

    if (entry && !autoMount) {
      // 新結果只留在快取：還原原本掛載的快取，沒有就清空下載區
      const prev = prevId
        ? this.entries.find((e) => e.id === prevId)
        : undefined
      if (prev) {
        this.applyToStore(prev.results, prev.metas, prev.title, true)
        this.mountedId = prev.id
      } else {
        this.applyToStore([], [], document.title, true)
        this.mountedId = null
      }
      this.mountedUnsaved = false
      this.fireMountChange(false)
      toast.show(lang.transl('_cacheSavedNotMounted', entry.title))
      downloadControl.drainAfterCrawl()
      return
    }

    // 自動掛載，或結果沒能存進快取（一律直接掛載避免遺失）：store 已是這批結果
    this.mountedId = entry?.id ?? null
    this.mountedUnsaved = !entry
    this.fireMountChange(false)
    downloadControl.readyDownload()
  }

  /** 把一批結果換進 store（深拷貝）並重建下載狀態；keepQueue 時保留等待中的抓取任務 */
  private applyToStore(
    results: Result[],
    metas: Result[],
    title: string,
    keepQueue: boolean
  ): void {
    const r: Result[] = JSON.parse(JSON.stringify(results))
    const m: Result[] = JSON.parse(JSON.stringify(metas))
    if (keepQueue) {
      store.replaceResults(r, m)
    } else {
      // loadSnapshot 另外清等待佇列，否則舊任務會接在這批結果後面開跑
      store.loadSnapshot(r, m)
    }
    store.title = title
    // 狀態列表長度跟著新結果走，並收起舊的逐檔進度條；
    // 不發 resultChange：那會觸發 readyDownload 的自動開始下載
    downloadStates.init()
    progressBar.reset(0)
  }

  /** 目前掛載狀態；什麼都沒掛載回傳 null（entry 為不含大陣列的摘要） */
  public getMounted(): MountedInfo | null {
    if (this.mountedId) {
      const e = this.entries.find((x) => x.id === this.mountedId)
      if (e) {
        const { results: _r, metas: _m, ...summary } = e
        return { entry: summary, unsaved: false }
      }
    }
    if (this.mountedUnsaved && store.result.length > 0) {
      return { entry: null, unsaved: true }
    }
    return null
  }

  public isMounted(id: string): boolean {
    return this.mountedId === id
  }

  /** 單例門：併發呼叫共用同一次載入，避免構造器預載與首次快照互相覆寫 */
  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const data = await chrome.storage.local.get(STORE_KEY)
          const saved = data[STORE_KEY] as CacheEntry[] | undefined
          if (Array.isArray(saved)) {
            this.entries = saved.filter(
              (e) => !!e && typeof e.id === 'string' && Array.isArray(e.results)
            )
          }
        } catch (e) {
          console.error('[PawchivePro] load crawl cache failed', e)
        }
      })()
    }
    return this.loadPromise
  }

  /** 目前快取（新在前；回傳深拷貝，防外部竄改快取內容） */
  public list(): CacheEntry[] {
    return JSON.parse(JSON.stringify(this.entries))
  }

  /** 抓取完成自動快照（空結果／縮圖單帖快抓不存；滿了擋下請用戶先刪舊的）。
   * 成功回傳該筆摘要，沒存回傳 null；silent 時不彈「已存入」提示 */
  public async autoSave(
    opts: { quick?: boolean; stopped?: boolean; silent?: boolean } = {}
  ): Promise<CacheSummary | null> {
    // 必須在任何 await 之前同步擷取：之後旗標可能已被下一輪改寫
    const quick = opts.quick ?? states.quickCrawl
    const stopped = opts.stopped ?? states.stopCrawl
    await this.ensureLoaded()
    // 縮圖單帖快抓、用戶中途停止的不完整結果都不存
    if (quick || stopped) {
      return null
    }
    if (store.result.length === 0) {
      return null
    }
    if (this.entries.length >= MAX_ENTRIES) {
      toast.warning(lang.transl('_cacheFull', String(MAX_ENTRIES)))
      return null
    }
    const first = store.result[0]
    const entry: CacheEntry = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`,
      title: first.creator || first.creatorId,
      service: first.service,
      creatorId: first.creatorId,
      creator: first.creator,
      host: location.host,
      postCount: store.resultMeta.length,
      fileCount: store.result.length,
      createdAt: Date.now(),
      results: JSON.parse(JSON.stringify(store.result)),
      metas: JSON.parse(JSON.stringify(store.resultMeta)),
    }
    this.entries.unshift(entry)
    this.persist()
    EVT.fire('cacheChange', { id: entry.id })
    if (!opts.silent) {
      toast.show(lang.transl('_cacheSaved', entry.title))
    }
    const { results: _r, metas: _m, ...summary } = entry
    return summary
  }

  public async rename(id: string, title: string): Promise<boolean> {
    await this.ensureLoaded()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) {
      return false
    }
    const t = title.trim()
    if (!t) {
      return false
    }
    entry.title = t
    this.persist()
    EVT.fire('cacheChange', { id })
    if (this.mountedId === id) {
      store.title = t
      this.fireMountChange(false)
    }
    return true
  }

  public async remove(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) {
      return false
    }
    const mounted = this.mountedId === id
    // 正在下載（含暫停）的快取不能刪，否則下載目標憑空消失
    if (mounted && (states.busy || states.hasDownloadTask)) {
      toast.error(lang.transl('_cacheDeleteMountedBusy'))
      return false
    }
    this.entries.splice(i, 1)
    this.persist()
    EVT.fire('cacheChange', { id })
    if (mounted) {
      // 刪掉掛載中的快取：一併清空下載區，避免留著已無對應快取的結果
      this.applyToStore([], [], document.title, false)
      this.mountedId = null
      this.mountedUnsaved = false
      this.fireMountChange(false)
    }
    return true
  }

  /** 掛載：載入 store 當作目前下載目標，不自動開始下載。
   * 下載中（含暫停）／抓取中拒絕；目前掛載的是未存入快取的結果時先確認 */
  public async mount(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry || entry.results.length === 0) {
      return false
    }
    await states.waitSettingInitialized()
    if (states.busy || states.hasDownloadTask) {
      toast.error(lang.transl('_mountBusy'))
      return false
    }
    if (this.mountedId === id) {
      toast.show(lang.transl('_alreadyMounted'))
      return true
    }
    if (this.mountedUnsaved && store.result.length > 0) {
      if (!window.confirm(lang.transl('_mountReplaceUnsaved'))) {
        return false
      }
    }
    // 去重表、等待佇列、下載計數都會跟著重建，否則後續 addResult 去重／
    // removeWorkById 會對不上這批結果
    this.applyToStore(entry.results, entry.metas, entry.title, false)
    this.mountedId = id
    this.mountedUnsaved = false
    this.fireMountChange(true)
    toast.success(lang.transl('_mounted', entry.title))
    return true
  }

  private persist(): void {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      void this.saveEntries()
    }, 200)
  }

  private async saveEntries(): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORE_KEY]: this.entries })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 配額不足：由舊到新丟棄，直到能寫入（最新一筆優先保留）
      if (/quota/i.test(msg) && this.entries.length > 1) {
        const removed = this.entries.pop()
        EVT.fire('cacheChange', { id: removed?.id ?? '' })
        // 被丟掉的剛好是掛載中的：結果還在 store，改記成未存入快取
        if (removed && removed.id === this.mountedId) {
          this.mountedId = null
          this.mountedUnsaved = true
          this.fireMountChange(false)
        }
        log.warning(lang.transl('_cacheEvicted', removed?.title ?? ''))
        this.persist()
        return
      }
      // 常見於單筆過大（內文 textData 多）超過配額：
      // 本筆仍留記憶體可下載，只是重開瀏覽器後消失
      toast.warning(lang.transl('_cacheStoreFailed'))
      log.warning(lang.transl('_cacheStoreFailed'))
    }
  }
}

const crawlCache = new CrawlCache()
export { crawlCache, MAX_ENTRIES }
