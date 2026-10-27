/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 下載前整批比對：先依下載記錄、再依本機資料夾，找出「已經有了」的檔案。
 * 命中的由呼叫端直接標成已完成，執行緒就不用逐檔跳過，總進度也從一開始就正確。
 * 比對邏輯用注入的函式，方便單元測試。
 */

import type { Result } from '../store/StoreType'

interface PrecheckOptions {
  results: Result[]
  /** 與 results 一一對應的下載狀態；只比對尚未開始（-1）的項目 */
  states: (-1 | 0 | 1)[]
  useRecord: boolean
  useFolder: boolean
  checkRecord: (r: Result) => Promise<boolean>
  existsMany: (paths: string[]) => Promise<Set<string> | null>
  nameOf: (r: Result) => string
}

interface PrecheckResult {
  /** 依下載記錄命中的索引 */
  byRecord: number[]
  /** 依本機資料夾命中的索引 */
  byFolder: number[]
}

async function precheckExisting(
  opts: PrecheckOptions
): Promise<PrecheckResult> {
  const byRecord: number[] = []
  const byFolder: number[] = []

  let rest: number[] = []
  for (let i = 0; i < opts.results.length; i++) {
    if (opts.states[i] === -1) {
      rest.push(i)
    }
  }

  // 先查記錄：命中的不必再去翻資料夾
  if (opts.useRecord) {
    const remain: number[] = []
    for (const i of rest) {
      if (await opts.checkRecord(opts.results[i])) {
        byRecord.push(i)
      } else {
        remain.push(i)
      }
    }
    rest = remain
  }

  // 剩下的一次丟給資料夾比對（整批只呼叫一次）
  if (opts.useFolder && rest.length > 0) {
    const names = rest.map((i) => opts.nameOf(opts.results[i]))
    const found = await opts.existsMany(names)
    if (found) {
      rest.forEach((i, k) => {
        if (found.has(names[k])) {
          byFolder.push(i)
        }
      })
    }
  }

  return { byRecord, byFolder }
}

export { precheckExisting }
export type { PrecheckOptions, PrecheckResult }
