/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader
 *          src/ts/buttonsOnThumb/ButtonsOnArtworkThumbOnPC.ts (mechanics,
 *          xuejianxianzun): hover show/hide with delay, doNotShowBtn
 *          click guard, pageSwitch/crawlStart hiding, scroll-compensated
 *          absolute positioning.
 * changes: single download button only (no zoom/copy);
 *          no icon sprite (text glyph); position top-right of card;
 *          click → crawlIdList (busy → waitingIdList, drained by
 *          DownloadControl); visibility gated by showDownloadBtnOnThumb.
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { settings } from '../setting/Settings'
import { states } from '../store/States'
import { store } from '../store/Store'
import type { IDData } from '../store/StoreType'
import { toast } from '../Toast'
import { workThumbnail } from './WorkThumbnail'
import { keepInBody } from '../PageRoots'

/** 帖子縮圖上的下載按鈕（hover 卡片時在右上角顯示，點擊下載整帖） */
class ThumbDownloadButton {
  private btn: HTMLButtonElement
  private currentPostKey = ''

  private hideTimer = 0
  private delay = 100
  // 點擊後短暫不顯示：避免按鈕消失後滑鼠下方露出卡片，立刻又觸發顯示
  private noShow = false

  private readonly btnSize = 32

  constructor() {
    this.btn = document.createElement('button')
    this.btn.id = 'pwpThumbDownloadBtn'
    this.btn.className = 'btnOnThumb'
    this.btn.textContent = '⬇'
    this.btn.dataset.xztitle = '_downloadPost'
    this.btn.title = lang.transl('_downloadPost')
    lang.register(this.btn)
    document.body.appendChild(this.btn)
    keepInBody(this.btn)

    workThumbnail.onEnter((el, postKey) => {
      this.currentPostKey = postKey
      this.show(el)
    })
    workThumbnail.onLeave(() => {
      this.hideDelay()
    })

    this.btn.addEventListener('mouseenter', () => {
      window.clearTimeout(this.hideTimer)
    })
    this.btn.addEventListener('mouseleave', () => {
      this.hideDelay()
    })
    this.btn.addEventListener('click', () => {
      this.download()
    })

    EVT.on(EVT.list.pageSwitch, () => {
      // 切頁後到按鈕隱藏前（鬼影期）點擊不可再下載舊頁的帖子
      this.currentPostKey = ''
      this.hideDelay()
    })
    EVT.on(EVT.list.crawlStart, () => {
      this.hideDelay()
    })
  }

  private show(card: HTMLAnchorElement): void {
    if (this.noShow || !settings.get('showDownloadBtnOnThumb')) {
      return
    }
    window.clearTimeout(this.hideTimer)
    const rect = card.getBoundingClientRect()
    this.btn.style.left =
      window.scrollX + rect.left + rect.width - this.btnSize + 'px'
    this.btn.style.top = window.scrollY + rect.top + 'px'
    this.btn.style.display = 'flex'
  }

  private hideDelay(): void {
    window.clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      this.btn.style.display = 'none'
    }, this.delay)
  }

  private hideNow(): void {
    this.noShow = true
    window.setTimeout(() => {
      this.noShow = false
    }, 100)
    window.clearTimeout(this.hideTimer)
    this.btn.style.display = 'none'
  }

  private download(): void {
    this.hideNow()
    if (!this.currentPostKey) {
      return
    }
    const idData: IDData = { id: this.currentPostKey, type: 'post' }
    if (states.busy || states.hasDownloadTask) {
      store.waitingIdList.push(idData)
      toast.show(lang.transl('_queuedN', '1'))
    } else {
      EVT.fire('crawlIdList', [idData])
    }
  }
}

const thumbDownloadButton = new ThumbDownloadButton()

export { thumbDownloadButton }
