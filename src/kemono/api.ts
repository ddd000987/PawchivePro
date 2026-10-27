/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono-family/api.ts
 *   + src/modules/api/main.ts (apiRequest cache semantics)
 *   + src/sites/pawchive.ts (normalizePost)
 * changes: GM_xmlhttpRequest replaced with content-side native fetch
 *          (DNR opens CORS); cache simplified to in-memory Map
 *          with per-endpoint TTL (no IndexedDB; the cache dies with the page).
 *          Endpoints/headers/error shape unchanged.
 */

import { Config } from '../Config'
import { EVT } from '../EVT'
import { settings } from '../setting/Settings'
import { Queue } from '../utils/queue'
import {
  isErrorResponse,
  type APIErrorResponse,
  type KemonoService,
  type PostApiResponse,
  type PostInfo,
  type PostsApiResponse,
  type ProfileApiResponse,
} from './apiTypes'

/** Kemono 系 API 要求此 header（KD 實測要求） */
const KEMONO_API_HEADERS: HeadersInit = { Accept: 'text/css' }

/**
 * 全域 API 限流：
 * max 為同時進行上限；sleep 為相鄰請求的「啟動」間隔，
 * 即使 max > 1 也不會同時突發（第一個請求立即執行）。
 */
const queueApi = new Queue({
  max: Config.apiConcurrency,
  sleep: Config.apiInterval,
})

/**
 * 記憶體快取（key = URL；照抄 KD apiRequest 快取語義的簡化版）
 * TTL 依端點分級（變動頻率不同）：profile 少變給長、
 * posts 列表會隨新帖出現給短、單帖詳情居中。TTL 隨條目存放。
 * 上限 CACHE_MAX 筆；Map 插入順序即新舊順序，命中時刪了重插（LRU），超量刪最舊。
 * 快取內只存 clone，且每次回給呼叫者的都是新 clone，避免下游改動污染快取。
 */
const TTL_PROFILE = 6 * 60 * 60 * 1000
const TTL_POSTS = 10 * 60 * 1000
const TTL_POST = 60 * 60 * 1000
const CACHE_MAX = 500
const memCache = new Map<string, { at: number; ttl: number; data: unknown }>()

/**
 * 在途請求合併：同 URL 且 signal 相同（含同為 undefined）時共用同一個 promise。
 * signal 不同則不共用、照常另發請求——否則第一個呼叫者 abort 會連帶讓第二個失敗。
 */
const inflight = new Map<
  string,
  { signal: AbortSignal | undefined; promise: Promise<unknown> }
>()

/** API 回應非 2xx 時拋出的錯誤（網路錯誤/abort 則原樣往上拋） */
class ApiHttpError extends Error {
  status: number
  url: string

  constructor(status: number, url: string, message: string) {
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    this.url = url
  }
}

async function fetchJson<T>(
  url: string,
  ttl: number,
  signal?: AbortSignal
): Promise<T | APIErrorResponse> {
  const cached = memCache.get(url)
  if (cached) {
    if (Date.now() - cached.at < cached.ttl) {
      // LRU：命中後刪了重插，移到最新
      memCache.delete(url)
      memCache.set(url, cached)
      return structuredClone(cached.data) as T
    }
    // 過期：讀取時順手刪除
    memCache.delete(url)
  }
  const pending = inflight.get(url)
  if (pending && pending.signal === signal) {
    // 共用結果也要 clone，各呼叫者互不影響
    return structuredClone(await pending.promise) as T | APIErrorResponse
  }
  const promise = requestJson<T>(url, ttl, signal)
  // 只有第一個（未被佔用的）請求登記為在途；結束後只移除自己
  const entry = pending ? undefined : { signal, promise }
  if (entry) inflight.set(url, entry)
  try {
    return structuredClone(await promise) as T | APIErrorResponse
  } finally {
    if (entry && inflight.get(url) === entry) inflight.delete(url)
  }
}

/** 實際發請求並寫入快取（存 clone） */
async function requestJson<T>(
  url: string,
  ttl: number,
  signal?: AbortSignal
): Promise<T | APIErrorResponse> {
  const data = await queueApi.enqueue(async (s) => {
    const res = await fetch(url, { headers: KEMONO_API_HEADERS, signal: s })
    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        if (body && typeof body.error === 'string') detail = `: ${body.error}`
      } catch {
        // body 不是 JSON 或已耗盡：忽略，沿用簡短訊息
      }
      throw new ApiHttpError(
        res.status,
        url,
        `HTTP ${res.status}${detail} (${url})`
      )
    }
    return (await res.json()) as T | APIErrorResponse
  }, signal)
  if (!isErrorResponse(data)) {
    memCache.set(url, { at: Date.now(), ttl, data: structuredClone(data) })
    // 超過上限：刪最舊（Map 第一個 key）
    while (memCache.size > CACHE_MAX) {
      memCache.delete(memCache.keys().next().value as string)
    }
  }
  return data
}

/**
 * Pawchive 扁平詳情 → canonical PostApiResponse
 * （已有 canonical 即直返；照抄 KD pawchive.ts normalizePost）
 */
// 回包形狀未知（兩站結構不同），函式內逐欄檢查後才組成 canonical
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePost(raw: any): PostApiResponse | APIErrorResponse {
  if (isErrorResponse(raw)) return raw
  // null／非物件無法補成 canonical，直接回錯誤形狀（避免讀 raw.attachments 崩潰）
  if (!raw || typeof raw !== 'object') {
    return { error: 'invalid post response' }
  }
  // 已是 canonical（頂層有 post）：附件以頂層 attachments 為準
  if (Object.hasOwn(raw, 'post')) {
    if (!raw.post || typeof raw.post !== 'object') {
      return { error: 'invalid post response' }
    }
    return raw
  }
  // 扁平回包：把整個物件當 post，附件取自頂層 attachments
  return {
    post: raw,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    previews: undefined,
    props: undefined,
  }
}

export interface PostsQuery {
  service: KemonoService
  creatorId: string
  /** offset（50 筆一頁，呼叫端控制） */
  index?: number
  /** 關鍵字（有才帶；Pawchive 要求 length >= 3） */
  query?: string
}

export interface ProfileQuery {
  service: KemonoService
  creatorId: string
}

const api = {
  async profile(
    { service, creatorId }: ProfileQuery,
    signal?: AbortSignal
  ): Promise<ProfileApiResponse | APIErrorResponse> {
    const url = `https://${location.host}/api/v1/${service}/user/${creatorId}/profile`
    return fetchJson<ProfileApiResponse>(url, TTL_PROFILE, signal)
  },

  async posts(
    { service, creatorId, index, query }: PostsQuery,
    signal?: AbortSignal
  ): Promise<PostsApiResponse | APIErrorResponse> {
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      throw new Error('invalid offset: ' + index)
    }
    const url = new URL(
      `https://${location.host}/api/v1/${service}/user/${creatorId}/posts`
    )
    if (typeof index === 'number') url.searchParams.set('o', index.toString())
    if (typeof query === 'string' && query) url.searchParams.set('q', query)
    return fetchJson<PostsApiResponse>(url.href, TTL_POSTS, signal)
  },

  async post(
    info: PostInfo,
    signal?: AbortSignal
  ): Promise<PostApiResponse | APIErrorResponse> {
    const url = `https://${location.host}/api/v1/${info.service}/user/${info.creatorId}/post/${info.postId}`
    const data = await fetchJson<unknown>(url, TTL_POST, signal)
    return normalizePost(data)
  },

  isErrorResponse,
}

/** 抓取間隔（秒）→ 佇列 sleep（ms）；面板修改即時生效，抓取中途改也吃新值 */
function applyCrawlInterval(v: unknown): void {
  const s =
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(Math.max(v, 0), 10)
      : Config.apiInterval / 1000
  queueApi.updateConfig({ sleep: Math.round(s * 1000) })
}

// restore() 直接寫 store 不發 settingChange：啟動時用存檔值套一次
EVT.on(EVT.list.settingInitialized, () => {
  applyCrawlInterval(settings.get('crawlInterval'))
})
EVT.on(EVT.list.settingChange, (ev: CustomEventInit) => {
  const data = ev.detail.data as { key?: string; value?: unknown }
  if (data.key === 'crawlInterval') {
    applyCrawlInterval(data.value)
  }
})

export { api, queueApi, normalizePost, ApiHttpError }
