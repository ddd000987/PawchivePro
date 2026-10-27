/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/FileName.ts engine mechanics
 *          (xuejianxianzun): generateFileName shape,
 *          handleOptionalSegments (verbatim), removeEmptyTag,
 *          handleEdgeCases, lengthLimit (folder-aware truncation kept).
 * changes: token set rewritten for Kemono
 *          ({service}/{creator}/{creator_id}/{post_id}/{title}/{date}/
 *          {year}/{month}/{day}/{index}/{file_name}/{ext}/{kind});
 *          Pixiv special tags (multi_image_folder/r18/tags/...) deleted;
 *          removeEmoji switch deleted; rule source = settings namingRule
 *          (+ namingRulePawchive override for Pawchive hosts).
 *          Default: kemono/{service}/{creator}-{creator_id}/
 *                   {post_id}-{title}/{index}-{file_name}.{ext}
 */

import { Config } from '../Config'
import { log } from '../Log'
import { lang } from '../Language'
import { isKemonoHost } from '../preview/previewAssets'
import { settings } from '../setting/Settings'
import { Result } from '../store/StoreType'
import { handleWindowsReservedName, replaceUnsafeStr } from '../Tools'

/** 逸出正則表示式特殊字元（標記與副檔名都可能含正則語法） */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** UTF-8 位元組長度（檔名長度上限以位元組計） */
const textEncoder =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function utf8Length(str: string): number {
  if (textEncoder) {
    return textEncoder.encode(str).length
  }
  // 無 TextEncoder 時依碼點估算位元組數
  let bytes = 0
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

/** 依 UTF-8 位元組上限截斷，不切斷多位元組字元或代理對 */
function truncateByBytes(str: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return ''
  }
  let bytes = 0
  let result = ''
  // for...of 以碼點迭代，代理對不會被拆開
  for (const char of str) {
    const size = utf8Length(char)
    if (bytes + size > maxBytes) {
      break
    }
    result += char
    bytes += size
  }
  return result
}

/** 命名標記表：token → 取值（先 sanitize 再用於檔名） */
interface NamingSchema {
  [tag: string]: {
    value: string
  }
}

class FileName {
  /** 內建預設規則（規則被清空時回退用，避免產出 `.png` 這種垃圾檔名） */
  public readonly defaultRule =
    'kemono/{service}/{creator}-{creator_id}/{post_id}-{title}/{index}-{file_name}.{ext}'

  /** 為一條抓取結果生成檔名（含資料夾路徑） */
  public createFileName(result: Result, host = location.host): string {
    const rule = this.getRule(host) || this.defaultRule
    const schema = this.buildSchema(result)
    let name = this.generateFileName(rule, schema)
    // 規則沒寫 {ext} 時自動補副檔名（沿用 buildSchema 推回並清潔過的副檔名）
    if (!rule.includes('{ext}')) {
      name += '.' + replaceUnsafeStr(schema['{ext}'].value)
    }
    return this.lengthLimit(name, result.postId)
  }

  /** 取當前生效的規則（Pawchive 站專用規則優先；空白回退預設由呼叫端處理） */
  public getRule(host = location.host): string {
    if (!isKemonoHost(host)) {
      const siteRule = settings.get('namingRulePawchive').trim()
      if (siteRule) {
        return siteRule
      }
    }
    return settings.get('namingRule').trim() || this.defaultRule
  }

  /** 由抓取結果建標記表 */
  public buildSchema(result: Result): NamingSchema {
    const date = (result.published || '').slice(0, 10)
    const [year = '', month = '', day = ''] = date.split('-')
    const rawName = result.fileName || result.postId
    // result.ext 缺失時由原名推回，避免 `{file_name}.{ext}` 產生雙副檔名
    const dot = rawName.lastIndexOf('.')
    const fallbackExt = dot > 0 ? rawName.slice(dot + 1) : ''
    const ext = (result.ext || fallbackExt || 'bin').toLowerCase()
    // 附件原名多半自帶副檔名，{file_name} 取主幹，避免 `a.png.png`
    const stem = rawName.replace(
      new RegExp(`\\.${escapeRegExp(ext)}$`, 'i'),
      ''
    )
    return {
      '{service}': { value: result.service || 'unknown' },
      '{creator}': { value: result.creator || result.creatorId },
      '{creator_id}': { value: result.creatorId },
      '{post_id}': { value: result.postId },
      '{title}': { value: result.title || result.postId },
      '{date}': { value: date },
      '{year}': { value: year },
      '{month}': { value: month },
      '{day}': { value: day },
      '{index}': { value: String(result.fileIndex) },
      '{file_name}': { value: stem || result.postId },
      '{ext}': { value: ext },
      '{kind}': { value: result.kind },
    }
  }

  /** 傳入命名規則和標記表，生成檔名（供面板預覽複用） */
  public generateFileName(rule: string, schema: NamingSchema): string {
    const normalizedSchema = this.normalizeSchema(schema)

    // 處理可選片段 [...]（無特殊標記，單遍即可）
    let result = this.handleOptionalSegments(rule, normalizedSchema)

    // 空標記先移除其前面的分隔符
    for (const [tag, obj] of Object.entries(normalizedSchema)) {
      if ((obj.value ?? '') === '') {
        result = this.removeEmptyTag(result, tag)
      }
    }

    // 一次替換所有標記，避免插入值中的文字被當成標記再解析（token 殘留）
    const tags = Object.keys(normalizedSchema)
    if (tags.length > 0) {
      const tagRegExp = new RegExp(tags.map(escapeRegExp).join('|'), 'g')
      result = result.replace(
        tagRegExp,
        (tag) => normalizedSchema[tag].value ?? ''
      )
    }

    // 移除檔名開頭不可用的字元
    result = this.removeStartChar(result)

    // 去掉尾部 /
    if (result.endsWith('/')) {
      result = result.substring(0, result.length - 1)
    }

    // 處理連續的 /
    result = result.replace(/\/{2,100}/g, '/')

    // 邊界處理
    result = this.handleEdgeCases(result)

    return result
  }

  /** 預處理標記值：全形化非法字元（含 ext，避免外部資料夾帶入不安全字元） */
  private normalizeSchema(schema: NamingSchema): NamingSchema {
    const result: NamingSchema = {}

    for (const [tag, obj] of Object.entries(schema)) {
      result[tag] = { value: replaceUnsafeStr(obj.value ?? '') }
    }

    return result
  }

  /**
   * 處理命名規則中的可選片段，即用 [] 包起標記及其前後自訂字元的情況，
   * 如 `[{post_id}-]`。當片段內單個標記值為空時，整個片段移除。
   * （照搬 PBD handleOptionalSegments，拿掉特殊標記雙遍邏輯）
   */
  private handleOptionalSegments(rule: string, schema: NamingSchema): string {
    const matchedBrackets = new Map<number, number>()
    const openBrackets: number[] = []

    // 記錄每一對閉合的方括號。未閉合的不進映射，原樣保留
    for (let index = 0; index < rule.length; index++) {
      if (rule[index] === '[') {
        openBrackets.push(index)
      } else if (rule[index] === ']' && openBrackets.length > 0) {
        matchedBrackets.set(openBrackets.pop()!, index)
      }
    }

    const tagNames = Object.keys(schema)
    if (tagNames.length === 0) {
      return rule
    }

    const tagRegExp = new RegExp(tagNames.map(escapeRegExp).join('|'), 'g')

    /** 處理指定範圍內的字元，內層方括號優先 */
    const processRange = (start: number, end: number): string => {
      let result = ''
      let index = start

      while (index < end) {
        const closeIndex = matchedBrackets.get(index)

        if (closeIndex !== undefined && closeIndex < end) {
          const content = processRange(index + 1, closeIndex)
          let hasNestedSegment = false

          for (
            let childIndex = index + 1;
            childIndex < closeIndex;
            childIndex++
          ) {
            if (matchedBrackets.has(childIndex)) {
              hasNestedSegment = true
              break
            }
          }

          if (hasNestedSegment) {
            // 外層方括號視為普通字元，內層已處理的片段保留
            result += `[${content}]`
          } else {
            const tags =
              rule.slice(index + 1, closeIndex).match(tagRegExp) ?? []

            if (tags.length === 0) {
              // 無標記時方括號是普通字元
              result += `[${content}]`
            } else if (
              tags.length === 1 &&
              (schema[tags[0]].value ?? '') === ''
            ) {
              // 單個空標記使整個可選片段失效
            } else {
              // 有標記的片段去掉方括號
              result += content
            }
          }

          index = closeIndex + 1
          continue
        }

        result += rule[index]
        index++
      }

      return result
    }

    return processRange(0, rule.length)
  }

  // 空標記移除其前面的分隔符（- _ 空格 , & #）
  private removeEmptyTag(rule: string, tag: string): string {
    const symbols = ['-', '_', ' ', ',', '&', '#']
    for (const symbol of symbols) {
      rule = rule.replaceAll(symbol + tag, '')
    }

    return rule
  }

  private readonly checkStartCharList = ['/', ' ']

  private checkStartChar(str: string) {
    return this.checkStartCharList.includes(str[0])
  }

  private removeStartChar(str: string) {
    while (this.checkStartChar(str)) {
      str = str.substring(1, str.length)
    }
    return str
  }

  /** 如果某層路徑是 Windows 保留檔名，在其後添加此字串 */
  private readonly addStr = '[WindowsReservedName]'

  /** 邊界處理：逐層 trim、頭尾點全形化、保留名處理、去空層 */
  public handleEdgeCases(string: string) {
    string = string.replace(/\/{2,100}/g, '/')

    const parts = string.split('/')

    for (let i = 0; i < parts.length; i++) {
      // 去掉每層首尾空格；頭尾的 . 換全形（Chrome 不允許頭尾用 .）
      parts[i] = parts[i].trim().replace(/^\./g, '．').replace(/\.$/g, '．')

      // Windows 保留檔名處理（不含副檔名層由 lengthLimit 保證唯一性）
      parts[i] = handleWindowsReservedName(parts[i], this.addStr)
    }

    string = parts.filter((part) => part !== '').join('/')
    return string
  }

  /** 長度限制：優先截檔名（保 postId 唯一），再截內層資料夾
   * 長度以 UTF-8 位元組計算，且截斷不切斷多位元組字元或代理對
   * @param fullName 全路徑含副檔名
   * @param id 必須保留的唯一字串（postId）
   */
  public lengthLimit(fullName: string, id: string) {
    const limit = Config.fullNameLengthLimit

    if (utf8Length(fullName) <= limit) {
      return fullName
    }

    // 只認最後一層的副檔名，避免資料夾名稱中的點被誤判
    const slashIndex = fullName.lastIndexOf('/')
    const dotIndex = fullName.lastIndexOf('.')
    // 點在最後一層開頭時是隱藏檔名，不是副檔名
    const hasExt = dotIndex > slashIndex + 1
    const ext = hasExt ? fullName.slice(dotIndex) : ''
    const parts = (hasExt ? fullName.slice(0, dotIndex) : fullName).split('/')

    const totalLength = () => utf8Length(parts.join('/')) + utf8Length(ext)

    // 單層上限：避免任一層超過檔案系統的單一名稱限制
    const partLimit = Math.min(255, limit)
    for (let i = 0; i < parts.length; i++) {
      if (utf8Length(parts[i]) > partLimit) {
        parts[i] = truncateByBytes(parts[i], partLimit).trim()
      }
    }

    // 倒序遍歷：先截檔名，再截內層資料夾（保外層完整，避免資料夾四散）
    const lastIndex = parts.length - 1
    for (let i = lastIndex; i >= 0 && totalLength() > limit; i--) {
      const part = parts[i]
      const partBytes = utf8Length(part)
      if (partBytes <= 0) {
        continue
      }

      const excess = totalLength() - limit

      if (i === lastIndex) {
        // 截檔名：至少保留 id 長度；缺 id 則補 `-id…` 保唯一
        const idBytes = id ? utf8Length(id) : 0
        const target = Math.max(partBytes - excess, idBytes)
        let head = truncateByBytes(part, target).trim()
        if (id && !head.includes(id)) {
          const suffix = '-' + id + '…'
          const suffixBytes = utf8Length(suffix)
          if (suffixBytes <= target) {
            head = truncateByBytes(part, target - suffixBytes).trim() + suffix
          } else {
            // id 本身超過可用空間時優先保唯一性
            head = id
          }
        }
        parts[i] = head
      } else {
        // 截資料夾：至少保留 25 bytes 並對齊 25 倍數（避免微小差異產生多個資料夾）
        const minLength = 25
        const ellipsisBytes = utf8Length('…')
        if (partBytes > minLength + ellipsisBytes) {
          const target = Math.max(partBytes - excess - ellipsisBytes, minLength)
          const units = Math.max(Math.floor(target / minLength), 1)
          const keep = Math.min(units * minLength, partBytes)
          if (partBytes - keep > ellipsisBytes) {
            parts[i] = truncateByBytes(part, keep).trim() + '…'
          }
        }
      }
    }

    // 總長回檢：仍有極端超長時，先丟外層資料夾，最後才硬截檔名
    while (totalLength() > limit && parts.length > 1) {
      parts.shift()
    }
    if (totalLength() > limit && parts.length === 1) {
      const budget = Math.max(limit - utf8Length(ext), 0)
      parts[0] = truncateByBytes(parts[0], budget).trim()
    }

    log.warning(lang.transl('_filenameTruncated', fullName))
    return parts.join('/') + ext
  }
}

const fileName = new FileName()
export { fileName }
