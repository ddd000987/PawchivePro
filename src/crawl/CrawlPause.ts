/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 抓取暫停閘門：引擎在每次發 API 請求之前呼叫 wait()。
 * 暫停期間已發出的請求照常完成，下一個請求在這裡等到繼續或中止為止。
 * 暫停中 states.busy 保持 true（抓取仍在進行），所以下載不會插隊。
 */

import { EVT } from '../EVT'
import { states } from '../store/States'

class CrawlPause {
  constructor() {
    this.bindEvents()
  }

  private isPaused = false

  /** 正在等待繼續的請求：每項是一個放行函數 */
  private waiters = new Set<() => void>()

  /** 是否處於暫停中 */
  public get paused(): boolean {
    return this.isPaused
  }

  private bindEvents() {
    // 新一輪開始或這一輪收尾：一律回到未暫停
    for (const ev of [
      EVT.list.crawlStart,
      EVT.list.crawlComplete,
      EVT.list.crawlEmpty,
    ]) {
      EVT.on(ev, () => this.reset())
    }
    // 停止抓取：引擎會 abort 控制器，等待者由各自的 signal 放行（回 false）；
    // 這裡只清旗標，不能搶先放行，否則會多發一個請求
    EVT.on(EVT.list.stopCrawl, () => {
      this.isPaused = false
    })
  }

  /** 暫停抓取。僅在抓取進行中有效；回傳是否真的進入暫停 */
  public pause(): boolean {
    if (this.isPaused || !states.busy || states.hasDownloadTask) {
      return false
    }
    this.isPaused = true
    EVT.fire('crawlPause')
    return true
  }

  /** 繼續抓取；回傳是否真的從暫停恢復 */
  public resume(): boolean {
    if (!this.isPaused) {
      return false
    }
    this.isPaused = false
    this.release()
    EVT.fire('crawlResume')
    return true
  }

  /** 事件觸發的重置：放行等待者並清旗標，不發 crawlResume */
  private reset() {
    this.isPaused = false
    this.release()
  }

  private release() {
    for (const fn of [...this.waiters]) {
      fn()
    }
  }

  /**
   * 發請求前呼叫。未暫停 → 立刻回 true；暫停中 → 等到繼續回 true，
   * 等待期間 signal 中止則回 false（呼叫端照既有的中止路徑收尾）。
   */
  public wait(signal: AbortSignal): Promise<boolean> {
    if (!this.isPaused) {
      return Promise.resolve(true)
    }
    if (signal.aborted) {
      return Promise.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      const onAbort = () => {
        this.waiters.delete(release)
        resolve(false)
      }
      const release = () => {
        this.waiters.delete(release)
        signal.removeEventListener('abort', onAbort)
        resolve(!signal.aborted)
      }
      this.waiters.add(release)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

const crawlPause = new CrawlPause()
export { crawlPause }
