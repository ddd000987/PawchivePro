/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/store/States.ts (xuejianxianzun)
 * changes: dropped Pixiv-only flags (debut/bookmarkMode/crawlTagList/
 *          slowCrawlMode/exportIDList/quickMergeNovel/timedCrawlMode);
 *          kept busy/quickCrawl/stopCrawl/downloading + crawl/download
 *          timestamps. Preview fields (previewWorkIsShow/indexRecord) kept.
 */

import { EVT } from '../EVT'
import { sleep } from '../Tools'

/** 執行期狀態（不持久化） */
class States {
  constructor() {
    this.bindEvents()
  }

  /** 指示 settings 是否初始化完畢 */
  public settingInitialized = false

  /** 下載器是否繁忙（抓取中或下載中） */
  public busy = false

  /** 快速下載標記（帖子頁 D/C 單帖任務；總是自動開始下載） */
  public quickCrawl = false

  /** 指示是否應該停止抓取 */
  public stopCrawl = false

  /** 抓取是否處於暫停中（暫停時 busy 仍為 true） */
  public crawlPaused = false

  /** 是否處於下載中 */
  public downloading = false

  /** 下載是否處於暫停中（暫停時 downloading 為 false，但仍有下載任務） */
  public downloadPaused = false

  /** 是否還有下載任務（進行中或暫停中），用來阻止插隊的抓取 */
  public get hasDownloadTask() {
    return this.downloading || this.downloadPaused
  }

  // 每次抓取/下載完成的時間戳，用來判斷抓取結果是否已被下載完畢
  public crawlCompleteTime = 1
  public downloadCompleteTime = 0

  /** 預覽浮層是否顯示中 */
  public previewWorkIsShow = false

  /** 每帖的目前預覽索引：key = `${service}/${creatorId}/${postId}` */
  public indexRecord: Record<string, number> = {}

  /** 綁定全域事件以維護執行期狀態 */
  private bindEvents() {
    EVT.on(EVT.list.settingInitialized, () => {
      this.settingInitialized = true
    })

    const idle = [
      EVT.list.stopCrawl,
      EVT.list.crawlComplete,
      EVT.list.downloadPause,
      EVT.list.downloadStop,
      EVT.list.downloadComplete,
    ]

    idle.forEach((type) => {
      EVT.on(type, () => {
        this.busy = false
      })
    })

    const busy = [EVT.list.crawlStart, EVT.list.downloadStart]

    busy.forEach((type) => {
      EVT.on(type, () => {
        this.busy = true
      })
    })

    EVT.on(EVT.list.stopCrawl, () => {
      this.stopCrawl = true
    })

    EVT.on(EVT.list.crawlPause, () => {
      this.crawlPaused = true
    })

    // 繼續，以及抓取開始／收尾／停止，都回到未暫停
    for (const ev of [
      EVT.list.crawlResume,
      EVT.list.crawlStart,
      EVT.list.crawlComplete,
      EVT.list.crawlEmpty,
      EVT.list.stopCrawl,
    ]) {
      EVT.on(ev, () => {
        this.crawlPaused = false
      })
    }

    EVT.on(EVT.list.crawlStart, () => {
      this.stopCrawl = false
    })

    // 下載結束或中止時復位快速下載標記（避免快速抓取旗標殘留）
    // 不含 crawlComplete / stopCrawl：抓取快取在 crawlComplete 後非同步讀 quickCrawl，
    // 提早復位會讓縮圖單帖快抓被誤存；quickCrawl 於每輪抓取開始時由引擎重設
    const resetQuickState = [
      EVT.list.crawlEmpty,
      EVT.list.downloadStop,
      EVT.list.downloadPause,
      EVT.list.downloadComplete,
    ]

    for (const ev of resetQuickState) {
      EVT.on(ev, () => {
        this.quickCrawl = false
      })
    }

    EVT.on(EVT.list.downloadStart, () => {
      this.downloading = true
      this.downloadPaused = false
    })

    const downloadIdle = [EVT.list.downloadStop, EVT.list.downloadComplete]
    for (const ev of downloadIdle) {
      EVT.on(ev, () => {
        this.downloading = false
        this.downloadPaused = false
      })
    }

    EVT.on(EVT.list.downloadPause, () => {
      this.downloading = false
      this.downloadPaused = true
    })

    EVT.on(EVT.list.crawlComplete, () => {
      this.crawlCompleteTime = Date.now()
    })

    EVT.on(EVT.list.downloadComplete, () => {
      this.downloadCompleteTime = Date.now()
    })
  }

  public async waitSettingInitialized() {
    const start = Date.now()
    while (!this.settingInitialized) {
      // 存檔讀取卡住時不能讓整個流程死等；10 秒後報錯放行，改用預設值
      if (Date.now() - start >= 10000) {
        console.error(
          '[PawchivePro] waitSettingInitialized timeout, continue with defaults'
        )
        return
      }
      await sleep(50)
    }
  }
}

const states = new States()

export { states }
