/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/pawchive.ts (assets section)
 * changes: thumbnail() + URL rules only; the original-image switch is a
 *          parameter, wired by callers (preview and download each pass
 *          their own setting). preview_only rule kept verbatim.
 */

import { isImageFile } from './fileType'
import type { FileItem } from './apiTypes'

/** 縮圖（兩站相同） */
function thumbnail(path: string, host = location.host): string {
  return `https://img.${host}/thumbnail/data${path}`
}

/**
 * Pawchive 原檔規則：
 * - preview_only == true → 永遠縮圖 URL（無視原圖開關）
 * - 非圖片 → https://file.{host}/data{path}
 * - 圖片 → 依 downloadOriginalImage 開關選 file. 或 img. 子域
 */
function fullFile(
  file: FileItem,
  downloadOriginalImage: boolean,
  host = location.host
): string {
  if (file.preview_only) {
    return `https://img.${host}/thumbnail/data${file.path}`
  }
  if (!isImageFile(file)) {
    return `https://file.${host}/data${file.path}`
  }
  return downloadOriginalImage
    ? `https://file.${host}/data${file.path}`
    : `https://img.${host}/thumbnail/data${file.path}`
}

export { thumbnail, fullFile }
