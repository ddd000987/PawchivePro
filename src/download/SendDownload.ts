/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/SendDownload.ts
 *          (xuejianxianzun)
 * changes: anchor-download branch + Firefox/dataURL branches removed
 *          (Chromium + downloads API only). Used for no-reply sidecar
 *          files (content.txt/html) via the existing background channel.
 */

import { SendToBackEndData } from './DownloadType'
import { blobToDataURL } from '../Tools'

// 下載不顯示在下載進度條上的獨立檔案（文字檔等），預設下載成功
class SendDownload {
  /**
   * @param blob 要下載的檔案內容
   * @param name 檔名，可包含資料夾路徑
   * @param conflictAction 同名檔案處理方式。未指定時後台預設 uniquify
   *
   * 注意：no_reply 通道不經過 DownloadRecord（後台不回執）。目前無調用者
   * （文字檔走主下載管線）；若將來使用，調用方需自行登記去重。
   */
  static async noReply(
    blob: Blob,
    name: string,
    conflictAction?: 'uniquify' | 'overwrite' | 'prompt'
  ) {
    const blobURL = URL.createObjectURL(blob)

    const sendData: SendToBackEndData = {
      msg: 'no_reply',
      fileName: name,
      id: 'sidecar',
      taskBatch: -1,
      blobURL,
      dataURL: chrome.extension.inIncognitoContext
        ? await blobToDataURL(blob)
        : undefined,
      conflictAction,
    }
    chrome.runtime.sendMessage(sendData)
  }
}

export { SendDownload }
