import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/Config'
import {
  migrateLegacySettings,
  sanitizeSetting,
  settings,
} from '../src/setting/Settings'

describe('sanitizeSetting', () => {
  it('downloadThread：夾取、四捨五入、非有限數與型別不符回預設', () => {
    expect(sanitizeSetting('downloadThread', 999)).toBe(
      Config.downloadThreadMax
    )
    expect(sanitizeSetting('downloadThread', 0)).toBe(1)
    expect(sanitizeSetting('downloadThread', 2.6)).toBe(3)
    expect(sanitizeSetting('downloadThread', NaN)).toBe(
      Config.downloadThreadDefault
    )
    expect(sanitizeSetting('downloadThread', '4')).toBe(
      Config.downloadThreadDefault
    )
  })

  it('downloadInterval 與 crawlInterval 夾取', () => {
    expect(sanitizeSetting('downloadInterval', -5)).toBe(0)
    expect(sanitizeSetting('downloadInterval', NaN)).toBe(0)
    expect(sanitizeSetting('crawlInterval', 99)).toBe(10)
  })

  it('枚舉鍵白名單', () => {
    expect(sanitizeSetting('textContent', 'xxx')).toBe('txt')
    expect(sanitizeSetting('skipDownloaded', 'both')).toBe('both')
    expect(sanitizeSetting('skipDownloaded', 'strict')).toBe('record')
    expect(sanitizeSetting('skipDownloaded', true)).toBe('record')
  })

  it('settings.set 寫入前會清洗', () => {
    settings.set('downloadThread', 999 as never)
    expect(settings.get('downloadThread')).toBe(Config.downloadThreadMax)
  })
})

describe('settings.restore', () => {
  it('存檔值經清洗後寫回', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockResolvedValue({
      [Config.settingStoreName]: {
        downloadThread: 999,
        crawlInterval: 50,
        textContent: 'bad',
        namingRule: 'x',
      },
    } as never)

    await settings.restore()

    expect(settings.get('downloadThread')).toBe(Config.downloadThreadMax)
    expect(settings.get('crawlInterval')).toBe(10)
    expect(settings.get('textContent')).toBe('txt')
    expect(settings.get('namingRule')).toBe('x')
  })

  it('舊存檔（deduplication／skipExistingFiles）合併成 skipDownloaded，舊鍵被丟掉', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockResolvedValue({
      [Config.settingStoreName]: {
        deduplication: true,
        dupliStrategy: 'strict',
        skipExistingFiles: true,
        switchImageByKeyboard: false,
      },
    } as never)

    await settings.restore()

    expect(settings.get('skipDownloaded')).toBe('both')
    const store = settings as unknown as { store: Record<string, unknown> }
    expect('deduplication' in store.store).toBe(false)
    expect('dupliStrategy' in store.store).toBe(false)
    expect('skipExistingFiles' in store.store).toBe(false)
    expect('switchImageByKeyboard' in store.store).toBe(false)
  })
})

describe('migrateLegacySettings', () => {
  const derive = (dedup: unknown, folder: unknown) =>
    migrateLegacySettings({ deduplication: dedup, skipExistingFiles: folder })
      .skipDownloaded

  it('去重／資料夾四種組合對應 skipDownloaded', () => {
    expect(derive(true, true)).toBe('both')
    expect(derive(true, false)).toBe('record')
    expect(derive(false, true)).toBe('folder')
    expect(derive(false, false)).toBe('none')
  })

  it('只有一個舊鍵時，缺的那個按舊預設（去重開、資料夾關）', () => {
    expect(migrateLegacySettings({ deduplication: false }).skipDownloaded).toBe(
      'none'
    )
    expect(
      migrateLegacySettings({ skipExistingFiles: true }).skipDownloaded
    ).toBe('both')
  })

  it('已有新鍵時以新鍵為準；沒有任何舊鍵時不憑空產生', () => {
    expect(
      migrateLegacySettings({ skipDownloaded: 'folder', deduplication: true })
        .skipDownloaded
    ).toBe('folder')
    expect(migrateLegacySettings({ namingRule: 'x' })).toEqual({
      namingRule: 'x',
    })
  })

  it('丟掉已移除的鍵，且不改動原物件', () => {
    const input = {
      deduplication: true,
      dupliStrategy: 'loose',
      skipExistingFiles: false,
      switchImageByKeyboard: true,
      textContent: 'html',
    }
    const out = migrateLegacySettings(input)
    expect(out).toEqual({ skipDownloaded: 'record', textContent: 'html' })
    expect(input.deduplication).toBe(true)
  })
})
