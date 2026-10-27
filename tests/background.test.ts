import { beforeEach, describe, expect, it, vi } from 'vitest'

// 本檔只測下載；資料夾服務會多註冊一個 onMessage listener，排除避免干擾 listeners.message[0]
vi.mock('../src/folder/folderService', () => ({}))

type Listener = (...args: any[]) => any

function makeChrome(
  storageData: Record<string, any>,
  downloadImpl: () => Promise<number>
) {
  const listeners: Record<string, Listener[]> = {
    action: [],
    installed: [],
    message: [],
    changed: [],
  }
  const chrome = {
    action: {
      onClicked: {
        addListener: (fn: Listener) => listeners.action.push(fn),
      },
    },
    runtime: {
      onInstalled: {
        addListener: (fn: Listener) => listeners.installed.push(fn),
      },
      onMessage: {
        addListener: (fn: Listener) => listeners.message.push(fn),
      },
      sendMessage: vi.fn(async () => {}),
    },
    downloads: {
      download: vi.fn(downloadImpl),
      onChanged: {
        addListener: (fn: Listener) => listeners.changed.push(fn),
      },
    },
    tabs: {
      sendMessage: vi.fn(async () => {}),
      get: vi.fn(async () => ({})),
    },
    storage: {
      local: {
        get: vi.fn(async () => storageData),
        set: vi.fn(async () => {}),
      },
    },
  }
  return { chrome, listeners }
}

describe('background save_work_file', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as any)
  })

  it('idList 缺失時仍可建立下載（不拋錯）', async () => {
    const { chrome, listeners } = makeChrome(
      { batchNo: { 1: 5 }, idList: {} },
      async () => 1
    )
    ;(globalThis as any).chrome = chrome
    await import('../src/background')

    listeners.message[0](
      {
        msg: 'save_work_file',
        id: 'a',
        taskBatch: 5,
        blobURL: 'blob:x',
        fileName: 'f',
      },
      { tab: { id: 1 } }
    )

    await vi.waitFor(() => {
      expect(chrome.downloads.download).toHaveBeenCalledTimes(1)
    })
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('downloads.download 失敗時回報 download_err', async () => {
    const { chrome, listeners } = makeChrome(
      { batchNo: { 1: 5 }, idList: { 1: [] } },
      async () => {
        throw new Error('boom')
      }
    )
    ;(globalThis as any).chrome = chrome
    await import('../src/background')

    listeners.message[0](
      {
        msg: 'save_work_file',
        id: 'a',
        taskBatch: 5,
        blobURL: 'blob:x',
        fileName: 'f',
      },
      { tab: { id: 1 } }
    )

    await vi.waitFor(() => {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ msg: 'download_err', saveRequestFailed: true })
    )
  })

  it('快下不會覆寫主下載的批次與 idList', async () => {
    const { chrome, listeners } = makeChrome(
      { batchNo: {}, idList: {} },
      async () => 1
    )
    ;(globalThis as any).chrome = chrome
    await import('../src/background')

    const send = (msg: Record<string, unknown>) =>
      listeners.message[0](msg, { tab: { id: 1 } })
    const main = {
      msg: 'save_work_file',
      id: 'a',
      taskBatch: 1700000000000,
      blobURL: 'blob:a',
      fileName: 'a',
    }

    send(main)
    await vi.waitFor(() => {
      expect(chrome.downloads.download).toHaveBeenCalledTimes(1)
    })

    send({
      msg: 'save_work_file',
      id: 'q',
      taskBatch: 1,
      channel: 'quick',
      blobURL: 'blob:q',
      fileName: 'q',
    })
    await vi.waitFor(() => {
      expect(chrome.downloads.download).toHaveBeenCalledTimes(2)
    })

    // 主下載重複 id：快下清空過 idList 的話這裡會多下一次
    send({ ...main, blobURL: 'blob:a2' })
    await new Promise((r) => setTimeout(r, 10))
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2)
  })
})
