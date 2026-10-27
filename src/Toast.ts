/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/Toast.ts (xuejianxianzun)
 * changes: simplified — no Colors/Config.mobile dependency, no animation.
 *          API surface kept: show/success/warning/error(msg, {stay, position}).
 *          同時顯示的多個 toast 會錯開堆疊（見 toastLayout.ts），不再疊在同一處。
 */

import { markTransient } from './PageRoots'
import { avoidOverlap } from './toastLayout'

interface ToastOptions {
  /** 停留時間（ms），預設 1500 */
  stay?: number
  /** 出現位置：預設跟滑鼠 */
  position?: 'topCenter' | 'center' | 'mouse'
}

const BG = {
  default: '#2196f3',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
}

class Toast {
  private mouse = { x: 0, y: 0 }

  /** 目前顯示中的 toast（超過上限時移除最舊的，避免堆疊失控） */
  private active: HTMLSpanElement[] = []

  /** 同時最多顯示的 toast 數量 */
  private readonly maxActive = 5

  constructor() {
    window.addEventListener('mousemove', (ev) => {
      this.mouse.x = ev.x
      this.mouse.y = ev.y
    })
  }

  public show(msg: string, opt?: ToastOptions) {
    this.create(msg, BG.default, opt)
  }
  public success(msg: string, opt?: ToastOptions) {
    this.create(msg, BG.success, opt)
  }
  public warning(msg: string, opt?: ToastOptions) {
    this.create(msg, BG.warning, opt)
  }
  public error(msg: string, opt?: ToastOptions) {
    this.create(msg, BG.error, opt)
  }

  private create(msg: string, bg: string, opt?: ToastOptions) {
    const stay = opt?.stay ?? 1500
    const position = opt?.position ?? 'mouse'
    const span = document.createElement('span')
    span.textContent = msg
    span.className = 'pwpToast'
    span.style.backgroundColor = bg
    document.body.appendChild(span)
    markTransient(span)
    this.active.push(span)
    while (this.active.length > this.maxActive) {
      this.active.shift()?.remove()
    }

    const rect = span.getBoundingClientRect()
    let left = window.innerWidth / 2 - rect.width / 2
    let top = window.innerHeight / 2 - 20
    if (position === 'topCenter') {
      top = 20
    } else if (
      position === 'mouse' &&
      (this.mouse.x !== 0 || this.mouse.y !== 0)
    ) {
      left = this.mouse.x - rect.width / 2
      top = Math.max(20, this.mouse.y - 40)
    }
    left = Math.max(0, Math.min(left, window.innerWidth - rect.width - 16))
    // 同時有多個 toast 時錯開位置，不要疊在同一處互相遮住
    const others = this.active
      .filter((el) => el !== span)
      .map((el) => el.getBoundingClientRect())
    top = avoidOverlap(
      { left, top, width: rect.width, height: rect.height },
      others,
      window.innerHeight
    )
    span.style.left = `${left}px`
    span.style.top = `${top}px`
    span.style.opacity = '1'

    window.setTimeout(() => {
      span.remove()
      this.active = this.active.filter((el) => el !== span)
    }, stay)
  }
}

const toast = new Toast()
export { toast }
export type { ToastOptions }
