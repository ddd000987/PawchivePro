/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono.ts (fullFile) +
 *               src/sites/pawchive.ts (fullFile) (Kemono-Downloader authors)
 * changes: merged the two families' URL rules into one helper behind
 *          `host.includes('kemono')`. Kemono rule: non-image → murmur
 *          fileserver; image + original → previews.server ?? n1.{host};
 *          image +縮圖 → img.{host} thumbnail. Pawchive rule: preview_only
 *          → always thumbnail; non-image → file.; image → file./img. by
 *          the original-image switch. Callers pass their own flag:
 *          preview uses `previewOriginalImage`, downloads use
 *          `downloadOriginalImage` (see kemono/expand.ts). Also
 *          resolveDownloadUrl() upgrades stored thumbnail URLs at
 *          download time.
 */

import { fileserverFor } from '../kemono/assetsKemono'
import { fullFile as pawchiveFullFile } from '../kemono/assetsPawchive'
import { isImageFile } from '../kemono/fileType'
import { isKemonoService, postRegPath } from '../kemono/pages'
import type {
  FileItem,
  KemonoService,
  PostApiResponse,
} from '../kemono/apiTypes'

/** `patreon/12345/67890` → {service, creatorId, postId}；非法回 null */
function parsePostKey(postKey: string): {
  service: KemonoService
  creatorId: string
  postId: string
} | null {
  const parts = postKey.split('/')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  // 服務名走白名單，避免任意字串被當成站點服務
  if (!isKemonoService(parts[0])) return null
  return {
    service: parts[0],
    creatorId: parts[1],
    postId: parts[2],
  }
}

/** Kemono 系網域（精確匹配，避免 kemono.su.evil.com 之類誤判） */
const KEMONO_HOSTS = ['kemono.su', 'kemono.party', 'kemono.cr']

/** 該 host 是否 Kemono 站（否則按 Pawchive 規則） */
function isKemonoHost(host = location.host): boolean {
  const h = host.toLowerCase().split(':')[0]
  return KEMONO_HOSTS.some((k) => h === k || h.endsWith(`.${k}`))
}

/** 從卡片連結 href 解析 postKey（`patreon/12345/67890`）；非帖子連結回 null */
function parsePostKeyFromHref(href: string): string | null {
  let pathname: string
  try {
    // 只取 pathname，base 用 dummy（相對 href 照樣解析；node 測試環境無 location）
    pathname = new URL(href, 'https://preview.invalid').pathname
  } catch {
    return null
  }
  const m = pathname.match(postRegPath)
  if (!m) return null
  return `${m[1]}/${m[2]}/${m[3]}`
}

/** 封面縮圖（兩站同規則；post.file 可能沒有 path） */
function coverUrl(
  file: Partial<FileItem> | undefined,
  host = location.host
): string {
  if (!file?.path) return ''
  return `https://img.${host}/thumbnail/data${file.path}`
}

/** 去重合併 post.file＋attachments（保持原順序） */
function allFiles(data: PostApiResponse): FileItem[] {
  const list: FileItem[] = []
  const push = (f: FileItem | Partial<FileItem> | undefined) => {
    if (f?.path && !list.some((x) => x.path === f.path)) {
      list.push(f as FileItem)
    }
  }
  push(data.post.file)
  for (const a of data.post.attachments ?? []) push(a)
  for (const a of data.attachments ?? []) push(a)
  return list
}

/** 可在 <img> 顯示的圖片附件 */
function imageFiles(data: PostApiResponse): FileItem[] {
  return allFiles(data).filter((f) => isImageFile(f))
}

/** 單張圖片的顯示 URL（'' 表示無法顯示，如 Kemono 非圖片附件） */
function imageUrl(
  file: FileItem,
  data: PostApiResponse,
  original: boolean,
  host = location.host
): string {
  if (isKemonoHost(host)) {
    if (!isImageFile(file)) return ''
    if (original) {
      // 與非圖片附件共用 fileserverFor 分流，避免原圖固定 n1.{host}
      // 而附件卻走 n1–n4.kemono.cr 的跨域不一致
      const server =
        data.previews?.find((p) => p.path === file.path)?.server ??
        fileserverFor(file.path)
      return `${server}/data${file.path}`
    }
    return `https://img.${host}/thumbnail/data${file.path}`
  }
  return pawchiveFullFile(file, original, host)
}

/** 可下載附件（含非圖片；順序同 allFiles） */
function downloadableFiles(data: PostApiResponse): FileItem[] {
  return allFiles(data)
}

/** 單個附件的下載 URL */
function downloadUrl(
  file: FileItem,
  data: PostApiResponse,
  original: boolean,
  host = location.host
): string {
  if (isKemonoHost(host)) {
    if (!isImageFile(file))
      return `${fileserverFor(file.path)}/data${file.path}`
    return imageUrl(file, data, original, host)
  }
  return pawchiveFullFile(file, original, host)
}

/** 把已存的縮圖網址換回原圖網址。
 * 舊抓取結果／快取是在「預設縮圖」時算好的，下載時才依設定補救；
 * previewOnly 的檔案站方只給縮圖，不能換；非縮圖網址原樣返回。 */
function resolveDownloadUrl(
  result: { fileUrl: string; previewOnly: boolean },
  original: boolean,
  host = location.host
): string {
  const url = result.fileUrl
  if (!original || result.previewOnly) return url
  const prefix = `https://img.${host}/thumbnail/data`
  if (!url.startsWith(prefix)) return url
  const path = url.slice(prefix.length)
  if (!path.startsWith('/')) return url
  if (isKemonoHost(host)) return `${fileserverFor(path)}/data${path}`
  return `https://file.${host}/data${path}`
}

export {
  isKemonoHost,
  parsePostKey,
  parsePostKeyFromHref,
  coverUrl,
  allFiles,
  imageFiles,
  imageUrl,
  downloadableFiles,
  downloadUrl,
  resolveDownloadUrl,
}
