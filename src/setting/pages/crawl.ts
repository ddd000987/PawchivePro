/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：抓取分頁（抓取控制、過濾條件） */

import { checkRow, inputRow, section } from './controls'
import type { CenterContext } from './context'
import { CrawlControls } from './crawlControls'
import { CrawlProgressView } from './crawlProgress'

export function buildCrawl(
  host: HTMLDivElement,
  ctx: CenterContext,
  crawlControls: CrawlControls,
  crawlProgress: CrawlProgressView
): void {
  const onChange = () => ctx.refreshNamingPreview()
  // 抓取控制（開始／暫停／繼續／停止）：與首頁共用同一組狀態
  const crawlBody = section(host, '_secCrawl')
  crawlControls.build(crawlBody)
  // 抓取進度與結果摘要：緊接在按鈕下方
  crawlProgress.build(crawlBody)
  const body = section(host, '_secFilter')
  inputRow(body, 'filterTitle', '_f_filterTitle', 'text', onChange)
  inputRow(body, 'filterDateFrom', '_f_filterDateFrom', 'date', onChange)
  inputRow(body, 'filterDateTo', '_f_filterDateTo', 'date', onChange)
  inputRow(body, 'filterMinFiles', '_f_filterMinFiles', 'number', onChange)
  inputRow(body, 'filterMaxFiles', '_f_filterMaxFiles', 'number', onChange)
  checkRow(body, 'downImageFiles', '_f_downImageFiles')
  checkRow(body, 'downVideoFiles', '_f_downVideoFiles')
  checkRow(body, 'downOtherFiles', '_f_downOtherFiles')
  checkRow(body, 'downloadCover', '_f_downloadCover')
  checkRow(body, 'skipPendingPosts', '_f_skipPendingPosts')
  inputRow(body, 'filterServices', '_f_filterServices', 'text', onChange)
  inputRow(body, 'filterPostIdFrom', '_f_filterPostIdFrom', 'text', onChange)
  inputRow(body, 'filterPostIdTo', '_f_filterPostIdTo', 'text', onChange)
  inputRow(body, 'filterMaxSizeMiB', '_f_filterMaxSizeMiB', 'number', onChange)
}
