/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/DownloadRecord.ts
 *          record shape + export/import/clear concept
 *          (xuejianxianzun)
 * changes: schema redesigned — single chrome.storage.local
 *          store keyed by per-file result id (`${postKey}#${index}`);
 *          no ID-shard stores (PBD's 9 numeric shards don't fit Kemono
 *          string keys), no IndexedDB (records are small). d = published
 *          date; matching is by id only (the old strict mode was dropped).
 *          Replaces the earlier DownloadedKeys store (deleted).
 */

import { EVT } from '../EVT'
import { fileName } from '../filename/FileName'
import { lang } from '../Language'
import { log } from '../Log'
import { settings } from '../setting/Settings'
import { skipByRecord } from '../setting/skipMode'
import { Result } from '../store/StoreType'
import { toast } from '../Toast'

const STORE_KEY = 'pawchiveProDownloadRecord'

/** 單條下載記錄：{id 檔 id, n 檔名, d 發布日期, s 展開形狀指紋} */
export interface RecordItem {
  id: string
  n: string
  d: string
  /** 展開形狀指紋（textContent|noCoverFile）。缺失的舊記錄視為形狀未知，
   * 查詢時走檔名比對，切換設定後不會位移誤判 */
  s?: string
}

class DownloadRecord {
  constructor() {
    this.bindEvents()
  }

  private records: Record<string, RecordItem> = {}
  /** postKey → 該帖記錄的索引（hasPost 用，避免每帖全表掃描） */
  private postIndex: Map<string, RecordItem[]> | null = null
  private loadPromise: Promise<void> | null = null
  private saveTimer = 0

  /** 單例門：冷啟動時併發呼叫共用同一次載入，避免後寫入的記錄被讀回的舊資料覆寫 */
  private load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const data = await chrome.storage.local.get(STORE_KEY)
          const saved = data[STORE_KEY] as
            Record<string, RecordItem> | undefined
          if (saved && typeof saved === 'object') {
            this.records = saved
            this.postIndex = null
          }
        } catch (e) {
          console.error('[PawchivePro] load download record failed', e)
        }
      })()
    }
    return this.loadPromise
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.persist(), 200)
  }

  /** 寫入失敗時只提醒一次，避免每個檔案都跳 toast */
  private saveFailedNotified = false

  private persist(): void {
    chrome.storage.local
      .set({ [STORE_KEY]: this.records })
      .then(() => {
        this.saveFailedNotified = false
      })
      .catch((e) => {
        console.error('[PawchivePro] save record failed', e)
        if (!this.saveFailedNotified) {
          this.saveFailedNotified = true
          const msg = lang.transl('_recordStoreFailed')
          log.error(msg)
          toast.error(msg)
        }
      })
  }

  /** 由抓取結果生成一條記錄 */
  private createRecord(result: Result): RecordItem {
    return {
      id: result.id,
      n: fileName.createFileName(result),
      d: result.published,
      s: this.expandShape(),
    }
  }

  /** 展開形狀指紋：影響附件序號的兩個開關。序號變了舊記錄的位置鍵
   * 就不再可信，查詢時必須改走檔名比對 */
  private expandShape(): string {
    return `${settings.get('textContent')}|${settings.get('noCoverFile') ? 1 : 0}`
  }

  /** 下載成功後登記（記憶體同步寫入，storage 防抖持久化） */
  public async addRecord(result: Result): Promise<void> {
    await this.load()
    this.records[result.id] = this.createRecord(result)
    this.postIndex = null
    this.scheduleSave()
  }

  public async getRecord(id: string): Promise<RecordItem | null> {
    await this.load()
    return this.records[id] ?? null
  }

  /** 檢查單檔是否重複。true = 跳過 */
  public async checkDeduplication(result: Result): Promise<boolean> {
    // 未啟用「按下載記錄跳過」直接放行
    if (!skipByRecord(settings.get('skipDownloaded'))) {
      return false
    }

    const record = await this.getRecord(result.id)
    if (record === null) {
      return false
    }

    // 發布日期變了視為新檔案
    if (record.d !== result.published) {
      return false
    }

    // 展開形狀變了（或舊記錄無指紋）：位置鍵不可信，退回檔名比對
    // （否則切 textContent/noCoverFile 會整帖誤判跳過或漏判）
    if (record.s !== this.expandShape()) {
      return fileName.createFileName(result) === record.n
    }

    // 只認 id（命名規則改了也不重下）
    return true
  }

  /** 建立 postKey → 記錄列表的索引（只建一次，記錄異動時作廢） */
  private buildPostIndex(): Map<string, RecordItem[]> {
    if (this.postIndex) {
      return this.postIndex
    }
    const index = new Map<string, RecordItem[]>()
    for (const key of Object.keys(this.records)) {
      const hash = key.lastIndexOf('#')
      if (hash < 0) {
        continue
      }
      const postKey = key.slice(0, hash)
      const list = index.get(postKey)
      if (list) {
        list.push(this.records[key])
      } else {
        index.set(postKey, [this.records[key]])
      }
    }
    this.postIndex = index
    return index
  }

  /** 整帖是否已下完：同帖同日期的記錄數量足夠即可，不比對檔名 */
  public async hasPost(
    postKey: string,
    published: string,
    expectedNames: string[]
  ): Promise<boolean> {
    await this.load()
    if (expectedNames.length === 0) {
      return false
    }
    const matched = (this.buildPostIndex().get(postKey) ?? []).filter(
      (r) => r.d === published
    )
    if (matched.length === 0) {
      return false
    }
    return matched.length >= expectedNames.length
  }

  public async count(): Promise<number> {
    await this.load()
    return Object.keys(this.records).length
  }

  public async clear(silent = false): Promise<void> {
    await this.load()
    this.records = {}
    this.postIndex = null
    this.scheduleSave()
    // 不在此 fire clearDownloadRecord：監聽器會再調 clear()，造成無限遞迴
    if (!silent) {
      toast.show(lang.transl('_recordCleared'))
      log.warning(lang.transl('_recordCleared'))
    }
  }

  private downloadJson(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  private bindEvents() {
    // 下載完成即時落盤，避免防抖窗口內關頁面丟失尾部記錄
    EVT.on(EVT.list.downloadComplete, () => {
      window.clearTimeout(this.saveTimer)
      this.persist()
    })

    EVT.on(EVT.list.exportDownloadRecord, () => {
      void (async () => {
        await this.load()
        this.downloadJson(
          `pawchive-record-${Date.now()}.json`,
          Object.values(this.records)
        )
        toast.show(
          lang.transl(
            '_recordExported',
            String(Object.keys(this.records).length)
          )
        )
      })()
    })

    EVT.on(EVT.list.importDownloadRecord, () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          void (async () => {
            try {
              const list = JSON.parse(reader.result as string) as RecordItem[]
              if (!Array.isArray(list)) {
                throw new Error('not an array')
              }
              await this.load()
              let n = 0
              for (const r of list) {
                if (r && typeof r.id === 'string') {
                  this.records[r.id] = {
                    id: r.id,
                    n: String(r.n ?? ''),
                    d: String(r.d ?? ''),
                    s: typeof r.s === 'string' ? r.s : undefined,
                  }
                  n++
                }
              }
              this.postIndex = null
              this.scheduleSave()
              toast.show(lang.transl('_recordImported', String(n)))
              log.success(lang.transl('_recordImported', String(n)))
            } catch {
              toast.error(lang.transl('_recordImportFailed'))
            }
          })()
        }
        reader.readAsText(file)
      })
      input.click()
    })

    EVT.on(EVT.list.clearDownloadRecord, () => {
      void this.clear()
    })
  }
}

const downloadRecord = new DownloadRecord()
export { downloadRecord }
