/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：抓取／待下載狀態列（首頁與下載頁共用，一起刷新） */

import { lang } from '../../Language'
import { store } from '../../store/Store'

export class StatusRows {
  private crawlStatus!: HTMLDivElement
  /** 首頁與下載頁各一個待下載狀態列（都要刷新） */
  private downloadStatuses: HTMLDivElement[] = []

  /** 建立抓取狀態列（首頁用） */
  public createCrawl(): HTMLDivElement {
    this.crawlStatus = document.createElement('div')
    this.crawlStatus.className = 'pwpSC-row pwpSC-status'
    return this.crawlStatus
  }

  /** 建立待下載狀態列並登記，之後一起刷新 */
  public createDownload(): HTMLDivElement {
    const downloadStatus = document.createElement('div')
    downloadStatus.className = 'pwpSC-row pwpSC-status'
    this.downloadStatuses.push(downloadStatus)
    return downloadStatus
  }

  public refresh(): void {
    this.crawlStatus.textContent = lang.transl(
      '_statusCrawl',
      String(store.resultMeta.length),
      String(store.result.length)
    )
    const downloadText = lang.transl(
      '_statusDownload',
      String(store.remainingDownload)
    )
    for (const el of this.downloadStatuses) el.textContent = downloadText
  }
}
