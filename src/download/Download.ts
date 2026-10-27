/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/Download.ts
 *          (xuejianxianzun)
 * changes: novel/ugoira/color/width-height/imageSize branches
 *          deleted; Kemono additions — kind re-check (settings may change
 *          after crawl), text sidecar (blob from textData, no fetch),
 *          per-post dedup via DownloadedKeys, chrome.* messaging.
 */

import { Config } from '../Config'
import { EVT } from '../EVT'
import { fileName } from '../filename/FileName'
import { filter } from '../filter/Filter'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { downloadRecord } from './DownloadRecord'
import { downloadInterval } from './DownloadInterval'
import { StallWatchdog } from './StallWatchdog'
import { downloadStates } from './DownloadStates'
import {
  downloadArgument,
  DownloadSkipData,
  isNonRetryableStatus,
  SendToBackEndData,
} from './DownloadType'
import { progressBar } from './ProgressBar'
import { settings } from '../setting/Settings'
import { states } from '../store/States'
import { Result } from '../store/StoreType'
import { blobToDataURL, formatMiB, sleep } from '../Tools'
import { getDirectDownloadThreshold, getRetryDelayMs } from './DownloadPolicy'
import { resolveDownloadUrl } from '../preview/previewAssets'

// 下載抓取結果裡的一個檔案
class Download {
  constructor(
    progressBarIndex: number,
    data: downloadArgument,
    downloadStatesIndex: number
  ) {
    this.progressBarIndex = progressBarIndex
    this.downloadStatesIndex = downloadStatesIndex
    this.isStale = data.cancelled ?? (() => false)
    this.beforeDownload(data)
  }

  private progressBarIndex: number
  private downloadStatesIndex: number
  /** 回報本任務所屬批次是否已被新批次取代（全部重下／重開後舊任務用） */
  private isStale: () => boolean = () => false

  /** 目前進行中的 fetch 控制器（停止下載時立即中斷） */
  private controller: AbortController | null = null
  private abortDownload = () => {
    this.controller?.abort()
  }

  private retry = 0 // 重試次數
  private retryInterval: number[] = [] // 每次失敗時，請求本身花費的時間（不含退避等待）

  private sizeChecked = false // 是否對檔案體積進行了檢查
  private skip = false // 這個下載是否應該被跳過
  private error = false // 下載過程中是否出現了無法解決的錯誤

  private get cancel() {
    // isStale：本任務屬於舊批次（中途被全部重下／重開取代），一律停手
    return this.skip || this.error || !states.downloading || this.isStale()
  }

  /** 跳過下載這個檔案 */
  private skipDownload(data: DownloadSkipData, msg?: string) {
    this.skip = true
    // 舊批次殘留不打擾新批次：不寫日誌、不發事件
    if (this.isStale()) {
      return
    }
    if (msg) {
      // 訊息含檔案 id 每條都不同，按跳過原因合併
      log.warning('🚫' + msg, `skip-${data.reason}`)
    }
    if (states.downloading) {
      EVT.fire('skipDownload', data)
    }
  }

  /** 在下載前檢查一些過濾條件，以確認是否應該下載這個檔案 */
  private async beforeDownload(arg: downloadArgument) {
    // 全部重下批次跳過去重檢查，真的每個檔都重下
    // （種類開關、體積上限仍照現行設定檢查）
    const duplicate =
      !arg.force && (await downloadRecord.checkDeduplication(arg.result))
    if (duplicate) {
      return this.skipDownload({
        id: arg.id,
        type: arg.result.kind,
        reason: 'duplicate',
      })
    }

    // 複查附件種類。因為用戶可能在抓取後、下載前改了種類開關
    if (!filter.isKindAllowed(arg.result.kind)) {
      return this.skipDownload({
        id: arg.id,
        type: arg.result.kind,
        reason: 'excludedType',
      })
    }

    // 檢查通過，下載這個檔案
    this.download(arg)
  }

  private async download(arg: downloadArgument): Promise<void> {
    const result = arg.result
    // 獲取檔名
    const _fileName = fileName.createFileName(result)

    // 非文字項必須有下載網址（文字項的 fileUrl 固定為空）；
    // 缺網址時不 fetch 空字串，直接跳過，免得白白重試
    if (result.kind !== 'text' && !result.fileUrl) {
      this.skipDownload(
        { id: arg.id, type: result.kind, reason: 'noUrl' },
        lang.transl('_missingFileUrl', result.id)
      )
      return
    }

    // 重置當前下載記錄條
    this.setProgressBar(_fileName, 0, 0)

    // 間隔等待期間若已暫停／改批就立刻停手，不必等滿間隔
    if (!(await downloadInterval.wait(() => this.cancel))) {
      return
    }
    if (this.cancel) {
      return
    }

    // 文字檔單獨處理：內容已在抓取時備好，直接生成 Blob，不走 Fetch
    if (result.kind === 'text') {
      const blob = new Blob([result.textData], {
        type:
          result.ext === 'html'
            ? 'text/html;charset=utf-8'
            : 'text/plain;charset=utf-8',
      })
      // 文字檔也要套用體積上限（沒有 Content-Length 可先檢查）
      if (!this.checkFinalSize(result, blob.size)) {
        this.setProgressBar(_fileName, 1, 1)
        return
      }
      const blobURL = URL.createObjectURL(blob)

      // 等待上一個檔案下載完成
      await this.waitPreviousFileDownload()

      this.setProgressBar(_fileName, blob.size, blob.size)
      this.sendDownload(blob, blobURL, _fileName, arg.id, arg.taskBatch)
      return
    }

    // 舊抓取結果／快取裡可能是縮圖網址，下載當下按設定換成原圖
    const fileUrl = resolveDownloadUrl(
      result,
      settings.get('downloadOriginalImage')
    )

    // 使用 Fetch API 下載檔案
    const controller = new AbortController()
    this.controller = controller
    // 停止下載時立即中斷在途請求
    EVT.on(EVT.list.downloadStop, this.abortDownload)
    // 暫停也要中斷：否則卡死的連線會一直佔著，續傳後新請求與舊連線搶同一台伺服器
    EVT.on(EVT.list.downloadPause, this.abortDownload)
    // 停滯偵測：一段時間沒收到任何位元組就中斷，走重試流程
    const watchdog = new StallWatchdog(Config.stallTimeoutMs, () =>
      controller.abort()
    )
    // 目前卡在等回應還是讀內容（錯誤訊息用）
    let phase: 'response' | 'body' = 'response'
    let loaded = 0
    // 保存 catch 裡的響應狀態碼與 Retry-After
    let status = 0
    let retryAfter: string | null = null
    // 主動中斷改走直接下載時，不能進到 catch 的重試流程
    let switchedToDirect = false
    // 本次請求開始時間：只量測請求本身耗時，不含退避等待
    let requestStartTime = 0

    try {
      requestStartTime = Date.now()
      watchdog.kick()
      const response = await fetch(fileUrl, {
        signal: controller.signal,
      })
      phase = 'body'
      watchdog.kick()
      status = response.status
      retryAfter = response.headers.get('Retry-After')

      // 狀態碼錯誤，拋出異常進入重試流程
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`)
      }

      // 獲取檔案總體積（伺服器偶爾不帶 Content-Length，直接設 0）
      const contentLength = response.headers.get('Content-Length') || '0'
      const total = parseInt(contentLength, 10)

      // 檢查體積設置，不通過則中斷下載
      const sizeCheck = this.checkSize(result, total)
      if (!sizeCheck) {
        // 體積跳過時把進度條拉滿，避免用戶以為卡住
        this.setProgressBar(_fileName, 1, 1)
      }

      if (this.cancel) {
        controller.abort()
        return
      }

      // 大檔不進分頁記憶體：已知超過門檻就直接放棄 fetch，改由瀏覽器下載
      const directThreshold = getDirectDownloadThreshold(
        chrome.extension.inIncognitoContext
      )
      if (total > directThreshold) {
        switchedToDirect = true
        controller.abort()
        // 已不再讀內容，後面的排隊等待不算停滯
        watchdog.stop()
        await this.waitPreviousFileDownload()
        if (this.cancel) {
          return
        }
        progressBar.errorColor(this.progressBarIndex, false)
        this.setProgressBar(_fileName, 1, 1)
        this.sendDirectDownload(fileUrl, _fileName, arg.id, arg.taskBatch)
        return
      }

      // 使用 ReadableStream 讀取響應體，跟蹤下載進度
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []

      while (true) {
        if (this.cancel) {
          reader.cancel()
          return
        }

        const { done, value } = await reader.read()
        if (done) break

        watchdog.kick()
        chunks.push(value)
        loaded += value.length

        // 沒有 Content-Length 時只能邊讀邊量：超過門檻就丟掉已讀內容改直下
        if (loaded > directThreshold) {
          switchedToDirect = true
          watchdog.stop()
          await reader.cancel()
          chunks.length = 0
          // 已讀部分就超過使用者的體積上限時，直下也只會白抓
          if (!this.checkFinalSize(result, loaded)) {
            this.setProgressBar(_fileName, 1, 1)
            return
          }
          await this.waitPreviousFileDownload()
          if (this.cancel) {
            return
          }
          progressBar.errorColor(this.progressBarIndex, false)
          this.setProgressBar(_fileName, 1, 1)
          this.sendDirectDownload(fileUrl, _fileName, arg.id, arg.taskBatch)
          return
        }

        this.setProgressBar(_fileName, loaded, total)
      }

      // 讀完了，後面的排隊等待不算停滯
      watchdog.stop()

      // 組裝 Blob
      const contentType =
        response.headers.get('Content-Type')?.split(';')[0].trim() ||
        'application/octet-stream'
      const file: Blob = new Blob(chunks as BlobPart[], { type: contentType })

      // 無 Content-Length 時上面無從檢查，組包後用實際大小回查一次
      if (!this.checkFinalSize(result, file.size)) {
        this.setProgressBar(_fileName, 1, 1)
        return
      }

      // 沒有 content-length 時，下載完畢後把進度拉滿
      if (file.size) {
        this.setProgressBar(_fileName, file.size, file.size)
      }
      progressBar.errorColor(this.progressBarIndex, false)

      if (this.cancel) {
        return
      }

      // 生成下載連結
      const blobURL = URL.createObjectURL(file)

      // 等待上一個檔案下載完成
      await this.waitPreviousFileDownload()

      // 發送下載任務
      this.sendDownload(file, blobURL, _fileName, arg.id, arg.taskBatch)
    } catch (error) {
      if (switchedToDirect || this.cancel) {
        return
      }

      // AbortError 表示請求被主動中斷，不需要重試；
      // 但由停滯偵測中斷的要照一般失敗走重試
      if ((error as Error).name === 'AbortError' && !watchdog.stalled) {
        return
      }

      if (watchdog.stalled) {
        const secs = String(Config.stallTimeoutMs / 1000)
        const stallMsg =
          phase === 'response'
            ? lang.transl('_downloadStalledNoResponse', arg.id, secs)
            : lang.transl('_downloadStalled', arg.id, secs, formatMiB(loaded))
        log.warning(stallMsg, 'downloadStalled')
        // 用戶看不到 console，停滯要用 toast 提醒
        toast.warning(stallMsg)
        // 中斷產生的 status 可能是上一輪殘留，停滯一律當網路錯誤（0）
        status = 0
        retryAfter = null
      }

      log.debug(
        'Download error: ' +
          (error instanceof Error ? error.message : String(error))
      )

      // 4xx 是請求本身有問題（404 等），重試不會成功：直接跳過
      // （429 限流、408 逾時除外，走正常重試流程）
      if (isNonRetryableStatus(status)) {
        progressBar.errorColor(this.progressBarIndex, true)
        log.error(
          lang.transl('_cannotDownload', arg.id, String(status)),
          'cannotDownload'
        )
        log.error(lang.transl('_noMoreRetry'))
        return this.skipDownload({
          id: arg.id,
          reason: '4xx',
        })
      }

      // 記錄請求本身花費的時間（不含退避與下載間隔等待）
      if (this.retryInterval.length > 10) {
        this.retryInterval.shift()
      }
      this.retryInterval.push(Date.now() - requestStartTime)

      progressBar.errorColor(this.progressBarIndex, true)
      this.retry++

      if (this.retry >= Config.retryMax) {
        // 重試達到最大次數
        this.afterReTryMax(status, arg.id)
      } else {
        // 先退避（429／503 依 Retry-After），避免瞬間打爆配額
        if (
          !(await this.waitBackoff(
            getRetryDelayMs(this.retry, status, retryAfter)
          ))
        ) {
          return
        }
        // 再走一次使用者設定的下載間隔
        if (!(await downloadInterval.wait(() => this.cancel))) {
          return
        }
        if (this.cancel) {
          return
        }
        return this.download(arg)
      }
    } finally {
      watchdog.stop()
      EVT.off(EVT.list.downloadStop, this.abortDownload)
      EVT.off(EVT.list.downloadPause, this.abortDownload)
      if (this.controller === controller) {
        this.controller = null
      }
    }
  }

  /** 設置下載的這個檔案的進度條資訊 */
  private setProgressBar(name: string, loaded: number, total: number) {
    // 舊批次（停止／重開後）不能再寫進度條，否則會蓋掉新批次同序號的條
    if (this.isStale()) {
      return
    }
    // 在下載初始化和下載完成時，立即更新進度條
    // 在下載途中，使用節流來更新進度條
    progressBar[loaded === total ? 'setProgress' : 'setProgressThrottle'](
      this.progressBarIndex,
      {
        name,
        loaded,
        total,
      }
    )
  }

  /** 當重試達到最大次數時 */
  private afterReTryMax(status: number, fileId: string) {
    const errorMsg = lang.transl('_cannotDownload', fileId, String(status))

    // 狀態碼為 0 可能是磁碟空間不足或網路錯誤，暫停下載讓用戶檢查
    if (status === 0) {
      const timeLimit = 10000
      const result = this.retryInterval.filter((val) => val <= timeLimit)
      if (result.length >= Config.retryMax) {
        log.error(errorMsg, 'cannotDownload')
        log.error(lang.transl('_diskMaybeFull'))
        return EVT.fire('requestPauseDownload')
      }
    }

    // 5xx／網路錯誤已按上限重試，仍失敗則暫時跳過，最後再重試
    log.log(lang.transl('_retryLater'))
    this.error = true
    EVT.fire('downloadError', fileId)
  }

  /** 檢查體積設置 */
  private checkSize(result: Result, size: number) {
    if (!this.sizeChecked) {
      this.sizeChecked = true
      if (size === 0) {
        return true
      }

      const check = filter.checkFileSize(size)
      if (!check) {
        this.skipDownload(
          {
            id: result.id,
            reason: 'size',
          },
          lang.transl('_skipSize', result.id)
        )
      }
      return check
    }

    return true
  }

  /** 以實際檔案大小複查體積（無 Content-Length 或文字檔用） */
  private checkFinalSize(result: Result, size: number) {
    if (size <= 0) {
      return true
    }
    const check = filter.checkFileSize(size)
    if (!check) {
      this.skipDownload(
        {
          id: result.id,
          reason: 'size',
        },
        lang.transl('_skipSize', result.id)
      )
    }
    return check
  }

  /** 等待上一個檔案下載完成 */
  // 啟用“檔案下載順序”時，等待上一個檔案下載完成後再開始下載這個檔案
  private async waitPreviousFileDownload() {
    while (settings.get('setFileDownloadOrder')) {
      // 暫停／停止後等待者直接返回，避免手持 blobURL 空轉卡住；
      // 後續 sendDownload 的 cancel 檢查會釋放資源
      if (this.cancel) {
        return
      }
      if (
        this.downloadStatesIndex === 0 ||
        downloadStates.states[this.downloadStatesIndex - 1] === 1
      ) {
        return
      }

      await sleep(50)
    }
  }

  /** 可中斷的退避等待：取消時回傳 false（每 200ms 檢查一次） */
  private async waitBackoff(ms: number): Promise<boolean> {
    const step = 200
    let waited = 0
    while (waited < ms) {
      if (this.cancel) {
        return false
      }
      const chunk = Math.min(step, ms - waited)
      await sleep(chunk)
      waited += chunk
    }
    return !this.cancel
  }

  private async sendDownload(
    blob: Blob,
    blobURL: string,
    fileName: string,
    id: string,
    taskBatch: number
  ) {
    // 如果任務已停止，就不再下載這個檔案
    if (this.cancel) {
      // 釋放 blob URL
      URL.revokeObjectURL(blobURL)
      return
    }

    const sendData: SendToBackEndData = {
      msg: 'save_work_file',
      fileName: fileName,
      id,
      taskBatch,
      blobURL,
      // 隱身視窗裡 SW 讀不到前台的 blobURL，改發 dataURL（與 PBD sendDataURL 同理）
      dataURL: chrome.extension.inIncognitoContext
        ? await blobToDataURL(blob)
        : undefined,
    }

    this.sendToBackground(sendData)
  }

  /** 大檔直下：只把網址交給後台，由瀏覽器自己下載，不經分頁記憶體 */
  private sendDirectDownload(
    url: string,
    fileName: string,
    id: string,
    taskBatch: number
  ) {
    // 如果任務已停止，就不再下載這個檔案
    if (this.cancel) {
      return
    }

    this.sendToBackground({
      msg: 'save_work_file',
      fileName,
      id,
      taskBatch,
      url,
    })
  }

  /** 送出「交給瀏覽器下載」的訊息（blob 與直下兩條通道共用） */
  private sendToBackground(sendData: SendToBackEndData) {
    try {
      chrome.runtime.sendMessage(sendData)
      EVT.fire('sendBrowserDownload', {
        id: sendData.id,
        fileName: sendData.fileName,
      })
    } catch (error) {
      let msg = lang.transl('_unknownRefresh', (error as Error).message)
      if ((error as Error).message.includes('Extension context invalidated')) {
        msg = lang.transl('_extUpdated')
      }
      log.error(msg)
    }
  }
}

export { Download }
