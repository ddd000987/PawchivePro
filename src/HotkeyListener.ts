/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/HotkeyListener.ts
 *          (xuejianxianzun): capture-phase keydown dispatch, signature map,
 *          recording guard, input-field skip, settingChange rebuild.
 * changes: reads settings.get('hotkeys') (no direct property);
 *          our settingChange payload is {key, value} (not {name, value});
 *          also rebuilds on settingInitialized (restore() writes the store
 *          directly without firing settingChange, so the map built at
 *          import time would ignore saved custom hotkeys).
 */

import { EVT } from './EVT'
import { settings, HotkeyCommand } from './setting/Settings'

// 錄製快捷鍵期間，暫停派發已註冊的命令，避免錄入的按鍵誤觸發既有動作
let recording = false

/** 設定是否處於快捷鍵錄製態；錄製期間 HotkeyListener 不派發命令 */
function setHotkeyRecording(state: boolean): void {
  recording = state
}

// 在 content script 集中監聽 keydown，把使用者自訂的一級快捷鍵派發為 EVT 命令
// 二級快捷鍵（預覽內的 D/C/V/方向鍵等）由各功能模組自行處理，不經這裡
class HotkeyListener {
  constructor() {
    this.buildMap()
    this.bindEvents()
  }

  /** 按鍵簽名到命令的映射。簽名格式：ctrl|alt|shift|meta|key */
  private map: Map<string, HotkeyCommand> = new Map()

  /** 依目前設定，重建「按鍵簽名 → 命令」映射 */
  private buildMap(): void {
    this.map.clear()
    const hotkeys = settings.get('hotkeys')
    for (const command of Object.keys(hotkeys) as HotkeyCommand[]) {
      const combo = hotkeys[command]
      if (!combo || !combo.key) {
        continue
      }
      this.map.set(this.signature(combo), command)
    }
  }

  /** 把組合轉為可比較的簽名 */
  private signature(combo: {
    key: string
    ctrl: boolean
    alt: boolean
    shift: boolean
    meta: boolean
  }): string {
    return `${combo.ctrl ? 1 : 0}${combo.alt ? 1 : 0}${combo.shift ? 1 : 0}${
      combo.meta ? 1 : 0
    }|${combo.key}`
  }

  private bindEvents(): void {
    // 捕獲階段監聽，以便必要時阻止預設行為
    window.addEventListener(
      'keydown',
      (ev: KeyboardEvent) => {
        if (recording) {
          return
        }

        // 輸入控制項裡的按鍵不處理（使用者可能在輸入文字）
        if (ev.target) {
          const target = ev.target as HTMLElement
          if (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
          ) {
            return
          }
        }

        const sig = this.signature({
          key: ev.code,
          ctrl: ev.ctrlKey,
          alt: ev.altKey,
          shift: ev.shiftKey,
          meta: ev.metaKey,
        })

        const command = this.map.get(sig)
        if (command) {
          ev.preventDefault()
          EVT.fire(command)
        }
      },
      true
    )

    // 使用者修改快捷鍵後熱更新映射，無需刷新頁面
    EVT.on(EVT.list.settingChange, (ev: CustomEventInit) => {
      const data = ev.detail.data as { key?: string }
      if (data.key === 'hotkeys') {
        this.buildMap()
      }
    })
    // restore() 直接寫 store 不發 settingChange，這裡補一次重建
    EVT.on(
      EVT.list.settingInitialized,
      () => {
        this.buildMap()
      },
      { once: true }
    )
  }
}

const hotkeyListener = new HotkeyListener()

export { hotkeyListener, setHotkeyRecording, HotkeyListener }
