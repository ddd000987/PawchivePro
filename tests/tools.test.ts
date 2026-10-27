import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleWindowsReservedName,
  replaceUnsafeStr,
  throttle,
} from '../src/Tools'

afterEach(() => {
  vi.useRealTimers()
})

describe('throttle', () => {
  it('延遲執行使用最後一次呼叫的 this', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const seen: string[] = []
    const fn = throttle(function (this: { name: string }, _n: number) {
      seen.push(this.name)
    }, 100)
    const a = { name: 'a', fn }
    const b = { name: 'b', fn }

    a.fn(1)
    b.fn(2)
    vi.advanceTimersByTime(100)

    expect(seen).toEqual(['b'])
  })

  it('立即執行時回傳被包裝函數的回傳值', () => {
    vi.useFakeTimers()
    const fn = throttle((n: number) => n * 2, 100)

    // 第一次排入延遲；時間到後的下一次呼叫可直接執行並回傳結果
    fn(1)
    vi.advanceTimersByTime(100)

    expect(fn(3)).toBe(6)
  })
})

describe('replaceUnsafeStr', () => {
  it('非法檔名字元替換成全角版本', () => {
    expect(replaceUnsafeStr('a\\b/c:d?e"f<g>h*i|j~k')).toBe(
      'a＼b／c：d？e＂f＜g＞h＊i｜j～k'
    )
  })

  it('keepPathSeparator=true 時保留 /，其他照常替換', () => {
    expect(replaceUnsafeStr('dir/sub:name?', true)).toBe('dir/sub：name？')
    expect(replaceUnsafeStr('dir/sub', false)).toBe('dir／sub')
  })

  it('移除控制字元、零寬與 BOM 字元', () => {
    expect(replaceUnsafeStr('a\u0000b\u0007c\u007fd\u200be\ufeff')).toBe(
      'abcde'
    )
    // 換行也是控制字元
    expect(replaceUnsafeStr('line1\nline2\r')).toBe('line1line2')
  })

  it('正常字串（含中日文與空白）原樣返回', () => {
    expect(replaceUnsafeStr('正常 名稱 テスト-1.png')).toBe(
      '正常 名稱 テスト-1.png'
    )
    expect(replaceUnsafeStr('')).toBe('')
  })
})

describe('handleWindowsReservedName', () => {
  it('保留名整段相符（不分大小寫）：無 addStr 回空字串', () => {
    expect(handleWindowsReservedName('CON')).toBe('')
    expect(handleWindowsReservedName('nul')).toBe('')
    expect(handleWindowsReservedName('Com1')).toBe('')
    expect(handleWindowsReservedName('LPT9')).toBe('')
    expect(handleWindowsReservedName('conin$')).toBe('')
  })

  it('保留名整段相符：有 addStr 則附加在原字串後', () => {
    expect(handleWindowsReservedName('CON', '_')).toBe('CON_')
    expect(handleWindowsReservedName('aux', '-x')).toBe('aux-x')
  })

  it('保留名加副檔名（CON.txt）：點換成全形點避開保留', () => {
    expect(handleWindowsReservedName('CON.txt')).toBe('CON．txt')
    expect(handleWindowsReservedName('nul.tar.gz')).toBe('nul．tar．gz')
  })

  it('只是以保留名開頭但不是保留名（CONSOLE、COM10）原樣返回', () => {
    expect(handleWindowsReservedName('CONSOLE')).toBe('CONSOLE')
    expect(handleWindowsReservedName('COM10')).toBe('COM10')
    expect(handleWindowsReservedName('my.CON')).toBe('my.CON')
    expect(handleWindowsReservedName('')).toBe('')
  })
})
