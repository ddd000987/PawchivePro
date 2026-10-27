/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：掛載詳情卡（首頁與下載頁共用，一起刷新） */

import { crawlCache } from '../../download/CrawlCache'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { store } from '../../store/Store'
import { states } from '../../store/States'

export class MountInfoView {
  /** 掛載詳情卡（首頁與下載頁各一份，一起刷新） */
  private mountInfos: HTMLDivElement[] = []

  /** 掛載詳情卡：顯示目前下載目標是哪筆快取、內容與下載狀態 */
  public build(host: HTMLDivElement): void {
    const box = document.createElement('div')
    box.className = 'pwpSC-row pwpSC-status pwpSC-cacheCard pwpSC-mountInfo'
    host.appendChild(box)
    this.mountInfos.push(box)
    this.refresh()
  }

  /** 重繪所有掛載詳情卡（動態文字直接寫 textContent，語言切換時重繪） */
  public refresh(): void {
    if (this.mountInfos.length === 0) {
      return
    }
    const mounted = crawlCache.getMounted()
    const lines: Array<{ text: string; title?: boolean }> = []
    if (!mounted) {
      lines.push({ text: lang.transl('_mountNone') })
    } else {
      const e = mounted.entry
      lines.push({
        text: e
          ? lang.transl('_mountTitle', e.title)
          : lang.transl('_mountUnsavedTitle'),
        title: true,
      })
      // 來源：已存入快取用快取記錄的值；未存入則取 store 第一筆
      const first = store.result[0]
      const source = e
        ? {
            service: e.service,
            host: e.host,
            creator: e.creator,
            creatorId: e.creatorId,
          }
        : first
          ? {
              service: first.service,
              host: location.host,
              creator: first.creator,
              creatorId: first.creatorId,
            }
          : null
      if (source) {
        lines.push({
          text: lang.transl(
            '_mountSource',
            source.service,
            source.host,
            source.creator,
            source.creatorId
          ),
        })
      }
      // 數量以 store 為準：下載中刪帖後仍與實際下載內容一致
      const count = { image: 0, video: 0, other: 0, text: 0 }
      for (const r of store.result) {
        if (r.kind === 'video') count.video++
        else if (r.kind === 'text') count.text++
        else if (r.kind === 'image' || r.kind === 'cover') count.image++
        else count.other++
      }
      lines.push({
        text: lang.transl(
          '_mountCounts',
          String(store.resultMeta.length),
          String(store.result.length),
          String(count.image),
          String(count.video),
          String(count.other),
          String(count.text)
        ),
      })
      if (e) {
        lines.push({
          text: lang.transl(
            '_mountTime',
            new Date(e.createdAt).toLocaleString()
          ),
        })
      }
      const statusKey: LangTextKey = states.downloadPaused
        ? '_mountStatusPaused'
        : states.downloading
          ? '_mountStatusDownloading'
          : '_mountStatusIdle'
      lines.push({ text: lang.transl('_mountStatus', lang.transl(statusKey)) })
    }
    for (const box of this.mountInfos) {
      box.innerHTML = ''
      for (const line of lines) {
        const div = document.createElement('div')
        div.className = line.title
          ? 'pwpSC-cacheTitle'
          : 'pwpSC-row pwpSC-status'
        div.textContent = line.text
        box.appendChild(div)
      }
    }
  }
}
