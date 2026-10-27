import { beforeEach, describe, expect, it } from 'vitest'
import { downloadStates, reconcileStates } from '../src/download/DownloadStates'
import { store } from '../src/store/Store'

function result(id: string) {
  return { id } as any
}

describe('reconcileStates', () => {
  it('按 id 保留進度、新出現的為 -1、消失的丟棄', () => {
    expect(
      reconcileStates(['a#0', 'b#0', 'c#0'], [1, 0, 1], ['c#0', 'a#0', 'd#0'])
    ).toEqual([1, 1, -1])
  })

  it('空表或缺漏的舊狀態也能安全對帳', () => {
    expect(reconcileStates([], [], ['x#0'])).toEqual([-1])
    expect(reconcileStates(['a#0'], [], ['a#0'])).toEqual([-1])
  })
})

describe('downloadStates 增量對帳', () => {
  beforeEach(() => {
    store.result = []
    downloadStates.clear()
  })

  it('reconcile 依 id 搬移狀態，不清空已完成進度', () => {
    store.result = [result('a#0'), result('b#0'), result('c#0')]
    downloadStates.init()
    downloadStates.setState(0, 1)
    downloadStates.setState(1, 0)

    // 刪掉 a，並在尾端新增 d
    store.result = [result('b#0'), result('c#0'), result('d#0')]
    downloadStates.reconcile()

    expect(downloadStates.states).toEqual([0, -1, -1])
  })

  it('被刪除的項目找不到 id，回執可安全丟棄', () => {
    store.result = [result('a#0'), result('b#0')]
    downloadStates.init()

    expect(downloadStates.findIndexById('b#0')).toBe(1)
    expect(downloadStates.setStateById('b#0', 1)).toBe(true)
    expect(downloadStates.findIndexById('missing#0')).toBe(-1)
    expect(downloadStates.setStateById('missing#0', 1)).toBe(false)
  })
})

describe('isNonRetryableStatus', () => {
  it('429 與 408 可重試，其他 4xx 不重試', async () => {
    const { isNonRetryableStatus } =
      await import('../src/download/DownloadType')
    expect(isNonRetryableStatus(404)).toBe(true)
    expect(isNonRetryableStatus(403)).toBe(true)
    expect(isNonRetryableStatus(429)).toBe(false)
    expect(isNonRetryableStatus(408)).toBe(false)
    expect(isNonRetryableStatus(500)).toBe(false)
    expect(isNonRetryableStatus(0)).toBe(false)
  })
})
