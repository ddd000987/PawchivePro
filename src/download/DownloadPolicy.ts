/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 大檔直下門檻與下載重試退避的純函式（可單元測試）。
 */

import { Config } from '../Config'

/** 重試退避的基礎延遲：第 1 次重試 2s，之後每次加倍 */
export const retryBaseDelayMs = 2000
/** 一般退避的等待上限 30s */
export const retryBackoffMaxMs = 30000
/** Retry-After 的等待上限 120s */
export const retryAfterMaxMs = 120000

/** 依視窗模式取得大檔直下門檻（隱身模式要轉 dataURL，門檻較低） */
export function getDirectDownloadThreshold(incognito: boolean): number {
  return incognito
    ? Config.directDownloadThresholdIncognito
    : Config.directDownloadThreshold
}

/**
 * 解析 Retry-After 標頭，回傳毫秒；無法解析時回 undefined。
 * 支援秒數與 HTTP 日期兩種格式；已過去的日期回 0。
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return undefined
  }
  // 純數字 = 秒數
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000
  }
  const time = Date.parse(trimmed)
  if (Number.isNaN(time)) {
    return undefined
  }
  return Math.max(0, time - now)
}

/**
 * 計算重試前的等待時間（ms）。retry 從 1 開始。
 * 429／503 且有可解析的 Retry-After 時改用它（上限 120s），
 * 其餘情況走 2s、4s、8s… 的指數退避（上限 30s）。
 */
export function getRetryDelayMs(
  retry: number,
  status = 0,
  retryAfter?: string | null,
  now = Date.now()
): number {
  if ((status === 429 || status === 503) && retryAfter) {
    const parsed = parseRetryAfter(retryAfter, now)
    if (parsed !== undefined) {
      return Math.min(retryAfterMaxMs, parsed)
    }
  }
  // 上限次數很小，仍夾住指數避免極端值溢位
  const exponent = Math.max(0, Math.min(retry - 1, 16))
  return Math.min(retryBackoffMaxMs, retryBaseDelayMs * 2 ** exponent)
}
