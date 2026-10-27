import { describe, expect, it } from 'vitest'
import { clampPreviewPosition } from '../src/preview/previewLayout'

const VW = 1000
const VH = 800

describe('clampPreviewPosition', () => {
  it('優先放在游標右側並垂直置中', () => {
    expect(clampPreviewPosition(100, 400, 200, 100, VW, VH)).toEqual({
      x: 124,
      y: 350,
    })
  })

  it('右側空間不足時翻到游標左側', () => {
    expect(clampPreviewPosition(900, 400, 200, 100, VW, VH)).toEqual({
      x: 676,
      y: 350,
    })
  })

  it('左右都放不下時仍留在視窗內（至少 8px 邊距）', () => {
    expect(clampPreviewPosition(10, 400, 990, 100, VW, VH)).toEqual({
      x: 8,
      y: 350,
    })
  })

  it('靠上時夾到 8px', () => {
    expect(clampPreviewPosition(100, 0, 200, 100, VW, VH)).toEqual({
      x: 124,
      y: 8,
    })
  })

  it('靠下時夾到視窗底部（保留 8px）', () => {
    expect(clampPreviewPosition(100, 800, 200, 100, VW, VH)).toEqual({
      x: 124,
      y: 692,
    })
  })

  it('浮層比視窗高時不會產生負座標', () => {
    expect(clampPreviewPosition(100, 400, 200, 900, VW, VH)).toEqual({
      x: 124,
      y: 8,
    })
  })
})
