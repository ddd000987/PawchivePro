/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/filter/Filter.ts check-chain
 *          concept (xuejianxianzun)
 * changes: conditions rewritten for Kemono (9 items) —
 *          title/date/file-count/kind/cover/pending/service/post-id-range
 *          (downloaded-dedup lives at download time, not here).
 *          Two levels: checkPost (crawl time) and
 *          checkFile-size + kind re-check (download time, settings may have
 *          changed after crawl — same rationale as PBD's ugoira re-check).
 */

import { settings } from '../setting/Settings'
import { KemonoFileKind } from '../store/StoreType'

/** 抓取時傳入的帖子摘要 */
export interface PostFilterInput {
  service: string
  postId: string
  title: string
  /** ISO 日期字串，可能為空 */
  published: string
  /** 附件數（含封面，不含文字檔） */
  fileCount: number
  /** 帖內含有的附件種類集合 */
  kinds: Set<KemonoFileKind>
  /** 未完整匯入 */
  pending: boolean
}

/** 比較數字字串 ID（先比長度再比字典序，等價於數值比較） */
function compareId(a: string, b: string): number {
  if (a.length !== b.length) {
    return a.length - b.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** 曾被忽略的非數字 ID 篩選值（避免每帖都重複警告） */
const warnedIdBoundaries = new Set<string>()

/** 清洗帖子 ID 篩選值：非純數字視為未設定，避免字串比較造成靜默誤濾 */
export function normalizePostIdBoundary(raw: string): string {
  const value = raw.trim()
  if (value === '' || /^\d+$/.test(value)) {
    return value
  }
  if (!warnedIdBoundaries.has(value)) {
    warnedIdBoundaries.add(value)
    console.warn(`[PawchivePro] 非數字帖子 ID 篩選值已忽略：${value}`)
  }
  return ''
}

class Filter {
  /** 最近一次未通過的原因（展示用） */
  public lastReason = ''

  /** 抓取時檢查一帖是否保留。全部條件取交集。
   * 抓取不做下載記錄去重（去重是下載時的事，見 DownloadControl／Precheck） */
  public checkPost(input: PostFilterInput): boolean {
    // 1. 標題關鍵字
    const keyword = settings.get('filterTitle').trim().toLowerCase()
    if (keyword && !input.title.toLowerCase().includes(keyword)) {
      return this.fail('title')
    }

    // 2. 發布日期範圍
    if (input.published) {
      const date = input.published.slice(0, 10)
      const from = settings.get('filterDateFrom')
      const to = settings.get('filterDateTo')
      if (from && date < from) {
        return this.fail('date')
      }
      if (to && date > to) {
        return this.fail('date')
      }
    }

    // 3. 附件數範圍
    const min = settings.get('filterMinFiles')
    const max = settings.get('filterMaxFiles')
    if (min > 0 && input.fileCount < min) {
      return this.fail('fileCount')
    }
    if (max > 0 && input.fileCount > max) {
      return this.fail('fileCount')
    }

    // 4. 附件種類：帖內至少有一種被允許的種類才保留
    if (!this.hasAllowedKind(input.kinds)) {
      return this.fail('kind')
    }

    // 5. 跳過未完整匯入
    if (input.pending && settings.get('skipPendingPosts')) {
      return this.fail('pending')
    }

    // 6. 服務限定
    const services = settings
      .get('filterServices')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (
      services.length > 0 &&
      !services.includes(input.service.toLowerCase())
    ) {
      return this.fail('service')
    }

    // 7. 帖子 ID 範圍（非數字輸入忽略，不參與比較）
    const idFrom = normalizePostIdBoundary(settings.get('filterPostIdFrom'))
    const idTo = normalizePostIdBoundary(settings.get('filterPostIdTo'))
    if (idFrom && compareId(input.postId, idFrom) < 0) {
      return this.fail('postId')
    }
    if (idTo && compareId(input.postId, idTo) > 0) {
      return this.fail('postId')
    }

    return true
  }

  /** 帖內是否含有所允許的附件種類 */
  public hasAllowedKind(kinds: Set<KemonoFileKind>): boolean {
    for (const kind of kinds) {
      if (this.isKindAllowed(kind)) {
        return true
      }
    }
    return false
  }

  /** 單個附件種類是否允許下載（下載時複查） */
  public isKindAllowed(kind: KemonoFileKind): boolean {
    switch (kind) {
      case 'image':
        return settings.get('downImageFiles')
      case 'video':
        return settings.get('downVideoFiles')
      case 'cover':
        return settings.get('downloadCover')
      case 'other':
        return settings.get('downOtherFiles')
      case 'text':
        return settings.get('textContent') !== 'none'
    }
  }

  /** 下載時檢查單檔體積（bytes，0 = 未知則放行） */
  public checkFileSize(size: number): boolean {
    const limitMiB = settings.get('filterMaxSizeMiB')
    if (limitMiB <= 0 || size <= 0) {
      return true
    }
    if (size > limitMiB * 1024 * 1024) {
      this.lastReason = 'size'
      return false
    }
    return true
  }

  private fail(reason: string): false {
    this.lastReason = reason
    return false
  }
}

const filter = new Filter()
export { filter }
