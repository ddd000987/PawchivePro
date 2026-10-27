import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadRootHandle: vi.fn(),
  getFolderStatus: vi.fn(),
}))

vi.mock('../src/folder/folderCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/folder/folderCore')>()),
  loadRootHandle: mocks.loadRootHandle,
  getFolderStatus: mocks.getFolderStatus,
}))

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (res: unknown) => void
) => boolean

let listener: Listener
const createWindow = vi.fn(async () => ({}))

function notFound() {
  return { name: 'NotFoundError', message: 'NotFoundError' }
}

/** 只有根底下的平面檔案：值為檔案大小 */
function fakeRoot(
  name: string,
  permission: string,
  files: Record<string, number>
) {
  return {
    name,
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    getDirectoryHandle: vi.fn(async () => {
      throw notFound()
    }),
    getFileHandle: vi.fn(async (n: string) => {
      if (files[n] === undefined) throw notFound()
      return {
        kind: 'file',
        name: n,
        getFile: async () => ({ size: files[n] }),
      }
    }),
    values: vi.fn(async function* () {
      for (const [n, size] of Object.entries(files)) {
        yield { kind: 'file', name: n, getFile: async () => ({ size }) }
      }
    }),
  }
}

/** 送一則訊息給已註冊的 listener，等回覆 */
function call(msg: unknown, senderId: string | undefined | null = 'ext-id') {
  return new Promise<{ handled: boolean; response?: unknown }>((resolve) => {
    let responded = false
    const handled = listener(msg, { id: senderId ?? undefined }, (response) => {
      responded = true
      resolve({ handled, response })
    })
    if (!handled && !responded) {
      resolve({ handled })
    }
  })
}

beforeEach(async () => {
  mocks.loadRootHandle.mockReset()
  mocks.getFolderStatus.mockReset()
  createWindow.mockClear()
  const g = globalThis as any
  g.chrome.runtime = {
    id: 'ext-id',
    getURL: (p: string) => 'chrome-extension://ext-id/' + p,
    onMessage: {
      addListener: (fn: Listener) => {
        listener = fn
      },
    },
  }
  g.chrome.windows = { create: createWindow }
  vi.resetModules()
  await import('../src/folder/folderService')
})

describe('folderService 訊息過濾', () => {
  it('sender.id 不是本擴充功能就忽略', async () => {
    const r = await call({ msg: 'folder_status' }, 'other-ext')
    expect(r.handled).toBe(false)
    expect(mocks.getFolderStatus).not.toHaveBeenCalled()
    expect((await call({ msg: 'folder_status' }, null)).handled).toBe(false)
  })

  it('非 folder_ 訊息與非物件訊息回 false', async () => {
    expect((await call({ msg: 'save_work_file' })).handled).toBe(false)
    expect((await call({ msg: 123 })).handled).toBe(false)
    expect((await call({})).handled).toBe(false)
    expect((await call('folder_status')).handled).toBe(false)
    expect((await call(null)).handled).toBe(false)
  })
})

describe('folderService 訊息處理', () => {
  it('folder_status 回資料夾名稱與權限', async () => {
    mocks.getFolderStatus.mockResolvedValue({
      name: 'kemono',
      permission: 'granted',
    })
    const r = await call({ msg: 'folder_status' })
    expect(r.handled).toBe(true)
    expect(r.response).toEqual({ name: 'kemono', permission: 'granted' })
  })

  it('folder_exists_many：沒有資料夾回 noFolder', async () => {
    mocks.loadRootHandle.mockResolvedValue(null)
    const r = await call({ msg: 'folder_exists_many', paths: ['kemono/1.png'] })
    expect(r.response).toEqual({ status: 'noFolder' })
  })

  it('folder_exists_many：權限不是 granted 回 noPermission', async () => {
    mocks.loadRootHandle.mockResolvedValue(fakeRoot('kemono', 'prompt', {}))
    const r = await call({ msg: 'folder_exists_many', paths: ['kemono/1.png'] })
    expect(r.response).toEqual({ status: 'noPermission', name: 'kemono' })
  })

  it('folder_exists_many：happy path', async () => {
    mocks.loadRootHandle.mockResolvedValue(
      fakeRoot('kemono', 'granted', { '1.png': 10, '2.png': 0 })
    )
    const r = await call({
      msg: 'folder_exists_many',
      paths: ['kemono/1.png', 'kemono/2.png', 'other/3.png'],
    })
    expect(r.response).toEqual({
      status: 'ok',
      name: 'kemono',
      found: ['kemono/1.png'],
      mismatch: true,
    })
  })

  it('folder_exists_many：paths 不是字串陣列時回 error', async () => {
    const r = await call({ msg: 'folder_exists_many', paths: [1, 2] })
    expect(r.response).toMatchObject({ status: 'error' })
    expect(mocks.loadRootHandle).not.toHaveBeenCalled()
  })

  it('folder_exists：happy path 與型別檢查', async () => {
    mocks.loadRootHandle.mockResolvedValue(
      fakeRoot('kemono', 'granted', { '1.png': 10 })
    )
    const r = await call({ msg: 'folder_exists', path: 'kemono/1.png' })
    expect(r.response).toEqual({
      status: 'ok',
      name: 'kemono',
      exists: true,
      mismatch: false,
    })
    const bad = await call({ msg: 'folder_exists', path: 5 })
    expect(bad.response).toMatchObject({ status: 'error' })
  })

  it('處理中丟出例外時回 error 而不是沒有回覆', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getFolderStatus.mockRejectedValue(new Error('boom'))
    const r = await call({ msg: 'folder_status' })
    expect(r.response).toEqual({ status: 'error', error: 'boom' })
  })

  it('未知的 folder_ 訊息回 error', async () => {
    const r = await call({ msg: 'folder_nope' })
    expect(r.handled).toBe(true)
    expect(r.response).toMatchObject({ status: 'error' })
  })
})

describe('folder_open_page', () => {
  it('以彈出視窗開啟授權頁', async () => {
    const r = await call({ msg: 'folder_open_page', mode: 'reauth' })
    expect(r.response).toEqual({ ok: true })
    expect(createWindow).toHaveBeenCalledWith({
      url: 'chrome-extension://ext-id/folder.html?mode=reauth',
      type: 'popup',
      width: 460,
      height: 360,
    })
  })

  it('mode 不合法時不開視窗', async () => {
    const r = await call({ msg: 'folder_open_page', mode: '../x' })
    expect(r.response).toMatchObject({ ok: false })
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('建立視窗失敗時回 ok:false', async () => {
    createWindow.mockRejectedValueOnce(new Error('no window'))
    const r = await call({ msg: 'folder_open_page', mode: 'pick' })
    expect(r.response).toEqual({ ok: false, error: 'no window' })
  })
})
