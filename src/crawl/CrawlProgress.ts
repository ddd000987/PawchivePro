/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 抓取進度統計：保存當前（或最近一輪）抓取的計數與階段，供設定中心顯示，
 * 也供抓取結果為空時說明原因。引擎在關鍵點呼叫更新方法；
 * 階段隨抓取生命週期事件切換。每次變化發 crawlProgress 事件（檢視層自行節流）。
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { LangTextKey } from '../langText'

/** 抓取階段 */
export type CrawlPhase =
  'idle' | 'crawling' | 'paused' | 'done' | 'stopped' | 'empty'

/** 篩選排除原因的顯示順序（對應 Filter.lastReason） */
const REASON_ORDER = [
  'title',
  'date',
  'fileCount',
  'kind',
  'pending',
  'service',
  'postId',
  'size',
] as const

const REASON_KEYS: Record<string, LangTextKey> = {
  title: '_cp_r_title',
  date: '_cp_r_date',
  fileCount: '_cp_r_fileCount',
  kind: '_cp_r_kind',
  pending: '_cp_r_pending',
  service: '_cp_r_service',
  postId: '_cp_r_postId',
  size: '_cp_r_size',
}

/** 把各原因的排除數量寫成「標題 3、日期 2」；沒有排除則回空字串 */
export function formatExcluded(excluded: Record<string, number>): string {
  const known: string[] = [...REASON_ORDER]
  const extra = Object.keys(excluded).filter((r) => !known.includes(r))
  const parts: string[] = []
  for (const reason of [...known, ...extra]) {
    const n = excluded[reason]
    if (!n) {
      continue
    }
    const key = REASON_KEYS[reason]
    parts.push(`${key ? lang.transl(key) : reason} ${n}`)
  }
  return parts.join(lang.transl('_cp_listSep'))
}

class CrawlProgress {
  constructor() {
    this.bindEvents()
  }

  public phase: CrawlPhase = 'idle'
  /** 抓取對象的簡短標籤（創作者名／ID＋服務）；ID 列表型抓取為空，改看 targetPosts */
  public target = ''
  /** ID 列表型抓取（縮圖快抓、等待佇列）的帖子數；0 = 不適用 */
  public targetPosts = 0
  /** 已取得的列表頁數 */
  public pages = 0
  /** 已檢查（走完篩選流程）的帖子數 */
  public scanned = 0
  /** 預期帖子總數；引擎不知道（例如 Pawchive 沒有 post_count）則為 null */
  public total: number | null = null
  /** 已加入結果的帖子數與檔案數 */
  public kept = 0
  public keptFiles = 0
  /** 各篩選原因排除的帖子數 */
  public excluded: Record<string, number> = {}
  /** 詳情取得失敗或因錯誤跳過的帖子數 */
  public failed = 0
  public startedAt = 0
  public endedAt = 0

  /** 被篩選排除的帖子總數 */
  public get excludedTotal(): number {
    let sum = 0
    for (const n of Object.values(this.excluded)) {
      sum += n
    }
    return sum
  }

  /** 已用時間（ms）：進行中算到現在，收尾後固定 */
  public elapsedMs(now = Date.now()): number {
    if (this.startedAt === 0) {
      return 0
    }
    return Math.max(0, (this.endedAt || now) - this.startedAt)
  }

  /** 是否進行中（含暫停） */
  public get active(): boolean {
    return this.phase === 'crawling' || this.phase === 'paused'
  }

  private bindEvents() {
    EVT.on(EVT.list.crawlStart, () => {
      this.reset()
      this.setPhase('crawling')
    })
    EVT.on(EVT.list.crawlPause, () => {
      if (this.phase === 'crawling') {
        this.setPhase('paused')
      }
    })
    EVT.on(EVT.list.crawlResume, () => {
      if (this.phase === 'paused') {
        this.setPhase('crawling')
      }
    })
    // 使用者中止：之後引擎還會發 crawlComplete 收尾，但階段維持「已停止」
    EVT.on(EVT.list.stopCrawl, () => {
      if (this.active) {
        this.setPhase('stopped')
      }
    })
    EVT.on(EVT.list.crawlComplete, () => {
      if (this.active) {
        this.setPhase('done')
      }
    })
    // crawlEmpty 晚於 crawlComplete：把「完成」改成「結果為空」
    EVT.on(EVT.list.crawlEmpty, () => {
      if (this.phase === 'done') {
        this.setPhase('empty')
      }
    })
  }

  /** 清零所有統計（新一輪抓取開始） */
  public reset(): void {
    this.phase = 'idle'
    this.target = ''
    this.targetPosts = 0
    this.pages = 0
    this.scanned = 0
    this.total = null
    this.kept = 0
    this.keptFiles = 0
    this.excluded = {}
    this.failed = 0
    this.startedAt = Date.now()
    this.endedAt = 0
    this.notify()
  }

  private setPhase(phase: CrawlPhase) {
    this.phase = phase
    if (!this.active) {
      this.endedAt = Date.now()
    }
    this.notify()
  }

  public setTarget(target: string): void {
    this.target = target
    this.notify()
  }

  public setTargetPosts(count: number): void {
    this.targetPosts = count
    this.notify()
  }

  public setTotal(total: number | null): void {
    this.total = total
    this.notify()
  }

  /** 取得了一頁列表 */
  public addPage(): void {
    this.pages++
    this.notify()
  }

  /** 開始檢查一帖 */
  public scan(): void {
    this.scanned++
    this.notify()
  }

  /** 該帖加入結果 */
  public keep(fileCount: number): void {
    this.kept++
    this.keptFiles += fileCount
    this.notify()
  }

  /** 該帖被篩選條件排除 */
  public exclude(reason: string): void {
    this.excluded[reason] = (this.excluded[reason] ?? 0) + 1
    this.notify()
  }

  /** 該帖取詳情失敗或因錯誤跳過 */
  public fail(): void {
    this.failed++
    this.notify()
  }

  private notify() {
    EVT.fire('crawlProgress')
  }
}

const crawlProgress = new CrawlProgress()
export { crawlProgress }
