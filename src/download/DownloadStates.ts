/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/DownloadStates.ts
 *          (xuejianxianzun)
 * changes: verbatim port (imports repointed). -1 未開始 / 0 下載中 /
 *          1 已完成。
 */

import { EVT } from '../EVT'
import { store } from '../store/Store'

// 每個任務在陣列中的對應位置用一個數字表示它的下載狀態
type DLStatesI = (-1 | 0 | 1)[]

/** 按 id 對帳下載狀態：仍存在的項目沿用舊進度，新出現的為 -1，
 * 已消失的直接丟棄（避免下載中刪帖時整表被 fill(-1) 清空）。 */
function reconcileStates(
  oldIds: string[],
  oldStates: DLStatesI,
  newIds: string[]
): DLStatesI {
  const byId = new Map<string, -1 | 0 | 1>()
  for (let i = 0; i < oldIds.length; i++) {
    byId.set(oldIds[i], oldStates[i] ?? -1)
  }
  return newIds.map((id) => byId.get(id) ?? -1)
}

// 下載狀態列表
class DownloadStates {
  constructor() {
    this.bindEvents()
  }

  public states: DLStatesI = []

  /** 上次對帳時的 result id 順序，與 states 一一對應 */
  private resultIds: string[] = []

  private bindEvents() {
    // 新一輪抓取：完整重建
    EVT.on(EVT.list.crawlComplete, () => {
      this.init()
    })
    // 抓取結果變化（例如下載中刪帖）：按 id 增量對帳，保留已完成進度
    EVT.on(EVT.list.resultChange, () => {
      this.reconcile()
    })
  }

  // 創建新的狀態列表
  public init() {
    this.resultIds = store.result.map((r) => r.id)
    this.states = new Array(this.resultIds.length).fill(-1)
  }

  // 按 id 把舊狀態搬到新結果的索引；長度對不上時退回完整重建
  public reconcile() {
    const newIds = store.result.map((r) => r.id)
    if (this.states.length !== this.resultIds.length) {
      this.states = new Array(newIds.length).fill(-1)
    } else {
      this.states = reconcileStates(this.resultIds, this.states, newIds)
    }
    this.resultIds = newIds
  }

  /** 依 id 找目前索引（找不到回傳 -1） */
  public findIndexById(id: string) {
    return this.resultIds.indexOf(id)
  }

  /** 依 id 設置狀態；項目已被刪除時回傳 false，讓呼叫端安全忽略回執 */
  public setStateById(id: string, value: -1 | 0 | 1) {
    const index = this.findIndexById(id)
    if (index === -1) {
      return false
    }
    this.states[index] = value
    return true
  }

  // 統計下載完成的數量
  public downloadedCount() {
    let count = 0
    const length = this.states.length
    for (let i = 0; i < length; i++) {
      if (this.states[i] === 1) {
        count++
      }
    }
    return count
  }

  // 接受傳入的狀態數據
  // 目前只有在恢復下載的時候使用
  public replace(states: DLStatesI) {
    this.states = states
  }

  // 恢復之前的下載任務
  // 這會把之前的“下載中”標記復位到“未開始下載”，以便再次下載
  public resume() {
    const length = this.states.length
    for (let i = 0; i < length; i++) {
      if (this.states[i] === 0) {
        this.setState(i, -1)
      }
    }
  }

  // 獲取第一個“未開始下載”標記的索引
  public getFirstDownloadItem() {
    const length = this.states.length
    for (let i = 0; i < length; i++) {
      if (this.states[i] === -1) {
        this.setState(i, 0)
        return i
      }
    }
    return undefined
  }

  // 設置已下載列表中的標記
  public setState(index: number, value: -1 | 0 | 1) {
    this.states[index] = value
  }

  public clear() {
    this.states = []
    this.resultIds = []
  }
}

const downloadStates = new DownloadStates()
export { downloadStates, reconcileStates, DLStatesI }
