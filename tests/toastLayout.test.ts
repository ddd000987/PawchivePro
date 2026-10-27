import { describe, expect, it } from 'vitest'
import { avoidOverlap } from '../src/toastLayout'

const box = (top: number, left = 100) => ({ left, top, width: 120, height: 30 })

describe('avoidOverlap', () => {
  it('沒有其他 toast：位置不變', () => {
    expect(avoidOverlap(box(200), [], 800)).toBe(200)
  })

  it('與已顯示的 toast 重疊：疊到它上方，留 6px 間距', () => {
    expect(avoidOverlap(box(200), [box(200)], 800)).toBe(200 - 30 - 6)
  })

  it('連續多個：依序往上疊，彼此不重疊', () => {
    const shown = [box(200)]
    const tops = [200]
    for (let i = 0; i < 3; i++) {
      const top = avoidOverlap(box(200), shown, 800)
      tops.push(top)
      shown.push(box(top))
    }
    expect(tops).toEqual([200, 164, 128, 92])
  })

  it('水平方向沒有交集：不需要錯開', () => {
    expect(avoidOverlap(box(200, 400), [box(200, 100)], 800)).toBe(200)
  })

  it('只有部分水平重疊也算遮住', () => {
    expect(avoidOverlap(box(200, 180), [box(200, 100)], 800)).toBe(164)
  })

  it('上方放不下（超出視窗頂端）：改疊到下方', () => {
    expect(avoidOverlap(box(20), [box(20)], 800)).toBe(20 + 30 + 6)
  })

  it('上下都放不下：維持原位（接受重疊，不跑出視窗）', () => {
    expect(avoidOverlap(box(10), [box(10)], 40)).toBe(10)
  })
})
