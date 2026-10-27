/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 下載停滯偵測：超過指定時間沒被 kick（沒收到資料）就觸發一次回呼。
 */

export class StallWatchdog {
  constructor(
    private timeoutMs: number,
    private onStall: () => void
  ) {}

  /** 是否已判定停滯 */
  stalled = false

  private timer: number | undefined = undefined
  private stopped = false

  /** 重新計時（每收到資料就呼叫）；已停止或已停滯時不動作 */
  kick(): void {
    if (this.stopped || this.stalled) {
      return
    }
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      this.stalled = true
      this.onStall()
    }, this.timeoutMs)
  }

  /** 停止計時並禁止之後的 kick（下載結束／取消時呼叫） */
  stop(): void {
    this.stopped = true
    window.clearTimeout(this.timer)
    this.timer = undefined
  }
}
