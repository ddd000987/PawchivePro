import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { eventNames } from '../src/EVT'

// EVT 是模組內的私有單例，每個測試重新載入模組（含 EVT／States），
// 並在同一批 import 取得與受測模組相同的實例
let EVT: typeof import('../src/EVT').EVT
let states: typeof import('../src/store/States').states
let crawlPause: typeof import('../src/crawl/CrawlPause').crawlPause

beforeEach(async () => {
  vi.resetModules()
  EVT = (await import('../src/EVT')).EVT
  states = (await import('../src/store/States')).states
  crawlPause = (await import('../src/crawl/CrawlPause')).crawlPause
})

function record(type: eventNames) {
  const hits: number[] = []
  EVT.on(type, () => hits.push(1))
  return hits
}

/** 讓已 resolve 的 promise 回呼跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('CrawlPause', () => {
  it('未暫停：wait 立刻回 true', async () => {
    const ac = new AbortController()
    expect(await crawlPause.wait(ac.signal)).toBe(true)
  })

  it('抓取沒在進行時 pause 無效', () => {
    expect(crawlPause.pause()).toBe(false)
    expect(crawlPause.paused).toBe(false)
  })

  it('下載任務佔用 busy 時不能暫停抓取', () => {
    EVT.fire('downloadStart')
    expect(crawlPause.pause()).toBe(false)
  })

  it('pause／resume：發事件、同步 states.crawlPaused，且不重複觸發', () => {
    EVT.fire('crawlStart')
    const paused = record('crawlPause')
    const resumed = record('crawlResume')

    expect(crawlPause.pause()).toBe(true)
    expect(crawlPause.pause()).toBe(false)
    expect(crawlPause.paused).toBe(true)
    expect(states.crawlPaused).toBe(true)
    expect(states.busy).toBe(true) // 暫停仍算抓取中

    expect(crawlPause.resume()).toBe(true)
    expect(crawlPause.resume()).toBe(false)
    expect(crawlPause.paused).toBe(false)
    expect(states.crawlPaused).toBe(false)
    expect(paused).toHaveLength(1)
    expect(resumed).toHaveLength(1)
  })

  it('暫停中 wait 會等到 resume 才回 true（多個等待者一起放行）', async () => {
    EVT.fire('crawlStart')
    crawlPause.pause()
    const ac = new AbortController()
    let a: boolean | undefined
    let b: boolean | undefined
    void crawlPause.wait(ac.signal).then((v) => (a = v))
    void crawlPause.wait(ac.signal).then((v) => (b = v))
    await flush()
    expect(a).toBeUndefined()
    expect(b).toBeUndefined()

    crawlPause.resume()
    await flush()
    expect(a).toBe(true)
    expect(b).toBe(true)
  })

  it('暫停中 signal 中止：wait 回 false', async () => {
    EVT.fire('crawlStart')
    crawlPause.pause()
    const ac = new AbortController()
    let result: boolean | undefined
    void crawlPause.wait(ac.signal).then((v) => (result = v))
    await flush()
    expect(result).toBeUndefined()

    ac.abort()
    await flush()
    expect(result).toBe(false)
  })

  it('暫停前 signal 已中止：wait 直接回 false', async () => {
    EVT.fire('crawlStart')
    crawlPause.pause()
    const ac = new AbortController()
    ac.abort()
    expect(await crawlPause.wait(ac.signal)).toBe(false)
  })

  it('stopCrawl 重置暫停旗標，但不搶先放行等待者（由 abort 放行成 false）', async () => {
    EVT.fire('crawlStart')
    crawlPause.pause()
    const ac = new AbortController()
    let result: boolean | undefined
    void crawlPause.wait(ac.signal).then((v) => (result = v))

    EVT.fire('stopCrawl')
    expect(crawlPause.paused).toBe(false)
    expect(states.crawlPaused).toBe(false)
    await flush()
    expect(result).toBeUndefined()

    ac.abort()
    await flush()
    expect(result).toBe(false)
  })

  it.each(['crawlStart', 'crawlComplete', 'crawlEmpty'] as const)(
    '%s 重置為未暫停',
    (type) => {
      EVT.fire('crawlStart')
      crawlPause.pause()
      expect(crawlPause.paused).toBe(true)
      EVT.fire(type)
      // crawlStart 本身會把 busy 設回 true，其餘事件不影響結論
      expect(crawlPause.paused).toBe(false)
      expect(states.crawlPaused).toBe(false)
    }
  )
})
