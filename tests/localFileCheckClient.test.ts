import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/Log', () => ({
  log: { log: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('../src/Toast', () => ({
  toast: { show: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import { localFileCheck } from '../src/download/LocalFileCheck'
import { log } from '../src/Log'
import { toast } from '../src/Toast'

/** 以 handler 取代 chrome.runtime.sendMessage，並回傳 mock 方便檢查送出的訊息 */
function stubSend(handler: (msg: any) => unknown) {
  const fn = vi.fn(async (msg: any) => handler(msg))
  ;(globalThis as any).chrome.runtime.sendMessage = fn
  return fn
}

function setActivation(isActive: boolean | undefined) {
  ;(globalThis.navigator as any).userActivation =
    isActive === undefined ? undefined : { isActive }
}

beforeEach(() => {
  localFileCheck.beginBatch()
  setActivation(undefined)
  vi.mocked(log.warning).mockClear()
  vi.mocked(toast.show).mockClear()
  vi.mocked(toast.error).mockClear()
})

describe('localFileCheck.existsMany', () => {
  it('ok 回傳 Set，並把路徑原樣送給後台', async () => {
    const send = stubSend(() => ({
      status: 'ok',
      name: 'kemono',
      found: ['kemono/a/1.png'],
      mismatch: false,
    }))
    const r = await localFileCheck.existsMany([
      'kemono/a/1.png',
      'kemono/a/2.png',
    ])
    expect(r).toEqual(new Set(['kemono/a/1.png']))
    expect(send).toHaveBeenCalledWith({
      msg: 'folder_exists_many',
      paths: ['kemono/a/1.png', 'kemono/a/2.png'],
    })
    expect(log.warning).not.toHaveBeenCalled()
  })

  it('noFolder 回 null，每批只警告一次', async () => {
    stubSend(() => ({ status: 'noFolder' }))
    expect(await localFileCheck.existsMany(['a'])).toBeNull()
    expect(await localFileCheck.existsMany(['b'])).toBeNull()
    expect(log.warning).toHaveBeenCalledTimes(1)
    localFileCheck.beginBatch()
    await localFileCheck.existsMany(['c'])
    expect(log.warning).toHaveBeenCalledTimes(2)
  })

  it('noPermission 回 null 並警告', async () => {
    stubSend(() => ({ status: 'noPermission', name: 'kemono' }))
    expect(await localFileCheck.existsMany(['a'])).toBeNull()
    expect(log.warning).toHaveBeenCalledTimes(1)
  })

  it('mismatch 仍回 Set，並警告一次（帶資料夾名稱）', async () => {
    stubSend(() => ({
      status: 'ok',
      name: 'kemono',
      found: ['kemono/a/1.png'],
      mismatch: true,
    }))
    expect(await localFileCheck.existsMany(['x'])).toEqual(
      new Set(['kemono/a/1.png'])
    )
    await localFileCheck.existsMany(['y'])
    expect(log.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(log.warning).mock.calls[0][0]).toContain('kemono')
  })

  it('訊息失敗、沒有回覆或後台回 error 都回 null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubSend(() => {
      throw new Error('no sw')
    })
    expect(await localFileCheck.existsMany(['a'])).toBeNull()
    stubSend(() => undefined)
    expect(await localFileCheck.existsMany(['a'])).toBeNull()
    stubSend(() => ({ status: 'error', error: 'boom' }))
    expect(await localFileCheck.existsMany(['a'])).toBeNull()
  })
})

describe('localFileCheck.exists', () => {
  it('ok 回傳後台的 exists', async () => {
    const send = stubSend(() => ({
      status: 'ok',
      name: 'kemono',
      exists: true,
      mismatch: false,
    }))
    expect(await localFileCheck.exists('kemono/a/1.png')).toBe(true)
    expect(send).toHaveBeenCalledWith({
      msg: 'folder_exists',
      path: 'kemono/a/1.png',
    })
  })

  it('mismatch 回 null 並警告一次', async () => {
    stubSend(() => ({
      status: 'ok',
      name: 'kemono',
      exists: null,
      mismatch: true,
    }))
    expect(await localFileCheck.exists('other/a/1.png')).toBeNull()
    expect(await localFileCheck.exists('other/a/2.png')).toBeNull()
    expect(log.warning).toHaveBeenCalledTimes(1)
  })

  it('noFolder／noPermission 回 null 並警告', async () => {
    stubSend(() => ({ status: 'noFolder' }))
    expect(await localFileCheck.exists('a')).toBeNull()
    stubSend(() => ({ status: 'noPermission', name: 'kemono' }))
    expect(await localFileCheck.exists('a')).toBeNull()
    expect(log.warning).toHaveBeenCalledTimes(2)
  })

  it('訊息失敗回 null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubSend(() => {
      throw new Error('no sw')
    })
    expect(await localFileCheck.exists('a')).toBeNull()
  })
})

describe('localFileCheck.prepare', () => {
  it('已授權回 true，不開視窗', async () => {
    const send = stubSend(() => ({ name: 'kemono', permission: 'granted' }))
    expect(await localFileCheck.prepare(true)).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('沒有資料夾回 false，不開視窗', async () => {
    setActivation(true)
    const send = stubSend(() => ({ name: null, permission: 'none' }))
    expect(await localFileCheck.prepare(true)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('權限不足且沒有使用者操作：不開視窗', async () => {
    const send = stubSend(() => ({ name: 'kemono', permission: 'prompt' }))
    expect(await localFileCheck.prepare(true)).toBe(false)
    setActivation(false)
    expect(await localFileCheck.prepare(true)).toBe(false)
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'folder_open_page' })
    )
  })

  it('非互動即使有使用者操作也不開視窗', async () => {
    setActivation(true)
    const send = stubSend(() => ({ name: 'kemono', permission: 'prompt' }))
    expect(await localFileCheck.prepare(false)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('權限不足且有使用者操作：開啟 reauth 視窗並提示', async () => {
    setActivation(true)
    const send = stubSend((msg) =>
      msg.msg === 'folder_status'
        ? { name: 'kemono', permission: 'prompt' }
        : { ok: true }
    )
    expect(await localFileCheck.prepare(true)).toBe(false)
    expect(send).toHaveBeenCalledWith({
      msg: 'folder_open_page',
      mode: 'reauth',
    })
    expect(toast.show).toHaveBeenCalledTimes(1)
  })

  it('訊息失敗回 false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubSend(() => {
      throw new Error('no sw')
    })
    expect(await localFileCheck.prepare(true)).toBe(false)
  })
})

describe('localFileCheck.folderName / pickFolder', () => {
  it('folderName 回後台的資料夾名稱', async () => {
    stubSend(() => ({ name: 'kemono', permission: 'granted' }))
    expect(await localFileCheck.folderName()).toBe('kemono')
    stubSend(() => ({ name: null, permission: 'none' }))
    expect(await localFileCheck.folderName()).toBeNull()
  })

  it('pickFolder 送出 pick 模式的 folder_open_page', async () => {
    const send = stubSend(() => ({ ok: true }))
    await localFileCheck.pickFolder()
    expect(send).toHaveBeenCalledWith({ msg: 'folder_open_page', mode: 'pick' })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('pickFolder 失敗時提示錯誤', async () => {
    stubSend(() => ({ ok: false, error: 'boom' }))
    await localFileCheck.pickFolder()
    expect(toast.error).toHaveBeenCalledTimes(1)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubSend(() => {
      throw new Error('no sw')
    })
    await localFileCheck.pickFolder()
    expect(toast.error).toHaveBeenCalledTimes(2)
  })
})

describe('舊版 handle 清理', () => {
  async function loadFresh() {
    vi.resetModules()
    await import('../src/download/LocalFileCheck')
    await new Promise((r) => setTimeout(r, 0))
  }

  it('網站來源有舊資料庫時刪除並提示', async () => {
    const deleteDatabase = vi.fn()
    ;(globalThis as any).indexedDB = {
      databases: async () => [{ name: 'pawchivePro' }],
      deleteDatabase,
    }
    try {
      await loadFresh()
      expect(deleteDatabase).toHaveBeenCalledWith('pawchivePro')
      const { log: freshLog } = await import('../src/Log')
      expect(freshLog.warning).toHaveBeenCalledTimes(1)
    } finally {
      delete (globalThis as any).indexedDB
    }
  })

  it('沒有舊資料庫時什麼都不做', async () => {
    const deleteDatabase = vi.fn()
    ;(globalThis as any).indexedDB = {
      databases: async () => [{ name: 'other' }],
      deleteDatabase,
    }
    try {
      await loadFresh()
      expect(deleteDatabase).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as any).indexedDB
    }
  })
})
