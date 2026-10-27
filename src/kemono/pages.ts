/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono-family/pages.ts
 * changes: regex extended with discord|afdian (KD type has them but regex
 *          lacks them); added detectPage() helper for content.ts
 *          dev-only page detection output. Mount selectors are KD's values
 *          and depend on the live site layout (confirmed present on
 *          kemono.cr on 2026-10-26); update MOUNT if they break.
 */

import type { KemonoService } from './apiTypes'

/** 服務名白名單（路由／postKey 共用；不在名單內一律視為非法） */
const KEMONO_SERVICES: readonly KemonoService[] = [
  'boosty',
  'dlsite',
  'fanbox',
  'fantia',
  'gumroad',
  'patreon',
  'subscribestar',
  'discord',
  'afdian',
]

const SERVICE_PATTERN = KEMONO_SERVICES.join('|')

/** 創作者頁路徑（尾斜線可選；補 discord|afdian） */
const creatorRegPath = new RegExp(`^/(${SERVICE_PATTERN})/user/([^/]+)/?$`)

/** 帖子頁路徑（尾斜線可選；補 discord|afdian） */
const postRegPath = new RegExp(
  `^/(${SERVICE_PATTERN})/user/([^/]+)/post/([^/]+)/?$`
)

/** 是否為已知服務名（postKey／路由校驗用） */
function isKemonoService(value: string): value is KemonoService {
  return KEMONO_SERVICES.some((service) => service === value)
}

export type PageKind = 'creator' | 'post' | 'other'

export interface CreatorPage {
  kind: 'creator'
  service: KemonoService
  creatorId: string
}

export interface PostPage {
  kind: 'post'
  service: KemonoService
  creatorId: string
  postId: string
}

export type DetectedPage = CreatorPage | PostPage | { kind: 'other' }

/** 掛載點（KD 沿用值，依線上站點佈局而定；選擇器失效時在此更新） */
const MOUNT = {
  creator: '.user-header__actions',
  post: '.post__actions',
} as const

/** 判定目前頁面類型並解析 service/creatorId/postId */
function detectPage(pathname = location.pathname): DetectedPage {
  let m = pathname.match(creatorRegPath)
  if (m) {
    return { kind: 'creator', service: m[1] as KemonoService, creatorId: m[2] }
  }
  m = pathname.match(postRegPath)
  if (m) {
    return {
      kind: 'post',
      service: m[1] as KemonoService,
      creatorId: m[2],
      postId: m[3],
    }
  }
  return { kind: 'other' }
}

/** 帖子唯一鍵：`${service}/${creatorId}/${postId}`。零件非法直接拋錯，
 * 避免產生無法解析的鍵流進 store／去重記錄 */
function makePostKey(
  service: KemonoService,
  creatorId: string,
  postId: string
): string {
  if (!isKemonoService(service) || !creatorId || !postId) {
    throw new Error('invalid postKey parts')
  }
  return `${service}/${creatorId}/${postId}`
}

export {
  KEMONO_SERVICES,
  creatorRegPath,
  postRegPath,
  MOUNT,
  detectPage,
  makePostKey,
  isKemonoService,
}
