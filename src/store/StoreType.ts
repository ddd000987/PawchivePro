/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/store/StoreType.d.ts (xuejianxianzun)
 * changes: Result rewritten for Kemono — dropped Pixiv-only
 *          fields (ugoiraInfo/novelMeta/bmk/bookmark/rank/series/tags/...)
 *          and added service/creator/creatorId/postId/published/fileUrl/
 *          fileName/ext/kind/pending/previewOnly. IDData uses Kemono page
 *          keys instead of numeric artwork ids.
 */

/** 附件種類（由副檔名判定，見 kemono/fileType.ts） */
export type KemonoFileKind = 'image' | 'video' | 'other' | 'cover' | 'text'

/** 抓取目標的唯一鍵：`${service}/${creatorId}/${postId}` */
export type PostKey = string

export interface IDData {
  /** 帖子唯一鍵（PostKey） */
  id: string
  /** 固定為 'post'（Kemono 只有帖子一種抓取單位） */
  type: 'post'
  /** 帖子標題（列表頁已知時帶上，未知則 ''） */
  title?: string
}

/** addResult 時的數據，所有屬性可選、無 index */
export interface ResultOptional {
  /** 帖子唯一鍵，也是 Result.id 的前綴 */
  postKey?: string
  /** 站點服務，如 patreon */
  service?: string
  /** 創作者顯示名 */
  creator?: string
  /** 創作者 ID */
  creatorId?: string
  /** 帖子 ID */
  postId?: string
  /** 帖子標題 */
  title?: string
  /** 帖子發布時間（ISO 字串） */
  published?: string
  /** 該帖附件總數（含封面，不含文字檔） */
  fileCount?: number
  /** 未完整匯入（has_full=false） */
  pending?: boolean
  /** 附件下載 URL（已按原圖/縮圖開關算好） */
  fileUrl?: string
  /** 附件原始檔名 */
  fileName?: string
  /** 副檔名（小寫，不含點） */
  ext?: string
  /** 附件種類 */
  kind?: KemonoFileKind
  /** 僅預覽可存取（Pawchive preview_only；無視原圖開關） */
  previewOnly?: boolean
  /** 文字檔內容（kind=text 時有效，不走 fetch） */
  textData?: string
  /** 該附件在帖子內的序號（從 0 開始） */
  fileIndex?: number
}

/** 內部抓取結果：屬性必填，並加上全域唯一的 id */
export type Result = Required<
  {
    /** 全域唯一 id：`${postKey}#${fileIndex}` */
    id: string
  } & ResultOptional
>
