/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：本機資料夾區塊（授權狀態列＋選擇／重新授權按鈕）。
 * 只有「跳過已下載」選了按資料夾（folder／both）時才顯示 */

import { localFileCheck } from '../../download/LocalFileCheck'
import type { FolderStatus } from '../../folder/folderCore'
import { lang } from '../../Language'
import { toast } from '../../Toast'
import { settings } from '../Settings'
import { skipByFolder } from '../skipMode'
import { btnRow } from './controls'

export class FolderStatusView {
  private block: HTMLDivElement | null = null
  private line!: HTMLDivElement
  /** 最近一次取得的狀態：undefined 尚未取得；null 訊息失敗 */
  private last: FolderStatus | null | undefined = undefined
  /** 遞增序號：舊的非同步回覆晚到時丟棄 */
  private seq = 0

  /** 在 host 底下建立區塊（預設依設定決定顯示與否） */
  public build(host: HTMLDivElement): void {
    const block = document.createElement('div')
    block.className = 'pwpSC-folderBlock'
    this.block = block
    this.line = document.createElement('div')
    // 狀態列內容會變，沿用狀態列樣式（搜尋不比對、不隱藏）
    this.line.className = 'pwpSC-row pwpSC-status'
    block.appendChild(this.line)
    btnRow(block, [
      {
        labelKey: '_pickLocalFolder',
        onClick: () => {
          void (async () => {
            await localFileCheck.pickFolder()
            await this.refresh()
          })()
        },
      },
      {
        labelKey: '_reauthLocalFolder',
        onClick: () => {
          void (async () => {
            const ok = await localFileCheck.prepare(true)
            const name = await localFileCheck.folderName()
            if (ok) {
              toast.success(lang.transl('_localFolderReady', name ?? ''))
            } else if (name === null) {
              // 還沒選資料夾：授權視窗不會開，直接提示
              toast.error(lang.transl('_localFolderNotReady'))
            }
            // 已選資料夾但權限不足：prepare 已開啟授權視窗並提示，這裡不再重複
            await this.refresh()
          })()
        },
      },
    ])
    host.appendChild(block)
    this.syncVisibility()
    void this.refresh()
  }

  /** 依 skipDownloaded 顯示或隱藏整個區塊 */
  public syncVisibility(): void {
    if (!this.block) return
    this.block.hidden = !skipByFolder(settings.get('skipDownloaded'))
  }

  /** 重新向後台查詢授權狀態並顯示（區塊隱藏時不查） */
  public async refresh(): Promise<void> {
    if (!this.block || this.block.hidden) return
    const seq = ++this.seq
    const status = await localFileCheck.status()
    if (seq !== this.seq) return
    this.last = status
    this.render()
  }

  /** 用最近一次的狀態重繪文字（語言切換時用） */
  public render(): void {
    if (!this.block) return
    const s = this.last
    let text = ''
    if (s === null) {
      text = lang.transl('_folderStatusUnknown')
    } else if (s !== undefined) {
      if (s.name === null || s.permission === 'none') {
        text = lang.transl('_folderNone')
      } else if (s.permission === 'granted') {
        text = lang.transl('_folderStatusGranted', s.name)
      } else {
        text = lang.transl('_folderStatusNeedAuth', s.name)
      }
    }
    this.line.textContent = text
  }
}
