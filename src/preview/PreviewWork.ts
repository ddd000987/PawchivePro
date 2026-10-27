/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/PreviewWork.ts (xuejianxianzun)
 * changes:
 *   KEPT: showWrap positioning/sizing, rebuild-<img>-per-switch, next-image
 *           preload, dontShowAfterPageSwitch 500ms, wheel (100ms throttle,
 *           loop), Esc/click/pageSwitch close, showPreviewWorkTip
 *           border:none override.
 *   REWROTE: data layer → api.post() (cover-first zero-request, then detail
 *           → attachments); URLs → previewAssets (previewOriginalImage picks
 *           thumbnail/full variants for the preview only); tip bar → Kemono 6-piece set.
 *   CHANGED: wheel listener — PBD put it on the thumbnail element (and the
 *           float). Now one window-level capture listener is attached only
 *           while the preview is showing, so wheel is caught whatever is
 *           under the cursor (card, float, or something overlaying the
 *           card). The cover-first float is visible before urls are known,
 *           so wheel is captured from the moment the float appears.
 *           Wheel is captured whenever the preview is showing (loading /
 *           single / failed included — switchImage no-ops with nothing to
 *           switch, acting purely as a page-scroll lock) while the pointer
 *           is still; wheel while the pointer is moving scrolls the page.
 *           show() clears current + old img
 *           synchronously so wheel/keys during the load window can't act on
 *           the previous post's urls (no afterimage).
 *   ADDED: auto-enter — WorkThumbnail synthesizes mouseenter for cards that
 *           appear under a stationary cursor (Chrome fires none when the
 *           pointer doesn't move, so SPA re-renders under the cursor never
 *           started a preview). Auto starts bypass the 500ms pageSwitch
 *           block (freshly bound cards belong to the current page); real
 *           mouseenter keeps PBD's dontShowAfterPageSwitch semantics.
 *           Poll loop (500ms pollHover): converges the "pointer resting on a
 *           card, preview should be up" state — covers binds that predate
 *           listener registration, real enters swallowed by the pageSwitch
 *           window, layout shifts, and a second pageSwitch killing a pending
 *           show. Skips while showing/pending/failed/manually-dismissed
 *           (Esc or float-click dismiss; hovering another card or pageSwitch
 *           clears it). Failed posts toast only once on the auto path (real
 *           re-hover still retries, as before).
 *   CHANGED: D/C fire quickDownload directly (no DownloadControl involved);
 *           V fires callShowOriginSizeImage with an image URL payload.
 *   DELETED: B bookmark, checkPreviewType, ugoira, R-18/AI/bookmark branches,
 *           keyboard image switching (←/→/PageUp/PageDown) removed — it hijacked
 *           the site's own paging keys; wheel switching stays.
 *   CHANGED: 資訊列拆成上下兩列，DOM 順序＝上列 → 圖 → 下列；
 *           欄位與位置改由 settings.previewInfoPlacement 決定（9 欄位 ×
 *           上方／下方／不顯示，見 preview/previewInfo.ts），預設全部在上方
 *           （原本在圖片下方的資訊搬到預覽框上方）。載入中／失敗等狀態訊息
 *           固定佔用上方那一列（欄位讓位），showPreviewWorkTip=false 仍遵守
 *           PBD 語義：兩列全空＋浮層去框。fitImage 改量測浮層實際外框
 *           （兩列後總高≠圖高），設定變更時即時重繪。
 *   本輪（用戶需求）: settings.keepPreviewOnFloatHover（預設 true＝現行行為）；
 *           false 時離開卡片即關（保留 120ms＋別卡接手檢查），浮層 mouseenter
 *           不再取消待關閉、scheduleClose 不再被浮層 hover 挽留。
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { throttle } from '../Tools'
import { downloadPost, downloadSingle } from '../download/quickDownload'
import { api } from '../kemono/api'
import { isPendingPost, type PostApiResponse } from '../kemono/apiTypes'
import { settings } from '../setting/Settings'
import { states } from '../store/States'
import { clampPreviewPosition } from './previewLayout'
import { imageFiles, imageUrl, parsePostKey } from './previewAssets'
import { buildPreviewInfoFields, composePreviewInfo } from './previewInfo'
import { workThumbnail } from './WorkThumbnail'
import { markTransient } from '../PageRoots'

/** 顯示中的一帖 */
interface CurrentPreview {
  postKey: string
  service: string
  data: PostApiResponse
  urls: string[]
  index: number
  mouseX: number
  mouseY: number
}

/** 離開卡片／浮層後的關閉延遲（ms）：PBD 原版 100ms。
 * 單純睡一下不夠——浮層常壓在游標底下（show 即觸發卡片 mouseleave）、
 * 卡片→浮層要跨 24px 縫隙、浮層可能疊住卡片，所以時間到還要 hit-test
 * 再確認（見 scheduleClose），三種過渡情況都不誤殺。 */
const CLOSE_DELAY = 120

/** 滾輪前這段時間內滑鼠移動超過設定的距離（wheelScrollPageMoveDistance），
 * 就當成「邊移動邊滾」，讓頁面捲動 */
const POINTER_MOVING_MS = 200

class PreviewWork {
  private wrap: HTMLDivElement | null = null
  /** 圖片上方的資訊列（狀態訊息也走這一列） */
  private tipTop: HTMLDivElement | null = null
  /** 圖片下方的資訊列 */
  private tipBottom: HTMLDivElement | null = null
  /** 狀態訊息（載入中／失敗）：非空時佔用上方資訊列，欄位內容讓位 */
  private statusText = ''
  private pendingTimer = 0
  private closeTimer = 0
  private loadToken = 0
  private lastPageSwitch = 0
  /** 非 0 時：這個時間之後使用者沒動過滑鼠前，一律不觸發預覽（返回／前進換頁用） */
  private blockUntilMoveSince = 0
  private current: CurrentPreview | null = null
  /** 本次顯示的觸發座標：佔位圖（current 尚未建立）也用同一點夾回視窗 */
  private anchorX = 0
  private anchorY = 0
  /** 詳情載入中：浮層已可見（封面＋載入中）但 urls 還未知 */
  private dataLoading = false
  /** 已排入待顯示（pendingTimer 有效）：收斂迴圈看到它就跳過，避免重排 */
  private showPending = false
  /** 載入失敗過的 postKey：自動路徑不再重試（真人重 hover 仍會重試，維持舊行為） */
  private failedKeys = new Set<string>()
  /** 使用者手動關掉的 postKey（Esc/點浮層）：游標不動時不再自動重開 */
  private dismissedKey: string | null = null
  /** 目前浮層屬於哪個 postKey（載入中、失敗態也算）；手動關閉時用它記住 */
  private shownKey: string | null = null
  private switchWheel: (dir: 1 | -1) => void
  /** 預覽顯示期間掛在 window 上的滾輪監聽（見 onWheelScroll） */
  private wheelBound = false
  private readonly onWheel = (ev: WheelEvent): void => this.onWheelScroll(ev)

  constructor() {
    workThumbnail.onEnter((el, postKey, ev, auto) =>
      this.start(el, postKey, ev, auto)
    )
    workThumbnail.onLeave(() => this.scheduleClose())
    // 返回／前進時卡片會在靜止的游標底下重新出現，Chrome 還會自己補發
    // mouseover；不擋的話會冒出使用者沒要的預覽，看起來像舊預覽沒關。
    // 直接聽 popstate：網站可能先 replaceState，pageSwitch 分不出是返回
    window.addEventListener('popstate', () => {
      this.blockUntilMoveSince = Date.now()
      this.close()
    })
    EVT.on(EVT.list.pageSwitch, () => {
      log.debug('pageSwitch: ' + window.location.href)
      this.lastPageSwitch = Date.now()
      this.dismissedKey = null
      this.failedKeys.clear()
      this.close()
    })
    EVT.on(EVT.list.commandTogglePreviewWork, () => {
      if (settings.get('PreviewWork')) return
      // 關閉開關時連待顯示計時一起取消，否則已排入的那一次仍會彈出
      this.cancelPending()
      if (states.previewWorkIsShow) this.close()
    })
    window.addEventListener('keydown', (ev) => this.onKeyDown(ev))
    // 整頁離開（含進 BFCache）時收掉，否則按返回還原頁面時浮層原樣留著
    window.addEventListener('pagehide', () => this.close())
    // 設定面板／設定匯入改了資訊列相關設定時即時重繪（預覽浮層可能正開著）
    EVT.on(EVT.list.settingChange, (ev: CustomEventInit) => {
      const key = ev.detail?.data?.key
      // 關閉預覽開關：取消待顯示並收掉已開的浮層（含熱鍵與面板兩條路徑）
      if (key === 'PreviewWork' && !settings.get('PreviewWork')) {
        this.cancelPending()
        this.close()
        return
      }
      if (key !== 'previewInfoPlacement' && key !== 'showPreviewWorkTip') return
      this.refreshTipLayout()
    })
    // restore() 不發 settingChange：萬一存檔載入完成時浮層已開著（極早 hover），
    // 這裡補一次，免得以預設值畫出的資訊列一直留到重新 hover
    EVT.on(EVT.list.settingInitialized, () => {
      this.refreshTipLayout()
    })
    this.switchWheel = throttle((dir: 1 | -1) => {
      this.switchImage(dir)
    }, 100)
    // 收斂迴圈（500ms）：游標停在卡片上不動時，補上所有「事件漏掉」的情況——
    // 綁定早於監聽註冊、真人 enter 被換頁窗口吞掉、版面位移後卡片滑到游標下、
    // 第二次 pageSwitch 掐掉待顯示。已顯示／待顯示／失敗過／手動關掉時跳過。
    window.setInterval(() => this.pollHover(), 500)
  }

  private start(
    el: HTMLAnchorElement,
    postKey: string,
    ev: MouseEvent,
    /** auto = 卡片出現在游標底下自動觸發（見 WorkThumbnail.checkAutoEnter） */
    auto: boolean
  ): void {
    // 返回／前進後還沒動滑鼠：mouseenter 是瀏覽器補發的，不是使用者 hover
    if (!this.pointerActive()) return
    window.clearTimeout(this.closeTimer)
    window.clearTimeout(this.pendingTimer)
    this.showPending = false
    if (!settings.get('PreviewWork')) return
    // 原圖 viewer 開著時互斥
    if (document.querySelector('#originSizeWrap')) return
    // 換頁 500ms 封鎖（PBD dontShowAfterPageSwitch）只擋真人 mouseenter：
    // 防舊頁殘留卡片上誤觸；自動觸發的卡片必屬當前頁，豁免
    if (!auto && Date.now() - this.lastPageSwitch < 500) {
      log.debug('preview suppressed by pageSwitch window')
      return
    }
    this.showPending = true
    this.pendingTimer = window.setTimeout(() => {
      this.show(el, postKey, ev.clientX, ev.clientY)
    }, settings.get('previewWorkWait'))
  }

  /** hover 離開：取消待顯示；已顯示的延遲再確認後關。
   * 時間到時 hit-test：keepPreviewOnFloatHover=true 時，游標已到浮層上
   * （卡片→浮層途中，含浮層壓住游標的誤觸）→ 跳過不關；=false（嚴格模式）
   * 時離開卡片即關，不再被浮層 hover 挽留（仍保留 CLOSE_DELAY＋別卡接手
   * 檢查，避免卡片間移動閃爍）。
   * 或已到任一已綁定卡片上（該卡 start 已接手）→ 跳過不關；
   * 兩者皆非（真拿開了）才關。移到隔壁卡會被 start 取消計時，不閃爍。 */
  private scheduleClose(): void {
    window.clearTimeout(this.pendingTimer)
    this.showPending = false
    if (!states.previewWorkIsShow) return
    window.clearTimeout(this.closeTimer)
    this.closeTimer = window.setTimeout(() => {
      // 嚴格模式（keepPreviewOnFloatHover=false）：離開卡片即關，不再被
      // 浮層 hover 挽留；仍保留 CLOSE_DELAY＋別卡接手檢查，卡片間移動不閃爍
      if (settings.get('keepPreviewOnFloatHover') && this.cursorOnFloat())
        return
      // 已到別卡上：該卡 start 已排待顯示或已顯示，不關
      if (this.showPending || workThumbnail.findCardUnderCursor()) return
      this.close()
    }, CLOSE_DELAY)
  }

  /** 游標是否在預覽浮層上（hit-test，不靠 mouseenter 競速）。
   * 浮層剛出現在靜止的游標底下時 :hover 要等下一次移動才更新，
   * 所以再用最後已知座標比對浮層範圍 */
  private cursorOnFloat(): boolean {
    if (!this.wrap) return false
    if (this.wrap.matches(':hover')) return true
    const c = workThumbnail.cursorPoint()
    if (!c) return false
    const r = this.wrap.getBoundingClientRect()
    return c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom
  }

  /** 是否允許觸發預覽：返回／前進換頁後要等使用者真的動過滑鼠 */
  private pointerActive(): boolean {
    return (
      !this.blockUntilMoveSince ||
      workThumbnail.movedSince(this.blockUntilMoveSince)
    )
  }

  /** 收斂迴圈本體（見建構子）：游標下有已綁定卡片、且預覽既沒顯示也沒在等、
   * 該帖沒失敗過、沒被手動關掉，就補一次自動觸發 */
  private pollHover(): void {
    if (document.hidden) return
    // 已顯示但游標既不在卡片也不在浮層上：補關。卡片若被換頁重繪或從沒真的
    // 被游標進入過（自動觸發），永遠等不到 mouseleave，浮層會一直留著
    if (
      states.previewWorkIsShow &&
      !this.cursorOnFloat() &&
      !workThumbnail.findCardUnderCursor()
    ) {
      this.scheduleClose()
      return
    }
    if (states.previewWorkIsShow || this.showPending) return
    if (!this.pointerActive()) return
    if (!settings.get('PreviewWork')) return
    if (document.querySelector('#originSizeWrap')) return
    const f = workThumbnail.findCardUnderCursor()
    if (!f || this.failedKeys.has(f.postKey)) return
    if (f.postKey === this.dismissedKey) return
    this.dismissedKey = null
    if (workThumbnail.fireAutoEnterForCursor(f)) {
      log.debug('auto-enter: pointer resting on card')
    }
  }

  private async show(
    el: HTMLAnchorElement,
    postKey: string,
    mouseX: number,
    mouseY: number
  ): Promise<void> {
    this.showPending = false
    // 待顯示期間開關被關掉：計時器仍可能已排入，這裡是最後一道守衛
    if (!settings.get('PreviewWork')) return
    const info = parsePostKey(postKey)
    if (!info) return
    const token = ++this.loadToken
    this.shownKey = postKey
    this.anchorX = mouseX
    this.anchorY = mouseY
    this.ensureWrap(mouseX, mouseY)
    states.previewWorkIsShow = true
    this.bindWheel(true)
    this.dataLoading = true
    // 同步斷開上一個作品：浮層是重用的，current 不清掉的話，切換後的載入
    // 空窗期滾輪／鍵盤會作用到舊帖的 urls（殘影）；舊圖也不管新卡有無封面
    // 都先清掉，摘要條先置載入中
    this.current = null
    this.wrap?.querySelector('img')?.remove()
    this.setTip(lang.transl('_loading'))

    try {
      // 先顯卡片上的封面（零請求），再抓詳情升級
      const cardImg = el.querySelector('img')
      const cover = cardImg?.currentSrc || cardImg?.src || ''
      if (cover) this.renderImageSrc(cover, lang.transl('_loading'))

      let data: PostApiResponse
      try {
        const res = await api.post(info)
        if (token !== this.loadToken) return
        if (api.isErrorResponse(res)) {
          this.failedKeys.add(postKey)
          toast.error(lang.transl('_loadFailed') + `：${res.error}`)
          this.setTip(lang.transl('_loadFailed'))
          return
        }
        data = res
      } catch (e) {
        if (token !== this.loadToken) return
        this.failedKeys.add(postKey)
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(lang.transl('_loadFailed') + `：${msg}`)
        this.setTip(lang.transl('_loadFailed'))
        return
      }

      const original = settings.get('previewOriginalImage')
      const files = imageFiles(data)
      const urls = files
        .map((f) => imageUrl(f, data, original))
        .filter((u) => u)
      if (urls.length === 0) {
        this.failedKeys.add(postKey)
        this.setTip(lang.transl('_noPreviewImage'))
        return
      }
      const index = Math.min(states.indexRecord[postKey] ?? 0, urls.length - 1)
      this.current = {
        postKey,
        service: info.service,
        data,
        urls,
        index,
        mouseX,
        mouseY,
      }
      this.renderCurrent()
    } finally {
      // 只有本次請求仍是最新時才清除；被 close()/新 show() 接管時由它們負責
      if (token === this.loadToken) this.dataLoading = false
    }
  }

  private ensureWrap(mouseX: number, mouseY: number): void {
    if (this.wrap) return
    const wrap = document.createElement('div')
    wrap.id = 'previewWorkWrap'
    wrap.style.left = `${Math.min(mouseX + 24, window.innerWidth - 100)}px`
    wrap.style.top = `${Math.max(8, mouseY - 100)}px`
    // DOM 順序＝上列 → 圖片 → 下列（圖片由 insertImage 插在兩列之間）
    const tipTop = this.makeTipBar('previewWorkTipTop')
    const tipBottom = this.makeTipBar('previewWorkTipBottom')
    wrap.append(tipTop, tipBottom)
    wrap.addEventListener('click', () => {
      // 手動關閉：同 Esc，游標不動時不再自動重開
      this.dismiss()
    })
    // 滑鼠移到浮層上時保持開啟（方便滾輪切圖），離開後才關；
    // 嚴格模式（keepPreviewOnFloatHover=false）下移入浮層也不取消待關閉
    wrap.addEventListener('mouseenter', () => {
      if (settings.get('keepPreviewOnFloatHover')) {
        window.clearTimeout(this.closeTimer)
      }
    })
    wrap.addEventListener('mouseleave', () => this.scheduleClose())
    document.body.appendChild(wrap)
    markTransient(wrap)
    this.wrap = wrap
    this.tipTop = tipTop
    this.tipBottom = tipBottom
    this.applyTipEnabled()
  }

  private makeTipBar(id: string): HTMLDivElement {
    const bar = document.createElement('div')
    bar.id = id
    bar.className = 'pwpPreviewTip'
    return bar
  }

  /** 圖片插在上下兩列之間（重繪時先移除舊圖） */
  private insertImage(img: HTMLImageElement): void {
    if (!this.wrap) return
    this.wrap.querySelector('img')?.remove()
    if (this.tipBottom) {
      this.wrap.insertBefore(img, this.tipBottom)
    } else {
      this.wrap.appendChild(img)
    }
  }

  /** 直接顯示一張圖（封面佔位用，不記 current） */
  private renderImageSrc(src: string, tip: string): void {
    if (!this.wrap || !this.tipTop) return
    const img = document.createElement('img')
    img.src = src
    img.onload = () => this.fitImage(img)
    this.insertImage(img)
    this.setTip(tip)
  }

  private renderCurrent(): void {
    if (!this.current || !this.wrap) return
    const { urls, index } = this.current
    states.indexRecord[this.current.postKey] = index
    const img = document.createElement('img')
    img.src = urls[index]
    img.onload = () => this.fitImage(img)
    img.onerror = () => this.setTip(lang.transl('_imageLoadFailed'))
    this.insertImage(img)
    // 預載下一張（PBD 同策略）
    if (urls.length > 1) {
      const next = new Image()
      next.src = urls[(index + 1) % urls.length]
    }
    this.updateTip()
  }

  /** 等比縮放塞進視窗（留資訊列高度），並把浮層保持在可視區內。
   * 有上下兩列後浮層總寬／總高不再等於圖片，故直接量測外框。 */
  private fitImage(img: HTMLImageElement): void {
    // 佔位期（封面已載入、詳情未回）current 還是 null，仍要縮放並夾回視窗
    if (!this.wrap) return
    const maxW = window.innerWidth * 0.92
    const maxH = window.innerHeight * 0.86
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
    const w = Math.max(1, Math.floor(img.naturalWidth * scale))
    const h = Math.max(1, Math.floor(img.naturalHeight * scale))
    img.style.width = `${w}px`
    img.style.height = `${h}px`
    const totalW = this.wrap.offsetWidth || w
    const totalH = this.wrap.offsetHeight || h
    const mouseX = this.current?.mouseX ?? this.anchorX
    const mouseY = this.current?.mouseY ?? this.anchorY
    const { x, y } = clampPreviewPosition(
      mouseX,
      mouseY,
      totalW,
      totalH,
      window.innerWidth,
      window.innerHeight
    )
    this.wrap.style.left = `${x}px`
    this.wrap.style.top = `${y}px`
  }

  /** 顯示當前帖的欄位（清掉狀態訊息） */
  private updateTip(): void {
    this.statusText = ''
    this.renderTip()
  }

  /** 逐欄文字：資料來自 current（無 current 時只有狀態訊息） */
  private collectFields(): ReturnType<typeof buildPreviewInfoFields> | null {
    if (!this.current) return null
    const { data, urls, index, service } = this.current
    const post = data.post
    return buildPreviewInfoFields(
      {
        index,
        total: urls.length,
        title: post.title ?? '',
        creatorId: post.user || this.current.postKey.split('/')[1] || '',
        service,
        postId: post.id ?? '',
        published: post.published ?? '',
        pendingOnly: isPendingPost(post),
      },
      lang.transl.bind(lang)
    )
  }

  /** showPreviewWorkTip=false 時：兩列隱藏＋浮層去框去陰影（PBD 語義） */
  private applyTipEnabled(): void {
    const on = settings.get('showPreviewWorkTip')
    if (this.wrap) this.wrap.style.boxShadow = on ? '' : 'none'
    for (const bar of [this.tipTop, this.tipBottom]) {
      if (bar) bar.style.border = on ? '' : 'none'
    }
    this.renderTip()
  }

  /** 設定變更／設定載入完成後：重畫兩列並重新夾回視窗（浮層沒開就什麼都不做） */
  private refreshTipLayout(): void {
    if (!this.wrap) return
    this.applyTipEnabled()
    const img = this.wrap.querySelector('img')
    if (img && img.naturalWidth > 0) this.fitImage(img)
  }

  /** 重繪上下兩列：狀態訊息佔用上列；空的一列整個隱藏（不佔高度不留框線）。
   * showPreviewWorkTip=false 時整條留空（連狀態訊息也不顯示，PBD 語義） */
  private renderTip(): void {
    if (!this.tipTop || !this.tipBottom) return
    if (!settings.get('showPreviewWorkTip')) {
      this.paintTip(this.tipTop, '')
      this.paintTip(this.tipBottom, '')
      return
    }
    const fields = this.collectFields()
    const laid = fields
      ? composePreviewInfo(fields, settings.get('previewInfoPlacement'))
      : { top: '', bottom: '' }
    this.paintTip(this.tipTop, this.statusText || laid.top)
    this.paintTip(this.tipBottom, laid.bottom)
  }

  private paintTip(bar: HTMLDivElement, text: string): void {
    bar.textContent = text
    bar.style.display = text === '' ? 'none' : 'block'
  }

  /** 狀態訊息入口（載入中／失敗）：佔用上方資訊列 */
  private setTip(text: string): void {
    this.statusText = text
    this.renderTip()
  }

  private switchImage(dir: 1 | -1): void {
    if (!this.current || this.current.urls.length < 2) return
    const n = this.current.urls.length
    this.current.index = (this.current.index + dir + n) % n
    this.renderCurrent()
  }

  /** 預覽顯示期間才在 window 捕獲階段聽滾輪：不管游標下是卡片、浮層還是
   * 蓋在卡片上的其他元素都收得到；平時不掛，不拖慢頁面捲動 */
  private bindWheel(on: boolean): void {
    if (on === this.wheelBound) return
    this.wheelBound = on
    if (on) {
      window.addEventListener('wheel', this.onWheel, {
        capture: true,
        passive: false,
      })
    } else {
      window.removeEventListener('wheel', this.onWheel, true)
    }
  }

  /** 滾輪：預覽顯示中＋開關開＋滑鼠沒在動就攔截，頁面不捲動。
   * 多圖時真正切圖；載入中／單圖／失敗時 switchImage 因無圖可切而 no-op，
   * 只起到鎖住頁面捲動的作用。
   * 滑鼠邊移動邊滾、而且移動超過設定的距離時不攔截，頁面照常捲動；
   * 只動一點點（手抖、微調位置）照樣切圖。 */
  private onWheelScroll(ev: WheelEvent): void {
    if (!states.previewWorkIsShow) return
    if (!settings.get('wheelScrollSwitchImageOnPreviewWork')) return
    if (
      workThumbnail.movedFar(
        POINTER_MOVING_MS,
        settings.get('wheelScrollPageMoveDistance')
      )
    ) {
      return
    }
    // 原圖檢視器開著時讓它自己捲動
    if (document.querySelector('#originSizeWrap')) return
    ev.preventDefault()
    this.switchWheel(ev.deltaY > 0 ? 1 : -1)
  }

  private onKeyDown(ev: KeyboardEvent): void {
    // 一級快捷鍵已在捕獲階段處理並 preventDefault，這裡不再重複動作
    if (ev.defaultPrevented) return
    // 輸入框守衛要在最前面（Esc 也不該關預覽／觸發其他動作）
    const t = ev.target as HTMLElement | null
    if (
      t &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    ) {
      return
    }
    // Esc 在載入中/失敗態（current 為 null）也要能關，所以先處理；
    // 原圖 viewer 開著時讓它先關（ShowOriginSizeImage 會處理）
    if (ev.key === 'Escape') {
      if (document.querySelector('#originSizeWrap')) return
      if (states.previewWorkIsShow) {
        // 手動關閉：記住該帖，游標不動時收斂迴圈不再重開
        this.dismiss()
      }
      return
    }
    if (!states.previewWorkIsShow || !this.current) return
    // 字母鍵必須無修飾鍵才 acting（Alt/Ctrl/Meta/Shift 組合留給一級快捷鍵，
    // 否則錄了 Alt+D、Shift+D 之類的快捷鍵會同時觸發這裡的下載）
    const hasModifier = ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey
    const originViewerOpen = !!document.querySelector('#originSizeWrap')
    switch (ev.key) {
      case 'd':
      case 'D':
        if (!hasModifier && !originViewerOpen)
          void downloadPost(this.current.postKey)
        break
      case 'c':
      case 'C':
        if (!hasModifier && !originViewerOpen)
          void downloadSingle(this.current.postKey, this.current.index)
        break
      case 'v':
      case 'V':
        if (!hasModifier) {
          EVT.fire('callShowOriginSizeImage', {
            imageUrl: this.current.urls[this.current.index],
          })
        }
        break
    }
  }

  /** 取消尚未觸發的待顯示計時（關閉開關時用） */
  private cancelPending(): void {
    window.clearTimeout(this.pendingTimer)
    this.showPending = false
  }

  /** 手動關閉（點浮層／Esc）：記住目前顯示的 postKey，游標不動時不再自動重開 */
  private dismiss(): void {
    this.dismissedKey = this.shownKey
    this.close()
  }

  private close(): void {
    window.clearTimeout(this.pendingTimer)
    window.clearTimeout(this.closeTimer)
    this.loadToken++
    this.current = null
    this.showPending = false
    this.dataLoading = false
    this.statusText = ''
    this.shownKey = null
    this.wrap?.remove()
    this.wrap = null
    this.tipTop = null
    this.tipBottom = null
    states.previewWorkIsShow = false
    this.bindWheel(false)
  }
}

const previewWork = new PreviewWork()

export { previewWork }
