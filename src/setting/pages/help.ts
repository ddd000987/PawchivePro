/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：幫助分頁 */

import { LangTextKey } from '../../langText'
import { helpItem, section } from './controls'

/** 幫助頁分區：標題 key＋條目 key */
const HELP_SECTIONS: Array<{ titleKey: LangTextKey; items: LangTextKey[] }> = [
  {
    titleKey: '_help_quick_title',
    items: ['_help_quick_1', '_help_quick_2', '_help_quick_3', '_help_quick_4'],
  },
  {
    titleKey: '_help_crawl_title',
    items: ['_help_crawl_1', '_help_crawl_2', '_help_crawl_3', '_help_crawl_4'],
  },
  {
    titleKey: '_help_download_title',
    items: [
      '_help_download_1',
      '_help_download_2',
      '_help_download_3',
      '_help_download_4',
      '_help_download_5',
      '_help_download_6',
      '_help_download_7',
      '_help_download_8',
    ],
  },
  {
    titleKey: '_help_cache_title',
    items: [
      '_help_cache_1',
      '_help_cache_2',
      '_help_cache_3',
      '_help_cache_4',
      '_help_cache_5',
    ],
  },
  {
    titleKey: '_help_preview_title',
    items: ['_help_preview_1', '_help_preview_2', '_help_preview_3'],
  },
  {
    titleKey: '_help_trouble_title',
    items: [
      '_help_trouble_1',
      '_help_trouble_2',
      '_help_trouble_3',
      '_help_trouble_4',
      '_help_trouble_5',
      '_help_trouble_6',
    ],
  },
  {
    titleKey: '_help_hotkey_title',
    items: ['_help_hotkey_1', '_help_hotkey_2'],
  },
]

export function buildHelp(host: HTMLDivElement): void {
  HELP_SECTIONS.forEach(({ titleKey, items }, i) => {
    const body = section(host, titleKey)
    // 只展開第一區，其餘預設收合（搜尋時會自動展開）
    if (i > 0) body.parentElement?.classList.add('collapsed')
    for (const k of items) helpItem(body, k)
  })
}
