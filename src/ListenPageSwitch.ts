/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/ListenPageSwitch.ts (xuejianxianzun)
 *   + src/static/lib/listen_history_change.js
 * changes: browser.* → chrome.* (no webextension-polyfill);
 *          page-type check replaced by kemono detectPage().
 *          saveURL truncates hash (manga-style #p hash equivalent).
 */

import { EVT } from './EVT'

// 監聽 SPA 無刷新切換（hook pushState/replaceState + popstate）
class ListenPageSwitch {
  private nowURL: string

  constructor() {
    // 初始值同樣去掉 hash：否則首屏帶 # 時第一次 pushState 會誤發 pageSwitch
    this.nowURL = this.saveURL(window.location.href)
    this.supportListenHistory()
    this.listenPageSwitch()
  }

  private saveURL(url: string): string {
    return url.split('#')[0]
  }

  /** 注入 history hook（MV3 需 web_accessible_resources 宣告，見 manifest） */
  private supportListenHistory() {
    try {
      const s = document.createElement('script')
      s.src = chrome.runtime.getURL('lib/listen_history_change.js')
      document.head.appendChild(s)
    } catch (e) {
      console.warn('[PawchivePro] listen_history_change inject failed', e)
    }
  }

  private listenPageSwitch() {
    const check = () => {
      const now = this.saveURL(window.location.href)
      if (now !== this.nowURL) {
        this.nowURL = now
        EVT.fire('pageSwitch')
      }
    }
    ;['pushState', 'popstate', 'replaceState'].forEach((item) => {
      window.addEventListener(item, check)
    })
    // history hook 注入前／注入失敗的換頁會漏發；每秒補查一次，
    // 仍以 nowURL 去重，不會重複發事件
    window.setInterval(check, 1000)
  }
}

export { ListenPageSwitch }
