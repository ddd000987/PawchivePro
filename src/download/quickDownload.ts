/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader quick-download concept (xuejianxianzun)
 * changes: rewired — uses expandPost + FileName engine +
 *          DownloadRecord, so D/C-key downloads share `${postKey}#${index}`
 *          ids with the main pipeline (dedupe + record interoperate).
 *          Kind switches and size limit are honored like the main chain's
 *          download-time re-check. Records are added on the background
 *          `downloaded` receipt, not optimistically.
 *
 * 語義：D/C 快下＝使用者對單帖的明確指令。使用者已親自選了這帖，
 * 因此不套用標題／日期／服務／ID 範圍等抓取過濾；但仍保留種類開關、
 * 體積限制與去重，與主下載鏈的下載時複查一致。
 */

import { Config } from '../Config'
import { api } from '../kemono/api'
import { expandPost, ExpandedFile } from '../kemono/expand'
import { fileName } from '../filename/FileName'
import { filter } from '../filter/Filter'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { blobToDataURL } from '../Tools'
import { settings } from '../setting/Settings'
import { skipByFolder, skipByRecord } from '../setting/skipMode'
import { downloadInterval } from './DownloadInterval'
import { downloadRecord } from './DownloadRecord'
import { getDirectDownloadThreshold } from './DownloadPolicy'
import { localFileCheck } from './LocalFileCheck'
import { StallWatchdog } from './StallWatchdog'
import { imageFiles, parsePostKey } from '../preview/previewAssets'
import type { PostApiResponse } from '../kemono/apiTypes'
import type { Result } from '../store/StoreType'

/** 批次號：以時間為基底並保證嚴格遞增，頁面重載後也不會與舊批次重號
 * （後台只在批次號變動時才清除該分頁 quick 槽位的 idList） */
let lastBatch = 0
function nextBatch(): number {
  lastBatch = Math.max(Date.now(), lastBatch + 1)
  return lastBatch
}
/** 仍在送出檔案的批次：送出期間回執即使讓表清空也不能刪批次 */
const sending = new Set<number>()
const PENDING_TIMEOUT = 30 * 60 * 1000
/** 待確認回執：batch → (id → Result)。後台 `downloaded` 回來才入庫。
 * （批次號與主下載管線不重疊，DownloadControl 收到後只會釋放 URL） */
const pending = new Map<number, Map<string, Result>>()

// 自己的回執監聽：成功才登記去重，失敗只報錯（不入庫）
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== 'object') {
    return
  }
  const m = msg as {
    msg?: string
    data?: { taskBatch?: unknown; id?: unknown }
    err?: unknown
  }
  if (m.msg !== 'downloaded' && m.msg !== 'download_err') {
    return
  }
  const table =
    typeof m.data?.taskBatch === 'number'
      ? pending.get(m.data.taskBatch)
      : undefined
  if (!table) {
    return
  }
  const result =
    typeof m.data?.id === 'string' ? table.get(m.data.id) : undefined
  if (!result) {
    return
  }
  table.delete(result.id)
  if (
    table.size === 0 &&
    typeof m.data?.taskBatch === 'number' &&
    !sending.has(m.data.taskBatch)
  ) {
    pending.delete(m.data.taskBatch)
  }
  if (m.msg === 'downloaded') {
    void downloadRecord.addRecord(result)
  } else {
    log.error(
      lang.transl(
        '_downloadFailed',
        `${result.id} (${String(m.err ?? 'unknown')})`
      )
    )
  }
})

interface QuickContext {
  postKey: string
  data: PostApiResponse
  service: string
  creatorId: string
  postId: string
  creatorName: string
  title: string
  published: string
}

async function loadContext(postKey: string): Promise<QuickContext | null> {
  const info = parsePostKey(postKey)
  if (!info) {
    return null
  }
  let data: PostApiResponse
  try {
    const res = await api.post(info)
    if (api.isErrorResponse(res)) {
      toast.error(lang.transl('_downloadFailed', res.error))
      return null
    }
    data = res
  } catch (e) {
    toast.error(
      lang.transl('_downloadFailed', e instanceof Error ? e.message : String(e))
    )
    return null
  }
  // 創作者名（檔名用；失敗用 ID 代替，不中斷——與引擎一致）
  let creatorName = info.creatorId
  try {
    const profile = await api.profile({
      service: info.service,
      creatorId: info.creatorId,
    })
    if (!api.isErrorResponse(profile)) {
      creatorName = profile.name || creatorName
    }
  } catch {
    /* 用 ID 代替 */
  }
  return {
    postKey,
    data,
    service: info.service,
    creatorId: info.creatorId,
    postId: info.postId,
    creatorName,
    title: data.post.title ?? '',
    published: data.post.published ?? '',
  }
}

/** 與引擎入庫條目同形的 Result（同 id 體系，同檔名引擎） */
function toResult(
  ctx: QuickContext,
  file: ExpandedFile,
  index: number
): Result {
  return {
    id: `${ctx.postKey}#${index}`,
    postKey: ctx.postKey,
    service: ctx.service,
    creator: ctx.creatorName,
    creatorId: ctx.creatorId,
    postId: ctx.postId,
    title: ctx.title,
    published: ctx.published,
    fileCount: 0,
    pending: false,
    fileUrl: file.fileUrl,
    fileName: file.fileName,
    ext: file.ext,
    kind: file.kind,
    previewOnly: file.previewOnly,
    textData: file.textData,
    fileIndex: index,
  }
}

/**
 * 快下批次串行佇列：連按 D/C 時各組依序執行，不並行打爆連線與間隔設定。
 * 與主批次下載同時進行是刻意允許的（兩者走不同通道，快下用 channel 'quick'，
 * 後台槽位與批次號都獨立），只是快下自己之間不併發。
 */
let queueTail: Promise<void> = Promise.resolve()
/** 執行中＋排隊中的組數 */
let queuedBatches = 0

async function sendEntries(
  ctx: QuickContext,
  picked: Array<{ file: ExpandedFile; index: number }>
): Promise<void> {
  if (picked.length === 0) {
    return
  }
  const ahead = queuedBatches
  queuedBatches++
  if (ahead > 0) {
    toast.show(lang.transl('_quickQueued', String(ahead)))
  }
  const task = queueTail.then(() => runBatch(ctx, picked))
  // 前一組失敗不能卡住後面的組；錯誤仍由本次呼叫的 task 回報給呼叫端
  queueTail = task.then(
    () => undefined,
    () => undefined
  )
  try {
    await task
  } finally {
    queuedBatches--
  }
}

async function runBatch(
  ctx: QuickContext,
  picked: Array<{ file: ExpandedFile; index: number }>
): Promise<void> {
  const batch = nextBatch()
  const table = new Map<string, Result>()
  pending.set(batch, table)
  sending.add(batch)
  // 後台若沒回執（SW 被殺、使用者取消等），時間到就清掉，避免永久洩漏
  window.setTimeout(() => {
    pending.delete(batch)
    sending.delete(batch)
  }, PENDING_TIMEOUT)
  toast.show(lang.transl('_startDownloadN', String(picked.length)))
  // 略過已存在檔案：每次快下都重新確認授權（快捷鍵／點擊帶有使用者操作）
  if (skipByFolder(settings.get('skipDownloaded'))) {
    await localFileCheck.prepare(true)
    localFileCheck.beginBatch()
  }
  try {
    await sendPicked(ctx, picked, batch, table)
  } finally {
    // 送完才允許刪批次；此時表若已空（回執都回來了）就清掉
    sending.delete(batch)
    if (table.size === 0) {
      pending.delete(batch)
    }
  }
}

async function sendPicked(
  ctx: QuickContext,
  picked: Array<{ file: ExpandedFile; index: number }>,
  batch: number,
  table: Map<string, Result>
): Promise<void> {
  for (const { file, index } of picked) {
    const result = toResult(ctx, file, index)
    // 種類開關（與主鏈下載時複查一致）
    if (!filter.isKindAllowed(file.kind)) {
      continue
    }
    // 非文字項必須有網址（文字項 fileUrl 固定為空）；缺網址不 fetch 空字串
    if (file.kind !== 'text' && !file.fileUrl) {
      log.warning(
        '🚫' + lang.transl('_missingFileUrl', result.id),
        'skip-noUrl'
      )
      continue
    }
    // 去重（與主鏈同一記錄本；形狀變了自動退回檔名比對）
    if (
      skipByRecord(settings.get('skipDownloaded')) &&
      (await downloadRecord.checkDeduplication(result))
    ) {
      toast.show(lang.transl('_duplicateSkipped', result.id))
      continue
    }
    const name = fileName.createFileName(result)
    // 資料夾裡同路徑已有檔案就跳過；無法檢查（null）照常下載
    if (
      skipByFolder(settings.get('skipDownloaded')) &&
      (await localFileCheck.exists(name)) === true
    ) {
      toast.show(lang.transl('_existsSkipped', result.id))
      continue
    }
    let blob: Blob | undefined
    /** 大檔改走直下時只帶網址，不生成 Blob */
    let directUrl: string | undefined
    if (file.kind === 'text') {
      // 文字內容已在抓取時備好，不走 fetch
      blob = new Blob([file.textData], {
        type:
          file.ext === 'html'
            ? 'text/html;charset=utf-8'
            : 'text/plain;charset=utf-8',
      })
    } else {
      // 與主鏈共用下載間隔（文字項不 fetch，不必等）
      await downloadInterval.wait()
      // 停滯偵測：一段時間沒收到位元組就中斷，避免一個卡死的連線擋住後面全部
      const controller = new AbortController()
      const watchdog = new StallWatchdog(Config.stallTimeoutMs, () =>
        controller.abort()
      )
      try {
        watchdog.kick()
        const res = await fetch(file.fileUrl, { signal: controller.signal })
        watchdog.kick()
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const threshold = getDirectDownloadThreshold(
          chrome.extension.inIncognitoContext
        )
        const contentLength = parseInt(
          res.headers.get('Content-Length') || '0',
          10
        )
        if (contentLength > threshold) {
          // 已知超過門檻：不整檔讀進分頁記憶體，改由瀏覽器直接下載
          if (!filter.checkFileSize(contentLength)) {
            log.warning('🚫' + lang.transl('_skipSize', result.id), 'skipSize')
            continue
          }
          directUrl = file.fileUrl
        } else {
          const reader = res.body?.getReader()
          if (!reader) {
            // 無法逐塊餵狗，整包讀取時不計停滯以免大檔誤殺
            watchdog.stop()
            blob = await res.blob()
          } else {
            // 沒有 Content-Length 時邊讀邊量，超過門檻就丟掉已讀內容改直下
            const chunks: Uint8Array[] = []
            let loaded = 0
            let skipBySize = false
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              watchdog.kick()
              chunks.push(value)
              loaded += value.length
              if (loaded > threshold) {
                watchdog.stop()
                await reader.cancel()
                chunks.length = 0
                // 已讀部分就超過體積上限時，直下也只會白抓
                if (!filter.checkFileSize(loaded)) {
                  log.warning(
                    '🚫' + lang.transl('_skipSize', result.id),
                    'skipSize'
                  )
                  skipBySize = true
                } else {
                  directUrl = file.fileUrl
                }
                break
              }
            }
            if (skipBySize) {
              continue
            }
            if (!directUrl) {
              const contentType =
                res.headers.get('Content-Type')?.split(';')[0].trim() ||
                'application/octet-stream'
              blob = new Blob(chunks as BlobPart[], { type: contentType })
            }
          }
        }
      } catch (e) {
        const reason = watchdog.stalled
          ? lang.transl('_stallReason', String(Config.stallTimeoutMs / 1000))
          : e instanceof Error
            ? e.message
            : String(e)
        toast.error(
          lang.transl('_downloadFailed', `${file.fileName} (${reason})`)
        )
        continue
      } finally {
        watchdog.stop()
      }
      // 體積開關（此處 blob.size 即真實體積，比 Content-Length 更準）
      if (blob && !filter.checkFileSize(blob.size)) {
        log.warning('🚫' + lang.transl('_skipSize', result.id), 'skipSize')
        continue
      }
    }
    const blobURL = blob ? URL.createObjectURL(blob) : undefined
    table.set(result.id, result)
    try {
      await chrome.runtime.sendMessage({
        msg: 'save_work_file',
        fileName: name,
        id: result.id,
        taskBatch: batch,
        channel: 'quick',
        blobURL,
        url: directUrl,
        dataURL:
          blob && chrome.extension.inIncognitoContext
            ? await blobToDataURL(blob)
            : undefined,
      })
    } catch (e) {
      table.delete(result.id)
      if (blobURL) {
        URL.revokeObjectURL(blobURL)
      }
      toast.error(
        lang.transl(
          '_downloadFailed',
          `${file.fileName} (${e instanceof Error ? e.message : String(e)})`
        )
      )
    }
  }
}

/** 下載一帖全部附件（D 鍵） */
async function downloadPost(postKey: string): Promise<void> {
  const ctx = await loadContext(postKey)
  if (!ctx) {
    return
  }
  const files = expandPost(ctx.data, ctx.creatorName).files
  await sendEntries(
    ctx,
    files.map((file, index) => ({ file, index }))
  )
}

/** 由展開清單回查預覽檔案序號。
 * downloadUrl 產生的路徑形如 `.../data${path}`（縮圖為 `/thumbnail/data${path}`），
 * 因此用 pathname 全等比對；`includes` 會讓 `/ab/cd/x.png` 誤配 `/ab/cd/xx.png`
 * 或 `/zz/ab/cd/x.png`。解析失敗的 URL 直接跳過。 */
function matchFileByPath(files: ExpandedFile[], path: string): number {
  return files.findIndex((f) => {
    if (f.fileUrl === '') {
      return false
    }
    let pathname: string
    try {
      pathname = new URL(f.fileUrl).pathname
    } catch {
      return false
    }
    return pathname === path || pathname.endsWith('/data' + path)
  })
}

/** 下載目前預覽的單張（C 鍵；imageIndex 是預覽圖片列表序號） */
async function downloadSingle(
  postKey: string,
  imageIndex: number
): Promise<void> {
  const ctx = await loadContext(postKey)
  if (!ctx) {
    return
  }
  const item = imageFiles(ctx.data)[imageIndex]
  if (!item?.path) {
    toast.warning(lang.transl('_noSuchImage'))
    return
  }
  // 預覽列表（封面在前）與展開列表（封面在後）順序不同，按 path 回查展開序號
  const files = expandPost(ctx.data, ctx.creatorName).files
  const index = matchFileByPath(files, item.path)
  if (index < 0) {
    toast.warning(lang.transl('_noSuchImage'))
    return
  }
  toast.show(lang.transl('_startDownloadOne'))
  await sendEntries(ctx, [{ file: files[index], index }])
}

export { downloadPost, downloadSingle, matchFileByPath }
