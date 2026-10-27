/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono-family/api-types/
 *   (common.ts, posts.ts, post.ts, profile.ts)
 * changes: merged into one file; DateTimeString/Nullable inlined
 *          to stay dependency-free.
 */

export type KemonoService =
  | 'patreon'
  | 'fanbox'
  | 'discord'
  | 'fantia'
  | 'afdian'
  | 'boosty'
  | 'gumroad'
  | 'subscribestar'
  | 'dlsite'

export interface PostInfo {
  service: KemonoService
  creatorId: string
  postId: string
}

/** 檔案物件 */
export interface FileItem {
  name?: string
  path: string
  /**
   * 原始檔未匯入（僅預覽/縮圖可存取）
   * 目前僅 Pawchive 回傳：只能從 img.<host> 縮圖子域取得，無視「下載原圖」開關
   */
  preview_only?: boolean
}

export type Attachment = FileItem

/** 列表項（posts API 陣列元素） */
export interface PostsApiItem {
  /** 附件（不含 file 封面） */
  attachments: Attachment[]
  /** 封面（不在 attachments 內） */
  file: Partial<FileItem>
  id: string
  published: string
  service: KemonoService
  substring?: string
  title: string
  /** 創作者 ID */
  user: string
  has_full?: boolean
  preview_state?: string | null
  origin?: string | null
}

export type PostsApiResponse = PostsApiItem[]

export interface PostPreview {
  name: string
  path: string
  /** 如 'https://n3.kemono.cr' */
  server: string
  type: 'thumbnail'
}

export interface Post {
  id: string
  user: string
  service: KemonoService
  title: string
  content: string
  embed: Record<string, unknown>
  shared_file: boolean
  added: string
  published: string
  edited: string
  file: Partial<FileItem>
  attachments: Attachment[]
  has_full?: boolean
  preview_state?: string | null
  origin?: string | null
}

/** 詳情 canonical 根類型 */
export interface PostApiResponse {
  post: Post
  attachments: Attachment[]
  previews?: PostPreview[]
  props?: Record<string, unknown>
}

/** 創作者 profile */
export interface ProfileApiResponse {
  id: string
  public_id: string | null
  service: KemonoService
  name: string
  indexed: string
  updated: string
  chat_count?: number
  /** Kemono 有；Pawchive 無 */
  post_count?: number
  share_count?: number
  relation_id: string | null
}

/** 錯誤形狀：{ error: string }（以 Object.hasOwn(data,'error') 判斷） */
export interface APIErrorResponse {
  error: string
}

export function isErrorResponse(data: unknown): data is APIErrorResponse {
  return (
    !!data &&
    typeof data === 'object' &&
    Object.hasOwn(data as Record<string, unknown>, 'error')
  )
}

/**
 * 是否為「待匯入」帖子（僅有預覽、原檔未匯入）。
 * 語義定案：只有明確的 has_full === false 才算 pending；
 * 缺欄位視為完整（Kemono 在一般帖子上不回這個欄位）。
 */
export function isPendingPost(
  p: { has_full?: boolean } | null | undefined
): boolean {
  return p?.has_full === false
}
