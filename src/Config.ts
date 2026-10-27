/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/Config.ts (xuejianxianzun)
 * changes: removed all Pixiv constants (worksTypeName, ugoira/novel formats,
 *          BookmarkCountLimit, premium, naming rules...); kept thread/retry
 *          limits + platform detection. settingStoreName renamed to avoid
 *          colliding with PBD.
 */

// 預設配置與運行時常量（使用者無法經設定面板修改）
class Config {
  /** 程序名 */
  static readonly appName = 'PawchivePro'
  /** chrome.storage.local 儲存設定用的 key（避免與 PBD 的 xzSetting 衝突） */
  static readonly settingStoreName = 'pawchiveProSettings'
  /** 同時下載的檔案數量最大值 */
  static readonly downloadThreadMax = 6
  /** 預設下載併發數 */
  static readonly downloadThreadDefault = 3
  /** 單檔出錯時的最多嘗試次數（含第一次；5xx／網路錯誤才重試，4xx 直接跳過） */
  static readonly retryMax = 3
  /** 超過此體積（位元組）改由瀏覽器直接下載，不整檔讀進分頁記憶體 */
  static readonly directDownloadThreshold = 200 * 1024 * 1024
  /** 隱身模式要轉成 dataURL，體積上限更嚴，門檻較低 */
  static readonly directDownloadThresholdIncognito = 32 * 1024 * 1024
  /** 連續這麼久（ms）沒收到任何位元組就視為連線卡死，中斷並重試 */
  static readonly stallTimeoutMs = 30000
  /** 檔名總長上限（UTF-8 位元組） */
  static readonly fullNameLengthLimit = 210
  /** API 併發上限（Queue(3, 500ms)） */
  static readonly apiConcurrency = 3
  /** API 併發間隔（ms） */
  static readonly apiInterval = 500
  /** 是否 macOS/iOS（node 測試環境無 navigator 時為 false） */
  static readonly isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  /** 是否 Windows */
  static readonly isWin =
    typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
}

export { Config }
