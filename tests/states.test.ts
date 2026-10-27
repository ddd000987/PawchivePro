import { afterEach, describe, expect, it, vi } from 'vitest'
import { states } from '../src/store/States'

afterEach(() => {
  vi.useRealTimers()
  states.settingInitialized = true
})

describe('states.waitSettingInitialized', () => {
  it('10 秒仍未初始化：報錯後放行，不會永遠死等', async () => {
    vi.useFakeTimers()
    states.settingInitialized = false
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const wait = states.waitSettingInitialized()
    await vi.advanceTimersByTimeAsync(10000)
    await wait

    expect(error).toHaveBeenCalledTimes(1)
  })

  it('初始化後立刻返回，不輸出逾時錯誤', async () => {
    vi.useFakeTimers()
    states.settingInitialized = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await states.waitSettingInitialized()

    expect(error).not.toHaveBeenCalled()
  })
})
