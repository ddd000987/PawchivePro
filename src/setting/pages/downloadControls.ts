/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：下載控制按鈕組（首頁與下載頁共用，狀態一起刷新） */

import { downloadControl } from '../../download/DownloadControl'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { store } from '../../store/Store'
import { states } from '../../store/States'

export class DownloadControls {
  /** 下載控制按鈕組（首頁與下載頁各一組，狀態一起刷新） */
  private groups: Array<{
    start: HTMLButtonElement
    pause: HTMLButtonElement
    restart: HTMLButtonElement
  }> = []

  /** 下載控制列：開始／停止、暫停／繼續、全部重下（暫停時才出現）。
   * 點擊時才看 states 決定做什麼，不依賴快取的標籤 */
  public build(host: HTMLDivElement): void {
    const row = document.createElement('div')
    row.className = 'pwpSC-row pwpSC-btnRow'
    const mk = (onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.addEventListener('click', onClick)
      row.appendChild(btn)
      return btn
    }
    const start = mk(() => {
      if (states.hasDownloadTask) downloadControl.stopDownload()
      else void downloadControl.startDownload()
    })
    const pause = mk(() => {
      if (states.downloadPaused) void downloadControl.startDownload()
      else if (states.downloading) downloadControl.pauseDownload()
    })
    const restart = mk(() => this.confirmRestart())
    this.groups.push({ start, pause, restart })
    host.appendChild(row)
    this.refresh()
  }

  /** 依目前狀態刷新所有下載控制按鈕組 */
  public refresh(): void {
    const setLabel = (btn: HTMLButtonElement, key: LangTextKey) => {
      // 同步 data-xztext，語言切換時 lang.register 才會翻成對的字
      btn.dataset.xztext = key
      btn.textContent = lang.transl(key)
    }
    const busy = states.hasDownloadTask
    const paused = states.downloadPaused
    for (const g of this.groups) {
      setLabel(g.start, busy ? '_stopDownload' : '_startDownload')
      setLabel(g.pause, paused ? '_resumeDownload' : '_pauseDownload')
      // 暫停鈕只在有下載任務（下載中或暫停中）時出現
      g.pause.style.display = busy ? '' : 'none'
      g.pause.disabled = !busy
      g.restart.dataset.xztext = '_restartDownload'
      g.restart.textContent = lang.transl('_restartDownload')
      g.restart.style.display = paused ? '' : 'none'
    }
  }

  /** 全部重下：二次確認後忘記已下載進度、進度顯示歸零重來 */
  private confirmRestart(): void {
    if (store.result.length === 0 || states.busy) {
      // 無結果／忙碌中不彈確認，直接走既有提示（空結果／忙碌中）
      void downloadControl.restartDownload()
      return
    }
    if (!window.confirm(lang.transl('_restartConfirm'))) return
    void downloadControl.restartDownload()
  }
}
