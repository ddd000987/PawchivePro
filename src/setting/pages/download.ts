/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：下載分頁（掛載詳情、下載控制、下載參數、進度條、日誌區） */

import { progressBar } from '../../download/ProgressBar'
import { lang } from '../../Language'
import { checkRow, inputRow, section, selectRow } from './controls'
import type { CenterContext } from './context'
import { DownloadControls } from './downloadControls'
import { LogView } from './log'
import { MountInfoView } from './mountInfo'
import { StatusRows } from './status'

export function buildDownload(
  host: HTMLDivElement,
  ctx: CenterContext,
  views: {
    status: StatusRows
    mountInfo: MountInfoView
    dlControls: DownloadControls
    logView: LogView
  }
): void {
  const onChange = () => ctx.refreshNamingPreview()
  const body = section(host, '_secDownload')
  views.mountInfo.build(body)
  views.dlControls.build(body)
  inputRow(body, 'downloadThread', '_f_downloadThread', 'number', onChange)
  inputRow(body, 'downloadInterval', '_f_downloadInterval', 'number', onChange)
  inputRow(body, 'crawlInterval', '_f_crawlInterval', 'number', onChange, {
    min: '0',
    max: '10',
    step: '0.1',
  })
  checkRow(body, 'autoMountCache', '_f_autoMountCache')
  checkRow(body, 'autoStartDownload', '_f_autoStartDownload')
  checkRow(body, 'setFileDownloadOrder', '_f_setFileDownloadOrder')
  checkRow(body, 'noCoverFile', '_f_noCoverFile')
  checkRow(body, 'downloadOriginalImage', '_f_downloadOriginalImage')
  selectRow(
    body,
    'textContent',
    '_f_textContent',
    ['txt', 'html', 'none'],
    onChange,
    (v) => (v === 'none' ? lang.transl('_textContentNone') : v)
  )
  const progressHost = document.createElement('div')
  progressHost.className = 'pwpSC-row'
  progressHost.dataset.key = '_downloadProgress'
  body.appendChild(progressHost)
  progressBar.attach(progressHost)
  const downloadStatus = views.status.createDownload()
  body.appendChild(downloadStatus)
  views.logView.build(host)
}
