/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/ProgressBar.ts
 *          (xuejianxianzun)
 * changes: dropped useSlot infra — the bar mounts into a container
 *          provided by SettingsCenter via attach() (falls back to body).
 *          Labels come from lang.
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { store } from '../store/Store'
import { throttle } from '../Tools'

interface ProgressBarEl {
  name: HTMLSpanElement
  loaded: HTMLSpanElement
  progress: HTMLDivElement
}

interface ProgressData {
  name: string
  loaded: number
  total: number
}

// 進度條
class ProgressBar {
  constructor() {
    this.createElements()
    this.bindEvents()
  }

  private readonly wrapHTML = `
  <div class="progressBarWrap">
  <div class="total">
  <span class="text" data-xztext="_downloadProgress"></span>
  <div class="right1">
  <div class="progressBar progressBar1">
  <div class="progress progress1"></div>
  </div>
  <div class="totalNumberWrap">
  <span class="downloaded">0</span>
  /
  <span class="imgNum totalNumber">0</span>
  </div>
  </div>
  </div>

  <ul class="progressBarList"></ul>
  </div>
  `

  private readonly barHTML = `<li class="downloadBar">
  <div class="progressBar progressBar2">
  <div class="progress progress2"></div>
  </div>
  <div class="progressTip progressTip2">
  <span class="fileName"></span>
  <span class="loadedWrap">
  <span class="loaded"></span>
  </span>
  </div>
  </li>`

  private wrap!: HTMLDivElement
  private downloadedEl!: HTMLSpanElement
  private progressColorEl!: HTMLDivElement
  private listWrap!: HTMLUListElement
  private totalNumberEl!: HTMLSpanElement
  private allProgressBar: ProgressBarEl[] = []

  private readonly KiB = 1024
  private readonly MiB = 1024 * 1024

  private createElements() {
    this.wrap = document.createElement('div')
    this.wrap.innerHTML = this.wrapHTML
    this.downloadedEl = this.wrap.querySelector(
      '.downloaded'
    ) as HTMLSpanElement
    this.progressColorEl = this.wrap.querySelector(
      '.progress1'
    ) as HTMLDivElement
    this.listWrap = this.wrap.querySelector(
      '.progressBarList'
    ) as HTMLUListElement
    this.totalNumberEl = this.wrap.querySelector(
      '.totalNumber'
    ) as HTMLSpanElement
    this.hide()
  }

  /** 掛載到面板容器（面板建好後呼叫；未掛載時暫留 body 隱藏態） */
  public attach(container: HTMLElement) {
    container.appendChild(this.wrap)
    lang.register(this.wrap)
  }

  private bindEvents() {
    EVT.on(EVT.list.crawlStart, () => {
      this.hide()
    })
  }

  // 重設所有進度
  public reset(progressBarNum: number, downloaded: number = 0) {
    if (progressBarNum === 0) {
      // 如果進度條數量為 0（抓取結果為空），則隱藏進度條區域
      return this.hide()
    }

    // 重置總進度條
    this.setTotalProgress(downloaded)
    this.totalNumberEl.textContent = store.result.length.toString()
    // 重置子進度條
    this.listWrap.innerHTML = this.barHTML.repeat(progressBarNum)

    this.show()

    // 保存子進度條上需要使用到的元素
    const allProgressBar = this.listWrap.querySelectorAll('.downloadBar')
    this.allProgressBar = []
    for (const bar of allProgressBar) {
      const data: ProgressBarEl = {
        name: bar.querySelector('.fileName')! as HTMLSpanElement,
        loaded: bar.querySelector('.loaded')! as HTMLSpanElement,
        progress: bar.querySelector('.progress')! as HTMLDivElement,
      }

      this.allProgressBar.push(data)
    }
  }

  /** 停止下載後歸零：總進度清空、子進度條移除，但保留進度區域不隱藏 */
  public clear() {
    this.setTotalProgress(0)
    this.listWrap.innerHTML = ''
    this.allProgressBar = []
  }

  // 設置總進度條的進度
  public setTotalProgress(downloaded: number) {
    this.downloadedEl.textContent = downloaded.toString()

    // 結果為空時避免 0/0 產生 NaN%
    const total = store.result.length
    const progress = total > 0 ? (downloaded / total) * 100 : 0
    this.progressColorEl.style.width = progress + '%'
  }

  /**立即更新子進度條的進度 */
  public setProgress(index: number, data: ProgressData) {
    const bar = this.allProgressBar[index]
    if (!bar) {
      console.error(index, this.allProgressBar)
      return
    }
    bar.name.textContent = data.name
    bar.name.setAttribute('title', data.name)

    let text = ''
    if (data.total >= this.MiB) {
      // 使用 MiB 作為單位
      text = `${(data.loaded / this.MiB).toFixed(1)}/${(
        data.total / this.MiB
      ).toFixed(1)} MiB`
    } else {
      // 使用 KiB 作為單位
      text = `${Math.floor(data.loaded / this.KiB)}/${Math.floor(
        data.total / this.KiB
      )} KiB`
    }

    bar.loaded.textContent = text

    const progress = data.loaded / data.total || 0 // 若結果為 NaN 則設為 0
    bar.progress.style.width = progress * 100 + '%'
  }

  /**更新子進度條時，使用節流 */
  public setProgressThrottle = throttle(this.setProgress.bind(this), 200)

  // 讓某個子進度條顯示警告色
  public errorColor(index: number, show: boolean) {
    const bar = this.allProgressBar[index]
    if (!bar) {
      console.error(index, this.allProgressBar)
      return
    }
    bar.name.classList[show ? 'add' : 'remove']('downloadError')
  }

  private show() {
    this.wrap.style.display = 'block'
  }

  private hide() {
    this.wrap.style.display = 'none'
  }
}

const progressBar = new ProgressBar()
export { progressBar }
