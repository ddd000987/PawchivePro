/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/Log.ts (xuejianxianzun)
 * changes: 輸出到 console，同時寫入記憶體環形緩衝區，供面板的日誌區顯示；
 *          相同 key 在短時間內的重複訊息會合併成一筆並累加次數。
 *          debug 訊息只在開發版，或 localStorage.pawchiveProDebug === '1'
 *          時輸出到 console，不進緩衝區。
 *          API surface kept: log/success/warning/error(msg, key?).
 */

import { EVT } from './EVT'

// webpack 的 mode 會替換 process.env.NODE_ENV；tsconfig 只載入 chrome 型別，
// 所以這裡手動宣告（與 content.ts 同做法）
declare const process: { env: { NODE_ENV?: string } }

type LogLevel = 'log' | 'success' | 'warning' | 'error'

interface LogEntry {
  /** 時間戳（毫秒） */
  time: number
  level: LogLevel
  msg: string
  /** 合併後的出現次數，未重複時為 1 */
  count: number
}

/** 緩衝區上限：超過後丟棄最舊的，避免長時間運行無限增長 */
const MAX_ENTRIES = 300
/** 同 key 的重複訊息合併視窗（毫秒） */
const MERGE_WINDOW = 10000
const DEBUG_STORAGE_KEY = 'pawchiveProDebug'

class Log {
  /** 各 key 上次輸出的內容（相同內容不重複刷屏） */
  private refreshCache = new Map<string, string>()
  private buffer: LogEntry[] = []
  /** 合併記憶：key → 最近一次實際輸出的那筆（lastTime 是它輸出的時間） */
  private mergeMap = new Map<string, { entry: LogEntry; lastTime: number }>()
  private debugEnabled = false

  constructor() {
    this.debugEnabled = this.readDebugFlag()
    // 新一輪抓取／下載開始時清空去重記憶，否則第二輪相同進度文字永遠不顯示；
    // 合併記憶也要清，否則新一輪開頭的訊息會被上一輪的合併視窗吞掉
    const reset = () => {
      this.refreshCache.clear()
      this.mergeMap.clear()
    }
    EVT.on(EVT.list.crawlStart, reset)
    EVT.on(EVT.list.downloadStart, reset)
  }

  private readDebugFlag() {
    if (process.env.NODE_ENV !== 'production') {
      return true
    }
    // 隱私模式或被禁用時 localStorage 會拋錯，當作沒開
    try {
      return localStorage.getItem(DEBUG_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  }

  /** 開關 debug 輸出，並寫入 localStorage 讓下次載入沿用 */
  public setDebug(on: boolean) {
    this.debugEnabled = on
    try {
      if (on) {
        localStorage.setItem(DEBUG_STORAGE_KEY, '1')
      } else {
        localStorage.removeItem(DEBUG_STORAGE_KEY)
      }
    } catch {
      // 寫不進去就只在本次生效
    }
  }

  /** 除錯訊息：只輸出到 console，不進日誌區 */
  public debug(msg: string) {
    if (!this.debugEnabled) {
      return
    }
    console.debug(`[PawchivePro] ${msg}`)
  }

  public log(msg: string, key = '') {
    this.add('log', msg, key)
  }
  public success(msg: string, key = '') {
    this.add('success', msg, key)
  }
  public warning(msg: string, key = '') {
    this.add('warning', msg, key)
  }
  public error(msg: string, key = '') {
    this.add('error', msg, key)
  }

  private add(level: LogLevel, msg: string, key: string) {
    if (!msg) {
      return
    }

    const mergeKey = key || msg
    const now = Date.now()
    const hit = this.mergeMap.get(mergeKey)
    // 條目可能已被環形緩衝區擠掉，那就當作新的一筆
    if (
      hit &&
      now - hit.lastTime < MERGE_WINDOW &&
      this.buffer.includes(hit.entry)
    ) {
      hit.entry.count++
      hit.entry.msg = msg
      EVT.fire('logAdd')
      return
    }

    this.print(level, msg)
    const entry: LogEntry = { time: now, level, msg, count: 1 }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.shift()
    }
    this.mergeMap.set(mergeKey, { entry, lastTime: now })
    EVT.fire('logAdd')
  }

  private print(level: LogLevel, msg: string) {
    switch (level) {
      case 'success':
        console.log(`%c[PawchivePro] ${msg}`, 'color: green')
        break
      case 'warning':
        console.warn(`[PawchivePro] ${msg}`)
        break
      case 'error':
        console.error(`[PawchivePro] ${msg}`)
        break
      default:
        console.log(`[PawchivePro] ${msg}`)
    }
  }

  /** 目前緩衝區內容的拷貝（由舊到新） */
  public entries(): readonly LogEntry[] {
    return this.buffer.map((e) => ({ ...e }))
  }

  public clear() {
    this.buffer = []
    this.mergeMap.clear()
    EVT.fire('logAdd')
  }

  /** 固定 key 的刷新日誌：同 key 同內容只輸出一次，避免退化成刷屏 */
  public refresh(msg: string, key: string) {
    if (this.refreshCache.get(key) === msg) {
      return
    }
    this.refreshCache.set(key, msg)
    this.log(`${key}: ${msg}`)
  }
}

const log = new Log()
export { log }
export type { LogEntry, LogLevel }
