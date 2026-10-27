/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/DownloadType.d.ts
 *          (xuejianxianzun)
 * changes: Result import repointed to Kemono StoreType; skip reasons
 *          dropped Pixiv-only ones (color/widthHeight/size kept 'size';
 *          novels removed). Firefox blob branches removed (Chromium only).
 */

import { KemonoFileKind } from '../store/StoreType'
import { Result } from '../store/StoreType'

/** HTTP 狀態碼是否為不可重試的 4xx（429 限流、408 逾時可重試，不算） */
export function isNonRetryableStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429 && status !== 408
}

export interface TaskList {
  [id: string]: {
    index: number
    progressBarIndex: number
  }
}

export interface downloadArgument {
  id: string
  result: Result
  index: number
  progressBarIndex: number
  taskBatch: number
  /** true = 全部重下批次：跳過下載記錄去重，真的每個檔都重下 */
  force?: boolean
  /** 回報建立此任務的批次是否已被新批次取代（舊批次殘留任務用） */
  cancelled?: () => boolean
}

// 前台向後台發送的任務資訊（Chromium：使用前台生成的 Blob URL 下載）
export interface SendToBackEndData {
  msg: string
  fileName: string
  /**抓取結果 id（`${postKey}#${fileIndex}`） */
  id: string
  taskBatch: number
  /** 前台生成的 blobURL（大檔直下時沒有，改帶 url） */
  blobURL?: string
  dataURL?: string
  /** 遠端檔案網址：大檔由瀏覽器直接下載，不經分頁記憶體 */
  url?: string
  /** 同名檔案處理方式。未指定時後台預設 overwrite */
  conflictAction?: 'uniquify' | 'overwrite' | 'prompt'
}

// 瀏覽器下載時每個任務的資訊
export interface DownloadSuccessData {
  /** 前台生成的 blob URL */
  blobURLFront: string
  /** 後台也可能會生成 blob URL（保留欄位，Chromium 下為 ''） */
  blobURLBack: string
  /** 抓取結果 id */
  id: string
  /** 所屬下載批次 */
  taskBatch: number
  tabId: number
  uuid: boolean
  /** 當該標記為 true 時，後台不會向前台返回這個檔案的下載結果 */
  noReply?: boolean
  /** 瀏覽器實際保存這個檔案時使用的檔名，可能和前台傳遞的不同 */
  browserSetFilename?: string
}

export interface DownloadSkipData {
  id: string
  type?: KemonoFileKind
  reason:
    | 'duplicate'
    | 'exists'
    | 'size'
    | '404'
    | '500'
    | '4xx'
    | 'excludedType'
    | 'noUrl'
}

// 所有任務的資訊
export interface DownloadListData {
  [key: number]: DownloadSuccessData | null
}

// 下載完成後返回的資訊
export interface DownloadedMsg {
  msg: string
  data: DownloadSuccessData
  err?: string
  /** 後台執行時錯誤的詳細資訊 */
  runtimeError?: string
  /** browser.downloads.download 出錯，未能建立瀏覽器下載項。讓前台暫停下載 */
  saveRequestFailed?: boolean
}
