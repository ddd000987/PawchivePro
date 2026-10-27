/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/WorkThumbnail.ts (base class,
 *   xuejianxianzun) + src/ts/ArtworkThumbnail.ts (subclass)
 * changes: base + subclass merged into one class (the 3-layer
 *          detection lived in the base, card parsing in the subclass —
 *          Kemono has only one card shape, so the split buys nothing).
 *          - selector → `a[href*="/post/"]`, href parsed to
 *            {service, creatorId, postId} (no `type` field)
 *          - mark → data-pwp="1" + data-postkey (no idData JSON, no btn HTML)
 *          - DELETED: bookmark button + callbacks, debug outline mode,
 *            mobile tapDetector branch, ppdTask, click interception
 *            (clicks navigate normally; preview is hover-only)
 *          Constructor hooks → onEnter/onLeave subscriber lists +
 *          shared `workThumbnail` singleton (PreviewWork + thumb button
 *          share one observer instead of two).
 *          Auto-enter: track last cursor position (mousemove); in bind(),
 *          hit-test with elementFromPoint → synthesize mouseenter for cards
 *          that appear under a stationary cursor (SPA re-render / late
 *          hydration). Chrome fires no mouseenter when the pointer doesn't
 *          move, so hover previews never started in that case.
 *          findCardUnderCursor() exposes the same lookup for PreviewWork's
 *          500ms pollHover convergence loop (covers binds that predate
 *          listener registration, swallowed real enters, layout shifts).
 */

import { EVT } from '../EVT'
import { settings } from '../setting/Settings'
import { PointerMotion } from './pointerMotion'
import { parsePostKeyFromHref } from './previewAssets'

/** 縮圖事件訂閱（PreviewWork＋縮圖下載鈕共用同一實例）；
 * auto=true 表合成事件（卡片出現在游標底下，見 checkAutoEnter） */
type EnterListener = (
  el: HTMLAnchorElement,
  postKey: string,
  ev: MouseEvent,
  auto: boolean
) => void
type LeaveListener = (el: HTMLAnchorElement) => void

/** 滑鼠離上次算作移動的位置至少這麼多像素，才算真的在移動 */
const MOVE_MIN_PX = 4

/** 游標正下方的已綁定卡片（findCardUnderCursor 回傳） */
interface HoveredCard {
  el: HTMLAnchorElement
  postKey: string
  x: number
  y: number
}

/** 帖子卡片連結偵測（三層：首次全掃＋MutationObserver＋1s 輪詢兜底） */
class WorkThumbnail {
  private enterListeners: EnterListener[] = []
  private leaveListeners: LeaveListener[] = []
  private observer: MutationObserver | null = null
  private intervalId = 0
  /** 最後已知游標位置（clientX/Y）：指標不動、卡片自己冒出來時無 mouseenter 可聽 */
  private cursor: { x: number; y: number } | null = null
  /** 每張已綁定卡片的監聽控制器：設定變更時可解綁（關閉文字連結預覽） */
  private controllers = new WeakMap<HTMLAnchorElement, AbortController>()
  private started = false

  /** 最後一次滑鼠真的移動的時間（瀏覽器自己補發的 mouseover 不算） */
  private lastMoveAt = 0
  /** 上次算作移動時的螢幕座標。用螢幕座標：頁面捲動時瀏覽器可能補發
   * 座標不變的 mousemove；離它不到 MOVE_MIN_PX 的手抖不算移動 */
  private moveOrigin: { x: number; y: number } | null = null
  /** 游標軌跡（螢幕座標）：預覽中判斷滑鼠是否明確移開，決定滾輪捲不捲網頁 */
  private motion = new PointerMotion()

  private readonly onMouseMove = (ev: MouseEvent): void => {
    this.cursor = { x: ev.clientX, y: ev.clientY }
    this.motion.add(Date.now(), ev.screenX, ev.screenY)
    const o = this.moveOrigin
    if (
      !o ||
      Math.abs(ev.screenX - o.x) >= MOVE_MIN_PX ||
      Math.abs(ev.screenY - o.y) >= MOVE_MIN_PX
    ) {
      this.moveOrigin = { x: ev.screenX, y: ev.screenY }
      this.lastMoveAt = Date.now()
    }
  }

  /** 指定時間之後使用者是否真的移動過滑鼠 */
  public movedSince(time: number): boolean {
    return this.lastMoveAt > time
  }

  /** 最近 ms 毫秒內滑鼠是否移動了至少 px 像素 */
  public movedFar(ms: number, px: number): boolean {
    return this.motion.movedFar(Date.now(), ms, px)
  }

  /** 最後已知游標位置（離開網頁後為 null） */
  public cursorPoint(): { x: number; y: number } | null {
    return this.cursor ? { ...this.cursor } : null
  }

  /** 指標離開網頁（移到瀏覽器工具列按返回等）：舊座標已不代表游標位置，
   * 留著會讓回到列表時在「看不見的游標」底下自動開預覽，且永遠等不到 mouseleave */
  private readonly onMouseOut = (ev: MouseEvent): void => {
    if (!ev.relatedTarget) this.cursor = null
  }

  private readonly onSettingChange = (ev: CustomEventInit): void => {
    const key = ev.detail?.data?.key
    if (
      key !== 'PreviewWork' &&
      key !== 'showDownloadBtnOnThumb' &&
      key !== 'allowPreviewCoverThumbnail'
    ) {
      return
    }
    this.syncActive()
    // 文字連結是否納入綁定：開→補綁、關→解綁（不必整頁重載）
    if (key === 'allowPreviewCoverThumbnail' && this.started) {
      this.refreshBindings()
    }
  }

  constructor() {
    EVT.on(EVT.list.settingChange, this.onSettingChange)
    // 掃描只在有功能需要時啟動；離開頁面（含 BFCache）時停掉，回來再視設定重啟
    window.addEventListener('pagehide', () => this.destroy())
    window.addEventListener('pageshow', () => this.syncActive())
    this.syncActive()
  }

  /** 有任一卡片功能開啟才需要綁定／掃描 */
  private needsBinding(): boolean {
    return settings.get('PreviewWork') || settings.get('showDownloadBtnOnThumb')
  }

  private start(): void {
    if (this.started) return
    this.started = true
    // capture 以便不受頁面 stopPropagation 影響；只存座標，成本可忽略
    document.addEventListener('mousemove', this.onMouseMove, {
      passive: true,
      capture: true,
    })
    document.addEventListener('mouseout', this.onMouseOut, {
      passive: true,
      capture: true,
    })
    this.refreshBindings()
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) this.scan(node)
        }
      }
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
    // SPA 晚渲染兜底（PBD 同策略）
    this.intervalId = window.setInterval(() => this.scan(document.body), 1000)
  }

  private stop(): void {
    if (!this.started) return
    this.started = false
    document.removeEventListener('mousemove', this.onMouseMove, true)
    document.removeEventListener('mouseout', this.onMouseOut, true)
    this.observer?.disconnect()
    this.observer = null
    window.clearInterval(this.intervalId)
    this.intervalId = 0
    this.cursor = null
    this.moveOrigin = null
    this.motion.clear()
  }

  private syncActive(): void {
    if (this.needsBinding()) {
      this.start()
    } else {
      this.stop()
    }
  }

  /** 從 href 解析 postKey（轉調 previewAssets，node 可測；此處保留薄封裝） */
  public static parsePostKey(href: string): string | null {
    return parsePostKeyFromHref(href)
  }

  /** 訂閱卡片 hover 事件（多模組共用，不再經建構子注入） */
  public onEnter(fn: EnterListener): void {
    this.enterListeners.push(fn)
  }

  public onLeave(fn: LeaveListener): void {
    this.leaveListeners.push(fn)
  }

  private scan(root: HTMLElement): void {
    // 新增節點本身就可能是卡片（MutationObserver 直接回報 <a>），先判自身
    if (root.matches('a[href*="/post/"]')) this.bind(root as HTMLAnchorElement)
    const links = root.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')
    for (const a of links) this.bind(a)
  }

  /** 是否應綁定：必須是可解析的帖子連結；純文字連結依設定決定 */
  private eligible(a: HTMLAnchorElement): boolean {
    if (!WorkThumbnail.parsePostKey(a.href)) return false
    return (
      settings.get('allowPreviewCoverThumbnail') || !!a.querySelector('img')
    )
  }

  /** 每次使用時以目前的 href 重算 postKey：SPA 改寫 href 後鍵不會陳舊 */
  private keyOf(a: HTMLAnchorElement): string | null {
    const postKey = WorkThumbnail.parsePostKey(a.href)
    if (postKey) a.dataset.postkey = postKey
    return postKey
  }

  private bind(a: HTMLAnchorElement): void {
    if (this.controllers.has(a)) return
    if (!this.eligible(a)) return
    const postKey = WorkThumbnail.parsePostKey(a.href)
    if (!postKey) return
    const controller = new AbortController()
    this.controllers.set(a, controller)
    a.dataset.pwp = '1'
    a.dataset.postkey = postKey
    const { signal } = controller
    a.addEventListener(
      'mouseenter',
      (ev) => {
        const key = this.keyOf(a)
        if (!key) return
        const e = ev as MouseEvent
        for (const fn of this.enterListeners) fn(a, key, e, false)
      },
      { signal }
    )
    a.addEventListener(
      'mouseleave',
      () => {
        for (const fn of this.leaveListeners) fn(a)
      },
      { signal }
    )
    this.checkAutoEnter(a)
  }

  /** 移除單卡綁定（設定關閉純文字連結時用） */
  private unbind(a: HTMLAnchorElement): void {
    this.controllers.get(a)?.abort()
    this.controllers.delete(a)
    delete a.dataset.pwp
    delete a.dataset.postkey
  }

  /** 依現行設定重掃：不再符合者解綁，尚未綁定者補綁 */
  public refreshBindings(): void {
    const links =
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]')
    for (const a of links) {
      if (!this.controllers.has(a)) {
        this.bind(a)
      } else if (!this.eligible(a)) {
        this.unbind(a)
      }
    }
  }

  /** 找出游標正下方的已綁定卡片（hit-test＋:hover 兜底；找不到回 null）。
   * 綁定快徑（checkAutoEnter）與收斂迴圈（PreviewWork.pollHover）共用。
   * 要求卡片已綁定（dataset.pwp）：未綁定的等 bind 完成後再處理。 */
  public findCardUnderCursor(): HoveredCard | null {
    if (this.cursor) {
      const hit = document.elementFromPoint(this.cursor.x, this.cursor.y)
      const a = hit instanceof Element ? hit.closest('a[href*="/post/"]') : null
      if (a instanceof HTMLAnchorElement && a.dataset.pwp === '1') {
        const postKey = this.keyOf(a)
        if (postKey) {
          return { el: a, postKey, x: this.cursor.x, y: this.cursor.y }
        }
      }
      return null
    }
    const hovered = document.querySelector<HTMLAnchorElement>(
      'a[href*="/post/"]:hover'
    )
    if (hovered && hovered.dataset.pwp === '1') {
      const postKey = this.keyOf(hovered)
      if (postKey) {
        const rect = hovered.getBoundingClientRect()
        return {
          el: hovered,
          postKey,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      }
    }
    return null
  }

  /** 對游標下的卡片補發 enter（auto=true），有觸發回 true。
   * 游標下無卡片、或卡片未綁定時不做事。 */
  public fireAutoEnterForCursor(found?: HoveredCard | null): boolean {
    const f = found === undefined ? this.findCardUnderCursor() : found
    if (!f) return false
    const ev = new MouseEvent('mouseenter', { clientX: f.x, clientY: f.y })
    for (const fn of this.enterListeners) fn(f.el, f.postKey, ev, true)
    return true
  }

  /** 綁定快徑：剛綁定的卡片正好在游標底下就立即觸發（不等收斂迴圈） */
  private checkAutoEnter(a: HTMLAnchorElement): void {
    const f = this.findCardUnderCursor()
    if (!f || f.el !== a) return
    this.fireAutoEnterForCursor(f)
  }

  /** 停止常駐掃描（pagehide 呼叫；pageshow 會依設定重新 syncActive） */
  public destroy(): void {
    this.stop()
  }
}

/** 全站唯一的卡片偵測器（PreviewWork＋縮圖下載鈕共用，避免雙 observer） */
const workThumbnail = new WorkThumbnail()

export { workThumbnail, WorkThumbnail }
export type { EnterListener, LeaveListener, HoveredCard }
