import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { eventNames } from '../src/EVT'

// EVT 是模組內的私有單例，每個測試重新載入模組，
// 並在同一批 import 取得與受測模組相同的實例
let EVT: typeof import('../src/EVT').EVT
let crawlProgress: typeof import('../src/crawl/CrawlProgress').crawlProgress
let formatExcluded: typeof import('../src/crawl/CrawlProgress').formatExcluded

beforeEach(async () => {
  vi.resetModules()
  EVT = (await import('../src/EVT')).EVT
  const mod = await import('../src/crawl/CrawlProgress')
  crawlProgress = mod.crawlProgress
  formatExcluded = mod.formatExcluded
})

function count(type: eventNames) {
  let n = 0
  EVT.on(type, () => {
    n++
  })
  return () => n
}

describe('CrawlProgress 計數', () => {
  it('初始為閒置、全部為零', () => {
    expect(crawlProgress.phase).toBe('idle')
    expect(crawlProgress.scanned).toBe(0)
    expect(crawlProgress.total).toBeNull()
    expect(crawlProgress.excludedTotal).toBe(0)
    expect(crawlProgress.elapsedMs()).toBe(0)
  })

  it('各計數器累加，排除數按原因分開', () => {
    EVT.fire('crawlStart')
    crawlProgress.setTarget('Alice (patreon/1)')
    crawlProgress.setTotal(10)
    crawlProgress.addPage()
    crawlProgress.scan()
    crawlProgress.keep(3)
    crawlProgress.scan()
    crawlProgress.exclude('title')
    crawlProgress.scan()
    crawlProgress.exclude('title')
    crawlProgress.scan()
    crawlProgress.exclude('date')
    crawlProgress.scan()
    crawlProgress.fail()

    expect(crawlProgress.target).toBe('Alice (patreon/1)')
    expect(crawlProgress.total).toBe(10)
    expect(crawlProgress.pages).toBe(1)
    expect(crawlProgress.scanned).toBe(5)
    expect(crawlProgress.kept).toBe(1)
    expect(crawlProgress.keptFiles).toBe(3)
    expect(crawlProgress.excluded).toEqual({ title: 2, date: 1 })
    expect(crawlProgress.excludedTotal).toBe(3)
    expect(crawlProgress.failed).toBe(1)
  })

  it('每次更新都發 crawlProgress 事件', () => {
    const hits = count('crawlProgress')
    crawlProgress.scan()
    crawlProgress.keep(1)
    crawlProgress.exclude('kind')
    crawlProgress.fail()
    crawlProgress.addPage()
    expect(hits()).toBe(5)
  })

  it('crawlStart 清零上一輪的統計', () => {
    EVT.fire('crawlStart')
    crawlProgress.setTarget('x')
    crawlProgress.setTargetPosts(4)
    crawlProgress.setTotal(9)
    crawlProgress.addPage()
    crawlProgress.scan()
    crawlProgress.keep(2)
    crawlProgress.exclude('title')
    crawlProgress.fail()
    EVT.fire('crawlComplete')

    EVT.fire('crawlStart')
    expect(crawlProgress.phase).toBe('crawling')
    expect(crawlProgress.target).toBe('')
    expect(crawlProgress.targetPosts).toBe(0)
    expect(crawlProgress.total).toBeNull()
    expect(crawlProgress.pages).toBe(0)
    expect(crawlProgress.scanned).toBe(0)
    expect(crawlProgress.kept).toBe(0)
    expect(crawlProgress.keptFiles).toBe(0)
    expect(crawlProgress.excluded).toEqual({})
    expect(crawlProgress.failed).toBe(0)
    expect(crawlProgress.endedAt).toBe(0)
  })
})

describe('CrawlProgress 階段', () => {
  it('開始 → 暫停 → 繼續 → 完成', () => {
    EVT.fire('crawlStart')
    expect(crawlProgress.phase).toBe('crawling')
    expect(crawlProgress.active).toBe(true)

    EVT.fire('crawlPause')
    expect(crawlProgress.phase).toBe('paused')
    expect(crawlProgress.active).toBe(true)

    EVT.fire('crawlResume')
    expect(crawlProgress.phase).toBe('crawling')

    EVT.fire('crawlComplete')
    expect(crawlProgress.phase).toBe('done')
    expect(crawlProgress.active).toBe(false)
    expect(crawlProgress.endedAt).toBeGreaterThan(0)
  })

  it('crawlComplete 後接 crawlEmpty：完成改為結果為空', () => {
    EVT.fire('crawlStart')
    EVT.fire('crawlComplete')
    EVT.fire('crawlEmpty')
    expect(crawlProgress.phase).toBe('empty')
  })

  it('停止：階段為已停止，之後的 crawlComplete 不覆蓋', () => {
    EVT.fire('crawlStart')
    EVT.fire('crawlPause')
    EVT.fire('stopCrawl')
    expect(crawlProgress.phase).toBe('stopped')
    EVT.fire('crawlComplete')
    expect(crawlProgress.phase).toBe('stopped')
  })

  it('閒置時的暫停／繼續／停止事件不改變階段', () => {
    EVT.fire('crawlPause')
    EVT.fire('crawlResume')
    EVT.fire('stopCrawl')
    EVT.fire('crawlComplete')
    expect(crawlProgress.phase).toBe('idle')
  })

  it('收尾後已用時間固定；進行中隨時間增加', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
      EVT.fire('crawlStart')
      vi.setSystemTime(new Date('2025-01-01T00:01:05Z'))
      expect(crawlProgress.elapsedMs()).toBe(65000)
      EVT.fire('crawlComplete')
      vi.setSystemTime(new Date('2025-01-01T00:10:00Z'))
      expect(crawlProgress.elapsedMs()).toBe(65000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('formatExcluded', () => {
  it('依固定順序列出各原因，略過 0，未知原因照原字串', () => {
    // 測試 stub 的介面語言為 en
    expect(formatExcluded({ date: 2, title: 3, weird: 1, kind: 0 })).toBe(
      'title 3, date 2, weird 1'
    )
    expect(formatExcluded({})).toBe('')
  })
})
