import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- 會碰 DOM／外部狀態的模組一律 mock ----
const m = vi.hoisted(() => ({
  progressBar: {
    setProgress: vi.fn(),
    setProgressThrottle: vi.fn(),
    errorColor: vi.fn(),
  },
  toast: { warning: vi.fn(), error: vi.fn(), show: vi.fn(), success: vi.fn() },
  log: {
    log: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  filter: {
    isKindAllowed: vi.fn((_k: string) => true),
    checkFileSize: vi.fn((_s: number) => true),
  },
  record: { checkDeduplication: vi.fn(async (_r: unknown) => false) },
  states: { downloading: true },
  settings: { get: vi.fn((_k: string): unknown => false) },
}))

vi.mock('../src/download/ProgressBar', () => ({ progressBar: m.progressBar }))
vi.mock('../src/Toast', () => ({ toast: m.toast }))
vi.mock('../src/Log', () => ({ log: m.log }))
vi.mock('../src/Language', () => ({
  lang: {
    transl: (key: string, ...args: string[]) => [key, ...args].join('|'),
  },
}))
vi.mock('../src/filename/FileName', () => ({
  fileName: { createFileName: (r: any) => `${r.id}.${r.ext}` },
}))
vi.mock('../src/filter/Filter', () => ({ filter: m.filter }))
vi.mock('../src/download/DownloadRecord', () => ({
  downloadRecord: m.record,
}))
// 下載間隔：不等待，只尊重 cancelled（與真實實作的取消語義一致）
vi.mock('../src/download/DownloadInterval', () => ({
  downloadInterval: { wait: async (c: () => boolean = () => false) => !c() },
}))
vi.mock('../src/setting/Settings', () => ({ settings: m.settings }))
vi.mock('../src/store/States', () => ({ states: m.states }))

import { Config } from '../src/Config'
import { EVT, type eventNames } from '../src/EVT'
import { Download } from '../src/download/Download'

// ---- 輔助 ----
const g = globalThis as any

function abortError() {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

interface RespOpts {
  status?: number
  headers?: Record<string, string>
  chunks?: Uint8Array[]
  /** chunks 讀完後不結束，永遠卡住（直到 signal abort） */
  stallBody?: boolean
  signal?: AbortSignal
}

/** 手工 Response：不依賴 undici／真實 stream，完全由測試控制 */
function fakeResponse(o: RespOpts = {}) {
  const status = o.status ?? 200
  const headers = new Map(
    Object.entries(o.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  )
  const queue = [...(o.chunks ?? [])]
  const reader = {
    read: vi.fn((): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (queue.length) {
        return Promise.resolve({ done: false, value: queue.shift()! })
      }
      if (o.stallBody) {
        return new Promise((_, reject) => {
          if (o.signal?.aborted) return reject(abortError())
          o.signal?.addEventListener('abort', () => reject(abortError()))
        })
      }
      return Promise.resolve({ done: true })
    }),
    cancel: vi.fn(async () => {}),
  }
  const body = { getReader: vi.fn(() => reader) }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body,
    reader,
  }
}

type FetchImpl = (url: string, init: { signal: AbortSignal }) => Promise<any>
let fetchMock: ReturnType<typeof vi.fn>
function setFetch(...impls: FetchImpl[]) {
  // 依序使用；最後一個重複使用
  let i = 0
  fetchMock.mockImplementation((url: string, init: { signal: AbortSignal }) => {
    const impl = impls[Math.min(i++, impls.length - 1)]
    return impl(url, init)
  })
}
const okFetch =
  (
    chunks = [new Uint8Array(3), new Uint8Array(3)],
    headers: Record<string, string> = {}
  ): FetchImpl =>
  (_u, init) =>
    Promise.resolve(
      fakeResponse({
        chunks,
        headers: {
          'Content-Length': '6',
          'Content-Type': 'image/png; x=y',
          ...headers,
        },
        signal: init.signal,
      })
    )
const statusFetch =
  (status: number, headers: Record<string, string> = {}): FetchImpl =>
  (_u, init) =>
    Promise.resolve(fakeResponse({ status, headers, signal: init.signal }))

/** 一直等不到回應，直到 abort 才以 AbortError 結束 */
const hangingFetch: FetchImpl = (_u, init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(abortError()))
  })

function result(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'patreon/u1/1#0',
    postKey: 'patreon/u1/1',
    fileUrl: 'https://n1.kemono.su/data/ab/cd/x.png',
    ext: 'png',
    kind: 'image',
    textData: '',
    ...overrides,
  }
}

function arg(overrides: Record<string, unknown> = {}): any {
  const r = result()
  return {
    id: r.id,
    result: r,
    index: 0,
    progressBarIndex: 0,
    taskBatch: 7,
    ...overrides,
  }
}

const events: Record<string, any[]> = {}
// EVT 的私有匯流排不會被 setup.ts 清空，監聽只註冊一次（push 時才查當下的陣列）
const recorded = new Set<string>()
function record(...types: eventNames[]) {
  for (const t of types) {
    events[t] = []
    if (recorded.has(t)) continue
    recorded.add(t)
    EVT.on(t, (ev) => events[t].push(ev.detail.data))
  }
}

/** 推進假時間並讓 promise 鏈跑完 */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

function start(a = arg()) {
  new Download(0, a, 0)
  return a
}

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  sendMessage = vi.fn()
  g.chrome.runtime.sendMessage = sendMessage
  g.chrome.extension = { inIncognitoContext: false }
  m.states.downloading = true
  m.settings.get.mockImplementation(() => false)
  m.filter.isKindAllowed.mockImplementation(() => true)
  m.filter.checkFileSize.mockImplementation(() => true)
  m.record.checkDeduplication.mockImplementation(async () => false)
  for (const group of [m.progressBar, m.toast, m.log]) {
    Object.values(group).forEach((f) => f.mockClear())
  }
  for (const k of Object.keys(events)) delete events[k]
  record(
    'skipDownload',
    'downloadError',
    'sendBrowserDownload',
    'requestPauseDownload'
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Download：成功路徑', () => {
  it('fetch 成功 → 送 save_work_file（含 blobURL）並觸發 sendBrowserDownload', async () => {
    setFetch(okFetch())
    start()
    await tick(10)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://n1.kemono.su/data/ab/cd/x.png'
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const sent = sendMessage.mock.calls[0][0]
    expect(sent).toMatchObject({
      msg: 'save_work_file',
      fileName: 'patreon/u1/1#0.png',
      id: 'patreon/u1/1#0',
      taskBatch: 7,
    })
    expect(sent.blobURL).toMatch(/^blob:/)
    expect(sent.dataURL).toBeUndefined()
    expect(sent.url).toBeUndefined()
    expect(events.sendBrowserDownload).toEqual([
      { id: 'patreon/u1/1#0', fileName: 'patreon/u1/1#0.png' },
    ])
    expect(m.progressBar.errorColor).toHaveBeenLastCalledWith(0, false)
    expect(events.skipDownload).toHaveLength(0)
    expect(events.downloadError).toHaveLength(0)
  })

  it('非文字項缺 fileUrl：不 fetch，skipDownload（noUrl）並記警告', async () => {
    start(arg({ result: result({ fileUrl: '' }) }))
    await tick(10)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.skipDownload).toEqual([
      { id: 'patreon/u1/1#0', type: 'image', reason: 'noUrl' },
    ])
    expect(m.log.warning).toHaveBeenCalledWith(
      expect.stringContaining('_missingFileUrl'),
      'skip-noUrl'
    )
  })

  it('kind=text：不 fetch，直接用 textData 生成 blob 並送出', async () => {
    start(
      arg({ result: result({ kind: 'text', ext: 'txt', textData: 'hello' }) })
    )
    await tick(10)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0].blobURL).toMatch(/^blob:/)
    expect(sendMessage.mock.calls[0][0].fileName).toBe('patreon/u1/1#0.txt')
  })

  it('Content-Length 超過直下門檻 → 不讀 body，改送帶 url 的直下訊息', async () => {
    const resp = {
      value: undefined as ReturnType<typeof fakeResponse> | undefined,
    }
    setFetch((_u, init) => {
      resp.value = fakeResponse({
        headers: {
          'Content-Length': String(Config.directDownloadThreshold + 1),
        },
        signal: init.signal,
      })
      return Promise.resolve(resp.value)
    })
    start()
    await tick(10)

    expect(resp.value!.body.getReader).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const sent = sendMessage.mock.calls[0][0]
    expect(sent).toMatchObject({
      msg: 'save_work_file',
      url: 'https://n1.kemono.su/data/ab/cd/x.png',
    })
    expect(sent.blobURL).toBeUndefined()
    expect(events.sendBrowserDownload).toHaveLength(1)
  })

  it('隱身模式用較低門檻（32MiB 以上即直下）', async () => {
    g.chrome.extension.inIncognitoContext = true
    setFetch((_u, init) =>
      Promise.resolve(
        fakeResponse({
          headers: {
            'Content-Length': String(
              Config.directDownloadThresholdIncognito + 1
            ),
          },
          signal: init.signal,
        })
      )
    )
    start()
    await tick(10)

    expect(sendMessage.mock.calls[0][0].url).toBe(
      'https://n1.kemono.su/data/ab/cd/x.png'
    )
  })
})

describe('Download：跳過與過濾', () => {
  it('下載記錄重複 → skip duplicate；force 批次不查重', async () => {
    m.record.checkDeduplication.mockImplementation(async () => true)
    start()
    await tick(10)
    expect(events.skipDownload).toEqual([
      { id: 'patreon/u1/1#0', type: 'image', reason: 'duplicate' },
    ])
    expect(fetchMock).not.toHaveBeenCalled()

    setFetch(okFetch())
    start(arg({ force: true }))
    await tick(10)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('種類被關閉 → skip excludedType，不 fetch', async () => {
    m.filter.isKindAllowed.mockImplementation(() => false)
    start()
    await tick(10)
    expect(events.skipDownload[0]).toMatchObject({ reason: 'excludedType' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Content-Length 超過體積上限 → skip size，不讀 body、不送訊息', async () => {
    m.filter.checkFileSize.mockImplementation(() => false)
    setFetch(okFetch())
    start()
    await tick(10)
    expect(events.skipDownload[0]).toMatchObject({ reason: 'size' })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('Download：錯誤與重試', () => {
  it('404 → skip 4xx，不重試', async () => {
    setFetch(statusFetch(404))
    start()
    await tick(60000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events.skipDownload).toEqual([
      { id: 'patreon/u1/1#0', reason: '4xx' },
    ])
    expect(events.downloadError).toHaveLength(0)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(m.progressBar.errorColor).toHaveBeenCalledWith(0, true)
  })

  it('429 屬可重試：依 Retry-After 退避後再試一次並成功', async () => {
    setFetch(statusFetch(429, { 'Retry-After': '5' }), okFetch())
    start()
    await tick(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await tick(4000) // 還沒到 5 秒
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events.skipDownload).toHaveLength(0)
  })

  it('503 後 200：退避 2 秒重試一次即成功，不觸發 downloadError', async () => {
    setFetch(statusFetch(503), okFetch())
    start()
    await tick(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sendMessage).not.toHaveBeenCalled()

    await tick(1900)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 退避未滿
    await tick(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events.downloadError).toHaveLength(0)
  })

  it('持續 503 → 共嘗試 Config.retryMax 次後觸發 downloadError', async () => {
    setFetch(statusFetch(503))
    start()
    await tick(120000)

    expect(fetchMock).toHaveBeenCalledTimes(Config.retryMax)
    expect(events.downloadError).toEqual(['patreon/u1/1#0'])
    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.requestPauseDownload).toHaveLength(0)
  })

  it('網路錯誤秒失敗達上限 → 視為磁碟／網路異常，請求暫停而非 downloadError', async () => {
    setFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    start()
    await tick(120000)

    expect(fetchMock).toHaveBeenCalledTimes(Config.retryMax)
    expect(events.requestPauseDownload).toHaveLength(1)
    expect(events.downloadError).toHaveLength(0)
  })

  it('網路錯誤但每次都耗時很久（>10s）→ 走 downloadError', async () => {
    setFetch(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new TypeError('Failed to fetch')), 11000)
        })
    )
    start()
    await tick(200000)

    expect(fetchMock).toHaveBeenCalledTimes(Config.retryMax)
    expect(events.downloadError).toEqual(['patreon/u1/1#0'])
    expect(events.requestPauseDownload).toHaveLength(0)
  })
})

describe('Download：停滯偵測', () => {
  it('等不到回應 → 滿 stallTimeoutMs 後中斷並重試，之後成功', async () => {
    setFetch(hangingFetch, okFetch())
    start()
    await tick(Config.stallTimeoutMs - 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.toast.warning).not.toHaveBeenCalled()

    await tick(1000) // 觸發停滯 → abort → 進入退避
    expect(m.toast.warning).toHaveBeenCalledTimes(1)
    expect(m.toast.warning.mock.calls[0][0]).toContain(
      '_downloadStalledNoResponse'
    )
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)

    await tick(2500) // 退避 2 秒
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events.downloadError).toHaveLength(0)
    expect(events.skipDownload).toHaveLength(0)
  })

  it('收到部分資料後 body 卡住 → 同樣中斷重試，提示含「已讀」階段', async () => {
    setFetch(
      (_u, init) =>
        Promise.resolve(
          fakeResponse({
            headers: { 'Content-Length': '100' },
            chunks: [new Uint8Array(10)],
            stallBody: true,
            signal: init.signal,
          })
        ),
      okFetch()
    )
    start()
    await tick(Config.stallTimeoutMs + 100)
    expect(m.toast.warning.mock.calls[0][0]).toContain('_downloadStalled|')
    expect(m.toast.warning.mock.calls[0][0]).not.toContain('NoResponse')

    await tick(2500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('持續停滯 → 重試用盡後 downloadError（停滯當網路錯誤，但耗時 >10s 不觸發暫停）', async () => {
    setFetch(hangingFetch)
    start()
    await tick(400000)
    expect(fetchMock).toHaveBeenCalledTimes(Config.retryMax)
    expect(events.downloadError).toEqual(['patreon/u1/1#0'])
    expect(events.requestPauseDownload).toHaveLength(0)
  })
})

describe('Download：取消', () => {
  it('暫停事件立即中斷在途請求，且不重試、不送訊息', async () => {
    setFetch(hangingFetch)
    start()
    await tick(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    EVT.fire('downloadPause')
    await tick(60000)

    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.downloadError).toHaveLength(0)
    expect(events.skipDownload).toHaveLength(0)
  })

  it('停止事件同樣中斷在途請求', async () => {
    setFetch(hangingFetch)
    start()
    await tick(10)
    EVT.fire('downloadStop')
    await tick(60000)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('states.downloading 變 false（已停止）→ 回應到了也不送訊息', async () => {
    let release!: (r: any) => void
    setFetch(
      (_u, init) =>
        new Promise((res) => {
          release = () =>
            res(
              fakeResponse({
                chunks: [new Uint8Array(3)],
                headers: { 'Content-Length': '3' },
                signal: init.signal,
              })
            )
        })
    )
    start()
    await tick(10)
    m.states.downloading = false
    release(undefined)
    await tick(10)

    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.sendBrowserDownload).toHaveLength(0)
  })

  it('舊批次（cancelled() 為 true）：fetch 前就停手，且不發事件、不寫進度條', async () => {
    start(arg({ cancelled: () => true }))
    await tick(60000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.skipDownload).toHaveLength(0)
    expect(m.progressBar.setProgress).not.toHaveBeenCalled()
    expect(m.progressBar.setProgressThrottle).not.toHaveBeenCalled()
  })

  it('下載途中變成舊批次 → 讀完也不送訊息、被跳過時也不發 skipDownload', async () => {
    let stale = false
    let release!: () => void
    setFetch(
      (_u, init) =>
        new Promise((res) => {
          release = () =>
            res(
              fakeResponse({
                chunks: [new Uint8Array(3)],
                headers: { 'Content-Length': '3' },
                signal: init.signal,
              })
            )
        })
    )
    start(arg({ cancelled: () => stale }))
    await tick(10)
    stale = true
    release()
    await tick(10)

    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.skipDownload).toHaveLength(0)
  })
})
