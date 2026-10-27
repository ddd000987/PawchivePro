/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono-family/post-resource.ts
 *          expandPostResource (buildPostMeta file-list section)
 * changes: KD Resource/queue/storage replaced with direct input + Pawchive
 *          settings/previewAssets. File URLs computed once here via
 *          downloadUrl() (url in expand). Text sidecar
 *          (content.txt/html) included as kind=text with inline data.
 */

import { fileKind, extensionOf } from './fileType'
import { settings } from '../setting/Settings'
import { KemonoFileKind } from '../store/StoreType'
import { FileItem, PostApiResponse, isPendingPost } from './apiTypes'
import { downloadUrl } from '../preview/previewAssets'

/** 展開後的一條檔案記錄（對應一條 Result 的檔案部分） */
export interface ExpandedFile {
  kind: KemonoFileKind
  fileName: string
  ext: string
  fileUrl: string
  previewOnly: boolean
  /** kind=text 時為檔案內容（不走 fetch） */
  textData: string
}

export interface ExpandedPost {
  pending: boolean
  files: ExpandedFile[]
}

function kindOf(file: FileItem, isCover: boolean): KemonoFileKind {
  // 先依實際副檔名判定，封面只在真的是圖片時才覆寫成 cover，
  // 避免非圖片封面把 video/other 的種類吃掉
  const kind = fileKind(file)
  return isCover && kind === 'image' ? 'cover' : kind
}

function baseName(file: FileItem): string {
  if (file.name) {
    return file.name
  }
  if (!file.path) {
    return 'file'
  }
  return file.path.split('/').pop() || 'file'
}

/** HTML 轉純文字（簡版：<br> 換行，去標籤，解常見實體） */
function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/** 包一層最小 HTML（離線可讀） */
function toHTML(title: string, html: string): string {
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc}</title></head><body><h1>${esc}</h1>${html}</body></html>`
}

/** 展開一帖：附件 + 封面 + 文字檔。URL 在此一次算好 */
function expandPost(
  data: PostApiResponse,
  creatorName: string,
  host = location.host
): ExpandedPost {
  void creatorName
  if (!data || !data.post) {
    return { pending: false, files: [] }
  }
  const pending = isPendingPost(data.post)
  // 下載有自己的原圖開關，不能沿用預覽鍵（預設 false 會讓批量下載抓到縮圖）
  const original = settings.get('downloadOriginalImage')
  const files: ExpandedFile[] = []

  // 文字內容插最前面（pending 帖同樣提供完整文字，可保存）
  const textMode = settings.get('textContent')
  const title = typeof data.post.title === 'string' ? data.post.title : ''
  const content = typeof data.post.content === 'string' ? data.post.content : ''
  if (textMode !== 'none' && content) {
    const isTxt = textMode === 'txt'
    // 文字項與檔案項共用同一列表（不改資料結構）：kind==='text' 時
    // fileUrl 固定為空字串，內容只在 textData，下游必須先判 kind。
    const textFile: ExpandedFile = {
      kind: 'text',
      fileName: isTxt ? 'content.txt' : 'content.html',
      ext: isTxt ? 'txt' : 'html',
      fileUrl: '',
      previewOnly: false,
      textData: isTxt ? toText(content) : toHTML(title, content),
    }
    files.push(textFile)
  }

  const pushFile = (file: FileItem | null | undefined, isCover: boolean) => {
    // 畸形附件（缺 path）直接跳過，避免後續 split/URL 組裝崩潰
    if (!file || !file.path) {
      return
    }
    const name = baseName(file)
    const url = downloadUrl(file, data, original, host)
    if (!url) {
      return
    }
    files.push({
      kind: kindOf(file, isCover),
      fileName: name,
      ext: extensionOf(name) || 'bin',
      fileUrl: url,
      previewOnly: file.preview_only === true,
      textData: '',
    })
  }

  // canonical 的附件在頂層、扁平回包在 post.attachments；兩邊都收，
  // 以 path 去重（同一檔案只算一次）
  const seen = new Set<string>()
  const pushAttachment = (file: FileItem | null | undefined) => {
    if (!file || !file.path || seen.has(file.path)) {
      return
    }
    seen.add(file.path)
    pushFile(file, false)
  }
  const postAttachments = Array.isArray(data.post.attachments)
    ? data.post.attachments
    : []
  const apiAttachments = Array.isArray(data.attachments) ? data.attachments : []
  for (const file of postAttachments) {
    pushAttachment(file)
  }
  for (const file of apiAttachments) {
    pushAttachment(file)
  }

  // 封面（post.file 不在 attachments 內；若路徑重複則不覆寫既有種類）
  const cover = data.post.file as FileItem | undefined
  if (!settings.get('noCoverFile') && cover?.path && !seen.has(cover.path)) {
    seen.add(cover.path)
    pushFile(cover, true)
  }

  return { pending, files }
}

export { expandPost }
