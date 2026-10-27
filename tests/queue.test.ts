import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Queue } from '../src/utils/queue'

describe('Queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('進場時信號已中止：直接 reject 且任務不會執行', async () => {
    const queue = new Queue({ max: 1, sleep: 0 })
    const ac = new AbortController()
    ac.abort()
    const fn = vi.fn()

    await expect(queue.enqueue(fn, ac.signal)).rejects.toBe('aborted')
    await vi.advanceTimersByTimeAsync(10)
    expect(fn).not.toHaveBeenCalled()
  })

  it('max=3 sleep=500：相鄰任務啟動間隔 500ms，不會突發', async () => {
    const queue = new Queue({ max: 3, sleep: 500 })
    const calls: number[] = []

    queue.enqueue(() => calls.push(1))
    queue.enqueue(() => calls.push(2))
    queue.enqueue(() => calls.push(3))

    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual([1])

    await vi.advanceTimersByTimeAsync(499)
    expect(calls).toEqual([1])

    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([1, 2])

    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toEqual([1, 2, 3])
  })

  it('等待期間 abort：promise reject，func 從未被呼叫', async () => {
    const queue = new Queue({ max: 1, sleep: 500 })
    const controller = new AbortController()
    const func = vi.fn(() => 1)

    const p = queue.enqueue(func, controller.signal)
    controller.abort()

    await expect(p).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(1000)
    expect(func).not.toHaveBeenCalled()
  })

  it('func 收到的 signal 就是傳入的 signal', async () => {
    const queue = new Queue({ max: 1, sleep: 500 })
    const controller = new AbortController()
    const seen = vi.fn()

    const p = queue.enqueue((signal) => {
      seen(signal)
      return 1
    }, controller.signal)

    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toHaveBeenCalledWith(controller.signal)
    await expect(p).resolves.toBe(1)
  })

  it('clear()：pending promise 全部 reject，ongoing 最後回到 0', async () => {
    const queue = new Queue({ max: 1, sleep: 500 })
    const func = vi.fn(() => 1)

    const p1 = queue.enqueue(func)
    const p2 = queue.enqueue(func)
    const p3 = queue.enqueue(func)

    queue.clear()

    const results = await Promise.allSettled([p1, p2, p3])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // 等 finally 的 ongoing-- 微任務跑完
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.getStatus().ongoing).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(func).not.toHaveBeenCalled()
    expect(queue.getStatus().ongoing).toBe(0)
  })
})
