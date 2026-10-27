/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：抓取控制按鈕組（首頁與抓取頁共用，狀態一起刷新） */

import { crawlPause } from '../../crawl/CrawlPause'
import { engine } from '../../crawl/engine'
import { EVT } from '../../EVT'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { log } from '../../Log'
import { states } from '../../store/States'
import { toast } from '../../Toast'

export class CrawlControls {
  /** 抓取控制按鈕組（首頁與抓取頁各一組，狀態一起刷新） */
  private groups: Array<{
    main: HTMLButtonElement
    stop: HTMLButtonElement
  }> = []

  /** 目前是否有抓取在進行（暫停中也算）。下載任務佔用 busy 時不算抓取 */
  private get crawling(): boolean {
    return states.busy && !states.hasDownloadTask
  }

  /** 抓取控制列：開始／暫停／繼續，以及只在暫停時出現的停止。
   * 點擊時才看 states 決定做什麼，不依賴快取的標籤。
   * 忙於下載時「開始抓取」維持可點：engine.start 會把它排入等待佇列 */
  public build(host: HTMLDivElement): void {
    const row = document.createElement('div')
    row.className = 'pwpSC-row pwpSC-btnRow'
    // 帶上 _startCrawl，設定搜尋才找得到
    row.dataset.key = '_startCrawl'
    const mk = (onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.addEventListener('click', onClick)
      row.appendChild(btn)
      return btn
    }
    const main = mk(() => this.onMainClick())
    const stop = mk(() => EVT.fire('stopCrawl'))
    this.groups.push({ main, stop })
    host.appendChild(row)
    this.refresh()
  }

  private onMainClick(): void {
    if (states.crawlPaused) {
      if (crawlPause.resume()) {
        const msg = lang.transl('_crawlResumedMsg')
        log.log(msg)
        toast.show(msg)
      }
    } else if (this.crawling) {
      if (crawlPause.pause()) {
        const msg = lang.transl('_crawlPausedMsg')
        log.warning(msg)
        toast.warning(msg)
      }
    } else {
      void engine.start()
    }
  }

  /** 依目前狀態刷新所有抓取控制按鈕組 */
  public refresh(): void {
    const setLabel = (btn: HTMLButtonElement, key: LangTextKey) => {
      // 同步 data-xztext，語言切換時 lang.register 才會翻成對的字
      btn.dataset.xztext = key
      btn.textContent = lang.transl(key)
    }
    const paused = states.crawlPaused
    const crawling = this.crawling
    for (const g of this.groups) {
      setLabel(
        g.main,
        paused ? '_resumeCrawl' : crawling ? '_pauseCrawl' : '_startCrawl'
      )
      setLabel(g.stop, '_stopCrawl')
      g.stop.style.display = paused ? '' : 'none'
    }
  }
}
