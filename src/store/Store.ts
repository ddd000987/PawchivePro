/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/store/Store.ts (xuejianxianzun)
 * changes: numeric id dedup replaced with postKey dedup;
 *          Pixiv page info (Tools.getTagFromURL/...) replaced with Kemono
 *          detectPage(); one post expands to N file Results (attachments +
 *          cover + text), deduped by postKey. rank/waiting semantics kept.
 */

import { EVT } from '../EVT'
import { detectPage } from '../kemono/pages'
import { IDData, Result, ResultOptional } from './StoreType'

/** 保存抓取結果和一些公用數據 */
class Store {
  constructor() {
    this.bindEvents()
  }

  /** 儲存從列表中抓取到的帖子的 key */
  public idList: IDData[] = []

  /** 下載器忙碌時，新的抓取請求進入等待隊列
   *
   * 當抓取結果為空、以及下載完畢後，會開始抓取等待隊列裡的 id */
  public waitingIdList: IDData[] = []

  /** 忙碌時按下「開始抓取」：等待目前任務結束後再抓整頁 */
  public waitingFullCrawl = false

  /** 儲存抓取結果的元數據。每個帖子只會有一條數據 */
  public resultMeta: Result[] = []

  /** 儲存抓取結果（每帖展開為多個檔案） */
  public result: Result[] = []

  /** 儲存已抓取的帖子 key，用來避免重複添加 */
  private postKeyList: string[] = []

  /** 記錄從每個帖子裡下載多少個文件 */
  public downloadCount: {
    [postKey: string]: number
  } = {}

  public resetDownloadCount() {
    this.downloadCount = {}
    for (const r of this.result) {
      this.downloadCount[r.postKey] = (this.downloadCount[r.postKey] || 0) + 1
    }
  }

  /** 有多少個文件尚未下載完成 */
  public remainingDownload = 0
  /** 開始抓取時，儲存頁面此時的標題 */
  public title = ''
  /** 開始抓取時，儲存頁面此時的 id（創作者 ID 或帖子 ID） */
  public pageId = ''
  /** 開始抓取時，儲存頁面類型：creator/post/other */
  public pageType = ''
  /** 開始抓取時，儲存頁面此時的 URL */
  public URLWhenCrawlStart = ''
  /** 抓取完成的時間 */
  public crawlCompleteTime: Date = new Date()

  private readonly resultDefault: Result = {
    id: '',
    postKey: '',
    service: '',
    creator: '',
    creatorId: '',
    postId: '',
    title: '',
    published: '',
    fileCount: 0,
    pending: false,
    fileUrl: '',
    fileName: '',
    ext: '',
    kind: 'other',
    previewOnly: false,
    textData: '',
    fileIndex: 0,
  }

  /** 添加一個帖子的數據。只需要傳遞有值的屬性
   *
   * 一帖含多個附件時，只需要傳遞附件列表，Store 會為每個附件生成一條 Result。
   * 已存在的 postKey 會被忽略（去重）。
   */
  public addResult(data: ResultOptional, files: ResultOptional[]) {
    const postKey = data.postKey ?? ''
    if (!postKey) {
      return
    }
    // 檢查該帖子是否已存在，已存在則不添加
    if (this.postKeyList.includes(postKey)) {
      return
    }
    this.postKeyList.push(postKey)

    // 生成該帖子的元數據（取第一個附件的快照，僅展示用）
    const meta = Object.assign({}, this.resultDefault, data, files[0] ?? {})
    meta.id = postKey
    this.resultMeta.push(meta)
    EVT.fire('addResult', meta)

    // 為每個附件生成一條抓取結果
    const kept: Result[] = []
    for (let i = 0; i < files.length; i++) {
      const result = Object.assign({}, this.resultDefault, data, files[i])
      result.fileIndex = i
      result.id = `${postKey}#${i}`
      this.result.push(result)
      kept.push(result)
    }
    this.downloadCount[postKey] = kept.length
  }

  /** 換上一批結果：同步重建去重表與下載計數，但不動等待中的抓取任務 */
  public replaceResults(results: Result[], metas: Result[]) {
    this.result = results
    this.resultMeta = metas
    this.postKeyList = metas.map((meta) => meta.postKey || meta.id)
    this.resetDownloadCount()
    this.remainingDownload = results.length
  }

  /** 從快照載入結果：同 replaceResults，並清掉等待中的抓取任務 */
  public loadSnapshot(results: Result[], metas: Result[]) {
    this.replaceResults(results, metas)
    this.waitingIdList = []
    this.waitingFullCrawl = false
  }

  public findResult(id: string) {
    return this.result.find((item) => item.id === id)
  }

  /** 從 idList 和抓取結果裡移除指定的帖子。返回值表示是否有帖子被刪除 */
  public removeWorkById(ids: string[]) {
    const beforeMetaLength = this.resultMeta.length
    const beforeResultLength = this.result.length

    for (const id of ids) {
      const idIndex = this.idList.findIndex((item) => item.id === id)
      if (idIndex !== -1) {
        this.idList.splice(idIndex, 1)
      }

      this.resultMeta = this.resultMeta.filter((r) => r.postKey !== id)
      this.result = this.result.filter((r) => r.postKey !== id)

      const keyIndex = this.postKeyList.indexOf(id)
      if (keyIndex !== -1) {
        this.postKeyList.splice(keyIndex, 1)
      }
      delete this.downloadCount[id]
    }

    if (
      this.resultMeta.length < beforeMetaLength ||
      this.result.length < beforeResultLength
    ) {
      EVT.fire('resultChange')
      return true
    }

    return false
  }

  public reset() {
    this.resultMeta = []
    this.postKeyList = []
    this.result = []
    this.idList = []
    this.waitingIdList = []
    this.waitingFullCrawl = false
    this.remainingDownload = 0
    this.title = document.title
    const page = detectPage()
    this.pageId =
      page.kind === 'other'
        ? ''
        : page.kind === 'creator'
          ? page.creatorId
          : page.postId
    this.pageType = page.kind
  }

  private bindEvents() {
    EVT.on(EVT.list.crawlStart, () => {
      this.URLWhenCrawlStart = window.location.href
      this.reset()
    })

    // 停止下載時，清空等待下載的任務（含等待中的整頁抓取）
    EVT.on(EVT.list.downloadStop, () => {
      this.waitingIdList = []
      this.waitingFullCrawl = false
    })
  }
}

const store = new Store()
export { store }
