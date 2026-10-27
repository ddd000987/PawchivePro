import { describe, expect, it } from 'vitest'
import { lang } from '../src/Language'

describe('lang', () => {
  it('預設跟頁面（測試 stub html lang=en）', () => {
    expect(lang.type).toBe('en')
    expect(lang.transl('_startCrawl')).toBe('Start crawling')
  })

  it('{} 佔位符依序替換', () => {
    expect(lang.transl('_crawlComplete', '3', '10')).toBe(
      'Crawl complete: 3 posts / 10 files'
    )
  })

  it('切換語言後取對應文案', () => {
    lang.applyUserLang('zh-tw')
    expect(lang.transl('_startCrawl')).toBe('開始抓取')
    expect(lang.transl('_crawlComplete', '3', '10')).toBe(
      '抓取完成：3帖 / 10檔'
    )
    lang.applyUserLang('en')
  })

  it('缺 key 回傳 key 本身（不拋錯）', () => {
    expect(lang.transl('_notExistKey' as never)).toBe('_notExistKey')
  })

  it('瀏覽器語言標記對應介面語言', () => {
    const toType = (tag: string) => (lang as any).langTagToType(tag)
    expect(toType('zh-TW')).toBe('zh-tw')
    expect(toType('zh-HK')).toBe('zh-tw')
    expect(toType('zh-Hant-TW')).toBe('zh-tw')
    expect(toType('zh-CN')).toBe('zh-cn')
    expect(toType('zh')).toBe('zh-cn')
    expect(toType('ja-JP')).toBe('ja')
    expect(toType('fr-FR')).toBe('en')
    expect(toType('')).toBe('en')
  })

  it('非法語言值回退頁面語言（不炸）', () => {
    lang.applyUserLang('ru')
    expect(lang.type).toBe('en')
    expect(lang.transl('_startCrawl')).toBe('Start crawling')
  })
})
