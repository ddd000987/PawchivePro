/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono-family/file-type.ts
 * changes: none (verbatim port).
 */

/**
 * 附件類型判定（站点共享）
 *
 * 仅图片会经由`img.<host>`子域提供缩略图，因此「下载原图」开关只应对图片生效；
 * 视频、压缩包等其他类型一律应使用原始文件URL（`file.`/文件服务器子域）。
 */

/**
 * 视为图片的扩展名集合（以 `img.*` 缩略图服务可正常处理的栅格图为主）
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'avif',
  'jfif',
  'heic',
  'heif',
  'tif',
  'tiff',
  'ico',
])

/** 視為影片的副檔名集合（下載/預覽共用同一判定） */
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'])

/**
 * 取副檔名（小寫、不含點；無副檔名回空字串）。
 * 全專案唯一的後綴解析點：expand、engine、isImageFile 共用。
 */
export function extensionOf(nameOrPath: string): string {
  if (typeof nameOrPath !== 'string') return ''
  const basename = nameOrPath.split('/').pop() ?? nameOrPath
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === basename.length - 1) return ''
  return basename.slice(dotIndex + 1).toLowerCase()
}

/**
 * 根据文件路径/名称的扩展名判断是否为图片附件
 * 优先使用`path`判定（服务器路径，附有扩展名）；`path`无扩展名时回退到`name`
 * @param file 文件信息（API数据）
 */
export function isImageFile(
  file: { name?: string; path?: string } | null | undefined
): boolean {
  if (!file) return false
  const candidates = [file.path, file.name]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    // 无扩展名：尝试下一个候选
    const ext = extensionOf(candidate)
    if (!ext) continue
    // 存在扩展名：无论是否图片都据此定论
    return IMAGE_EXTENSIONS.has(ext)
  }

  return false
}

/** 是否為影片附件（用 name 優先，name 無副檔名才看 path） */
export function isVideoFile(
  file: { name?: string; path?: string } | null | undefined
): boolean {
  if (!file) return false
  for (const candidate of [file.name, file.path]) {
    if (typeof candidate !== 'string') continue
    const ext = extensionOf(candidate)
    if (ext) return VIDEO_EXTENSIONS.has(ext)
  }
  return false
}

/** 依副檔名判定附件種類（封面另由呼叫端覆寫） */
export function fileKind(
  file: { name?: string; path?: string } | null | undefined
): 'image' | 'video' | 'other' {
  if (isImageFile(file)) return 'image'
  if (isVideoFile(file)) return 'video'
  return 'other'
}
