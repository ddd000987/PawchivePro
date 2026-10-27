/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/serviceWorker/background.ts
 * changes:
 *   - browser.* → chrome.* (no webextension-polyfill)
 *   - DELETED: save_novel_*, save_novel_series_file, save_work_file_a_download
 *     (novel pipeline + ugoira a.download fast path not in scope)
 *   - KEPT: save_work_file + save_description_file/no_reply (content.txt/html)
 *     + clearDownloadsTempData (download temp cleanup, NOT novel-specific)
 *     + batchNo/idList/dlData persistence for SW hibernation survival
 */

import './folder/folderService'

interface SaveFileMsg {
  msg: string
  fileName?: string
  id?: string
  taskBatch?: number
  blobURL?: string
  dataURL?: string
  /** 遠端檔案網址：大檔由瀏覽器直接下載（非 blob/data URL，不可 revoke） */
  url?: string
  blob?: Blob
  conflictAction?: chrome.downloads.FilenameConflictAction
  /** 快下通道與主下載分開記錄批次／idList */
  channel?: 'quick'
}

interface DlRecord {
  blobURLFront?: string
  blobURLBack?: string
  id?: string
  tabId: number
  taskBatch?: number
  uuid?: boolean
  noReply?: boolean
  browserSetFilename?: string
  /** batchNo/idList 的分槽鍵（重啟後仍能釋放正確的 id） */
  slot?: string
}

type BatchNoMap = Record<string, number>
type IdListMap = Record<string, string[]>

let dlData: Record<string, DlRecord> = {}
let batchNo: BatchNoMap = {}
let idList: IdListMap = {}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || tab.id === undefined) return
  chrome.tabs
    .sendMessage(tab.id, { msg: 'click_icon' })
    .catch((e) => console.warn('Send click_icon failed', e))
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ batchNo: {}, idList: {} })
})

function setData(data: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(data)
}

let restorePromise: Promise<void> | undefined
function restoreDownloadData(): Promise<void> {
  if (!restorePromise) {
    restorePromise = chrome.storage.local
      .get(['batchNo', 'idList', 'dlData'])
      .then((data) => {
        batchNo = (data.batchNo as BatchNoMap) || {}
        idList = (data.idList as IdListMap) || {}
        dlData = (data.dlData as Record<string, DlRecord>) || {}
      })
  }
  return restorePromise
}

let saveChain: Promise<void> = Promise.resolve()
function saveDLData(): Promise<void> {
  const save = () =>
    setData({ dlData }).catch((e) => console.error('save dlData failed', e))
  saveChain = saveChain.then(save, save)
  return saveChain
}

/** batchNo/idList 的分槽鍵：快下用 `${tabId}:quick`，其餘沿用純 tabId */
function slotOf(tabId: number, channel?: string): string {
  return channel === 'quick' ? `${tabId}:quick` : String(tabId)
}

async function releaseDownloadId(
  slot: string,
  taskBatch?: number,
  id?: string
) {
  if (id === undefined || batchNo[slot] !== taskBatch) return
  const ids = idList[slot]
  const idx = ids?.indexOf(id) ?? -1
  if (idx < 0) return
  ids.splice(idx, 1)
  await setData({ idList }).catch((e) => console.error('save idList failed', e))
}

function isMsg(msg: unknown): msg is SaveFileMsg {
  return (
    !!msg &&
    typeof msg === 'object' &&
    'msg' in (msg as Record<string, unknown>)
  )
}

function getFileURL(msg: SaveFileMsg): string {
  // 大檔直下優先：遠端網址直接交給 downloads API
  if (msg.url) return msg.url
  if (msg.dataURL) return msg.dataURL
  if (msg.blobURL) return msg.blobURL
  console.error('No usable download URL')
  return ''
}

function revoke(url?: string) {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* noop */
    }
  }
}

chrome.runtime.onMessage.addListener((rawMsg, sender) => {
  if (!isMsg(rawMsg)) {
    console.warn('Invalid msg:', rawMsg)
    return false
  }
  const msg = rawMsg
  // 是否已回覆過 download_err，避免外層 catch 重複回執
  let replied = false
  ;(async () => {
    try {
      await restoreDownloadData()
      const tabId = sender.tab?.id
      if (tabId === undefined) return
      const conflictAction = msg.conflictAction || 'uniquify'

      // 作品檔案下載
      if (msg.msg === 'save_work_file') {
        const slot = slotOf(tabId, msg.channel)
        if (batchNo[slot] !== msg.taskBatch) {
          batchNo[slot] = msg.taskBatch as number
          idList[slot] = []
          setData({ batchNo, idList })
        }
        // storage 不一致或剛被 clearDownloadsTempData 清掉時補回陣列
        idList[slot] ??= []
        if (!idList[slot].includes(msg.id as string)) {
          idList[slot].push(msg.id as string)
          setData({ idList })
          const data: DlRecord = {
            // 直下模式沒有前台 blobURL；遠端 url 不記進這兩個欄位，
            // 避免完成回執時被當成 blob URL 處理
            blobURLFront: msg.blobURL,
            blobURLBack: '',
            id: msg.id,
            tabId,
            taskBatch: msg.taskBatch,
            uuid: false,
            slot,
          }
          try {
            const url = getFileURL(msg)
            data.blobURLBack = url.startsWith('blob:') ? url : ''
            const downloadId = await chrome.downloads.download({
              url,
              filename: msg.fileName,
              conflictAction,
              saveAs: false,
            })
            dlData[downloadId] = data
            await saveDLData()
          } catch (error) {
            console.error('Create download failed', error)
            revoke(data.blobURLFront)
            revoke(data.blobURLBack)
            await releaseDownloadId(slot, data.taskBatch, data.id)
            const runtimeError =
              error instanceof Error ? error.message : String(error)
            replied = true
            await chrome.tabs
              .sendMessage(tabId, {
                msg: 'download_err',
                data,
                err: runtimeError,
                // 建立請求即失敗（非法檔名／非法 URL 等）重試也不會好，
                // 前台收到後直接暫停（見 DownloadControl 的 saveRequestFailed 分支）
                saveRequestFailed: true,
              })
              .catch((e) => console.error('Reply download_err failed', e))
          }
        }
      }

      // 文字檔（content.txt/html）走 no-reply 模式（仿 PBD save_description_file）
      if (msg.msg === 'no_reply' || msg.msg === 'save_description_file') {
        try {
          const url = getFileURL(msg)
          const downloadId = await chrome.downloads.download({
            url,
            filename: msg.fileName,
            conflictAction,
            saveAs: false,
          })
          dlData[downloadId] = {
            blobURLFront: msg.blobURL,
            blobURLBack: url.startsWith('blob:') ? url : '',
            id: msg.id,
            taskBatch: msg.taskBatch,
            tabId,
            uuid: false,
            noReply: true,
            slot: slotOf(tabId, msg.channel),
          }
          await saveDLData()
        } catch (error) {
          console.error('Create text download failed', error)
          revoke(msg.blobURL)
        }
      }

      if (msg.msg === 'clearDownloadsTempData') {
        if (sender.tab?.id !== undefined) {
          // 只清主下載槽；快下槽由 quickDownload 自己的回執清理
          const tid = String(sender.tab.id)
          delete idList[tid]
          delete batchNo[tid]
          setData({ batchNo, idList })
        }
      }
    } catch (error) {
      // 外層兜底：避免 async IIFE 的例外變成無人處理的 rejection（下載無聲丟失）
      console.error('Handle message failed', error)
      const tabId = sender.tab?.id
      if (msg.msg === 'save_work_file' && !replied && tabId !== undefined) {
        const runtimeError =
          error instanceof Error ? error.message : String(error)
        const data: DlRecord = {
          blobURLFront: msg.blobURL,
          blobURLBack: '',
          id: msg.id,
          tabId,
          taskBatch: msg.taskBatch,
          uuid: false,
          slot: slotOf(tabId, msg.channel),
        }
        chrome.tabs
          .sendMessage(tabId, {
            msg: 'download_err',
            data,
            err: runtimeError,
            saveRequestFailed: true,
          })
          .catch((e) => console.error('Reply download_err failed', e))
      }
    }
  })()
  return false
})

const UUIDRegexp =
  /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/

chrome.downloads.onChanged.addListener(async (detail) => {
  await restoreDownloadData()
  const rec = dlData[detail.id]
  if (!rec) return
  let msg = ''
  let err = ''
  if (detail.filename?.current) {
    if (detail.filename.current.match(UUIDRegexp) !== null) rec.uuid = true
    rec.browserSetFilename = detail.filename.current
  }
  if (detail.state?.current === 'complete') msg = 'downloaded'
  if (detail.error?.current) {
    msg = 'download_err'
    err = detail.error.current
    await releaseDownloadId(
      rec.slot ?? String(rec.tabId),
      rec.taskBatch,
      rec.id
    )
  }
  if (msg) {
    if (!rec.noReply) {
      chrome.tabs
        .sendMessage(rec.tabId, { msg, data: rec, err })
        .catch((e) => console.error('Send download result failed', e))
    }
    revoke(rec.blobURLFront)
    revoke(rec.blobURLBack)
    delete dlData[detail.id]
  }
  await saveDLData()
})

async function clearData() {
  await restoreDownloadData()
  for (const key of Object.keys(idList)) {
    const tabId = parseInt(key, 10)
    try {
      await chrome.tabs.get(tabId)
    } catch {
      // 用原字串 key 刪除，避免 '12:quick' 被當成 12 而誤刪主槽
      delete idList[key]
      delete batchNo[key]
    }
  }
  await setData({ batchNo, idList })
}

// MV3 service worker 的 setInterval 會在休眠時被清掉、不可靠；
// 改為每次 SW 啟動時做一次惰性清理（喚醒頻率足以涵蓋孤兒標籤頁）
void clearData().catch((e) => console.error('clear stale tabs failed', e))
