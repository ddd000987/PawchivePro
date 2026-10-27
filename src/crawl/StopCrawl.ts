/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/crawl/StopCrawl.ts
 *          (xuejianxianzun)
 * changes: dropped addBtn-slot infra — self-mounted floating button,
 *          labels come from lang. Fires stopCrawl.
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { keepInBody } from '../PageRoots'

class StopCrawl {
  constructor() {
    this.addBtn()
    this.bindEvents()
  }

  private btn!: HTMLButtonElement

  /**創建停止抓取按鈕 */
  private addBtn() {
    this.btn = document.createElement('button')
    this.btn.dataset.xztext = '_stopCrawl'
    this.btn.textContent = lang.transl('_stopCrawl')
    this.btn.id = 'pwpStopCrawl'
    this.btn.addEventListener('click', () => {
      EVT.fire('stopCrawl')
    })
    document.body.appendChild(this.btn)
    keepInBody(this.btn)
    lang.register(this.btn)
    this.hide()
  }

  /**綁定停止按鈕和抓取生命週期事件 */
  private bindEvents() {
    EVT.on(EVT.list.crawlStart, () => {
      this.show()
    })

    EVT.on(EVT.list.crawlComplete, () => {
      this.hide()
    })

    EVT.on(EVT.list.stopCrawl, () => {
      this.hide()
      this.log()
    })
  }

  private hide() {
    this.btn.style.display = 'none'
  }

  private show() {
    this.btn.style.display = 'block'
  }

  private log() {
    const msg = lang.transl('_crawlStopped')
    log.error('🛑' + msg)
    toast.error(msg)
  }
}

new StopCrawl()
