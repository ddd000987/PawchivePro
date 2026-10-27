/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/utils/Utils.ts (xuejianxianzun)
 *   - replaceUnsafeStr (+ fullWidthDict) / handleWindowsReservedName /
 *     deepCopy / sleep; throttle/debounce semantics aligned with
 *     Kemono-Downloader src/utils/helpers/js-utils.ts debounce
 * changes: extracted only site-agnostic helpers; Pixiv-coupled
 *          helpers (findWorkIdFromElement, getTagFromURL...) NOT ported.
 */

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 可中斷的等待：時間到回 true；signal abort（含呼叫前已 abort）回 false */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener('abort', onAbort)
  })
}

/** 節流：每 wait ms 最多執行一次（取最後一次參數，保留 this 與回傳值） */
// 泛型約束需要 any 才能接受任意參數型別的函式（unknown[] 會因參數逆變而拒收）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait = 100
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastThis: unknown = null
  let result: ReturnType<T> | undefined
  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now()
    const remaining = wait - (now - last)
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      result = func.apply(this, args)
    } else {
      lastArgs = args
      // 刻意保存 this，節流後延遲呼叫時要還原原本的呼叫端 this
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastThis = this
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now()
          timer = null
          if (lastArgs) result = func.apply(lastThis, lastArgs)
          lastArgs = null
          lastThis = null
        }, remaining)
      }
    }
    return result
  }
}

// 不安全的字元（控制字元），需移除（轉義寫法，避免源碼混入字面控制字元）
// derived from PBD Utils.unsafeStr
const unsafeStr = new RegExp(
  // 刻意匹配控制字元（見上方註解）
  // eslint-disable-next-line no-control-regex
  '[\\u0000\\u0001-\\u001f\\u007f-\\u009f\\u00A0\\u00ad\\u0600-\\u0605\\u061c\\u06dd\\u070f\\u08e2\\u180e\\u2000-\\u200f\\u202a-\\u202f\\u205f\\u2060-\\u2064\\u2066-\\u206f\\ufdd0-\\ufdef\\ufeff\\ufff9-\\ufffb\\ufffe\\uffff]',
  'g'
)

// 半角 → 全角對照表（非法檔名字元全形化，照搬 KD constructFilename 思路）
const fullWidthDict = new Map<string, string>([
  ['\\', '＼'],
  ['/', '／'],
  [':', '：'],
  ['?', '？'],
  ['"', '＂'],
  ['<', '＜'],
  ['>', '＞'],
  ['*', '＊'],
  ['|', '｜'],
  ['~', '～'],
])

/**
 * 移除控制字元，並把半角非法字元替換成全角版本。
 * @param keepPathSeparator 是否保留路徑分隔符 /（命名模板含資料夾時用 true）
 */
function replaceUnsafeStr(str: string, keepPathSeparator = false): string {
  str = str.replace(unsafeStr, '')
  for (const [halfWidth, fullWidth] of fullWidthDict) {
    if (keepPathSeparator && halfWidth === '/') continue
    str = str.replaceAll(halfWidth, fullWidth)
  }
  return str
}

/** Windows 保留檔名，不可單獨作為檔名（不分大小寫） */
const windowsReservedNames = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'CONIN$',
  'CONOUT$',
]

function handleWindowsReservedName(str: string, addStr?: string): string {
  for (const name of windowsReservedNames) {
    if (str.toUpperCase() === name) {
      return addStr ? str + addStr : ''
    }
    if (str.toUpperCase().startsWith(name + '.')) {
      return str.replace(/\./g, '．')
    }
  }
  return str
}

/** Blob 轉 dataURL（隱身視窗下載用：SW 讀不到前台的 blobURL） */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 位元組數轉 MiB 字串（一位小數，日誌用） */
function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export {
  formatMiB,
  sleep,
  sleepAbortable,
  throttle,
  replaceUnsafeStr,
  handleWindowsReservedName,
  blobToDataURL,
}
