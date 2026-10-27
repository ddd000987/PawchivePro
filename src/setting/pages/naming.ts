/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：命名分頁（規則輸入、預覽、使用說明、範例、可用標籤） */

import { fileName } from '../../filename/FileName'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { store } from '../../store/Store'
import { toast } from '../../Toast'
import { copyFallback, helpItem, inputRow, section } from './controls'

/** 命名標籤一覽：token → 說明文案 key（與 FileName.buildSchema 對齊） */
const NAMING_TAGS: Array<{ token: string; descKey: LangTextKey }> = [
  { token: '{service}', descKey: '_nt_service' },
  { token: '{creator}', descKey: '_nt_creator' },
  { token: '{creator_id}', descKey: '_nt_creator_id' },
  { token: '{post_id}', descKey: '_nt_post_id' },
  { token: '{title}', descKey: '_nt_title' },
  { token: '{date}', descKey: '_nt_date' },
  { token: '{year}', descKey: '_nt_year' },
  { token: '{month}', descKey: '_nt_month' },
  { token: '{day}', descKey: '_nt_day' },
  { token: '{index}', descKey: '_nt_index' },
  { token: '{file_name}', descKey: '_nt_file_name' },
  { token: '{ext}', descKey: '_nt_ext' },
  { token: '{kind}', descKey: '_nt_kind' },
]

/** 命名規則範例：規則字面值＋說明文案 key */
const NAMING_EXAMPLES: Array<{ rule: string; descKey: LangTextKey }> = [
  {
    rule: 'kemono/{service}/{creator}-{creator_id}/{post_id}-{title}/{index}-{file_name}.{ext}',
    descKey: '_namingEx1',
  },
  {
    rule: 'kemono/{creator}/{year}-{month}/[{date}_]{post_id}/{index}.{ext}',
    descKey: '_namingEx2',
  },
  {
    rule: 'kemono/{creator}/{post_id}_{index}.{ext}',
    descKey: '_namingEx3',
  },
  {
    rule: 'kemono/{creator}/{kind}/{post_id}-{index}-{file_name}.{ext}',
    descKey: '_namingEx4',
  },
  {
    rule: 'kemono/{creator}/[{date} ]{title}/{file_name}.{ext}',
    descKey: '_namingEx5',
  },
]

export class NamingView {
  private namingPreview!: HTMLDivElement

  public build(host: HTMLDivElement): void {
    const onChange = () => this.refresh()
    const body = section(host, '_secNaming')
    inputRow(body, 'namingRule', '_f_namingRule', 'text', onChange)
    inputRow(
      body,
      'namingRulePawchive',
      '_f_namingRulePawchive',
      'text',
      onChange
    )
    this.namingPreview = document.createElement('div')
    this.namingPreview.className = 'pwpSC-row pwpSC-status'
    body.appendChild(this.namingPreview)
    this.refresh()

    // 使用說明
    const helpBody = section(host, '_namingHelpTitle')
    for (let i = 1; i <= 5; i++) {
      helpItem(helpBody, `_namingHelp${i}` as LangTextKey)
    }

    // 規則範例：規則用 code 顯示，按鈕複製整條規則
    const exBody = section(host, '_namingExamplesTitle')
    for (const { rule, descKey } of NAMING_EXAMPLES) {
      const row = document.createElement('div')
      row.className = 'pwpSC-row pwpSC-exRow'
      row.dataset.key = descKey
      const code = document.createElement('code')
      code.textContent = rule
      const desc = document.createElement('span')
      desc.className = 'pwpSC-exDesc'
      desc.dataset.xztext = descKey
      desc.textContent = lang.transl(descKey)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.xztext = '_copy'
      btn.textContent = lang.transl('_copy')
      btn.addEventListener('click', () => void this.copyTag(rule))
      row.append(code, desc, btn)
      exBody.appendChild(row)
    }

    // 可用標籤：每顆按鈕點了直接複製 token
    const tagsBody = section(host, '_namingTagsTitle')
    const grid = document.createElement('div')
    grid.className = 'pwpSC-row pwpSC-tagGrid'
    grid.dataset.key = '_namingTagsTitle'
    for (const { token, descKey } of NAMING_TAGS) {
      const row = document.createElement('div')
      row.className = 'pwpSC-row pwpSC-tagRow'
      row.dataset.key = token
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = token
      btn.title = lang.transl(descKey)
      btn.dataset.xztitle = descKey
      btn.addEventListener('click', () => void this.copyTag(token))
      const desc = document.createElement('span')
      desc.dataset.xztext = descKey
      desc.textContent = lang.transl(descKey)
      row.append(btn, desc)
      grid.appendChild(row)
    }
    tagsBody.appendChild(grid)
  }

  /** 命名規則預覽（有抓取結果時顯示第一條的檔名；頁面未建好時不動作） */
  public refresh(): void {
    if (!this.namingPreview) return
    const first = store.result[0]
    if (!first) {
      this.namingPreview.textContent = lang.transl('_namingNoPreview')
      return
    }
    try {
      const sample = fileName.createFileName(first)
      this.namingPreview.textContent = lang.transl('_namingPreview', sample)
    } catch {
      this.namingPreview.textContent = String(first.id)
    }
  }

  /** 複製命名標籤（Clipboard API 優先，失敗退回 textarea 方案） */
  private async copyTag(tag: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tag)
      } else {
        copyFallback(tag)
      }
      toast.success(lang.transl('_tagCopied', tag))
    } catch {
      try {
        copyFallback(tag)
        toast.success(lang.transl('_tagCopied', tag))
      } catch {
        toast.error(lang.transl('_tagCopyFail'))
      }
    }
  }
}
