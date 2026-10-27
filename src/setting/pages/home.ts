/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：首頁分頁（狀態、掛載詳情、抓取控制、下載控制） */

import { section, tipCard } from './controls'
import { CrawlControls } from './crawlControls'
import { CrawlProgressView } from './crawlProgress'
import { DownloadControls } from './downloadControls'
import { MountInfoView } from './mountInfo'
import { StatusRows } from './status'

export function buildHome(
  host: HTMLDivElement,
  views: {
    status: StatusRows
    mountInfo: MountInfoView
    crawlControls: CrawlControls
    crawlProgress: CrawlProgressView
    dlControls: DownloadControls
  }
): void {
  const body = section(host, '_sc_home')
  tipCard(body, '_sc_homeTip')
  const crawlStatus = views.status.createCrawl()
  const downloadStatus = views.status.createDownload()
  body.append(crawlStatus, downloadStatus)
  views.mountInfo.build(body)
  views.crawlControls.build(body)
  views.crawlProgress.build(body)
  views.dlControls.build(body)
}
