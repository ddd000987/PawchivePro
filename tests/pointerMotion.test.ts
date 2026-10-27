import { describe, expect, it } from 'vitest'
import { PointerMotion } from '../src/preview/pointerMotion'

describe('PointerMotion.movedFar', () => {
  it('沒有樣本：不算移動', () => {
    expect(new PointerMotion().movedFar(1000, 200, 30)).toBe(false)
  })

  it('時間窗內移動超過門檻：算移動', () => {
    const m = new PointerMotion()
    m.add(900, 100, 100)
    m.add(950, 120, 100)
    m.add(1000, 135, 100)
    expect(m.movedFar(1000, 200, 30)).toBe(true)
  })

  it('只移動一點點（手抖）：不算移動', () => {
    const m = new PointerMotion()
    for (let t = 800; t <= 1000; t += 10) m.add(t, 100 + (t % 20 ? 3 : -3), 100)
    expect(m.movedFar(1000, 200, 30)).toBe(false)
  })

  it('從時間窗起點前的位置算起：剛開始移動也算得到', () => {
    const m = new PointerMotion()
    m.add(500, 100, 100)
    m.add(990, 140, 100)
    expect(m.movedFar(1000, 200, 30)).toBe(true)
  })

  it('大移動發生在時間窗之前，之後停住：不算移動', () => {
    const m = new PointerMotion()
    m.add(100, 0, 0)
    m.add(200, 300, 0)
    m.add(950, 302, 0)
    expect(m.movedFar(1000, 200, 30)).toBe(false)
  })

  it('很久以前慢慢累積的位移不算', () => {
    const m = new PointerMotion()
    for (let t = 0; t <= 1000; t += 100) m.add(t, t / 10, 0)
    // 每 0.2 秒只移動 20px
    expect(m.movedFar(1000, 200, 30)).toBe(false)
  })

  it('斜向移動用直線距離計算', () => {
    const m = new PointerMotion()
    m.add(900, 0, 0)
    m.add(1000, 18, 24)
    expect(m.movedFar(1000, 200, 30)).toBe(true)
    expect(m.movedFar(1000, 200, 31)).toBe(false)
  })

  it('clear 後清空樣本', () => {
    const m = new PointerMotion()
    m.add(900, 0, 0)
    m.add(1000, 100, 0)
    m.clear()
    expect(m.movedFar(1000, 200, 30)).toBe(false)
  })

  it('舊樣本會被丟掉，但保留起點之前的最後一點', () => {
    const m = new PointerMotion()
    for (let t = 0; t <= 5000; t += 10) m.add(t, 0, 0)
    m.add(5010, 50, 0)
    expect(m.movedFar(5010, 200, 30)).toBe(true)
  })
})
