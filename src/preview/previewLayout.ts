/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 純函數模組（不碰 DOM）：預覽浮層定位計算，供 PreviewWork 與測試共用。
 */

/** 預覽浮層定位（純函數）：優先放在游標右側、垂直置中；右邊空間不足時
 * 翻到左側，最後把整個浮層夾回視窗（四周至少留 8px）。 */
export function clampPreviewPosition(
  mouseX: number,
  mouseY: number,
  totalW: number,
  totalH: number,
  viewW: number,
  viewH: number
): { x: number; y: number } {
  const margin = 8
  let x = mouseX + 24
  if (x + totalW > viewW - margin) x = mouseX - totalW - 24
  const y = Math.max(
    margin,
    Math.min(mouseY - totalH / 2, viewH - totalH - margin)
  )
  return { x: Math.max(margin, x), y }
}
