/*
 * PawchivePro content script entry.
 * Style: side-effect registry like PBD src/ts/content.ts — importing a
 * module starts it. Wires the preview, crawl/download pipeline, settings
 * center and hotkeys, plus dev-only page detection output.
 */

import { EVT } from './EVT'
import { log } from './Log'
import { ListenPageSwitch } from './ListenPageSwitch'
import { detectPage, MOUNT } from './kemono/pages'
import { lang } from './Language'
import { settings } from './setting/Settings'
import './setting/AutoExportSettings'
import { states } from './store/States'
import { store } from './store/Store'
import { settingsCenter } from './setting/SettingsCenter'
import { previewWork } from './preview/PreviewWork'
import { showOriginSizeImage } from './preview/ShowOriginSizeImage'
import { thumbDownloadButton } from './preview/ThumbDownloadButton'
import { hotkeyListener } from './HotkeyListener'
// 抓取 + 下載管線（副作用註冊，見 PBD content.ts 風格）
import './crawl/StopCrawl'
import { logErrorStatus } from './crawl/LogErrorStatus'
import { downloadStates } from './download/DownloadStates'
import { downloadInterval } from './download/DownloadInterval'
import { downloadControl } from './download/DownloadControl'
import { downloadRecord } from './download/DownloadRecord'
import './download/ExportResult2CSV'
import './download/ShowBorderOnDownloadedWorks'
// 核心抓取引擎直接 import：先前只靠 SettingsCenter 間接載入，模組一改就會靜默停擺
import { engine } from './crawl/engine'

// webpack 的 mode 會替換 process.env.NODE_ENV；tsconfig 只載入 chrome 型別，
// 這裡自行宣告避免 tsc 找不到 process
declare const process: { env: { NODE_ENV?: string } }
const DEV = process.env.NODE_ENV !== 'production'

void lang
void states
void store

/** 啟動自檢：核心單例若因改寫／匯出變動而沒初始化，及早大聲報錯 */
function checkModules() {
  const modules = {
    engine,
    downloadControl,
    downloadRecord,
    downloadStates,
    downloadInterval,
    logErrorStatus,
    settingsCenter,
    previewWork,
    showOriginSizeImage,
    thumbDownloadButton,
    hotkeyListener,
  }
  const missing = Object.entries(modules)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    console.error('[PawchivePro] 核心模組未初始化：' + missing.join(', '))
  }
}

// 工具列按鈕 → 開關設定中心
chrome.runtime.onMessage.addListener((msg: { msg?: string }) => {
  if (msg && msg.msg === 'click_icon') {
    settingsCenter.toggle()
  }
})

// 啟動 SPA 換頁監聽
new ListenPageSwitch()

/** 掛載點守望上限（ms）：SPA 首屏晚渲染時等它出現，不再固定 3 秒就判 MISSING */
const MOUNT_WAIT_MS = 10000
let reportGen = 0

/** 守望掛載點：已存在立即回報；否則用 MutationObserver 等到出現或超時 */
function reportMount(gen: number, selector: string, prefix: string) {
  const finish = (status: string) => {
    if (gen === reportGen) {
      log.debug(`${prefix} mount=${status}`)
    }
  }
  if (document.querySelector(selector)) {
    finish('found')
    return
  }
  let timer = 0
  const observer = new MutationObserver(() => {
    if (gen !== reportGen) {
      observer.disconnect()
      return
    }
    if (document.querySelector(selector)) {
      observer.disconnect()
      window.clearTimeout(timer)
      finish('found')
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  timer = window.setTimeout(() => {
    observer.disconnect()
    finish('MISSING ' + selector)
  }, MOUNT_WAIT_MS)
}

/** 頁面偵測輸出：只在開發模式印出，避免 production console 刷屏 */
function reportPage() {
  if (!DEV) return
  const gen = ++reportGen
  const page = detectPage()
  if (page.kind === 'creator') {
    reportMount(
      gen,
      MOUNT.creator,
      `[page] creator page: service=${page.service} creatorId=${page.creatorId}`
    )
  } else if (page.kind === 'post') {
    reportMount(
      gen,
      MOUNT.post,
      `[page] post page: service=${page.service} creatorId=${page.creatorId} postId=${page.postId}`
    )
  } else {
    log.debug(`[page] other page: ${location.host}${location.pathname}`)
  }
  log.debug('detectPage ' + JSON.stringify(page))
}

EVT.on(EVT.list.pageSwitch, reportPage)

async function bootstrap() {
  // 讀回設定（完成後發 settingInitialized，SettingsCenter 據此建 UI）
  await settings.restore()
  checkModules()
  reportPage()
}

void bootstrap()
