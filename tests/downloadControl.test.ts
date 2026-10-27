import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { eventNames } from '../src/EVT'

// ---- 會碰 DOM／外部狀態的模組 mock；Store/States/DownloadStates/EVT 用真的 ----
const m = vi.hoisted(() => ({
  /** 被建構的 Download 實例（記錄建構參數） */
  downloads: [] as {
    progressBarIndex: number
    data: any
    index: number
  }[],
  progressBar: {
    reset: vi.fn(),
    clear: vi.fn(),
    setTotalProgress: vi.fn(),
  },
  toast: { warning: vi.fn(), error: vi.fn(), show: vi.fn(), success: vi.fn() },
  log: {
    log: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  record: {
    checkDeduplication: vi.fn(async (_r: unknown) => false),
    addRecord: vi.fn(async (_r: unknown) => {}),
  },
  localFileCheck: {
    beginBatch: vi.fn(),
    prepare: vi.fn(async (_i: boolean) => true),
    existsMany: vi.fn(async (_p: string[]) => null as Set<string> | null),
  },
  settingValues: {} as Record<string, unknown>,
}))

vi.mock('../src/download/Download', () => ({
  Download: class {
    constructor(progressBarIndex: number, data: any, index: number) {
      m.downloads.push({ progressBarIndex, data, index })
    }
  },
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
  fileName: { createFileName: (r: any) => `${r.id}.png` },
}))
vi.mock('../src/download/DownloadRecord', () => ({ downloadRecord: m.record }))
vi.mock('../src/download/LocalFileCheck', () => ({
  localFileCheck: m.localFileCheck,
}))
vi.mock('../src/setting/Settings', () => ({
  settings: { get: (k: string) => m.settingValues[k] },
}))

const g = globalThis as any

type Mods = {
  EVT: typeof import('../src/EVT').EVT
  downloadControl: typeof import('../src/download/DownloadControl').downloadControl
  store: typeof import('../src/store/Store').store
  states: typeof import('../src/store/States').states
  downloadStates: typeof import('../src/download/DownloadStates').downloadStates
}
let mods: Mods
let onMessage: (msg: any) => void
const events: Record<string, any[]> = {}

function results(n: number): any[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `patreon/u1/1#${i}`,
    postKey: 'patreon/u1/1',
    fileUrl: `https://x/${i}.png`,
    ext: 'png',
    kind: 'image',
    fileIndex: i,
  }))
}

const id = (i: number) => `patreon/u1/1#${i}`
/** 後台回報儲存成功的回執 */
const downloaded = (i: number, taskBatch: number) => ({
  msg: 'downloaded',
  data: {
    id: id(i),
    taskBatch,
    blobURLFront: `blob:front/${i}`,
    blobURLBack: '',
    tabId: 1,
    uuid: false,
  },
})
const downloadErr = (
  i: number,
  taskBatch: number,
  extra: Record<string, unknown> = {}
) => ({
  msg: 'download_err',
  data: {
    id: id(i),
    taskBatch,
    blobURLFront: `blob:front/${i}`,
    blobURLBack: '',
    tabId: 1,
    uuid: false,
  },
  ...extra,
})

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

/** 載入 n 筆結果並開始下載，跑完執行緒建立 */
async function startWith(n: number) {
  mods.store.result = results(n)
  await mods.downloadControl.startDownload()
  await tick(1)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  m.downloads.length = 0
  for (const group of [
    m.progressBar,
    m.toast,
    m.log,
    m.record,
    m.localFileCheck,
  ]) {
    Object.values(group).forEach((f) => (f as any).mockClear())
  }
  m.record.checkDeduplication.mockImplementation(async () => false)
  m.localFileCheck.prepare.mockImplementation(async () => true)
  m.localFileCheck.existsMany.mockImplementation(async () => null)
  m.settingValues = {
    downloadThread: 3,
    skipDownloaded: 'none',
    autoStartDownload: false,
    setFileDownloadOrder: false,
  }

  g.chrome.runtime.sendMessage = vi.fn()
  g.chrome.runtime.onMessage = {
    addListener: (fn: (msg: any) => void) => {
      onMessage = fn
    },
  }
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  // EVT 是模組內的私有匯流排單例（監聽不會被清掉），所以每個測試重新載入模組
  // （States/Store/DownloadStates/DownloadControl 重新註冊自己的事件監聽），
  // 並在同一批 import 取得與它們相同的 EVT 實例
  vi.resetModules()
  const [
    { EVT },
    { downloadControl },
    { store },
    { states },
    { downloadStates },
  ] = await Promise.all([
    import('../src/EVT'),
    import('../src/download/DownloadControl'),
    import('../src/store/Store'),
    import('../src/store/States'),
    import('../src/download/DownloadStates'),
  ])
  mods = { EVT, downloadControl, store, states, downloadStates }
  states.settingInitialized = true

  for (const k of Object.keys(events)) delete events[k]
  for (const t of [
    'downloadStart',
    'downloadPause',
    'downloadStop',
    'downloadComplete',
    'saveFileError',
    'downloadSuccess',
  ]) {
    events[t] = []
    mods.EVT.on(t as eventNames, (ev) => events[t].push(ev.detail.data))
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DownloadControl：開始下載與執行緒', () => {
  it('startDownload 依 downloadThread 建立並發 Download，帶批次與進度條序號', async () => {
    await startWith(5)

    expect(events.downloadStart).toHaveLength(1)
    expect(m.downloads).toHaveLength(3)
    expect(m.downloads.map((d) => d.progressBarIndex)).toEqual([0, 1, 2])
    expect(m.downloads.map((d) => d.index)).toEqual([0, 1, 2])
    const batch = m.downloads[0].data.taskBatch
    expect(batch).toBeGreaterThan(0)
    for (const d of m.downloads) {
      expect(d.data.taskBatch).toBe(batch)
      expect(d.data.force).toBe(false)
      expect(d.data.cancelled()).toBe(false)
    }
    expect(m.downloads[1].data.id).toBe(id(1))
    expect(mods.downloadStates.states).toEqual([0, 0, 0, -1, -1])
  })

  it('剩餘任務少於執行緒數時，只建立需要的數量', async () => {
    await startWith(2)
    expect(m.downloads).toHaveLength(2)
  })

  it('沒有抓取結果 → 提示錯誤，不開始', async () => {
    await mods.downloadControl.startDownload()
    await tick(1)
    expect(m.toast.error).toHaveBeenCalled()
    expect(m.downloads).toHaveLength(0)
    expect(events.downloadStart).toHaveLength(0)
  })

  it('restartDownload：force 批次，且已完成的項目也回到未開始', async () => {
    await startWith(3)
    mods.downloadStates.setState(0, 1)
    mods.states.busy = false
    await mods.downloadControl.restartDownload()
    await tick(1)

    expect(m.downloads.slice(3)).toHaveLength(3)
    expect(m.downloads.slice(3).every((d) => d.data.force === true)).toBe(true)
    expect(m.downloads[3].index).toBe(0)
  })

  it('成功回執：標記完成、登記下載記錄、補上下一個檔案', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch

    onMessage(downloaded(0, batch))

    expect(mods.downloadStates.states).toEqual([1, 0, 0, 0, -1])
    expect(m.record.addRecord).toHaveBeenCalledTimes(1)
    expect((m.record.addRecord.mock.calls[0][0] as any).id).toBe(id(0))
    expect(events.downloadSuccess).toHaveLength(1)
    expect(m.downloads).toHaveLength(4)
    expect(m.downloads[3]).toMatchObject({ progressBarIndex: 0, index: 3 })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:front/0')
    expect(mods.store.remainingDownload).toBe(4)
  })

  it('全部完成 → 延後觸發 downloadComplete', async () => {
    await startWith(2)
    const batch = m.downloads[0].data.taskBatch
    onMessage(downloaded(0, batch))
    onMessage(downloaded(1, batch))
    expect(events.downloadComplete).toHaveLength(0) // setTimeout 0
    await tick(1)
    expect(events.downloadComplete).toHaveLength(1)
    expect(mods.states.busy).toBe(false)
  })

  it('非下載回執、批次不符的 download_err 一律忽略', async () => {
    await startWith(3)
    const before = m.downloads.length
    onMessage({ msg: 'click_icon' })
    onMessage(null)
    onMessage(downloadErr(0, 12345, { saveRequestFailed: true }))
    expect(events.downloadPause).toHaveLength(0)
    expect(events.saveFileError).toHaveLength(0)
    expect(m.downloads).toHaveLength(before)
  })
})

describe('DownloadControl：開始前比對（precheck）', () => {
  it('下載記錄命中的項目直接標成完成，不交給執行緒，也不寫記錄', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(
      async (r: any) => r.id === id(0) || r.id === id(1)
    )
    await startWith(4)

    expect(mods.downloadStates.states[0]).toBe(1)
    expect(mods.downloadStates.states[1]).toBe(1)
    // 只剩 2 個未完成 → 2 條執行緒，且指向 index 2、3
    expect(m.downloads.map((d) => d.index)).toEqual([2, 3])
    expect(m.record.addRecord).not.toHaveBeenCalled()
    expect(m.toast.show).toHaveBeenCalledWith(
      expect.stringContaining('_precheckSummary|2|0')
    )
    expect(mods.store.remainingDownload).toBe(2)
  })

  it('全部命中 → 不建立任何 Download，直接完成', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(async () => true)
    await startWith(2)

    expect(m.downloads).toHaveLength(0)
    expect(events.downloadComplete).toHaveLength(1)
  })

  it('全部命中：進度停在 N/N，不重設進度條成 0/N，也不提示「開始下載」', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(async () => true)
    await startWith(3)

    // 沒有執行緒、沒有「開始下載」提示
    expect(m.downloads).toHaveLength(0)
    expect(m.toast.show).not.toHaveBeenCalledWith('_downloadStarted')
    expect(m.toast.show).toHaveBeenCalledWith(
      expect.stringContaining('_precheckSummary|3|0')
    )
    // 總進度最後一次是 3；進度條沒被 reset（reset 會把已下載歸零成 0/N）
    const calls = m.progressBar.setTotalProgress.mock.calls
    expect(calls[calls.length - 1][0]).toBe(3)
    expect(m.progressBar.reset).not.toHaveBeenCalled()
    expect(events.downloadComplete).toHaveLength(1)
    expect(mods.states.busy).toBe(false)
  })

  it('部分命中時仍照常提示開始並建立執行緒', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(
      async (r: any) => r.id === id(0)
    )
    await startWith(3)

    expect(m.toast.show).toHaveBeenCalledWith('_downloadStarted')
    expect(m.progressBar.reset).toHaveBeenCalledWith(2, 1)
  })

  it('本機資料夾命中也算完成（整批只呼叫一次 existsMany）', async () => {
    m.settingValues.skipDownloaded = 'folder'
    m.localFileCheck.existsMany.mockImplementation(
      async () => new Set([`${id(2)}.png`])
    )
    await startWith(3)

    expect(m.localFileCheck.existsMany).toHaveBeenCalledTimes(1)
    expect(mods.downloadStates.states[2]).toBe(1)
    expect(m.downloads.map((d) => d.index)).toEqual([0, 1])
  })

  it('restartDownload（force）不做比對', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(async () => true)
    mods.store.result = results(2)
    await mods.downloadControl.restartDownload()
    await tick(1)

    expect(m.record.checkDeduplication).not.toHaveBeenCalled()
    expect(m.downloads).toHaveLength(2)
  })

  it('比對丟例外也不擋下載（當作沒命中）', async () => {
    m.settingValues.skipDownloaded = 'record'
    m.record.checkDeduplication.mockImplementation(async () => {
      throw new Error('boom')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await startWith(2)
    expect(m.downloads).toHaveLength(2)
  })
})

describe('DownloadControl：暫停與繼續', () => {
  it('暫停後再開始：0 退回 -1 接續下載，舊批次任務失效', async () => {
    await startWith(5)
    const oldBatch = m.downloads[0].data.taskBatch
    const oldCancelled = m.downloads[0].data.cancelled
    onMessage(downloaded(0, oldBatch))
    expect(mods.downloadStates.states).toEqual([1, 0, 0, 0, -1])

    mods.downloadControl.pauseDownload()
    expect(events.downloadPause).toHaveLength(1)
    expect(mods.states.busy).toBe(false)

    vi.setSystemTime(Date.now() + 5000) // 新批次號 = Date.now()，要和舊的不同
    await mods.downloadControl.startDownload()
    // 還沒建立執行緒前：在途的 0 已退回 -1，已完成的 1 保留
    expect(mods.downloadStates.states).toEqual([1, -1, -1, -1, -1])
    await tick(1)

    expect(oldCancelled()).toBe(true) // 舊 Download 看到批次已變 → 自行停手
    const fresh = m.downloads.slice(4) // 之前共 4 個（3 + 補 1）
    expect(fresh.map((d) => d.index)).toEqual([1, 2, 3])
    expect(fresh[0].data.taskBatch).not.toBe(oldBatch)
    expect(mods.downloadStates.states).toEqual([1, 0, 0, 0, -1])
  })

  it('暫停中不補新任務：完成回執只更新狀態', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch
    mods.downloadControl.pauseDownload()
    const before = m.downloads.length
    onMessage(downloaded(0, batch))
    expect(mods.downloadStates.states[0]).toBe(1)
    expect(m.downloads).toHaveLength(before)
  })

  it('未在下載中時 pauseDownload 不動作', () => {
    mods.store.result = results(2)
    mods.downloadControl.pauseDownload()
    expect(events.downloadPause).toHaveLength(0)
  })
})

describe('DownloadControl：停止', () => {
  it('stopDownload 歸零狀態與進度、批次作廢；遲到的成功回執只登記記錄不動進度', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch
    onMessage(downloaded(1, batch))
    m.record.addRecord.mockClear()
    const before = m.downloads.length

    mods.downloadControl.stopDownload()

    expect(events.downloadStop).toHaveLength(1)
    expect(mods.downloadStates.states).toEqual([-1, -1, -1, -1, -1])
    expect(mods.store.remainingDownload).toBe(5)
    expect(m.progressBar.clear).toHaveBeenCalled()
    expect(m.downloads[0].data.cancelled()).toBe(true)
    expect(mods.states.busy).toBe(false)

    // 停止後瀏覽器才存完 #2：仍要登記下載記錄，避免下次重下
    onMessage(downloaded(2, batch))
    expect(m.record.addRecord).toHaveBeenCalledTimes(1)
    expect((m.record.addRecord.mock.calls[0][0] as any).id).toBe(id(2))
    expect(mods.downloadStates.states).toEqual([-1, -1, -1, -1, -1])
    expect(m.downloads).toHaveLength(before) // 沒有補新任務
    expect(events.downloadSuccess).toHaveLength(1) // 只有停止前那次
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:front/2')
  })

  it('停止後遲到的 download_err 不影響狀態', async () => {
    await startWith(3)
    const batch = m.downloads[0].data.taskBatch
    mods.downloadControl.stopDownload()
    onMessage(downloadErr(0, batch, { err: 'SERVER_FAILED' }))
    await tick(10000)
    expect(events.saveFileError).toHaveLength(0)
    expect(m.downloads).toHaveLength(3)
  })

  it('沒有進行中的下載時 stopDownload 不處理', () => {
    mods.store.result = results(2)
    mods.downloadControl.stopDownload()
    expect(events.downloadStop).toHaveLength(0)
    expect(m.progressBar.clear).not.toHaveBeenCalled()
  })
})

describe('DownloadControl：download_err 回執', () => {
  it('USER_CANCELED → 當作跳過：標完成、不登記記錄、補下一個', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch

    onMessage(downloadErr(0, batch, { err: 'USER_CANCELED' }))

    expect(mods.downloadStates.states[0]).toBe(1)
    expect(m.record.addRecord).not.toHaveBeenCalled()
    expect(events.saveFileError).toHaveLength(0)
    expect(m.downloads).toHaveLength(4)
  })

  it('saveRequestFailed → 暫停下載並發 saveFileError', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch

    onMessage(
      downloadErr(0, batch, {
        saveRequestFailed: true,
        runtimeError: 'Invalid filename',
      })
    )

    expect(events.saveFileError).toHaveLength(1)
    expect(events.downloadPause).toHaveLength(1)
    expect(mods.downloadStates.states[0]).toBe(0) // 沒標完成
  })

  it('其他保存失敗 → 3 秒後把該檔復位並用同一條進度條重新下載', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch
    const before = m.downloads.length

    onMessage(downloadErr(1, batch, { err: 'SERVER_FAILED' }))
    expect(events.saveFileError).toHaveLength(1)

    await tick(2900)
    expect(m.downloads).toHaveLength(before)
    await tick(200)
    expect(m.downloads).toHaveLength(before + 1)
    expect(m.downloads[before]).toMatchObject({ progressBarIndex: 1, index: 1 })
    expect(m.downloads[before].data.taskBatch).toBe(batch)
  })

  it('等待重試期間被停止 → 不再重開', async () => {
    await startWith(5)
    const batch = m.downloads[0].data.taskBatch
    const before = m.downloads.length
    onMessage(downloadErr(1, batch, { err: 'SERVER_FAILED' }))
    mods.downloadControl.stopDownload()
    await tick(5000)
    expect(m.downloads).toHaveLength(before)
  })
})

describe('DownloadControl：失敗批次自動重試', () => {
  /** 讓目前所有在途檔案都回報 downloadError */
  function failAll(n: number) {
    for (let i = 0; i < n; i++) {
      mods.EVT.fire('downloadError', id(i))
    }
  }

  it('全數失敗 → 暫停，依 ERROR_RETRY_DELAYS 退避（30s、60s）後自動接續', async () => {
    await startWith(2)
    expect(m.downloads).toHaveLength(2)

    failAll(2)
    expect(events.downloadPause).toHaveLength(1)

    await tick(29_999)
    expect(m.downloads).toHaveLength(2)
    await tick(2) // 滿 30s 並讓 setTimeout(0) 建立執行緒
    expect(m.downloads).toHaveLength(4)
    expect(m.downloads.slice(2).map((d) => d.index)).toEqual([0, 1])
    expect(m.downloads[2].data.taskBatch).not.toBe(
      m.downloads[0].data.taskBatch
    )

    // 第二輪仍全失敗：等待時間加長為 60s（errorRetryCount 沒被自動重試清零）
    failAll(2)
    await tick(59_999)
    expect(m.downloads).toHaveLength(4)
    await tick(2)
    expect(m.downloads).toHaveLength(6)
  })

  it('退避等待期間用戶按暫停 → 醒來後保持暫停，不自動續跑', async () => {
    await startWith(2)
    failAll(2)
    mods.downloadControl.pauseDownload() // 記下用戶暫停意圖
    await tick(31_000)
    expect(m.downloads).toHaveLength(2)
  })

  it('退避等待期間重新抓取（crawlStart）→ 舊的重試作廢', async () => {
    await startWith(2)
    failAll(2)
    mods.EVT.fire('crawlStart')
    await tick(31_000)
    expect(m.downloads).toHaveLength(2)
  })

  it('重試用盡（3 次）後不再自動重開', async () => {
    await startWith(2)
    const delays = [30_000, 60_000, 120_000]
    for (const d of delays) {
      failAll(2)
      await tick(d + 5)
    }
    const count = m.downloads.length
    expect(count).toBe(8) // 初始 2 + 3 輪重開 × 2

    failAll(2)
    await tick(300_000)
    expect(m.downloads).toHaveLength(count)
    expect(m.log.error).toHaveBeenCalledWith(
      expect.stringContaining('_retryGiveUp')
    )
  })
})
