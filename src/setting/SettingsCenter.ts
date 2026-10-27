/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/setting/SettingsPanelShell.ts +
 *          SettingsPanelNavigation.ts + SettingsPanelSearch.ts (concept,
 *          xuejianxianzun)
 * changes: PBD 設定中心的簡化版 —— 置中深色 modal、左側欄分頁、頂部搜尋、
 *          可折疊分區，預覽設定與批次面板合併為單一入口：⚙ 開預覽頁、
 *          Alt+X／工具列圖示開關面板。這裡只有外殼（分頁切換、搜尋、
 *          介紹浮層、控件同步），各分頁的內容在 pages/。
 *          所有設定鍵沿用 settings.get/set 單一寫入源；面板建於
 *          settingInitialized 之後，故初值即存檔值，另有 settingChange
 *          中央同步（Alt+P、設定匯入等外部寫入）。
 */

import { Config } from '../Config'
import { EVT } from '../EVT'
import { lang } from '../Language'
import { LangTextKey } from '../langText'
import type { PreviewInfoField } from '../preview/previewInfo'
import { settings, SettingKey } from './Settings'
import { store } from '../store/Store'
import { toast } from '../Toast'
import { keepInBody } from '../PageRoots'
import { CacheView } from './pages/cache'
import { buildCommon } from './pages/common'
import type { CenterContext } from './pages/context'
import { buildCrawl } from './pages/crawl'
import { CrawlControls } from './pages/crawlControls'
import { CrawlProgressView } from './pages/crawlProgress'
import { buildDownload } from './pages/download'
import { DownloadControls } from './pages/downloadControls'
import { FolderStatusView } from './pages/folderStatus'
import { buildHelp } from './pages/help'
import { buildHome } from './pages/home'
import { LogView } from './pages/log'
import { MountInfoView } from './pages/mountInfo'
import { NamingView } from './pages/naming'
import { buildPreview } from './pages/preview'
import { StatusRows } from './pages/status'

/** 設定中心的側欄分頁 */
type CenterPage =
  | 'home'
  | 'preview'
  | 'crawl'
  | 'download'
  | 'cache'
  | 'naming'
  | 'common'
  | 'help'

/** 側欄分頁定義（圖示用純文字元號） */
const PAGES: Array<{ id: CenterPage; icon: string; label: LangTextKey }> = [
  { id: 'home', icon: '⌂', label: '_sc_home' },
  { id: 'preview', icon: '◉', label: '_sc_preview' },
  { id: 'crawl', icon: '⇩', label: '_secCrawl' },
  { id: 'download', icon: '⬇', label: '_secDownload' },
  { id: 'cache', icon: '🗂', label: '_secCache' },
  { id: 'naming', icon: '✎', label: '_secNaming' },
  { id: 'common', icon: '⚙', label: '_sc_common' },
  { id: 'help', icon: '?', label: '_sc_help' },
]

/** 深色設定中心：側欄分頁＋頂部搜尋＋可折疊分區（單一入口） */
class SettingsCenter {
  private built = false
  private backdrop!: HTMLDivElement
  private center!: HTMLDivElement
  private searchInput!: HTMLInputElement
  private noResult!: HTMLDivElement
  private navEls = new Map<CenterPage, HTMLButtonElement>()
  private pageEls = new Map<CenterPage, HTMLDivElement>()
  private activePage: CenterPage = 'crawl'
  /** 分頁模組需要從外殼取用的能力 */
  private readonly ctx: CenterContext = {
    refreshNamingPreview: () => this.naming.refresh(),
    reapplySearch: () => this.reapplySearch(),
  }
  /** 首頁與下載頁共用的狀態列、下載控制按鈕組、掛載詳情卡 */
  private readonly status = new StatusRows()
  private readonly dlControls = new DownloadControls()
  /** 首頁與抓取頁共用的抓取控制按鈕組 */
  private readonly crawlControls = new CrawlControls()
  /** 首頁與抓取頁共用的抓取進度區塊 */
  private readonly crawlProgress = new CrawlProgressView()
  /** 通用頁的本機資料夾區塊（授權狀態列＋按鈕） */
  private readonly folderStatus = new FolderStatusView()
  /** 右下角 ⚙ 浮動按鈕 */
  private trigger!: HTMLButtonElement
  private readonly mountInfo = new MountInfoView()
  private readonly logView = new LogView()
  private readonly naming = new NamingView()
  private readonly cache = new CacheView(this.ctx)
  /** 懸停介紹浮層（body 層單例，避免被面板捲動裁掉） */
  private descTip!: HTMLDivElement
  private descTimer = 0
  private descRow: HTMLElement | null = null
  /** 懸停多久後顯示介紹（ms） */
  private readonly descDelay = 500

  constructor() {
    EVT.on(EVT.list.settingInitialized, () => this.build(), {
      once: true,
    })
    this.bindGlobalCommands()
  }

  /** 開啟中心並停在指定分頁（預設停在上次分頁） */
  public open(page: CenterPage = this.activePage): void {
    if (!this.ensureBuilt()) return
    this.switchPage(page)
    this.center.style.display = 'flex'
    this.backdrop.style.display = 'block'
    this.refreshStatus()
    void this.folderStatus.refresh()
  }

  /** 關閉中心（含搜尋狀態重置、介紹浮層隱藏） */
  public close(): void {
    if (!this.built) return
    this.hideDesc()
    this.center.style.display = 'none'
    this.backdrop.style.display = 'none'
    this.clearSearch()
  }

  /** 開關中心；關閉中時可指定要停的分頁 */
  public toggle(page?: CenterPage): void {
    if (!this.ensureBuilt()) return
    if (this.center.style.display === 'none') {
      this.open(page ?? this.activePage)
    } else {
      this.close()
    }
  }

  /** 中心是否开启中 */
  public get isOpen(): boolean {
    return this.built && this.center.style.display !== 'none'
  }

  /** 切換分頁（搜尋中時保留搜尋，只切換要顯示的命中頁） */
  public switchPage(id: CenterPage): void {
    if (!this.ensureBuilt()) return
    this.hideDesc()
    this.activePage = id
    if (this.searchInput && this.searchInput.value.trim() !== '') {
      this.applySearch()
      return
    }
    this.clearSearch()
    for (const [pid, el] of this.pageEls) {
      el.style.display = pid === id ? 'block' : 'none'
    }
    for (const [pid, btn] of this.navEls) {
      btn.classList.toggle('active', pid === id)
    }
    // 日誌在隱藏分頁裡重繪時高度為 0、捲不到底；顯示出來後再捲到最新一筆
    if (id === 'download') {
      this.logView.scrollToBottom()
    }
    // 切到通用頁：資料夾授權狀態可能在別處變過，重新查一次
    if (id === 'common') {
      void this.folderStatus.refresh()
    }
  }

  /** 使用者操作入口：沒建好就地建（頁面剛載入、存檔還沒讀回時 Alt+X 照樣能開） */
  private ensureBuilt(): boolean {
    if (!this.built) this.build()
    return this.built
  }

  private build(): void {
    if (this.built) return
    this.built = true

    // 右下角 ⚙：開預覽頁
    const trigger = document.createElement('button')
    this.trigger = trigger
    trigger.id = 'pwpPanelBtn'
    trigger.textContent = '⚙'
    trigger.dataset.xztitle = '_previewSettings'
    trigger.title = lang.transl('_previewSettings')
    trigger.addEventListener('click', () => this.toggle('preview'))
    document.body.appendChild(trigger)
    keepInBody(trigger)
    this.applyFloatingButton()

    this.backdrop = document.createElement('div')
    this.backdrop.id = 'pwpSCBackdrop'
    this.backdrop.style.display = 'none'
    this.backdrop.addEventListener('click', () => this.close())
    document.body.appendChild(this.backdrop)
    keepInBody(this.backdrop)

    this.center = document.createElement('div')
    this.center.id = 'pwpSettingsCenter'
    this.center.style.display = 'none'
    this.center.innerHTML = `
      <div class="pwpSC-top">
        <div class="pwpSC-brand"><span class="pwpSC-app">${Config.appName}</span></div>
        <label class="pwpSC-search">
          <span class="pwpSC-searchIcon">⌕</span>
          <input type="text" data-xzplaceholder="_searchSettings">
        </label>
        <button type="button" class="pwpSC-close" data-xztitle="_close">×</button>
      </div>
      <div class="pwpSC-main">
        <nav class="pwpSC-nav"></nav>
        <div class="pwpSC-pages"></div>
      </div>
      <div class="pwpSC-noResult" data-xztext="_noSearchResult" style="display: none;"></div>`
    document.body.appendChild(this.center)
    keepInBody(this.center)

    const nav = this.center.querySelector('.pwpSC-nav') as HTMLElement
    const pages = this.center.querySelector('.pwpSC-pages') as HTMLDivElement
    for (const p of PAGES) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pwpSC-navBtn'
      btn.dataset.page = p.id
      btn.innerHTML = `<span class="pwpSC-navIcon">${p.icon}</span><span data-xztext="${p.label}"></span>`
      btn.addEventListener('click', () => this.switchPage(p.id))
      nav.appendChild(btn)
      this.navEls.set(p.id, btn)
      const page = document.createElement('div')
      page.className = 'pwpSC-page'
      page.dataset.page = p.id
      page.style.display = 'none'
      pages.appendChild(page)
      this.pageEls.set(p.id, page)
    }

    this.searchInput = this.center.querySelector(
      '.pwpSC-search input'
    ) as HTMLInputElement
    this.searchInput.addEventListener('input', () => this.applySearch())
    this.noResult = this.center.querySelector(
      '.pwpSC-noResult'
    ) as HTMLDivElement
    ;(
      this.center.querySelector('.pwpSC-close') as HTMLButtonElement
    ).addEventListener('click', () => this.close())
    window.addEventListener('keydown', (ev) =>
      this.onKeyDown(ev as KeyboardEvent)
    )
    // 面板捲動時藏介紹浮層（位置會跑掉）；mouseenter 委派負責顯示
    this.center.addEventListener('scroll', () => this.hideDesc(), true)
    this.center.addEventListener('mouseover', (ev) =>
      this.onRowHover(ev as MouseEvent)
    )
    this.center.addEventListener('mouseout', (ev) =>
      this.onRowLeave(ev as MouseEvent)
    )
    this.descTip = document.createElement('div')
    this.descTip.id = 'pwpSCDescTip'
    this.descTip.style.display = 'none'
    document.body.appendChild(this.descTip)
    keepInBody(this.descTip)

    buildHome(this.pageEls.get('home')!, {
      status: this.status,
      mountInfo: this.mountInfo,
      crawlControls: this.crawlControls,
      crawlProgress: this.crawlProgress,
      dlControls: this.dlControls,
    })
    buildPreview(this.pageEls.get('preview')!)
    buildCrawl(
      this.pageEls.get('crawl')!,
      this.ctx,
      this.crawlControls,
      this.crawlProgress
    )
    buildDownload(this.pageEls.get('download')!, this.ctx, {
      status: this.status,
      mountInfo: this.mountInfo,
      dlControls: this.dlControls,
      logView: this.logView,
    })
    this.cache.build(this.pageEls.get('cache')!)
    this.naming.build(this.pageEls.get('naming')!)
    buildCommon(this.pageEls.get('common')!, this.ctx, this.folderStatus)
    buildHelp(this.pageEls.get('help')!)

    lang.register(this.center)
    lang.register(trigger)
    // 面板若建得比存檔還早（lazy build），存檔落地後全量同步一次；
    // 正常時序下 settingInitialized 已發過，這個 once 監聽不會再觸發
    EVT.on(EVT.list.settingInitialized, () => this.syncAllControls(), {
      once: true,
    })
    this.switchPage(this.activePage)
    this.bindRefreshEvents()
    // 授權視窗關閉後焦點回到本分頁：面板開著時重查資料夾授權狀態
    window.addEventListener('focus', () => {
      if (this.isOpen) void this.folderStatus.refresh()
    })
  }

  /** 依 showFloatingButton 顯示或隱藏右下角 ⚙ 按鈕 */
  private applyFloatingButton(): void {
    if (!this.trigger) return
    this.trigger.style.display = settings.get('showFloatingButton')
      ? ''
      : 'none'
  }

  /** Esc 關閉（輸入框內只清搜尋，不關面板） */
  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.isOpen) return
    const t = ev.target as HTMLElement | null
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      if (t === this.searchInput) this.clearSearch()
      return
    }
    this.close()
  }
  // ---------- 懸停介紹 ----------

  /** 滑鼠進入設定列：停留 descDelay 後顯示介紹浮層（同列內移動不重計） */
  private onRowHover(ev: MouseEvent): void {
    const row = (ev.target as HTMLElement).closest?.(
      '.pwpSC-row[data-desc]'
    ) as HTMLElement | null
    if (row === this.descRow) return
    this.hideDesc()
    if (!row || !row.dataset.desc) return
    this.descRow = row
    const descKey = row.dataset.desc as LangTextKey
    this.descTimer = window.setTimeout(
      () => this.showDesc(row, descKey),
      this.descDelay
    )
  }

  /** 滑鼠真正離開該列才隱藏（列內子元素間移動不算離開） */
  private onRowLeave(ev: MouseEvent): void {
    if (!this.descRow) return
    const to = ev.relatedTarget as HTMLElement | null
    if (to && this.descRow.contains(to)) return
    this.hideDesc()
  }

  /** 在該列下方（空間不足改上方）顯示介紹，夾在視窗內 */
  private showDesc(row: HTMLElement, descKey: LangTextKey): void {
    if (!this.isOpen) return
    this.descTip.textContent = lang.transl(descKey)
    this.descTip.style.visibility = 'hidden'
    this.descTip.style.display = 'block'
    const r = row.getBoundingClientRect()
    const w = this.descTip.offsetWidth
    const h = this.descTip.offsetHeight
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
    let top = r.bottom + 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8)
    this.descTip.style.left = `${left}px`
    this.descTip.style.top = `${top}px`
    this.descTip.style.visibility = 'visible'
  }

  private hideDesc(): void {
    window.clearTimeout(this.descTimer)
    this.descRow = null
    if (this.descTip) this.descTip.style.display = 'none'
  }

  // ---------- 搜尋 ----------

  /** 退出搜尋，恢復分頁顯示 */
  private clearSearch(): void {
    if (!this.built) return
    if (this.searchInput && this.searchInput.value !== '')
      this.searchInput.value = ''
    this.center.classList.remove('pwpSC-searching', 'pwpSC-emptyResult')
    if (this.noResult) this.noResult.style.display = 'none'
    for (const sec of this.center.querySelectorAll('.pwpSC-section')) {
      ;(sec as HTMLElement).style.display = ''
    }
    for (const row of this.center.querySelectorAll('.pwpSC-row')) {
      ;(row as HTMLElement).style.display = ''
    }
    for (const [pid, el] of this.pageEls) {
      el.style.display = pid === this.activePage ? 'block' : 'none'
    }
    for (const btn of this.navEls.values()) btn.classList.remove('pwpSC-empty')
  }

  /** 快取列表重建後，若正在搜尋就重新套用過濾（新卡才不會漏掉） */
  private reapplySearch(): void {
    if (this.searchInput && this.searchInput.value.trim() !== '') {
      this.applySearch()
    }
  }

  /** 搜尋全部頁面的設定列；有命中的分區才顯示，一次只顯示一頁結果 */
  private applySearch(): void {
    const q = this.searchInput.value.trim().toLowerCase()
    if (q === '') {
      this.clearSearch()
      return
    }
    this.center.classList.add('pwpSC-searching')
    let total = 0
    const pageHits = new Map<CenterPage, number>()
    for (const [pid, page] of this.pageEls) {
      let pageCount = 0
      const sections = page.querySelectorAll(':scope > .pwpSC-section')
      for (const sec of sections) {
        let secCount = 0
        const rows = sec.querySelectorAll('.pwpSC-row')
        for (const r of rows) {
          const row = r as HTMLElement
          // 被整塊隱藏的區塊（如未選按資料夾時的資料夾區塊）不參與搜尋
          if (row.closest('[hidden]')) continue
          // 狀態列內容會隨任務變動，不參與比對，也不因搜尋被藏起來
          if (row.classList.contains('pwpSC-status')) {
            row.style.display = ''
            continue
          }
          const hay =
            `${row.textContent ?? ''} ${row.dataset.key ?? ''}`.toLowerCase()
          const hit = hay.includes(q)
          row.style.display = hit ? '' : 'none'
          if (hit) secCount++
        }
        ;(sec as HTMLElement).style.display = secCount > 0 ? '' : 'none'
        pageCount += secCount
      }
      pageHits.set(pid, pageCount)
      total += pageCount
    }
    // 只顯示目前分頁的命中結果；沒有命中就跳到第一個有命中的分頁
    let showPage: CenterPage | undefined = pageHits.get(this.activePage)
      ? this.activePage
      : undefined
    if (!showPage) {
      for (const [pid, count] of pageHits) {
        if (count > 0) {
          showPage = pid
          break
        }
      }
    }
    for (const [pid, page] of this.pageEls) {
      page.style.display = pid === showPage ? 'block' : 'none'
    }
    if (showPage) this.activePage = showPage
    for (const [pid, btn] of this.navEls) {
      btn.classList.toggle('active', pid === this.activePage)
      btn.classList.toggle('pwpSC-empty', (pageHits.get(pid) ?? 0) === 0)
    }
    this.noResult.style.display = total === 0 ? 'block' : 'none'
    this.center.classList.toggle('pwpSC-emptyResult', total === 0)
  }

  // ---------- 狀態與事件 ----------

  private refreshStatus(): void {
    if (!this.built) return
    this.status.refresh()
    if (store.result.length > 0) this.naming.refresh()
  }

  /** 存檔落地後，把所有控件重設為真實值（含資訊列位置表） */
  private syncAllControls(): void {
    if (!this.built) return
    for (const box of this.center.querySelectorAll<HTMLInputElement>(
      'input[data-skey]'
    )) {
      const key = box.dataset.skey as SettingKey
      if (box.type === 'checkbox') {
        box.checked = settings.get(key) as boolean
      } else {
        box.value = String(settings.get(key))
      }
    }
    for (const sel of this.center.querySelectorAll<HTMLSelectElement>(
      'select[data-skey]'
    )) {
      sel.value = String(settings.get(sel.dataset.skey as SettingKey))
    }
    const placement = settings.get('previewInfoPlacement')
    for (const sel of this.center.querySelectorAll<HTMLSelectElement>(
      'select[data-pfield]'
    )) {
      const field = sel.dataset.pfield as PreviewInfoField
      if (placement[field]) sel.value = placement[field]
    }
    this.naming.refresh()
    // 匯入設定等整批寫入後，連動區塊也要跟上
    this.applyFloatingButton()
    this.folderStatus.syncVisibility()
    void this.folderStatus.refresh()
  }

  /** 外部寫入設定時（Alt+P、設定匯入），同步面板控件 */
  private syncControl(key: string): void {
    if (key === 'previewInfoPlacement') {
      const placement = settings.get('previewInfoPlacement')
      for (const sel of this.center.querySelectorAll<HTMLSelectElement>(
        'select[data-pfield]'
      )) {
        const field = sel.dataset.pfield as PreviewInfoField
        if (placement[field]) sel.value = placement[field]
      }
      this.naming.refresh()
      return
    }
    const box = this.center.querySelector<HTMLInputElement>(
      `input[data-skey="${key}"]`
    )
    if (box) {
      if (box.type === 'checkbox') {
        box.checked = settings.get(key as SettingKey) as boolean
      } else {
        box.value = String(settings.get(key as SettingKey))
      }
      this.naming.refresh()
      return
    }
    const sel = this.center.querySelector<HTMLSelectElement>(
      `select[data-skey="${key}"]`
    )
    if (sel) {
      sel.value = String(settings.get(key as SettingKey))
      this.naming.refresh()
    }
  }

  /** 一級命令＋面板刷新事件 */
  private bindGlobalCommands(): void {
    EVT.on(EVT.list.commandToggleCrawlPanel, () => this.toggle())
    EVT.on(EVT.list.commandTogglePreviewWork, () => {
      const next = !settings.get('PreviewWork')
      settings.set('PreviewWork', next)
      toast.show(lang.transl(next ? '_previewOn' : '_previewOff'))
    })
  }

  private bindRefreshEvents(): void {
    EVT.on(EVT.list.settingChange, ((ev: Event) => {
      const { key } = (ev as CustomEvent).detail.data as { key: string }
      this.syncControl(key)
      if (key === 'showFloatingButton') {
        this.applyFloatingButton()
      } else if (key === 'skipDownloaded') {
        this.folderStatus.syncVisibility()
        void this.folderStatus.refresh()
      }
    }) as EventListener)
    const refresh = () => {
      this.refreshStatus()
      this.naming.refresh()
    }
    for (const ev of [
      EVT.list.crawlStart,
      EVT.list.addResult,
      EVT.list.crawlComplete,
      EVT.list.crawlEmpty,
      EVT.list.resultChange,
      EVT.list.downloadStart,
      EVT.list.downloadSuccess,
      EVT.list.skipDownload,
      EVT.list.downloadComplete,
    ]) {
      EVT.on(ev, refresh)
    }
    // 下載控制按鈕跟著任務狀態走
    for (const ev of [
      EVT.list.downloadStart,
      EVT.list.downloadPause,
      EVT.list.downloadStop,
      EVT.list.downloadComplete,
      EVT.list.crawlStart,
      EVT.list.crawlComplete,
      EVT.list.crawlEmpty,
      EVT.list.resultChange,
      EVT.list.readyDownload,
      EVT.list.langChange,
    ]) {
      EVT.on(ev, () => this.dlControls.refresh())
    }
    // 抓取控制按鈕跟著抓取／下載狀態走（下載任務會佔用 busy，影響按鈕判斷）
    for (const ev of [
      EVT.list.crawlStart,
      EVT.list.crawlComplete,
      EVT.list.crawlEmpty,
      EVT.list.stopCrawl,
      EVT.list.crawlPause,
      EVT.list.crawlResume,
      EVT.list.downloadStart,
      EVT.list.downloadPause,
      EVT.list.downloadStop,
      EVT.list.downloadComplete,
      EVT.list.langChange,
    ]) {
      EVT.on(ev, () => this.crawlControls.refresh())
    }
    // 抓取進度統計變化：節流後重繪（計數更新很頻繁）
    EVT.on(EVT.list.crawlProgress, () => this.crawlProgress.scheduleRender())
    // 抓取完成（有結果）自動切到下載頁並展開
    EVT.on(EVT.list.readyDownload, () => this.open('download'))
    // 快取異動時重繪快取頁
    EVT.on(EVT.list.cacheChange, () => this.cache.render())
    // 日誌區內容變化：節流後重繪
    EVT.on(EVT.list.logAdd, () => this.logView.scheduleRender())
    // 掛載狀態或下載任務狀態變化：快取頁按鈕（可否掛載）與掛載詳情卡一起重繪
    for (const ev of [
      EVT.list.mountChange,
      EVT.list.downloadStart,
      EVT.list.downloadPause,
      EVT.list.downloadStop,
      EVT.list.downloadComplete,
      EVT.list.crawlStart,
      EVT.list.crawlComplete,
    ]) {
      EVT.on(ev, () => {
        this.cache.render()
        this.mountInfo.refresh()
      })
    }
    EVT.on(EVT.list.mountChange, ((ev: Event) => {
      this.refreshStatus()
      // 手動掛載後帶用戶到下載頁，接著按「開始下載」
      if ((ev as CustomEvent).detail?.data?.manual) {
        this.open('download')
      }
    }) as EventListener)
    // 語言切換後刷新動態狀態列（靜態標籤由 lang.register 處理）
    EVT.on(EVT.list.langChange, () => {
      this.refreshStatus()
      this.naming.refresh()
      this.cache.render()
      this.mountInfo.refresh()
      this.logView.render()
      this.crawlProgress.render()
      this.folderStatus.render()
    })
  }
}

const settingsCenter = new SettingsCenter()

export { settingsCenter, SettingsCenter }
export type { CenterPage }
