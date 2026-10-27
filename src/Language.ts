/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/Language.ts (xuejianxianzun)
 * changes: 4 language slots (zh-cn/zh-tw/en/ja); page
 *          auto language from navigator.languages, then <html lang>; settingChange
 *          payload is {key, value} (not PBD's {name, value}). Missing
 *          translations fall back to English, then to the key itself.
 */

import { langText, LangTextKey } from './langText'
import { EVT } from './EVT'
import { settings } from './setting/Settings'

/** 下載器可用的顯示語言 */
type LangTypes = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

/** 頁面語言標記（Kemono/Pawchive 的 html lang，多為 en） */
type PageLangTypes = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

// i18n
class Lang {
  constructor() {
    this.pageLangType = this.getPageLangType()
    this.type = this.pageLangTypeToLangType()
    this.bindEvents()
  }

  /** 目前生效的介面語言（設定為 auto 時跟瀏覽器語言） */
  public type: LangTypes = 'en'

  /** auto 對應的語言（瀏覽器語言優先，其次網頁 lang）。不會動態變化 */
  public pageLangType: PageLangTypes = 'en'

  public readonly langTypes = ['zh-cn', 'zh-tw', 'en', 'ja'] as const

  private readonly flagIndex: Map<LangTypes, number> = new Map([
    ['zh-cn', 0],
    ['zh-tw', 1],
    ['en', 2],
    ['ja', 3],
  ])

  /** 將頁面語言轉為下載器支援的語言 */
  private pageLangTypeToLangType(): LangTypes {
    return this.pageLangType as LangTypes
  }

  /** 外部（設定面板）在 userSetLang 寫入後呼叫，套用新語言 */
  public applyUserLang(value: string) {
    const next: LangTypes = (
      value === 'auto' || !this.isLangType(value)
        ? this.pageLangTypeToLangType()
        : value
    ) as LangTypes
    if (next !== this.type) {
      this.type = next
      this.elList.forEach((el) => {
        this.handleMark(el)
      })
      EVT.fire('langChange')
    }
  }

  private isLangType(value: string): value is LangTypes {
    return (this.langTypes as readonly string[]).includes(value)
  }

  private bindEvents() {
    // 存檔載入完成後套用使用者語言（早於面板建立，無閃爍問題由各面板自理）
    EVT.on(
      EVT.list.settingInitialized,
      () => {
        this.applyUserLang(settings.get('userSetLang'))
      },
      { once: true }
    )
    EVT.on(EVT.list.settingChange, (ev: CustomEventInit) => {
      const data = ev.detail.data as { key: string; value: unknown }
      if (data.key !== 'userSetLang') {
        return
      }
      this.applyUserLang(String(data.value))
    })
  }

  // 「自動」要用的語言：先看瀏覽器語言，再看網頁 <html lang>。
  // Kemono 的 lang 是空字串、Pawchive 是 en，只看網頁會讓「自動」永遠是英文
  private getPageLangType(): PageLangTypes {
    const browser =
      typeof navigator !== 'undefined'
        ? [...(navigator.languages ?? []), navigator.language]
        : []
    for (const tag of browser) {
      if (tag) {
        return this.langTagToType(tag)
      }
    }
    return this.langTagToType(document.documentElement.lang)
  }

  /** BCP 47 語言標記 → 介面語言（繁中含台灣、香港、澳門與 Hant） */
  private langTagToType(tag: string): PageLangTypes {
    const t = tag.toLowerCase()
    if (t.startsWith('zh')) {
      return /hant|-tw|-hk|-mo/.test(t) ? 'zh-tw' : 'zh-cn'
    }
    if (t.startsWith('ja')) {
      return 'ja'
    }
    return 'en'
  }

  // translate
  public transl(name: LangTextKey, ...args: string[]) {
    if (name in langText === false) {
      console.warn(`LangText not found: ${name}`)
      return name
    }
    const texts = langText[name]
    // 缺翻譯回退英文，再回退 key 本身
    let content = texts[this.flagIndex.get(this.type)!] || texts[2] || name
    args.forEach((arg) => (content = content.replace('{}', arg)))
    return content
  }

  // 保存註冊的元素
  // 在註冊的元素裡設置特殊的標記，讓本模組可以動態更新其文本
  private elList: HTMLElement[] = []

  public register(el: HTMLElement) {
    // 同一容器重建後可能再次註冊：避免重複堆疊
    if (!this.elList.includes(el)) {
      this.elList.push(el)
    }
    // 清掉已從文件移除的舊節點，避免註冊表只增不減
    this.elList = this.elList.filter(
      (item) => item === el || item.isConnected !== false
    )
    this.handleMark(el)
  }

  // 查找元素上的標記，設置其文本和屬性
  private handleMark(wrap: HTMLElement) {
    // 設置 innerHTML
    const textEl = wrap.querySelectorAll(
      '*[data-xztext]'
    ) as NodeListOf<HTMLElement>
    for (const el of textEl) {
      // 因為有些文本中含有 html 標籤，所以這裡需要使用 innerHTML 而不是 textContent
      el.innerHTML = this.transl(el.dataset.xztext! as LangTextKey)
    }
    // 元素自身存在 xztext 標記的情況
    const text = wrap.dataset.xztext
    if (text) {
      wrap.innerHTML = this.transl(text as LangTextKey)
    }

    // 設置帶參數的 innerHTML
    const textArgsEl = wrap.querySelectorAll(
      '*[data-xztextargs]'
    ) as NodeListOf<HTMLElement>
    textArgsEl.forEach((el) => this.handleTextArgs(el))
    // 元素自身存在 xztextargs 標記的情況
    const textargs = wrap.dataset.xztextargs
    if (textargs) {
      this.handleTextArgs(wrap)
    }

    // 設置 tip
    const tipEl = wrap.querySelectorAll(
      '*[data-xztip]'
    ) as NodeListOf<HTMLElement>
    for (const el of tipEl) {
      el.dataset.tip = this.transl(el.dataset.xztip! as LangTextKey)
    }
    // 元素自身存在 xztip 標記的情況
    const tip = wrap.dataset.xztip
    if (tip) {
      wrap.dataset.tip = this.transl(tip as LangTextKey)
    }

    // 設置 placeholder
    const placeholderEl = wrap.querySelectorAll(
      '*[data-xzplaceholder]'
    ) as NodeListOf<HTMLElement>
    for (const el of placeholderEl) {
      el.setAttribute(
        'placeholder',
        this.transl(el.dataset.xzplaceholder! as LangTextKey)
      )
    }

    // 設置 title
    const titleEl = wrap.querySelectorAll(
      '*[data-xztitle]'
    ) as NodeListOf<HTMLElement>
    for (const el of titleEl) {
      el.setAttribute('title', this.transl(el.dataset.xztitle! as LangTextKey))
    }
    // 元素自身存在 title 標記的情況
    const title = wrap.dataset.xztitle
    if (title) {
      wrap.setAttribute('title', this.transl(title as LangTextKey))
    }
  }

  private handleTextArgs(el: HTMLElement) {
    const args = el.dataset.xztextargs!.split(',')
    const first = args.shift()
    el.innerHTML = this.transl(first as LangTextKey, ...args)
  }

  // 需要更新已註冊元素的文本時調用此方法
  public updateText(el: HTMLElement, ...args: string[]) {
    // 清空文本的情況
    if (args === undefined || args[0] === '') {
      delete el.dataset.xztext
      delete el.dataset.xztextargs
      el.innerHTML = ''
      return
    }
    // 設置文本
    if (args.length === 1) {
      // 無參數文本
      el.dataset.xztext = args[0]
      el.innerHTML = this.transl(args[0] as LangTextKey)
      delete el.dataset.xztextargs
    } else {
      // 有參數文本
      el.dataset.xztextargs = args.join(',')
      const first = args.shift()
      el.innerHTML = this.transl(first as LangTextKey, ...args)
      delete el.dataset.xztext
    }
  }
}

const lang = new Lang()

export { lang, LangTypes }
