/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：預覽設定分頁（開關、懸停延遲、資訊列欄位位置） */

import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import {
  PREVIEW_INFO_FIELDS,
  PREVIEW_INFO_PLACES,
} from '../../preview/previewInfo'
import type {
  PreviewInfoField,
  PreviewInfoPlace,
} from '../../preview/previewInfo'
import { settings, PreviewSettings } from '../Settings'
import { checkRow, section, tipCard } from './controls'

/** 預覽設定鍵的文案 key */
const PREVIEW_LABELS: Record<keyof PreviewSettings, LangTextKey> = {
  PreviewWork: '_f_PreviewWork',
  previewWorkWait: '_f_previewWorkWait',
  previewOriginalImage: '_f_previewOriginalImage',
  showPreviewWorkTip: '_f_showPreviewWorkTip',
  keepPreviewOnFloatHover: '_f_keepPreviewOnFloatHover',
  previewInfoPlacement: '_previewInfoTitle',
  allowPreviewCoverThumbnail: '_f_allowPreviewCoverThumbnail',
  wheelScrollSwitchImageOnPreviewWork: '_f_wheelScroll',
  showDownloadBtnOnThumb: '_f_showDownloadBtnOnThumb',
}

/** 純布林的預覽鍵（數字鍵與物件型鍵另有專屬控件） */
const PREVIEW_BOOL_KEYS: Array<
  Exclude<keyof PreviewSettings, 'previewWorkWait' | 'previewInfoPlacement'>
> = [
  'PreviewWork',
  'previewOriginalImage',
  'showPreviewWorkTip',
  'keepPreviewOnFloatHover',
  'allowPreviewCoverThumbnail',
  'wheelScrollSwitchImageOnPreviewWork',
  'showDownloadBtnOnThumb',
]

/** 資訊列欄位的名稱文案 key */
const INFO_LABELS: Record<PreviewInfoField, LangTextKey> = {
  index: '_pi_index',
  title: '_pi_title',
  creator: '_pi_creator',
  service: '_pi_service',
  postId: '_pi_postId',
  date: '_pi_date',
  files: '_pi_files',
  pendingOnly: '_pi_pendingOnly',
  keys: '_pi_keys',
}

/** 位置（上方／下方／不顯示）的文案 key */
const PLACE_LABELS: Record<PreviewInfoPlace, LangTextKey> = {
  top: '_pi_top',
  bottom: '_pi_bottom',
  none: '_pi_none',
}

export function buildPreview(host: HTMLDivElement): void {
  const body = section(host, '_previewSettings')
  tipCard(body, '_sc_previewTip')
  for (const key of PREVIEW_BOOL_KEYS) {
    checkRow(body, key, PREVIEW_LABELS[key])
  }
  // 懸停延遲（ms，0–2000）
  const waitRow = document.createElement('label')
  waitRow.className = 'pwpSC-row pwpSC-field'
  waitRow.dataset.key = 'previewWorkWait'
  waitRow.dataset.desc = '_d_previewWorkWait'
  const waitInput = document.createElement('input')
  waitInput.type = 'number'
  waitInput.min = '0'
  waitInput.max = '2000'
  waitInput.step = '50'
  waitInput.dataset.skey = 'previewWorkWait'
  waitInput.value = String(settings.get('previewWorkWait'))
  waitInput.addEventListener('change', () => {
    const v = Math.max(0, Math.min(2000, Number(waitInput.value) || 0))
    waitInput.value = String(v)
    settings.set('previewWorkWait', v)
  })
  const waitText = document.createElement('span')
  waitText.dataset.xztext = PREVIEW_LABELS.previewWorkWait
  waitText.textContent = lang.transl(PREVIEW_LABELS.previewWorkWait)
  waitRow.append(waitInput, waitText)
  body.appendChild(waitRow)

  // 資訊列內容：每個欄位獨立選「上方／下方／不顯示」
  const infoBody = section(host, '_previewInfoTitle')
  tipCard(infoBody, '_previewInfoHint')
  for (const field of PREVIEW_INFO_FIELDS) {
    const row = document.createElement('label')
    row.className = 'pwpSC-row pwpSC-field'
    row.dataset.key = `previewInfoPlacement.${field}`
    row.dataset.desc = '_d_previewInfoPlacement'
    const name = document.createElement('span')
    name.dataset.xztext = INFO_LABELS[field]
    name.textContent = lang.transl(INFO_LABELS[field])
    const select = document.createElement('select')
    select.dataset.pfield = field
    for (const place of PREVIEW_INFO_PLACES) {
      const opt = document.createElement('option')
      opt.value = place
      opt.dataset.xztext = PLACE_LABELS[place]
      opt.textContent = lang.transl(PLACE_LABELS[place])
      select.appendChild(opt)
    }
    select.value = settings.get('previewInfoPlacement')[field]
    select.addEventListener('change', () => {
      settings.set('previewInfoPlacement', {
        ...settings.get('previewInfoPlacement'),
        [field]: select.value as PreviewInfoPlace,
      })
    })
    row.append(name, select)
    infoBody.appendChild(row)
  }
}
