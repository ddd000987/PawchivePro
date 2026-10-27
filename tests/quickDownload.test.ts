import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- 會碰 DOM／網路／儲存的模組一律 mock ----
const m = vi.hoisted(() => ({
  events: [] as string[],
  toast: { show: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  log: { log: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
  api: {
    post: vi.fn(),
    profile: vi.fn(),
    isErrorResponse: (d: any) => !!d && typeof d === 'object' && 'error' in d,
  },
  interval: { wait: vi.fn(async () => true) },
  settings: {
    get: vi.fn((k: string): unknown => {
      const map: Record<string, unknown> = {
        textContent: 'none',
        noCoverFile: true,
        downloadOriginalImage: true,
        skipDownloaded: 'none',
      }
      return map[k]
    }),
  },
}))

vi.mock('../src/Toast', () => ({ toast: m.toast }))
vi.mock('../src/Log', () => ({ log: m.log }))
vi.mock('../src/Language', () => ({
  lang: {
    transl: (key: string, ...args: string[]) => [key, ...args].join('|'),
  },
}))
vi.mock('../src/kemono/api', () => ({ api: m.api }))
vi.mock('../src/setting/Settings', () => ({ settings: m.settings }))
vi.mock('../src/filter/Filter', () => ({
  filter: { isKindAllowed: () => true, checkFileSize: () => true },
}))
vi.mock('../src/filename/FileName', () => ({
  fileName: { createFileName: (r: any) => `${r.id}.${r.ext}` },
}))
vi.mock('../src/download/DownloadRecord', () => ({
  downloadRecord: { checkDeduplication: async () => false },
}))
vi.mock('../src/download/DownloadInterval', () => ({
  downloadInterval: m.interval,
}))
vi.mock('../src/download/LocalFileCheck', () => ({
  localFileCheck: {
    prepare: async () => true,
    beginBatch: () => {},
    exists: async () => null,
  },
}))

beforeAll(() => {
  ;(globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(async () => {}),
    },
    extension: { inIncognitoContext: false },
  }
})

describe('matchFileByPath', () => {
  it('以 pathname 全等比對，避免子字串誤配', async () => {
    const { matchFileByPath } = await import('../src/download/quickDownload')

    const files = [
      { fileUrl: 'https://img.kemono.su/thumbnail/data/ab/cd/x.png' },
      { fileUrl: 'https://n1.kemono.su/data/ab/cd/xx.png' },
      { fileUrl: 'https://n1.kemono.su/data/zz/ab/cd/x.png' },
    ] as any

    expect(matchFileByPath(files, '/ab/cd/x.png')).toBe(0)
    expect(matchFileByPath(files, '/zz/ab/cd/x.png')).toBe(2)
    expect(matchFileByPath(files, '/ab/cd/xx.png')).toBe(1)
  })

  it('無法解析或空 URL 直接跳過', async () => {
    const { matchFileByPath } = await import('../src/download/quickDownload')

    expect(
      matchFileByPath([{ fileUrl: 'not a url' }] as any, '/ab/cd/x.png')
    ).toBe(-1)
    expect(matchFileByPath([{ fileUrl: '' }] as any, '/ab/cd/x.png')).toBe(-1)
  })
})

describe('快下串行佇列', () => {
  /** 讓出事件迴圈，等 await 鏈跑完 */
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  /** 手工 Response：沒有 body reader，走 res.blob() 路徑 */
  const okRes = () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    blob: async () => new Blob(['x']),
  })

  beforeEach(() => {
    m.events.length = 0
    m.toast.show.mockClear()
    m.interval.wait.mockClear()
    m.interval.wait.mockImplementation(async () => {
      m.events.push('wait')
      return true
    })
    m.api.post.mockReset()
    m.api.profile.mockReset()
    m.api.post.mockResolvedValue({
      post: {
        id: '1',
        user: 'u1',
        service: 'patreon',
        title: 't',
        content: '',
        file: {},
        attachments: [{ name: 'a.png', path: '/a/a.png' }],
        published: '2024-01-01T00:00:00',
      },
      attachments: [],
    })
    m.api.profile.mockResolvedValue({ name: 'Creator' })
    ;(globalThis as any).chrome.runtime.sendMessage = vi.fn(async () => {
      m.events.push('send')
    })
    ;(globalThis as any).URL.createObjectURL = () => 'blob:test'
  })

  it('連按兩次：第二組等第一組整組送完才開始 fetch，並提示排隊', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let call = 0
    const fetchMock = vi.fn(async () => {
      const n = ++call
      m.events.push(`fetch${n}`)
      // 第一組的 fetch 卡住，直到測試放行
      if (n === 1) await gate
      return okRes()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadPost } = await import('../src/download/quickDownload')

    const p1 = downloadPost('patreon/u1/1')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const p2 = downloadPost('patreon/u1/2')
    await flush()
    // 第一組還卡著：第二組不能 fetch，且已跳出排隊提示
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.toast.show).toHaveBeenCalledWith('_quickQueued|1')

    release()
    await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 順序：第二組的 fetch 在第一組送出之後
    const iFetch2 = m.events.indexOf('fetch2')
    const iSend1 = m.events.indexOf('send')
    expect(iSend1).toBeGreaterThan(-1)
    expect(iFetch2).toBeGreaterThan(iSend1)
  })

  it('每個非文字檔 fetch 前都先等下載間隔', async () => {
    const fetchMock = vi.fn(async () => {
      m.events.push('fetch')
      return okRes()
    })
    vi.stubGlobal('fetch', fetchMock)
    m.api.post.mockResolvedValue({
      post: {
        id: '1',
        user: 'u1',
        service: 'patreon',
        title: 't',
        content: '',
        file: {},
        attachments: [
          { name: 'a.png', path: '/a/a.png' },
          { name: 'b.png', path: '/b/b.png' },
        ],
        published: '2024-01-01T00:00:00',
      },
      attachments: [],
    })
    const { downloadPost } = await import('../src/download/quickDownload')

    await downloadPost('patreon/u1/1')

    expect(m.interval.wait).toHaveBeenCalledTimes(2)
    const waits = m.events.filter((e) => e === 'wait' || e === 'fetch')
    expect(waits).toEqual(['wait', 'fetch', 'wait', 'fetch'])
  })

  it('單檔 fetch 失敗：後面的組照常執行', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('boom')
      return okRes()
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadPost } = await import('../src/download/quickDownload')

    await downloadPost('patreon/u1/1')
    await downloadPost('patreon/u1/2')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      (globalThis as any).chrome.runtime.sendMessage
    ).toHaveBeenCalledTimes(1)
  })
})
