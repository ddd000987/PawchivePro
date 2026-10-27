import { afterEach, describe, expect, it } from 'vitest'
import { EVT, type eventNames } from '../src/EVT'
import { HotkeyListener } from '../src/HotkeyListener'
import { isReservedHotkey } from '../src/setting/HotkeyEditor'
import {
  sanitizeHotkeys,
  settings,
  defaultHotkeys,
} from '../src/setting/Settings'

/** 在 stub window 上派發假 keydown（需自帶 preventDefault） */
function keydown(
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
  target?: unknown
) {
  ;(window.dispatchEvent as (ev: unknown) => void)({
    type: 'keydown',
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
    target,
    preventDefault: () => {},
  })
}

// EVT 的私有匯流排不會被 setup.ts 清空，用完要自己解除監聽
const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((fn) => fn())
})

function listenOnce(type: eventNames): { count: () => number } {
  let n = 0
  const listener = () => {
    n++
  }
  EVT.on(type, listener)
  disposers.push(() => EVT.off(type, listener))
  return { count: () => n }
}

describe('sanitizeHotkeys', () => {
  it('非法輸入回空表（派發端跳過無鍵命令）', () => {
    expect(sanitizeHotkeys(undefined)).toEqual({})
    expect(sanitizeHotkeys('alt+x')).toEqual({})
    expect(sanitizeHotkeys({})).toEqual({})
  })

  it('只收已知命令的有效組合：未知丟棄、非法丟棄、缺鍵保持缺', () => {
    const out = sanitizeHotkeys({
      commandToggleCrawlPanel: {
        key: 'KeyY',
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
      },
      commandBogus: {
        key: 'KeyB',
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
      },
      commandStartDefaultCrawl: {
        key: '',
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
      },
    })
    expect(out.commandToggleCrawlPanel).toEqual({
      key: 'KeyY',
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    })
    expect(out).not.toHaveProperty('commandBogus')
    // 非法組合被丟棄（不是回退預設——「清除」後重載不復活）
    expect(out).not.toHaveProperty('commandStartDefaultCrawl')
    expect(out).not.toHaveProperty('commandTogglePreviewWork')
  })
})

describe('isReservedHotkey', () => {
  const combo = (
    key: string,
    mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>>
  ) => ({
    key,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...mods,
  })

  it('Ctrl 與 Ctrl+Shift 的瀏覽器保留鍵都擋下', () => {
    expect(isReservedHotkey(combo('KeyT', { ctrl: true }))).toBe(true)
    expect(isReservedHotkey(combo('KeyT', { ctrl: true, shift: true }))).toBe(
      true
    )
    expect(isReservedHotkey(combo('Digit1', { ctrl: true }))).toBe(true)
    expect(isReservedHotkey(combo('Digit1', { ctrl: true, shift: true }))).toBe(
      false
    )
  })

  it('頁面可攔截的組合不擋（Ctrl+C／Ctrl+Shift+X 等）', () => {
    expect(isReservedHotkey(combo('KeyC', { ctrl: true }))).toBe(false)
    expect(isReservedHotkey(combo('KeyF', { ctrl: true }))).toBe(false)
    expect(isReservedHotkey(combo('KeyX', { ctrl: true, shift: true }))).toBe(
      false
    )
    expect(isReservedHotkey(combo('KeyQ', { ctrl: true, shift: true }))).toBe(
      false
    )
    expect(isReservedHotkey(combo('KeyW', { ctrl: true, shift: true }))).toBe(
      true
    )
    expect(isReservedHotkey(combo('KeyN', { ctrl: true, shift: true }))).toBe(
      true
    )
    expect(isReservedHotkey(combo('Tab', { ctrl: true }))).toBe(true)
    expect(isReservedHotkey(combo('KeyQ', { ctrl: true }))).toBe(true)
  })

  it('一般 Alt 組合仍可錄製', () => {
    expect(isReservedHotkey(combo('KeyX', { alt: true }))).toBe(false)
    expect(isReservedHotkey(combo('KeyX', { ctrl: true, alt: true }))).toBe(
      false
    )
  })
})

describe('HotkeyListener', () => {
  it('預設 Alt+X/Z/P 派發三個命令', () => {
    new HotkeyListener()
    const panel = listenOnce(EVT.list.commandToggleCrawlPanel)
    const crawl = listenOnce(EVT.list.commandStartDefaultCrawl)
    const preview = listenOnce(EVT.list.commandTogglePreviewWork)

    keydown('KeyX', { alt: true })
    keydown('KeyZ', { alt: true })
    keydown('KeyP', { alt: true })
    // 修飾鍵不對的不觸發
    keydown('KeyX', {})
    keydown('KeyX', { ctrl: true })

    expect(panel.count()).toBe(1)
    expect(crawl.count()).toBe(1)
    expect(preview.count()).toBe(1)
  })

  it('輸入框內的按鍵不派發', () => {
    new HotkeyListener()
    const panel = listenOnce(EVT.list.commandToggleCrawlPanel)
    keydown('KeyX', { alt: true }, { tagName: 'INPUT' })
    keydown('KeyX', { alt: true }, { tagName: 'TEXTAREA' })
    expect(panel.count()).toBe(0)
  })

  it('set hotkeys 後熱更新映射（舊組合失效、新組合生效）', () => {
    new HotkeyListener()
    const panel = listenOnce(EVT.list.commandToggleCrawlPanel)
    settings.set('hotkeys', {
      ...defaultHotkeys,
      commandToggleCrawlPanel: {
        key: 'KeyY',
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
      },
    })
    keydown('KeyX', { alt: true })
    expect(panel.count()).toBe(0)
    keydown('KeyY', { alt: true })
    expect(panel.count()).toBe(1)
    // 還原預設，避免污染其他測試（同檔共用 settings 單例）
    settings.set('hotkeys', { ...defaultHotkeys })
  })
})

describe('hotkeys 事件位', () => {
  it('三個命令都在 EVT.list（fire 型別安全）', () => {
    expect(EVT.list.commandToggleCrawlPanel).toBe('commandToggleCrawlPanel')
    expect(EVT.list.commandStartDefaultCrawl).toBe('commandStartDefaultCrawl')
    expect(EVT.list.commandTogglePreviewWork).toBe('commandTogglePreviewWork')
  })
})
