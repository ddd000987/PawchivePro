/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/crawl/LogErrorStatus.ts
 *          (xuejianxianzun)
 * changes: dropped settings-coupled tips (no slowCrawl mode here);
 *          keeps generic status log + 429 backoff note + listener registry
 *          (engine relies on requestStatusError only for logging here;
 *          its own 429 backoff lives in engine.ts).
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'

// 網路請求狀態異常時輸出日誌
class LogErrorStatus {
  constructor() {
    this.bindEvents()
  }

  private bindEvents() {
    EVT.on(EVT.list.requestStatusError, (ev: CustomEventInit) => {
      const { status, url } = ev.detail.data as {
        status: number
        url: string
      }

      // 依狀態分級：429 是限流提示；5xx／斷網是錯誤；其餘 4xx 只警告
      if (status === 429) {
        log.warning(
          lang.transl('_networkError', String(status), url),
          `net-${status}`
        )
        log.warning(lang.transl('_rateLimitHint'), 'rateLimitHint')
      } else if (status === 0 || status >= 500) {
        log.error(
          lang.transl('_networkError', String(status), url),
          `net-${status}`
        )
      } else {
        log.warning(
          lang.transl('_networkError', String(status), url),
          `net-${status}`
        )
      }
    })
  }
}

const logErrorStatus = new LogErrorStatus()
export { logErrorStatus }
