/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/ShowOriginSizeImage.ts
 *               (xuejianxianzun)
 * changes: minimal viewer only — show full image + close.
 *          Entry: `callShowOriginSizeImage` with {imageUrl} (PreviewWork V
 *          key sends an image URL, not work data). DELETED: right-click
 *          trigger, zoom, drag, cacheWorkData, D/C download keys.
 */

import { EVT } from '../EVT'
import { markTransient } from '../PageRoots'

/** 精簡原圖 viewer：顯示一張原圖，click/Esc/換頁關閉 */
class ShowOriginSizeImage {
  private wrap: HTMLDivElement | null = null

  constructor() {
    EVT.on(EVT.list.callShowOriginSizeImage, ((ev: Event) => {
      const { imageUrl } = (ev as CustomEvent).detail.data as {
        imageUrl?: string
      }
      if (imageUrl) this.show(imageUrl)
    }) as EventListener)
    EVT.on(EVT.list.pageSwitch, () => this.close())
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return
      // 輸入框內按 Esc 不關 viewer
      const t = ev.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }
      this.close()
    })
  }

  private show(imageUrl: string): void {
    this.close()
    const wrap = document.createElement('div')
    wrap.id = 'originSizeWrap'
    const img = document.createElement('img')
    img.src = imageUrl
    wrap.appendChild(img)
    wrap.addEventListener('click', () => this.close())
    document.body.appendChild(wrap)
    markTransient(wrap)
    this.wrap = wrap
  }

  private close(): void {
    if (!this.wrap) return
    this.wrap.remove()
    this.wrap = null
  }
}

const showOriginSizeImage = new ShowOriginSizeImage()

export { showOriginSizeImage }
