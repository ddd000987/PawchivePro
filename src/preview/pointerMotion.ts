/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 游標移動軌跡：判斷最近一段時間內滑鼠是否明確移動（純計算，無 DOM 依賴，方便測試） */

interface MotionSample {
  t: number
  x: number
  y: number
}

/** 樣本最多保留這麼久（ms）；查詢的時間窗不會超過它 */
const KEEP_MS = 1000

class PointerMotion {
  private samples: MotionSample[] = []

  add(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y })
    // 保留時間窗起點之前的最後一點：它代表時間窗開始時游標所在的位置
    let drop = 0
    while (
      drop < this.samples.length - 1 &&
      this.samples[drop + 1].t < t - KEEP_MS
    ) {
      drop++
    }
    if (drop > 0) this.samples.splice(0, drop)
  }

  clear(): void {
    this.samples = []
  }

  /** 最近 windowMs 內，游標離時間窗起點的位置是否至少 px 像素 */
  movedFar(now: number, windowMs: number, px: number): boolean {
    const from = now - windowMs
    // 時間窗起點的位置：起點之前最後一個樣本；沒有的話用窗內第一個
    let i = 0
    while (i < this.samples.length - 1 && this.samples[i + 1].t <= from) i++
    const origin = this.samples[i]
    if (!origin) return false
    for (let k = i + 1; k < this.samples.length; k++) {
      const s = this.samples[k]
      if (Math.hypot(s.x - origin.x, s.y - origin.y) >= px) return true
    }
    return false
  }
}

export { PointerMotion }
export type { MotionSample }
