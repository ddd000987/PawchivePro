import { beforeEach, describe, expect, it, vi } from 'vitest'

// 抓取調速：crawlInterval 設定 → queueApi.sleep 即時生效（含夾取）
// 注意：tests/setup.ts 的 beforeEach 會清空 window listeners，
// 故每個用例都重新載入模組，讓 api.ts 的頂層監聽重新註冊。
async function load() {
  vi.resetModules()
  const settingsMod = await import('../src/setting/Settings')
  const apiMod = await import('../src/kemono/api')
  const evtMod = await import('../src/EVT')
  return {
    settings: settingsMod.settings,
    queueApi: apiMod.queueApi,
    EVT: evtMod.EVT,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('crawlInterval', () => {
  it('啟動預設 0.5s：settingInitialized 後 sleep=500', async () => {
    const { queueApi, EVT } = await load()
    expect(queueApi.getConfig().sleep).toBe(500)
    EVT.fire('settingInitialized')
    expect(queueApi.getConfig().sleep).toBe(500)
  })

  it('面板修改即時生效：set 2s → sleep=2000', async () => {
    const { settings, queueApi } = await load()
    settings.set('crawlInterval', 2)
    expect(settings.get('crawlInterval')).toBe(2)
    expect(queueApi.getConfig().sleep).toBe(2000)
  })

  it('夾取：負數→0，超大→10，非數字→預設', async () => {
    const { settings, queueApi } = await load()
    settings.set('crawlInterval', -1)
    expect(settings.get('crawlInterval')).toBe(0)
    expect(queueApi.getConfig().sleep).toBe(0)
    settings.set('crawlInterval', 99)
    expect(settings.get('crawlInterval')).toBe(10)
    expect(queueApi.getConfig().sleep).toBe(10000)
    settings.set('crawlInterval', NaN as unknown as number)
    expect(settings.get('crawlInterval')).toBe(0.5)
  })

  it('小數秒換算毫秒：0.2s → sleep=200', async () => {
    const { settings, queueApi } = await load()
    settings.set('crawlInterval', 0.2)
    expect(queueApi.getConfig().sleep).toBe(200)
  })
})
