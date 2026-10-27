/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：通用分頁（語言、跳過已下載、本地資料夾、浮動按鈕、快捷鍵、設定／下載記錄匯出入） */

import { EVT } from '../../EVT'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { HotkeyEditor } from '../HotkeyEditor'
import { btnRow, checkRow, section, selectRow } from './controls'
import type { CenterContext } from './context'
import type { FolderStatusView } from './folderStatus'

export function buildCommon(
  host: HTMLDivElement,
  ctx: CenterContext,
  folderStatus: FolderStatusView
): void {
  const onChange = () => ctx.refreshNamingPreview()
  const body = section(host, '_secSettings')
  // 語言用自己的名字顯示（不翻譯），看不懂目前語言的人也找得到自己的
  const langNames: Record<string, string> = {
    'zh-cn': '简体中文',
    'zh-tw': '繁體中文',
    en: 'English',
    ja: '日本語',
  }
  selectRow(
    body,
    'userSetLang',
    '_f_userSetLang',
    ['auto', ...lang.langTypes],
    onChange,
    (v) => (v === 'auto' ? lang.transl('_langAuto') : (langNames[v] ?? v))
  )
  selectRow(
    body,
    'skipDownloaded',
    '_f_skipDownloaded',
    ['none', 'record', 'folder', 'both'],
    () => {
      // 選項變了：資料夾區塊跟著顯示／隱藏，並刷新授權狀態
      folderStatus.syncVisibility()
      void folderStatus.refresh()
    },
    (v) => lang.transl(`_skip_${v}` as LangTextKey)
  )
  folderStatus.build(body)
  checkRow(body, 'showFloatingButton', '_f_showFloatingButton')
  // 快捷鍵編輯器
  const hkTitle = document.createElement('div')
  hkTitle.className = 'pwpSC-subhead'
  hkTitle.dataset.xztext = '_hotkeys'
  hkTitle.textContent = lang.transl('_hotkeys')
  body.appendChild(hkTitle)
  const hkMount = document.createElement('div')
  hkMount.className = 'pwpSC-row'
  hkMount.dataset.key = '_hotkeys'
  body.appendChild(hkMount)
  new HotkeyEditor(hkMount)
  btnRow(body, [
    {
      labelKey: '_exportSettings',
      onClick: () => EVT.fire('exportSettings'),
      key: '_exportSettings',
    },
    {
      labelKey: '_importSettings',
      onClick: () => EVT.fire('importSettings'),
    },
  ])

  const recordBody = section(host, '_secRecord')
  btnRow(recordBody, [
    {
      labelKey: '_exportRecord',
      onClick: () => EVT.fire('exportDownloadRecord'),
      key: '_exportRecord',
    },
    {
      labelKey: '_importRecord',
      onClick: () => EVT.fire('importDownloadRecord'),
    },
    {
      labelKey: '_clearRecord',
      onClick: () => EVT.fire('clearDownloadRecord'),
    },
  ])
  btnRow(recordBody, [
    {
      labelKey: '_exportCSV',
      onClick: () => EVT.fire('exportCSV'),
      key: '_exportCSV',
    },
  ])
}
