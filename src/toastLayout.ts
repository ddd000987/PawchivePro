/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* Toast 的堆疊排版（純計算，無 DOM 依賴，方便測試） */

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 讓新 toast 避開仍顯示中的 toast：優先往上疊（緊貼其上緣再留 gap），
 * 上方放不下（超出視窗頂端）就改往下疊，兩邊都放不下才接受重疊。
 * 只回傳新的 top；left 不變。
 */
export function avoidOverlap(
  box: Box,
  others: Box[],
  viewportHeight: number,
  gap = 6
): number {
  // 水平方向有交集的才會互相遮住
  const sameColumn = others.filter(
    (o) => box.left < o.left + o.width && box.left + box.width > o.left
  )
  const hits = (top: number) =>
    sameColumn.filter((o) => top < o.top + o.height && top + box.height > o.top)

  if (hits(box.top).length === 0) {
    return box.top
  }

  // 往上疊
  let top = box.top
  for (let i = 0; i <= sameColumn.length; i++) {
    const hit = hits(top)
    if (hit.length === 0) {
      return top >= 0 ? top : box.top
    }
    top = Math.min(...hit.map((o) => o.top)) - box.height - gap
    if (top < 0) break
  }

  // 往下疊
  top = box.top
  for (let i = 0; i <= sameColumn.length; i++) {
    const hit = hits(top)
    if (hit.length === 0) {
      return top
    }
    top = Math.max(...hit.map((o) => o.top + o.height)) + gap
    if (top + box.height > viewportHeight) break
  }

  return box.top
}

export type { Box }
