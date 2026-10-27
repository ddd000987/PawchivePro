/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：日誌區（下載頁底部，顯示 Log 緩衝區內容） */

import { lang } from '../../Language'
import { log } from '../../Log'
import { toast } from '../../Toast'
import { btnRow, copyFallback, section } from './controls'

export class LogView {
  /** 日誌區列表容器與重繪節流計時器 */
  private logList!: HTMLDivElement
  private logRenderTimer = 0

  /** 日誌區：顯示 Log 緩衝區內容（debug 訊息不進緩衝區，所以不會出現在這裡） */
  public build(host: HTMLDivElement): void {
    const body = section(host, '_secLog')
    btnRow(body, [
      { labelKey: '_logCopy', onClick: () => void this.copyLog() },
      { labelKey: '_logClear', onClick: () => log.clear() },
    ])
    this.logList = document.createElement('div')
    this.logList.className = 'pwpSC-logList'
    body.appendChild(this.logList)
    this.render()
  }

  /** 捲到最新一筆（日誌在隱藏分頁裡重繪時高度為 0，顯示出來後再呼叫） */
  public scrollToBottom(): void {
    if (this.logList) {
      this.logList.scrollTop = this.logList.scrollHeight
    }
  }

  /** 重繪日誌列表；使用者原本就在底部（或附近）才跟著捲到最新，否則不打斷他看舊訊息 */
  public render(): void {
    const el = this.logList
    if (!el) {
      return
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    el.textContent = ''
    const entries = log.entries()
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'pwpSC-logEmpty'
      empty.textContent = lang.transl('_logEmpty')
      el.appendChild(empty)
      return
    }
    for (const e of entries) {
      const row = document.createElement('div')
      row.className = `pwpSC-logRow pwpSC-log-${e.level}`
      const time = document.createElement('span')
      time.className = 'pwpSC-logTime'
      time.textContent = this.formatLogTime(e.time)
      const msg = document.createElement('span')
      msg.className = 'pwpSC-logMsg'
      msg.textContent = e.msg
      row.append(time, msg)
      if (e.count > 1) {
        const badge = document.createElement('span')
        badge.className = 'pwpSC-logCount'
        badge.textContent = `×${e.count}`
        row.appendChild(badge)
      }
      el.appendChild(row)
    }
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }

  /** 合併每個 frame 內的多次日誌事件，避免大量日誌時反覆重繪整個列表 */
  public scheduleRender(): void {
    if (this.logRenderTimer) {
      return
    }
    this.logRenderTimer = window.setTimeout(() => {
      this.logRenderTimer = 0
      this.render()
    }, 100)
  }

  private formatLogTime(time: number): string {
    const d = new Date(time)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  /** 複製全部日誌（Clipboard API 優先，失敗退回 textarea 方案） */
  private async copyLog(): Promise<void> {
    const text = log
      .entries()
      .map(
        (e) =>
          `[${this.formatLogTime(e.time)}] [${e.level.toUpperCase()}] ${e.msg}` +
          (e.count > 1 ? ` (×${e.count})` : '')
      )
      .join('\n')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        copyFallback(text)
      }
      toast.success(lang.transl('_logCopied'))
    } catch {
      try {
        copyFallback(text)
        toast.success(lang.transl('_logCopied'))
      } catch {
        toast.error(lang.transl('_logCopyFail'))
      }
    }
  }
}
