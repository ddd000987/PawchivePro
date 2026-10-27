/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/crawl/InitPageBase.ts
 *          state machine concept (xuejianxianzun)
 *          + Kemono-Downloader post-resource.ts pending semantics
 * changes: rewritten for Kemono — creator pages paginate
 *          api.posts (o+=50, probe until short page; Pawchive has no
 *          total); post pages fetch one detail. List-level quick screen
 *          before detail fetch saves 429 budget. 429 → backoff 60s retry.
 */

import { api, ApiHttpError } from '../kemono/api'
import {
  isErrorResponse,
  isPendingPost,
  KemonoService,
} from '../kemono/apiTypes'
import { expandPost } from '../kemono/expand'
import { fileKind } from '../kemono/fileType'
import { detectPage, makePostKey } from '../kemono/pages'
import { EVT } from '../EVT'
import { filter, normalizePostIdBoundary } from '../filter/Filter'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { parsePostKey } from '../preview/previewAssets'
import { settings } from '../setting/Settings'
import { store } from '../store/Store'
import { states } from '../store/States'
import {
  IDData,
  KemonoFileKind,
  Result,
  ResultOptional,
} from '../store/StoreType'
import { sleepAbortable } from '../Tools'
import { crawlPause } from './CrawlPause'
import { crawlProgress, formatExcluded } from './CrawlProgress'

/** 創作者頁每頁筆數（API 固定 50） */
const PAGE_SIZE = 50
/**
 * 探測迴圈的最後安全上限（頁數）。
 * 正常的防呆靠「整頁無新帖 id」的重複偵測；這個上限只防偵測也失效的極端情況，
 * 所以設得很高，避免截斷真正的大創作者（50 筆 × 5000 頁 = 25 萬帖）。
 */
const MAX_PAGES = 5000
/** 429 退避等待（ms） */
const BACKOFF_429 = 60000
/** 429 單點最大重試次數 */
const RETRY_429_MAX = 3
/** 詳情 429 退避等待（ms，比列表短：單帖失敗只影響一帖） */
const BACKOFF_DETAIL_429 = 30000
/** 詳情 429 最大重試次數 */
const RETRY_DETAIL_429_MAX = 2
/** 列表暫時性錯誤（5xx／網路）最大重試次數 */
const RETRY_TRANSIENT_MAX = 3
/** 詳情暫時性錯誤（5xx／網路）最大重試次數 */
const RETRY_DETAIL_TRANSIENT_MAX = 2
/** 暫時性錯誤退避基數（ms；第 n 次重試等 BACKOFF_TRANSIENT * n） */
const BACKOFF_TRANSIENT = 5000

function quickKindOf(path: string, name?: string): KemonoFileKind {
  return fileKind({ path, name })
}

function parseHttpStatus(e: unknown): number {
  if (e instanceof ApiHttpError) {
    return e.status
  }
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/\b(403|404|429|5\d\d)\b/)
  return m ? parseInt(m[1], 10) : 0
}

/** 是否為 fetch 的網路層失敗（斷線／DNS／CORS 等，fetch 以 TypeError 拒絕） */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError
}

class Engine {
  /** 世代號：每輪抓取 +1，舊輪收尾時用來判斷是否已被取代 */
  private generation = 0
  /** 當前這輪抓取的中止控制器 */
  private controller: AbortController | null = null
  /** 當前這輪抓取的 promise（新一輪要等它收尾） */
  private running: Promise<void> | null = null

  constructor() {
    this.bindEvents()
  }

  private bindEvents() {
    // 縮圖下載鈕／等待佇列：給定 ID 列表，逐帖抓詳情入庫
    EVT.on(EVT.list.crawlIdList, (ev: CustomEventInit) => {
      const ids = ev.detail.data as IDData[]
      if (Array.isArray(ids) && ids.length > 0) {
        void this.crawlIds(ids)
      }
    })
    // Alt+Z：當前頁開始預設抓取
    EVT.on(EVT.list.commandStartDefaultCrawl, () => {
      void this.start()
    })
    // 停止抓取：立刻 abort 當前這輪（喚醒 sleep／fetch）
    EVT.on(EVT.list.stopCrawl, () => {
      this.controller?.abort()
    })
  }

  /**
   * 同一時間只允許一輪引擎執行：先等上一輪收尾，再開新世代。
   * body 內的停止判斷一律用 signal.aborted（新一輪的 crawlStart 會把
   * states.stopCrawl 改回 false，但舊 signal 永遠保持 aborted）。
   * onBusy：等完上一輪後若仍忙碌（別人搶先開跑）就走這裡排隊，
   * 且不動世代號與控制器，避免弄壞搶先者那一輪。
   */
  private async runExclusive(
    onBusy: () => void,
    body: (signal: AbortSignal, gen: number) => Promise<void>
  ): Promise<void> {
    // 迴圈等待：多個呼叫者同等一個 running 時，醒來後必須重新檢查
    while (this.running) {
      await this.running.catch(() => {})
    }
    // 以下到 body 啟動為止是同步區段（中間不可有 await），
    // 這樣檢查 busy、換世代、換控制器、登記 running 對其他呼叫者是原子的
    if (states.busy || states.hasDownloadTask) {
      onBusy()
      return
    }
    const gen = ++this.generation
    this.controller = new AbortController()
    const signal = this.controller.signal
    const running = body(signal, gen)
    this.running = running
    try {
      await running
    } finally {
      if (this.running === running) {
        this.running = null
      }
    }
  }

  /** 面板「開始抓取」入口 */
  public async start(): Promise<void> {
    // 等設定載入完成，否則會用預設值抓取（存檔的過濾條件被忽略）
    await states.waitSettingInitialized()
    if (states.busy || states.hasDownloadTask) {
      // 忙碌時統一排隊：目前任務（抓取或下載）結束後再開始整頁抓取
      store.waitingFullCrawl = true
      toast.show(lang.transl('_queuedCrawl'))
      return
    }
    const page = detectPage()
    if (page.kind === 'other') {
      toast.error(lang.transl('_unsupportedPage'))
      return
    }

    await this.runExclusive(
      () => {
        store.waitingFullCrawl = true
        toast.show(lang.transl('_queuedCrawl'))
      },
      async (signal, gen) => {
        // 面板發起的完整抓取：快取要存（與縮圖單帖快抓區分，見 crawlIds）
        states.quickCrawl = false
        EVT.fire('crawlStart')
        // crawlStart 會清零進度統計；之後才設目標（創作者名等 profile 回來再補）
        crawlProgress.setTarget(this.targetLabel(page.service, page.creatorId))
        log.log(
          lang.transl('_crawlStarted', `${location.host}${location.pathname}`)
        )

        try {
          if (page.kind === 'creator') {
            await this.crawlCreator(page.service, page.creatorId, signal)
          } else {
            await this.crawlPost(
              page.service,
              page.creatorId,
              page.postId,
              signal
            )
          }
        } catch (e) {
          if (!signal.aborted) {
            log.error(
              lang.transl(
                '_crawlAborted',
                e instanceof Error ? e.message : String(e)
              )
            )
          }
        }

        // 已被新一輪取代：不發收尾事件、不寫 store
        if (gen !== this.generation) {
          return
        }
        // 使用者中止：保留部分結果，但不記成「抓取完成」、也不標成成功
        if (signal.aborted) {
          log.warning(lang.transl('_crawlStoppedKeep'))
          this.finishStopped()
        } else if (store.resultMeta.length === 0) {
          this.finishEmpty()
        } else {
          this.finishDone()
        }
      }
    )
  }

  /** 縮圖下載鈕入口：逐帖取詳情 → 入庫 → 走正常下載管線 */
  public async crawlIds(idList: IDData[]): Promise<void> {
    await states.waitSettingInitialized()
    if (states.busy || states.hasDownloadTask) {
      // 忙碌中 → 排入等待佇列（下載完成後 DownloadControl 會重發 crawlIdList）
      store.waitingIdList.push(...idList)
      toast.show(lang.transl('_queuedN', String(idList.length)))
      return
    }

    await this.runExclusive(
      () => {
        store.waitingIdList.push(...idList)
        toast.show(lang.transl('_queuedN', String(idList.length)))
      },
      async (signal, gen) => {
        // 縮圖單帖快抓／等待佇列：抓取快取跳過這類（只存完整抓取的整批結果）
        states.quickCrawl = true
        EVT.fire('crawlStart')
        // ID 列表型抓取：目標是「N 帖」，總數已知
        crawlProgress.setTargetPosts(idList.length)
        crawlProgress.setTotal(idList.length)
        log.log(lang.transl('_crawlStarted', `${idList.length} posts`))

        // 同一創作者只查一次 profile（檔名用；失敗用 ID 代替，不中斷）
        const names = new Map<string, string>()
        const done: IDData[] = []
        try {
          for (const item of idList) {
            if (signal.aborted) {
              break
            }
            const info = parsePostKey(item.id)
            if (!info) {
              crawlProgress.scan()
              crawlProgress.fail()
              log.warning(
                lang.transl('_postDetailFailed', item.id, 'bad postKey')
              )
              continue
            }
            const ck = `${info.service}/${info.creatorId}`
            let creatorName = names.get(ck)
            if (creatorName === undefined) {
              creatorName = info.creatorId
              // 暫停中在這裡等；等待期間被停止就中止整輪
              if (!(await crawlPause.wait(signal))) {
                break
              }
              try {
                const profile = await api.profile(
                  {
                    service: info.service,
                    creatorId: info.creatorId,
                  },
                  signal
                )
                if (!isErrorResponse(profile)) {
                  creatorName = profile.name || creatorName
                }
              } catch (e) {
                if (!signal.aborted) {
                  log.warning(lang.transl('_profileFailed', String(e)))
                }
              }
              names.set(ck, creatorName)
            }
            const added = await this.crawlOnePost(
              info.service,
              info.creatorId,
              info.postId,
              creatorName,
              undefined,
              signal
            )
            if (added) {
              done.push(item)
            }
          }
        } catch (e) {
          if (!signal.aborted) {
            log.error(
              lang.transl(
                '_crawlAborted',
                e instanceof Error ? e.message : String(e)
              )
            )
          }
        }

        // 已被新一輪取代：不發收尾事件、不寫 store
        if (gen !== this.generation) {
          return
        }

        // 只登記實際處理過的 ID；停止時保留部分結果，但走中止收尾
        store.idList.push(...done)

        if (signal.aborted) {
          log.warning(lang.transl('_crawlStoppedKeep'))
          this.finishStopped()
        } else if (store.resultMeta.length === 0) {
          this.finishEmpty()
        } else {
          this.finishDone()
        }
      }
    )
  }

  /** 抓取收尾：空結果 */
  private finishEmpty(): void {
    EVT.fire('crawlComplete')
    EVT.fire('crawlEmpty')
    // 依統計說明為什麼是空的：沒找到帖子／全被篩選排除／取詳情失敗
    const msg = this.emptyMessage()
    log.warning(msg)
    // 不必翻日誌就能看到原因
    toast.warning(msg)
  }

  /** 抓取結果為空時的詳細說明（依 crawlProgress 統計） */
  private emptyMessage(): string {
    const { scanned, failed } = crawlProgress
    const excluded = crawlProgress.excludedTotal
    if (scanned === 0 || (excluded === 0 && failed === 0)) {
      return lang.transl('_crawlEmpty')
    }
    const detail = formatExcluded(crawlProgress.excluded)
    if (failed === 0) {
      return lang.transl('_crawlEmptyExcluded', String(scanned), detail)
    }
    if (excluded === 0) {
      return lang.transl('_crawlEmptyFailed', String(scanned))
    }
    return lang.transl(
      '_crawlEmptyMixed',
      String(scanned),
      String(excluded),
      detail,
      String(failed)
    )
  }

  /** 抓取目標的簡短標籤：有創作者名則「名字 (服務/ID)」，否則「服務/ID」 */
  private targetLabel(
    service: string,
    creatorId: string,
    name = creatorId
  ): string {
    const id = `${service}/${creatorId}`
    return name && name !== creatorId ? `${name} (${id})` : id
  }

  /** 抓取收尾：使用者中止（只發完成事件，讓 busy 收斂，不記成功） */
  private finishStopped(): void {
    EVT.fire('crawlComplete')
  }

  /** 抓取收尾：有結果 */
  private finishDone(): void {
    EVT.fire('crawlComplete')
    log.success(
      lang.transl(
        '_crawlComplete',
        String(store.resultMeta.length),
        String(store.result.length)
      )
    )
  }

  /** 創作者頁：分頁取列表 → 快篩 → 詳情 → 過濾 → 入庫 */
  private async crawlCreator(
    service: KemonoService,
    creatorId: string,
    signal: AbortSignal
  ): Promise<void> {
    // 服務過濾前置檢查：若當前服務被排除，直接中止，省掉整輪空跑
    const services = settings
      .get('filterServices')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (services.length > 0 && !services.includes(service.toLowerCase())) {
      toast.error(lang.transl('_serviceExcluded', service))
      log.warning(lang.transl('_serviceExcludedLog'))
      return
    }

    // 創作者名（檔名用；失敗則用 ID 代替，不中斷）
    let creatorName = creatorId
    // 暫停中在發請求前等待；等待期間被停止就直接收尾
    if (!(await crawlPause.wait(signal))) {
      return
    }
    try {
      const profile = await api.profile({ service, creatorId }, signal)
      if (!isErrorResponse(profile)) {
        creatorName = profile.name || creatorId
        crawlProgress.setTarget(
          this.targetLabel(service, creatorId, creatorName)
        )
        // Kemono 的 profile 有 post_count；Pawchive 沒有，維持未知
        if (typeof profile.post_count === 'number' && profile.post_count > 0) {
          crawlProgress.setTotal(profile.post_count)
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        log.warning(lang.transl('_profileFailed', String(e)))
      }
    }

    let offset = 0
    let pageNo = 0
    let backoffCount = 0
    let transientCount = 0
    // 本次列表已見過的帖子 id：API 若忽略 o= 會一直回同一頁，
    // 整頁都沒有新 id 就判定重複並停止，不必靠低頁數上限硬切
    const seenIds = new Set<string>()

    while (pageNo < MAX_PAGES) {
      if (signal.aborted) {
        return
      }

      // 暫停中在翻頁請求前等待（重試的 continue 也會回到這裡）
      if (!(await crawlPause.wait(signal))) {
        return
      }

      let items
      try {
        const res = await api.posts(
          {
            service,
            creatorId,
            index: offset,
          },
          signal
        )
        if (isErrorResponse(res)) {
          throw new Error(res.error)
        }
        items = res
        backoffCount = 0
        transientCount = 0
      } catch (e) {
        // 使用者中止造成的錯誤：安靜結束，不記失敗
        if (signal.aborted) {
          return
        }
        const status = parseHttpStatus(e)
        if (status !== 0) {
          EVT.fire('requestStatusError', { status, url: location.href })
        }
        if (status === 429 && backoffCount < RETRY_429_MAX) {
          backoffCount++
          log.warning(
            lang.transl(
              '_rateLimited',
              String(backoffCount),
              String(RETRY_429_MAX)
            )
          )
          if (!(await sleepAbortable(BACKOFF_429, signal))) {
            return
          }
          continue
        }
        // 5xx／網路抖動：有限次數重試（4xx 直接失敗）
        if (
          (status >= 500 || (status === 0 && isNetworkError(e))) &&
          transientCount < RETRY_TRANSIENT_MAX
        ) {
          transientCount++
          const delay = BACKOFF_TRANSIENT * transientCount
          log.warning(
            lang.transl(
              '_transientRetry',
              e instanceof Error ? e.message : String(e),
              String(delay / 1000),
              String(transientCount),
              String(RETRY_TRANSIENT_MAX)
            )
          )
          if (!(await sleepAbortable(delay, signal))) {
            return
          }
          continue
        }
        log.error(
          lang.transl('_listFailed', e instanceof Error ? e.message : String(e))
        )
        return
      }

      if (items.length === 0) {
        break
      }

      // 只處理沒見過的帖子（頁間若有重疊也不會重複入庫）
      const fresh = items.filter((it) => !seenIds.has(it.id))
      if (fresh.length === 0) {
        log.warning(lang.transl('_pageLoopDetected', String(offset)))
        return
      }
      for (const it of fresh) {
        seenIds.add(it.id)
      }
      crawlProgress.addPage()

      for (const it of fresh) {
        if (signal.aborted) {
          return
        }
        const attachments = (
          Array.isArray(it.attachments) ? it.attachments : []
        ).filter((a) => !!a?.path)
        // 與 expandPost 對齊：noCoverFile 時完整結果不會有封面
        const hasCover = !!it.file?.path && !settings.get('noCoverFile')
        const added = await this.crawlOnePost(
          it.service,
          it.user,
          it.id,
          creatorName,
          // 列表快篩資訊（省詳情請求）
          {
            title: it.title ?? '',
            published: it.published ?? '',
            fileCount: attachments.length + (hasCover ? 1 : 0),
            kinds: this.listKinds(attachments, hasCover),
            pending: isPendingPost(it),
          },
          signal
        )
        // idList 與 resultMeta 同口徑：只有真正入庫的帖子才登記
        if (added) {
          store.idList.push({
            id: makePostKey(it.service, it.user, it.id),
            type: 'post',
            title: it.title ?? '',
          })
        }
      }

      // 短頁 = 最後一頁
      if (items.length < PAGE_SIZE) {
        break
      }
      offset += PAGE_SIZE
      pageNo++
    }

    if (pageNo >= MAX_PAGES) {
      log.warning(lang.transl('_pageLimit', String(MAX_PAGES)))
    }
  }

  /** 帖子頁：單帖詳情 → 過濾 → 入庫 */
  private async crawlPost(
    service: KemonoService,
    creatorId: string,
    postId: string,
    signal: AbortSignal
  ): Promise<void> {
    let creatorName = creatorId
    // 暫停中在發請求前等待；等待期間被停止就直接收尾
    if (!(await crawlPause.wait(signal))) {
      return
    }
    crawlProgress.setTotal(1)
    try {
      const profile = await api.profile({ service, creatorId }, signal)
      if (!isErrorResponse(profile)) {
        creatorName = profile.name || creatorId
        crawlProgress.setTarget(
          this.targetLabel(service, creatorId, creatorName)
        )
      }
    } catch {
      /* 用 ID 代替 */
    }
    // 取 profile 期間可能已中止：不再發詳情請求
    if (signal.aborted) {
      return
    }
    const added = await this.crawlOnePost(
      service,
      creatorId,
      postId,
      creatorName,
      undefined,
      signal
    )
    if (added) {
      store.idList.push({
        id: makePostKey(service, creatorId, postId),
        type: 'post',
      })
    }
  }

  /** 列表項的附件種類集合（快篩用；含文字檔，與完整過濾對齊） */
  private listKinds(
    attachments: { path: string; name?: string }[],
    hasCover: boolean
  ): Set<KemonoFileKind> {
    const kinds = new Set<KemonoFileKind>()
    for (const a of attachments) {
      if (!a || !a.path) {
        continue
      }
      kinds.add(quickKindOf(a.path, a.name))
    }
    // 與 expandPost 對齊：noCoverFile 時完整結果不會有封面種類
    if (hasCover && !settings.get('noCoverFile')) {
      kinds.add('cover')
    }
    // 文字檔視為一種種類：若用戶只關附件種類、保留文字，帖子仍應通過快篩
    // （列表無 content，只能保守列入；與 filter.checkPost 收到完整 kinds 時一致）
    if (settings.get('textContent') !== 'none') {
      kinds.add('text')
    }
    return kinds
  }

  /** 單帖：列表快篩 → 詳情 → 完整過濾 → 入庫。回傳 true 表示真的入庫了 */
  private async crawlOnePost(
    service: KemonoService,
    creatorId: string,
    postId: string,
    creatorName: string,
    listInfo:
      | {
          title: string
          published: string
          fileCount: number
          kinds: Set<KemonoFileKind>
          pending: boolean
        }
      | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    // 進度統計：走到這裡就算檢查了一帖，之後必定落在 保留／排除／失敗 其中之一
    // （使用者中止的那一帖例外，不計）
    crawlProgress.scan()
    let postKey: string
    try {
      postKey = makePostKey(service, creatorId, postId)
    } catch (e) {
      // 未知 service 等非法零件：只跳過這一帖，不中斷整輪
      crawlProgress.fail()
      log.warning(
        lang.transl(
          '_postDetailFailed',
          `${service}/${creatorId}/${postId}`,
          e instanceof Error ? e.message : String(e)
        )
      )
      return false
    }

    // 列表快篩：不通過則省一次詳情請求
    if (listInfo) {
      // 快篩只做同步條件（標題/日期/數量/種類開關/pending/ID 範圍），
      // 去重（需 storage I/O）留給完整過濾。服務條件已在 crawlCreator 前置檢查
      const reason = this.quickScreen(listInfo, postId)
      if (reason) {
        crawlProgress.exclude(reason)
        return false
      }
    }

    // 取詳情（429 退避重試；5xx／網路有限重試；其他錯誤跳過該帖，不中斷整輪）
    let data
    {
      let backoffCount = 0
      let transientCount = 0
      for (;;) {
        // 暫停中在詳情請求前等待（重試的 continue 也會回到這裡）
        if (!(await crawlPause.wait(signal))) {
          return false
        }
        try {
          const res = await api.post({ service, creatorId, postId }, signal)
          if (isErrorResponse(res)) {
            throw new Error(res.error)
          }
          data = res
          break
        } catch (e) {
          // 使用者中止造成的錯誤：安靜結束，不記失敗
          if (signal.aborted) {
            return false
          }
          const status = parseHttpStatus(e)
          if (status !== 0) {
            EVT.fire('requestStatusError', { status, url: location.href })
          }
          if (status === 429 && backoffCount < RETRY_DETAIL_429_MAX) {
            backoffCount++
            log.warning(
              lang.transl(
                '_rateLimitedIn',
                String(BACKOFF_DETAIL_429 / 1000),
                String(backoffCount),
                String(RETRY_DETAIL_429_MAX)
              )
            )
            if (!(await sleepAbortable(BACKOFF_DETAIL_429, signal))) {
              return false
            }
            continue
          }
          // 5xx／網路抖動：有限次數重試（4xx 直接跳過）
          if (
            (status >= 500 || (status === 0 && isNetworkError(e))) &&
            transientCount < RETRY_DETAIL_TRANSIENT_MAX
          ) {
            transientCount++
            const delay = BACKOFF_TRANSIENT * transientCount
            log.warning(
              lang.transl(
                '_transientRetry',
                e instanceof Error ? e.message : String(e),
                String(delay / 1000),
                String(transientCount),
                String(RETRY_DETAIL_TRANSIENT_MAX)
              )
            )
            if (!(await sleepAbortable(delay, signal))) {
              return false
            }
            continue
          }
          crawlProgress.fail()
          log.error(
            lang.transl(
              '_postDetailFailed',
              postKey,
              e instanceof Error ? e.message : String(e)
            )
          )
          return false
        }
      }
    }

    // fetch 期間用戶可能已按停止：回包後再檢查一次，避免多漏入一帖
    if (signal.aborted) {
      return false
    }

    // 展開 + 完整過濾
    const { pending, files } = expandPost(data, creatorName)
    const kinds = new Set(files.map((f) => f.kind))

    // 入庫條目先建好：整帖去重的期望檔名與入庫用同一份，避免兩處展開不一致
    const meta: ResultOptional = {
      postKey,
      service,
      creator: creatorName,
      creatorId,
      postId,
      title: data.post.title ?? '',
      published: data.post.published ?? '',
      fileCount: files.filter((f) => f.kind !== 'text').length,
      pending,
    }
    const full: Result[] = files.map((f, i) => ({
      id: `${postKey}#${i}`,
      postKey,
      service,
      creator: creatorName,
      creatorId,
      postId,
      title: data.post.title ?? '',
      published: data.post.published ?? '',
      fileCount: files.filter((f) => f.kind !== 'text').length,
      pending,
      fileUrl: f.fileUrl,
      fileName: f.fileName,
      ext: f.ext,
      kind: f.kind,
      previewOnly: f.previewOnly,
      textData: f.textData,
      fileIndex: i,
    }))
    const ok = filter.checkPost({
      service,
      postId,
      title: data.post.title ?? '',
      published: data.post.published ?? '',
      fileCount: meta.fileCount ?? 0,
      kinds,
      pending,
    })
    if (!ok) {
      crawlProgress.exclude(filter.lastReason)
      return false
    }

    // 入庫前最後一次檢查：已中止就不入庫
    if (signal.aborted) {
      return false
    }

    // 入庫（full 已是完整 Result，addResult 的合併是冪等的）
    store.addResult(
      meta,
      full.map((f) => ({
        fileUrl: f.fileUrl,
        fileName: f.fileName,
        ext: f.ext,
        kind: f.kind,
        previewOnly: f.previewOnly,
        textData: f.textData,
      }))
    )
    crawlProgress.keep(full.length)
    return true
  }

  /** 列表快篩（同步條件 only；settings 直接讀，不碰 storage）。
   * 回傳排除原因（同 filter.lastReason 的命名），通過則回 null */
  private quickScreen(
    info: {
      title: string
      published: string
      fileCount: number
      kinds: Set<KemonoFileKind>
      pending: boolean
    },
    postId: string
  ): string | null {
    const keyword = settings.get('filterTitle').trim().toLowerCase()
    if (keyword && !info.title.toLowerCase().includes(keyword)) {
      return 'title'
    }
    if (info.published) {
      const date = info.published.slice(0, 10)
      const from = settings.get('filterDateFrom')
      const to = settings.get('filterDateTo')
      if ((from && date < from) || (to && date > to)) {
        return 'date'
      }
    }
    const min = settings.get('filterMinFiles')
    const max = settings.get('filterMaxFiles')
    if (
      (min > 0 && info.fileCount < min) ||
      (max > 0 && info.fileCount > max)
    ) {
      return 'fileCount'
    }
    if (!filter.hasAllowedKind(info.kinds)) {
      return 'kind'
    }
    if (info.pending && settings.get('skipPendingPosts')) {
      return 'pending'
    }
    const idFrom = normalizePostIdBoundary(settings.get('filterPostIdFrom'))
    const idTo = normalizePostIdBoundary(settings.get('filterPostIdTo'))
    if (idFrom && comparePostId(postId, idFrom) < 0) {
      return 'postId'
    }
    if (idTo && comparePostId(postId, idTo) > 0) {
      return 'postId'
    }
    return null
  }
}

/** 數字字串比較（先比長度再比字典序） */
function comparePostId(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}

const engine = new Engine()
export { engine }
