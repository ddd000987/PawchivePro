/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 插件掛在 <body> 底下的介面元素登記處。
 *
 * Pawchive 用 htmx 換頁（body 上 hx-boost，歷史快照存整個 body）：
 * 離開頁面前把 body 內容存成快照，按返回時直接貼回去。
 * 我們的元素若在快照裡，返回後畫面上會是沒有任何監聽的複製品
 * （預覽框關不掉、面板按鈕按了沒反應），真正的元素則脫離文件。
 * 對策：存快照前先暫時拿掉我們的元素；還原後清掉複製品、把真正的元素放回。
 */

/** 標記屬性（以 dataset.pwpRoot 設定，對應 data-pwp-root） */
const ATTR = 'data-pwp-root'

/** 我們自己建立的元素（含暫時的）；不在這裡的同標記元素就是快照複製品 */
const live = new WeakSet<HTMLElement>()
/** 常駐元素：還原後若脫離文件要放回 body */
const persistent = new Set<HTMLElement>()

/** 常駐元素（面板、按鈕）：登記後由這裡負責在 htmx 還原後放回 */
export function keepInBody(el: HTMLElement): void {
  el.dataset.pwpRoot = ''
  live.add(el)
  persistent.add(el)
}

/** 暫時元素（預覽框、原圖、提示）：只標記，還原後清掉複製品；本體由擁有者自行關閉 */
export function markTransient(el: HTMLElement): void {
  el.dataset.pwpRoot = ''
  live.add(el)
}

/** 清掉快照貼回來的複製品，並把脫離文件的常駐元素放回 body */
export function repairRoots(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR}]`)) {
    if (!live.has(el)) el.remove()
  }
  for (const el of persistent) {
    if (!el.isConnected) document.body.appendChild(el)
  }
}

/** 存快照前暫時拿掉所有標記元素，快照（同步）存完後的微任務再放回常駐元素 */
function hideFromSnapshot(): void {
  const removed: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR}]`)) {
    if (persistent.has(el)) removed.push(el)
    el.remove()
  }
  queueMicrotask(() => {
    for (const el of removed) {
      if (!el.isConnected) document.body.appendChild(el)
    }
  })
}

// htmx 事件在 body 上觸發並冒泡；非 htmx 網站（Kemono）不會收到，無副作用。
// 單元測試的 document 是精簡 stub，沒有 addEventListener
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('htmx:beforeHistorySave', hideFromSnapshot, true)
  document.addEventListener('htmx:historyRestore', repairRoots, true)
}
