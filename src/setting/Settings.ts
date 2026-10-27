/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/setting/Settings.ts (xuejianxianzun)
 * changes: preview, download, filter and meta
 *          settings in one store. No Language dependency — option labels
 *          are resolved by the UI layer (SettingsCenter).
 *          本輪：＋previewInfoPlacement（預覽資訊列每欄位的位置表，見
 *          preview/previewInfo.ts；物件型鍵比照 hotkeys 走 set/restore 清洗）。
 */

import { Config } from '../Config'
import { EVT } from '../EVT'
import {
  defaultPreviewInfoPlacement,
  sanitizePreviewInfoPlacement,
} from '../preview/previewInfo'
import type { PreviewInfoPlacement } from '../preview/previewInfo'

/** 預覽設定（注意拼字已修正，非 PBD 的 swicthImageByKeyboard） */
interface PreviewSettings {
  /** 啟用懸停預覽 */
  PreviewWork: boolean
  /** hover 延遲（ms） */
  previewWorkWait: number
  /** 預覽走原圖（false = 縮圖，省流量；下載另由 downloadOriginalImage 決定） */
  previewOriginalImage: boolean
  /** 顯示預覽摘要條 */
  showPreviewWorkTip: boolean
  /** 滑鼠離開卡片後、停在預覽浮層上是否保持顯示（false = 離開卡片即關） */
  keepPreviewOnFloatHover: boolean
  /** 預覽資訊列：每個欄位顯示在圖片上方／下方／不顯示 */
  previewInfoPlacement: PreviewInfoPlacement
  /** hover 封面縮圖也觸發預覽 */
  allowPreviewCoverThumbnail: boolean
  /** 預覽中滾輪切圖 */
  wheelScrollSwitchImageOnPreviewWork: boolean
  /** 在帖子縮圖上顯示下載按鈕*/
  showDownloadBtnOnThumb: boolean
}

/** 下載設定 */
interface DownloadSettings {
  /** 同時下載的檔案數（1–6，非法值回退預設） */
  downloadThread: number
  /** 檔案間下載間隔（秒，0 = 不啟用） */
  downloadInterval: number
  /** 抓取 API 請求間隔（秒，0 = 不等待；寫入時夾取 0–10） */
  crawlInterval: number
  /** 抓取完成並存入快取後自動掛載 */
  autoMountCache: boolean
  /** 抓取完成後自動開始下載 */
  autoStartDownload: boolean
  /** 嚴格按抓取順序下載（等上一個存檔完成才下一個） */
  setFileDownloadOrder: boolean
  /** 帖子文字內容保存方式：none 不保存 / txt / html */
  textContent: 'none' | 'txt' | 'html'
  /** 不下載封面圖 */
  noCoverFile: boolean
  /** 下載圖片走原圖（false = 縮圖；與預覽的 previewOriginalImage 各自獨立，預設原圖） */
  downloadOriginalImage: boolean
}

/** 過濾設定 */
interface FilterSettings {
  /** 標題關鍵字（包含才保留，空 = 不限） */
  filterTitle: string
  /** 發布日期下限 YYYY-MM-DD（空 = 不限） */
  filterDateFrom: string
  /** 發布日期上限 YYYY-MM-DD（空 = 不限） */
  filterDateTo: string
  /** 附件數下限（0 = 不限） */
  filterMinFiles: number
  /** 附件數上限（0 = 不限） */
  filterMaxFiles: number
  /** 下載圖片附件 */
  downImageFiles: boolean
  /** 下載影片附件 */
  downVideoFiles: boolean
  /** 下載其他附件（壓縮包/音訊等） */
  downOtherFiles: boolean
  /** 下載封面圖 */
  downloadCover: boolean
  /** 跳過未完整匯入的帖子（has_full=false） */
  skipPendingPosts: boolean
  /** 限定服務（逗號分隔，空 = 全部） */
  filterServices: string
  /** 帖子 ID 下限（空 = 不限，字串比較） */
  filterPostIdFrom: string
  /** 帖子 ID 上限（空 = 不限） */
  filterPostIdTo: string
  /** 單檔體積上限 MiB（0 = 不限，下載時檢查） */
  filterMaxSizeMiB: number
}

/** 通用設定：語言＋去重＋命名規則 */
interface MetaSettings {
  /** 介面語言（auto 跟頁面 html lang） */
  userSetLang: 'auto' | 'zh-tw' | 'zh-cn' | 'en' | 'ja'
  /** 跳過已下載的檔案：none 不跳過 / record 按下載記錄 / folder 按已授權資料夾
   * 中同路徑已有的檔案 / both 兩者都用 */
  skipDownloaded: 'none' | 'record' | 'folder' | 'both'
  /** 是否在頁面右下角顯示浮動的設定按鈕（關閉後仍可用快捷鍵或工具列圖示開啟） */
  showFloatingButton: boolean
  /** 全域命名規則（含 {token} 與 [...] 可選片段） */
  namingRule: string
  /** Pawchive 站專用規則（空 = 跟全域） */
  namingRulePawchive: string
  /** 使用者自訂的一級快捷鍵。鍵為命令名，未設定的命令不出現 */
  hotkeys: HotkeyMap
}

/** 快捷鍵組合（key 為 KeyboardEvent.code） */
interface HotkeyCombo {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

/** 一級快捷鍵命令（只留 3 個） */
type HotkeyCommand =
  | 'commandToggleCrawlPanel'
  | 'commandStartDefaultCrawl'
  | 'commandTogglePreviewWork'

/** 命令名到快捷鍵組合的映射，使用者未設定的命令不會出現在物件裡 */
type HotkeyMap = Partial<Record<HotkeyCommand, HotkeyCombo>>

/** 一級快捷鍵的預設鍵位（供初始值與「重置為預設」使用） */
const defaultHotkeys: HotkeyMap = {
  commandToggleCrawlPanel: {
    key: 'KeyX',
    ctrl: false,
    alt: true,
    shift: false,
    meta: false,
  },
  commandStartDefaultCrawl: {
    key: 'KeyZ',
    ctrl: false,
    alt: true,
    shift: false,
    meta: false,
  },
  commandTogglePreviewWork: {
    key: 'KeyP',
    ctrl: false,
    alt: true,
    shift: false,
    meta: false,
  },
}

/** 校驗單個快捷鍵組合的形狀（擋掉損壞／跨版本存檔） */
function isHotkeyCombo(v: unknown): v is HotkeyCombo {
  if (!v || typeof v !== 'object') {
    return false
  }
  const c = v as Record<string, unknown>
  return (
    typeof c.key === 'string' &&
    c.key.length > 0 &&
    typeof c.ctrl === 'boolean' &&
    typeof c.alt === 'boolean' &&
    typeof c.shift === 'boolean' &&
    typeof c.meta === 'boolean'
  )
}

/** 清洗快捷鍵表：只收已知命令的有效組合。
 * 缺鍵保持缺（對齊 PBD 語義：「清除」後重載不復活；舊存檔本來就沒
 * hotkeys 鍵，走 defaultSettings 的完整預設，不受影響）。 */
function sanitizeHotkeys(input: unknown): HotkeyMap {
  const out: HotkeyMap = {}
  if (!input || typeof input !== 'object') {
    return out
  }
  const src = input as Record<string, unknown>
  for (const cmd of Object.keys(defaultHotkeys) as HotkeyCommand[]) {
    if (isHotkeyCombo(src[cmd])) {
      const c = src[cmd] as HotkeyCombo
      out[cmd] = {
        key: c.key,
        ctrl: c.ctrl,
        alt: c.alt,
        shift: c.shift,
        meta: c.meta,
      }
    }
  }
  return out
}

type PawchiveSettings = PreviewSettings &
  DownloadSettings &
  FilterSettings &
  MetaSettings

type SettingKey = keyof PawchiveSettings

const defaultSettings: PawchiveSettings = {
  PreviewWork: true,
  previewWorkWait: 400,
  previewOriginalImage: false,
  showPreviewWorkTip: true,
  keepPreviewOnFloatHover: true,
  previewInfoPlacement: defaultPreviewInfoPlacement,
  allowPreviewCoverThumbnail: false,
  wheelScrollSwitchImageOnPreviewWork: true,
  showDownloadBtnOnThumb: true,
  downloadThread: Config.downloadThreadDefault,
  downloadInterval: 0,
  crawlInterval: 0.5,
  autoMountCache: true,
  autoStartDownload: true,
  setFileDownloadOrder: false,
  textContent: 'txt',
  noCoverFile: false,
  downloadOriginalImage: true,
  filterTitle: '',
  filterDateFrom: '',
  filterDateTo: '',
  filterMinFiles: 0,
  filterMaxFiles: 0,
  downImageFiles: true,
  downVideoFiles: true,
  downOtherFiles: true,
  downloadCover: true,
  skipPendingPosts: true,
  filterServices: '',
  filterPostIdFrom: '',
  filterPostIdTo: '',
  filterMaxSizeMiB: 0,
  userSetLang: 'auto',
  skipDownloaded: 'record',
  showFloatingButton: true,
  namingRule:
    'kemono/{service}/{creator}-{creator_id}/{post_id}-{title}/{index}-{file_name}.{ext}',
  namingRulePawchive: '',
  hotkeys: defaultHotkeys,
}

/** 數值鍵的夾取規則（整數鍵先四捨五入） */
const numberRules: Partial<
  Record<SettingKey, { min: number; max: number; integer?: boolean }>
> = {
  previewWorkWait: { min: 0, max: 5000, integer: true },
  downloadThread: { min: 1, max: Config.downloadThreadMax, integer: true },
  downloadInterval: { min: 0, max: 3600 },
  crawlInterval: { min: 0, max: 10 },
  filterMinFiles: { min: 0, max: 100000, integer: true },
  filterMaxFiles: { min: 0, max: 100000, integer: true },
  filterMaxSizeMiB: { min: 0, max: 1048576 },
}

/** 枚舉鍵的白名單（不在名單內回預設） */
const enumWhitelists: Partial<Record<SettingKey, readonly string[]>> = {
  textContent: ['none', 'txt', 'html'],
  userSetLang: ['auto', 'zh-tw', 'zh-cn', 'en', 'ja'],
  skipDownloaded: ['none', 'record', 'folder', 'both'],
}

/** 舊版存檔／匯入檔的相容轉換：舊的 deduplication／skipExistingFiles 合併成
 * skipDownloaded（新鍵已存在則以新鍵為準），並丟掉已移除的舊鍵
 * （dupliStrategy／switchImageByKeyboard 一併忽略）。回傳新物件，不改原物件。 */
function migrateLegacySettings(
  input: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...input }
  const hasLegacy = 'deduplication' in out || 'skipExistingFiles' in out
  if (hasLegacy && out.skipDownloaded === undefined) {
    // 缺的舊鍵按當時的預設值：去重開、略過已存在檔案關
    const dedup =
      typeof out.deduplication === 'boolean' ? out.deduplication : true
    const folder =
      typeof out.skipExistingFiles === 'boolean' ? out.skipExistingFiles : false
    out.skipDownloaded =
      dedup && folder ? 'both' : dedup ? 'record' : folder ? 'folder' : 'none'
  }
  delete out.deduplication
  delete out.dupliStrategy
  delete out.skipExistingFiles
  delete out.switchImageByKeyboard
  return out
}

/** 依鍵清洗單一設定值（set／restore／設定匯入共用）。
 * 型別不符（物件鍵除外）→ 預設值；數值鍵非有限數 → 預設值，其餘夾取；
 * 枚舉鍵不在白名單 → 預設值；物件鍵走各自的逐項清洗。 */
function sanitizeSetting<K extends SettingKey>(
  key: K,
  value: unknown
): PawchiveSettings[K] {
  const def = defaultSettings[key] as PawchiveSettings[K]
  // 物件型鍵先交給各自的清洗函數（每次回新物件，不共用預設引用）
  if (key === 'hotkeys') {
    return sanitizeHotkeys(value) as PawchiveSettings[K]
  }
  if (key === 'previewInfoPlacement') {
    return sanitizePreviewInfoPlacement(value) as PawchiveSettings[K]
  }
  // 型別不符（損壞／跨版本）直接回預設
  if (typeof value !== typeof def) {
    return def
  }
  const rule = numberRules[key]
  if (rule) {
    const v = value as number
    if (!Number.isFinite(v)) {
      return def
    }
    const n = rule.integer ? Math.round(v) : v
    return Math.min(Math.max(n, rule.min), rule.max) as PawchiveSettings[K]
  }
  const whitelist = enumWhitelists[key]
  if (whitelist) {
    return (
      whitelist.includes(value as string) ? value : def
    ) as PawchiveSettings[K]
  }
  // 其餘布林／字串鍵：型別正確即原樣回傳
  return value as PawchiveSettings[K]
}

class Settings {
  private store: PawchiveSettings = { ...defaultSettings }
  private saveTimer = 0

  public get<K extends SettingKey>(key: K): PawchiveSettings[K] {
    return this.store[key]
  }

  public set<K extends SettingKey>(key: K, value: PawchiveSettings[K]): void {
    // 所有鍵統一清洗（擋掉面板輸入與設定匯入的髒資料）
    value = sanitizeSetting(key, value)
    this.store[key] = value
    EVT.fire('settingChange', { key, value })
    this.scheduleSave()
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      chrome.storage.local
        .set({ [Config.settingStoreName]: this.store })
        .catch((e) => console.error('[PawchivePro] save settings failed', e))
    }, 50)
  }

  /** 啟動時呼叫：讀回存檔（缺鍵補預設），完成後發 settingInitialized */
  public async restore(): Promise<void> {
    try {
      const data = await chrome.storage.local.get(Config.settingStoreName)
      const raw = data[Config.settingStoreName] as unknown
      if (raw && typeof raw === 'object') {
        // 舊版存檔先做相容轉換（合併跳過選項、丟掉已移除的鍵）
        const saved = migrateLegacySettings(
          raw as Record<string, unknown>
        ) as Partial<PawchiveSettings>
        for (const key of Object.keys(defaultSettings) as SettingKey[]) {
          // 存檔有此鍵就清洗後寫回（型別不符／非法值回預設）
          if (saved[key] !== undefined) {
            ;(this.store as Record<SettingKey, unknown>)[key] = sanitizeSetting(
              key,
              saved[key]
            )
          }
        }
      }
    } catch (e) {
      console.error('[PawchivePro] restore settings failed, use defaults', e)
    }
    // 快捷鍵表逐項校驗（舊存檔缺 hotkeys 鍵時沿用預設；同時斷開與
    // defaultSettings 的共享引用，避免後續誤改預設）
    this.store.hotkeys = sanitizeHotkeys(this.store.hotkeys)
    // 資訊列位置表同樣逐欄校驗（舊存檔無此鍵；null 存檔會被清洗回預設）
    this.store.previewInfoPlacement = sanitizePreviewInfoPlacement(
      this.store.previewInfoPlacement
    )
    EVT.fire('settingInitialized')
  }
}

const settings = new Settings()

/** 便捷寫法（對齊 PBD 的 setSetting 語義） */
function setSetting<K extends SettingKey>(
  key: K,
  value: PawchiveSettings[K]
): void {
  settings.set(key, value)
}

export {
  settings,
  setSetting,
  defaultSettings,
  defaultHotkeys,
  sanitizeHotkeys,
  sanitizeSetting,
  migrateLegacySettings,
}
export type {
  PreviewSettings,
  DownloadSettings,
  FilterSettings,
  MetaSettings,
  PawchiveSettings,
  SettingKey,
  HotkeyCombo,
  HotkeyCommand,
  HotkeyMap,
}
