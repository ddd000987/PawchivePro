/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：抓取進度區塊（首頁與抓取頁共用，掛在抓取按鈕下方，狀態一起刷新） */

import {
  crawlProgress,
  CrawlPhase,
  formatExcluded,
} from '../../crawl/CrawlProgress'
import { lang } from '../../Language'

/** 重繪節流（ms）：抓取時計數變化很頻繁，合併後再畫 */
const RENDER_THROTTLE = 200
/** 已用時間的跳動間隔（ms） */
const TICK_INTERVAL = 1000

export class CrawlProgressView {
  /** 首頁與抓取頁各一個容器（都要刷新） */
  private hosts: HTMLDivElement[] = []
  private renderTimer = 0
  private tickTimer = 0

  /** 建立進度區塊並登記，之後一起刷新 */
  public build(host: HTMLDivElement): void {
    const box = document.createElement('div')
    box.className = 'pwpSC-crawlProgress'
    host.appendChild(box)
    this.hosts.push(box)
    this.render()
  }

  /** 合併短時間內的多次變化，避免每帖都重繪 */
  public scheduleRender(): void {
    if (this.renderTimer) {
      return
    }
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = 0
      this.render()
    }, RENDER_THROTTLE)
  }

  /** 立刻重繪所有容器，並依階段啟停「已用時間」計時器 */
  public render(): void {
    if (this.renderTimer) {
      window.clearTimeout(this.renderTimer)
      this.renderTimer = 0
    }
    for (const box of this.hosts) {
      this.renderBox(box)
    }
    this.syncTicker()
  }

  /** 進行中（含暫停）每秒重繪一次讓時間跳動；結束或閒置就停 */
  private syncTicker(): void {
    if (crawlProgress.active && this.hosts.length > 0) {
      if (!this.tickTimer) {
        this.tickTimer = window.setInterval(() => this.render(), TICK_INTERVAL)
      }
    } else if (this.tickTimer) {
      window.clearInterval(this.tickTimer)
      this.tickTimer = 0
    }
  }

  private renderBox(box: HTMLDivElement): void {
    box.textContent = ''
    const p = crawlProgress
    const line = (text: string) => {
      const row = document.createElement('div')
      row.className = 'pwpSC-row pwpSC-status'
      row.textContent = text
      box.appendChild(row)
    }

    // 狀態：尚未抓取時只顯示這一行，不含已用時間
    const phase = this.phaseText(p.phase)
    if (p.phase === 'idle') {
      line(lang.transl('_cp_statusOnly', phase))
      return
    }
    line(lang.transl('_cp_status', phase, this.formatElapsed(p.elapsedMs())))

    if (p.target) {
      line(lang.transl('_cp_target', p.target))
    } else if (p.targetPosts > 0) {
      line(
        lang.transl(
          '_cp_target',
          lang.transl('_cp_targetPosts', String(p.targetPosts))
        )
      )
    }

    line(
      p.total === null
        ? lang.transl('_cp_scannedUnknown', String(p.scanned))
        : lang.transl('_cp_scanned', String(p.scanned), String(p.total))
    )
    line(lang.transl('_cp_kept', String(p.kept), String(p.keptFiles)))

    const excluded = p.excludedTotal
    if (excluded > 0) {
      line(
        lang.transl(
          '_cp_excluded',
          String(excluded),
          formatExcluded(p.excluded)
        )
      )
    }
    if (p.failed > 0) {
      line(lang.transl('_cp_failed', String(p.failed)))
    }
  }

  private phaseText(phase: CrawlPhase): string {
    switch (phase) {
      case 'crawling':
        return crawlProgress.pages > 0
          ? lang.transl('_cp_phaseCrawlingPage', String(crawlProgress.pages))
          : lang.transl('_cp_phaseCrawling')
      case 'paused':
        return lang.transl('_cp_phasePaused')
      case 'done':
        return lang.transl('_cp_phaseDone')
      case 'stopped':
        return lang.transl('_cp_phaseStopped')
      case 'empty':
        return lang.transl('_cp_phaseEmpty')
      default:
        return lang.transl('_cp_phaseIdle')
    }
  }

  /** mm:ss（分鐘不設上限，滿一小時顯示如 75:03） */
  private formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(Math.floor(total / 60))}:${p(total % 60)}`
  }
}
