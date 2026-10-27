/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/EVT.ts (xuejianxianzun)
 * changes: event table replaced with the PawchivePro set;
 *          PBD StoreType/MsgBox payload imports removed so this module
 *          stays dependency-free. fire() keeps CustomEvent semantics but
 *          dispatches on a private EventTarget instead of window.
 */

// 事件匯流排：fire / on / off 走模組私有的 EventTarget，不經共享的頁面 window，
// 因此頁面腳本既看不到也無法偽造這些事件。
type eventNames = keyof typeof EVT.list

class EVENT {
  private readonly bus = new EventTarget()

  public readonly list = {
    /** SPA 換頁（不論頁面類型是否變化） */
    pageSwitch: 'pageSwitch',
    /** 設定初始化完畢 */
    settingInitialized: 'settingInitialized',
    /** 設定項變化 data: {key, value} */
    settingChange: 'settingChange',
    /** 抓取開始 */
    crawlStart: 'crawlStart',
    /** 請求停止抓取 */
    stopCrawl: 'stopCrawl',
    /** 抓取暫停（進行中的請求完成後，下一個請求等待繼續） */
    crawlPause: 'crawlPause',
    /** 抓取從暫停繼續 */
    crawlResume: 'crawlResume',
    /** 取得 ID 列表 data: IDData[] */
    crawlIdList: 'crawlIdList',
    /** 抓取完成 */
    crawlComplete: 'crawlComplete',
    /** 抓取結果為空（晚於 crawlComplete） */
    crawlEmpty: 'crawlEmpty',
    /** 抓取進度統計變化（計數或階段；檢視層自行節流） */
    crawlProgress: 'crawlProgress',
    /** 存入一帖元數據 data: Result */
    addResult: 'addResult',
    /** 抓取結果變化 */
    resultChange: 'resultChange',
    /** 抓取快取變化 data: {id}（新增／改名／刪除） */
    cacheChange: 'cacheChange',
    /** 掛載的快取變化 data: {manual}（manual＝用戶手動掛載） */
    mountChange: 'mountChange',
    /** 可準備下載（派生事件） */
    readyDownload: 'readyDownload',
    /** 開始下載 */
    downloadStart: 'downloadStart',
    /** 請求暫停下載 */
    requestPauseDownload: 'requestPauseDownload',
    /** 下載暫停 */
    downloadPause: 'downloadPause',
    /** 下載停止 */
    downloadStop: 'downloadStop',
    /** 單檔下載成功 data: DownloadSuccessData */
    downloadSuccess: 'downloadSuccess',
    /** 單檔下載失敗 data: id */
    downloadError: 'downloadError',
    /** 單檔被跳過 data: DownloadSkipData */
    skipDownload: 'skipDownload',
    /** 瀏覽器保存檔案失敗 */
    saveFileError: 'saveFileError',
    /** 全部下載完成 */
    downloadComplete: 'downloadComplete',
    /** 向瀏覽器發起下載請求時觸發（看門狗用） */
    sendBrowserDownload: 'sendBrowserDownload',
    /** 網路請求異常 data: {status, url} */
    requestStatusError: 'requestStatusError',
    /** 匯出 CSV */
    exportCSV: 'exportCSV',
    /** 匯出下載記錄 */
    exportDownloadRecord: 'exportDownloadRecord',
    /** 匯入下載記錄 */
    importDownloadRecord: 'importDownloadRecord',
    /** 清空下載記錄 */
    clearDownloadRecord: 'clearDownloadRecord',
    /** 匯出設定 */
    exportSettings: 'exportSettings',
    /** 匯入設定 */
    importSettings: 'importSettings',
    /** 語言切換 */
    langChange: 'langChange',
    /** 日誌區內容變化（新增、合併計數、清空） */
    logAdd: 'logAdd',
    /** 請求顯示原圖 data: url */
    callShowOriginSizeImage: 'callShowOriginSizeImage',
    /** Alt+X：開關批次面板 */
    commandToggleCrawlPanel: 'commandToggleCrawlPanel',
    /** Alt+Z：開始預設抓取（當前頁） */
    commandStartDefaultCrawl: 'commandStartDefaultCrawl',
    /** Alt+P：開關懸停預覽 */
    commandTogglePreviewWork: 'commandTogglePreviewWork',
  } as const

  public fire(type: eventNames, data?: unknown): void {
    const event = new CustomEvent(type, {
      detail: { data: data === undefined ? {} : data },
    })
    this.bus.dispatchEvent(event)
  }

  public on(
    type: eventNames,
    listener: (ev: CustomEvent) => void,
    options?: AddEventListenerOptions
  ): void {
    this.bus.addEventListener(type, listener as EventListener, options)
  }

  public off(type: eventNames, listener: (ev: CustomEvent) => void): void {
    this.bus.removeEventListener(type, listener as EventListener)
  }
}

const EVT = new EVENT()

export { EVT }
export type { eventNames }
