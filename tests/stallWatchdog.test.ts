import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StallWatchdog } from '../src/download/StallWatchdog'

describe('StallWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('超時後觸發一次並標記 stalled', () => {
    const onStall = vi.fn()
    const dog = new StallWatchdog(1000, onStall)
    dog.kick()
    vi.advanceTimersByTime(999)
    expect(onStall).not.toHaveBeenCalled()
    expect(dog.stalled).toBe(false)
    vi.advanceTimersByTime(1)
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(dog.stalled).toBe(true)
  })

  it('kick 會重新計時', () => {
    const onStall = vi.fn()
    const dog = new StallWatchdog(1000, onStall)
    dog.kick()
    vi.advanceTimersByTime(800)
    dog.kick()
    vi.advanceTimersByTime(800)
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('stop 之後不再觸發，kick 也無效', () => {
    const onStall = vi.fn()
    const dog = new StallWatchdog(1000, onStall)
    dog.kick()
    dog.stop()
    vi.advanceTimersByTime(5000)
    expect(onStall).not.toHaveBeenCalled()
    dog.kick()
    vi.advanceTimersByTime(5000)
    expect(onStall).not.toHaveBeenCalled()
    expect(dog.stalled).toBe(false)
  })

  it('停滯後再 kick 不會重複觸發', () => {
    const onStall = vi.fn()
    const dog = new StallWatchdog(1000, onStall)
    dog.kick()
    vi.advanceTimersByTime(1000)
    dog.kick()
    vi.advanceTimersByTime(5000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('沒 kick 過就不會觸發', () => {
    const onStall = vi.fn()
    new StallWatchdog(1000, onStall)
    vi.advanceTimersByTime(5000)
    expect(onStall).not.toHaveBeenCalled()
  })
})
