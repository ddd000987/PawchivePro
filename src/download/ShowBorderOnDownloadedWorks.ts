/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader ShowBorderOnDownloadedWorks concept
 *          (xuejianxianzun)
 * changes: Kemono cards carry data-postkey (see WorkThumbnail); a post
 *          counts as downloaded only when ALL its result files are
 *          recorded (sibling count from store, no guessing). Re-scans on
 *          crawl/download completion and (delayed) SPA page switches.
 */

import { EVT } from '../EVT'
import { downloadRecord } from './DownloadRecord'
import { fileName } from '../filename/FileName'
import { store } from '../store/Store'

const DONE_CLASS = 'pwp-downloaded'

class ShowBorderOnDownloadedWorks {
  constructor() {
    this.bindEvents()
  }

  private bindEvents() {
    for (const ev of [
      EVT.list.crawlComplete,
      EVT.list.downloadComplete,
      EVT.list.downloadSuccess,
    ]) {
      EVT.on(ev, () => {
        void this.scan()
      })
    }
    // SPA 切換後卡片晚渲染，延遲再掃一次
    EVT.on(EVT.list.pageSwitch, () => {
      window.setTimeout(() => void this.scan(), 1000)
    })
  }

  private async scan(): Promise<void> {
    const cards =
      document.querySelectorAll<HTMLAnchorElement>('a[data-postkey]')
    if (cards.length === 0) {
      return
    }
    const keys = new Set<string>()
    const byKey = new Map<string, HTMLAnchorElement[]>()
    for (const card of cards) {
      const key = card.dataset.postkey
      if (!key) {
        continue
      }
      keys.add(key)
      const list = byKey.get(key) ?? []
      list.push(card)
      byKey.set(key, list)
    }
    for (const key of keys) {
      const siblings = store.result.filter((r) => r.postKey === key)
      if (siblings.length === 0) {
        continue
      }
      // 按當前規則的期望檔名集合判定（檔名由同一 FileName 引擎生成，
      // 切換展開設定後不位移；舊記錄無需遷移）
      if (
        await downloadRecord.hasPost(
          key,
          siblings[0].published,
          siblings.map((r) => fileName.createFileName(r))
        )
      ) {
        for (const card of byKey.get(key) ?? []) {
          card.classList.add(DONE_CLASS)
        }
      }
    }
  }
}

new ShowBorderOnDownloadedWorks()
