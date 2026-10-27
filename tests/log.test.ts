import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVT } from '../src/EVT'
import { log } from '../src/Log'

describe('log.refresh', () => {
  it('同 key 同內容只輸出一次，內容變化才再輸出', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log.refresh('progress 1', 'testRefreshKey')
    log.refresh('progress 1', 'testRefreshKey')
    log.refresh('progress 2', 'testRefreshKey')

    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('log 緩衝區與合併', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    log.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('寫入緩衝區並帶 level／count，entries() 回傳拷貝', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    log.log('a')
    log.success('b')
    log.warning('c')
    log.error('d')

    const list = log.entries()
    expect(list.map((e) => [e.level, e.msg, e.count])).toEqual([
      ['log', 'a', 1],
      ['success', 'b', 1],
      ['warning', 'c', 1],
      ['error', 'd', 1],
    ])
    // 改拷貝不影響內部
    ;(list[0] as { msg: string }).msg = 'changed'
    expect(log.entries()[0].msg).toBe('a')
  })

  it('超過 300 筆丟棄最舊的', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (let i = 0; i < 310; i++) {
      log.log(`msg ${i}`)
    }
    const list = log.entries()
    expect(list.length).toBe(300)
    expect(list[0].msg).toBe('msg 10')
    expect(list[299].msg).toBe('msg 309')
  })

  it('空訊息完全忽略', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.log('')
    log.error('')
    expect(spy).not.toHaveBeenCalled()
    expect(log.entries().length).toBe(0)
  })

  it('10 秒內同 key 合併：不再印 console，只累加 count 並更新文字', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    log.warning('fail 1', 'net-429')
    vi.advanceTimersByTime(3000)
    log.warning('fail 2', 'net-429')
    vi.advanceTimersByTime(3000)
    log.warning('fail 3', 'net-429')

    expect(spy).toHaveBeenCalledTimes(1)
    const list = log.entries()
    expect(list.length).toBe(1)
    expect(list[0].count).toBe(3)
    expect(list[0].msg).toBe('fail 3')
  })

  it('沒有 key 時以訊息本身合併', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.log('same')
    log.log('same')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(log.entries()[0].count).toBe(2)
  })

  it('超過視窗後再次出現會重新印出並成為新條目', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    log.error('boom', 'k')
    vi.advanceTimersByTime(10001)
    log.error('boom', 'k')

    expect(spy).toHaveBeenCalledTimes(2)
    expect(log.entries().map((e) => e.count)).toEqual([1, 1])
  })

  it('不同 key 不合併', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    log.warning('x', 'net-429')
    log.warning('x', 'net-500')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(log.entries().length).toBe(2)
  })

  it('新增與合併都會觸發 logAdd，clear() 清空緩衝並重置合併記憶', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fired = vi.fn()
    EVT.on('logAdd', fired)

    log.log('m')
    log.log('m')
    expect(fired).toHaveBeenCalledTimes(2)

    log.clear()
    expect(fired).toHaveBeenCalledTimes(3)
    expect(log.entries().length).toBe(0)
    EVT.off('logAdd', fired)

    // 清空後同 key 要重新印出
    consoleLog.mockClear()
    log.log('m')
    expect(consoleLog).toHaveBeenCalledTimes(1)
  })
})

describe('log.debug', () => {
  afterEach(() => {
    delete (globalThis as any).localStorage
    log.setDebug(false)
  })

  it('關閉時靜默，開啟時輸出 console.debug；都不進緩衝區', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    log.clear()

    log.setDebug(false)
    log.debug('hidden')
    expect(spy).not.toHaveBeenCalled()

    log.setDebug(true)
    log.debug('shown')
    expect(spy).toHaveBeenCalledWith('[PawchivePro] shown')
    expect(log.entries().length).toBe(0)
  })

  it('setDebug 會寫入／移除 localStorage 旗標；沒有 localStorage 也不拋錯', () => {
    expect(() => log.setDebug(true)).not.toThrow()

    const store = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    log.setDebug(true)
    expect(store.get('pawchiveProDebug')).toBe('1')
    log.setDebug(false)
    expect(store.has('pawchiveProDebug')).toBe(false)
  })
})
