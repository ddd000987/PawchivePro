/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 預覽資訊列：9 個可獨立擺放的欄位，每個欄位可選「上方／下方／不顯示」
 * （settings.previewInfoPlacement），預設全部在圖片上方。
 * index 只在多圖時顯示；欄位的預設順序是
 * 序號｜日期｜標題｜附件數｜服務｜快捷鍵，再加上 creator／postId。
 * 純函數模組（不碰 DOM／不 import lang 實例）：翻譯以 t 參數注入，可單測。
 */

import type { LangTextKey } from '../langText'

/** 可擺放的資訊欄位（單帖一格的資訊單元） */
type PreviewInfoField =
  | 'index'
  | 'title'
  | 'creator'
  | 'service'
  | 'postId'
  | 'date'
  | 'files'
  | 'pendingOnly'
  | 'keys'

/** 欄位位置：上方資訊列／下方資訊列／不顯示 */
type PreviewInfoPlace = 'top' | 'bottom' | 'none'

/** 每個欄位的位置表（settings.previewInfoPlacement 的形狀） */
type PreviewInfoPlacement = Record<PreviewInfoField, PreviewInfoPlace>

/** 顯示順序（固定表序，不隨 placement 物件的鍵序變動）。
 * 沿用原摘要條的相對順序（序號→日期→標題→附件數→服務→⚠僅預覽→快捷鍵），
 * 兩個新欄位（創作者／帖子 ID）插在「服務」之後，不擾動使用者已熟悉的排列。
 * ⚙ 面板的列序也用這張表，所以「面板順序＝資訊列順序」。 */
const PREVIEW_INFO_FIELDS: readonly PreviewInfoField[] = [
  'index',
  'date',
  'title',
  'files',
  'service',
  'creator',
  'postId',
  'pendingOnly',
  'keys',
]

/** 合法的位置值（清洗／下拉選單共用） */
const PREVIEW_INFO_PLACES: readonly PreviewInfoPlace[] = [
  'top',
  'bottom',
  'none',
]

/** 位置值型別守衛（清洗與組字共用同一份判斷，避免兩處清單走音） */
function isPreviewInfoPlace(value: unknown): value is PreviewInfoPlace {
  return value === 'top' || value === 'bottom' || value === 'none'
}

/** 預設：全部顯示在上方（＝把原本圖片下方的資訊搬到預覽框上方） */
const defaultPreviewInfoPlacement: PreviewInfoPlacement = {
  index: 'top',
  title: 'top',
  creator: 'top',
  service: 'top',
  postId: 'top',
  date: 'top',
  files: 'top',
  pendingOnly: 'top',
  keys: 'top',
}

/** 逐欄清洗（set／restore／設定匯入共用）：只收合法值，缺欄或髒值回預設。
 * 每次回新物件（不共用 defaultPreviewInfoPlacement，避免被就地改寫）。 */
function sanitizePreviewInfoPlacement(input: unknown): PreviewInfoPlacement {
  const out: PreviewInfoPlacement = { ...defaultPreviewInfoPlacement }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return out
  }
  const src = input as Record<string, unknown>
  for (const field of PREVIEW_INFO_FIELDS) {
    const v = src[field]
    if (isPreviewInfoPlace(v)) {
      out[field] = v
    }
  }
  return out
}

/** 一帖的資訊原料（呼叫方已正規化：published 可為 ''） */
interface PreviewInfoSource {
  /** 0 起算的圖片序號 */
  index: number
  /** 可預覽圖片總數 */
  total: number
  title: string
  creatorId: string
  service: string
  postId: string
  published: string
  /** has_full === false（僅預覽，原檔未匯入） */
  pendingOnly: boolean
}

/** 翻譯函數（注入 lang.transl，維持本模組可單測） */
type Translate = (key: LangTextKey, ...args: string[]) => string

/** 逐欄產生文字（'' 表該欄當下無內容，組字時會被略過） */
function buildPreviewInfoFields(
  src: PreviewInfoSource,
  t: Translate
): Record<PreviewInfoField, string> {
  return {
    // 單圖沒有切換概念，1/1 只是噪音（多圖才顯示序號）
    index: src.total > 1 ? `${src.index + 1}/${src.total}` : '',
    title: src.title,
    creator: src.creatorId,
    service: src.service,
    postId: src.postId,
    date: src.published.slice(0, 10),
    files: t('_previewFiles', String(src.total)),
    pendingOnly: src.pendingOnly ? t('_pendingOnly') : '',
    keys: t('_previewKeys'),
  }
}

/** 依位置表把欄位組成上下兩行（固定順序、略過空欄、`｜` 分隔）。
 * 位置表若有缺欄或髒值，該欄回預設位置而不是消失——避免「設定壞掉＝欄位
 * 靜默不見」；Settings 的清洗已經保證完整表，這裡只是第二道防線。 */
function composePreviewInfo(
  fields: Record<PreviewInfoField, string>,
  placement: PreviewInfoPlacement
): { top: string; bottom: string } {
  const placeOf = (field: PreviewInfoField): PreviewInfoPlace => {
    const p = placement?.[field]
    return isPreviewInfoPlace(p) ? p : defaultPreviewInfoPlacement[field]
  }
  const pick = (where: PreviewInfoPlace) =>
    PREVIEW_INFO_FIELDS.filter((field) => placeOf(field) === where)
      .map((field) => fields[field])
      .filter((text) => text !== '')
      .join('｜')
  return { top: pick('top'), bottom: pick('bottom') }
}

export {
  PREVIEW_INFO_FIELDS,
  PREVIEW_INFO_PLACES,
  defaultPreviewInfoPlacement,
  sanitizePreviewInfoPlacement,
  buildPreviewInfoFields,
  composePreviewInfo,
}
export type {
  PreviewInfoField,
  PreviewInfoPlace,
  PreviewInfoPlacement,
  PreviewInfoSource,
  Translate,
}
