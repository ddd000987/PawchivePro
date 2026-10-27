/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/setting/HotkeyEditor.ts
 *          (xuejianxianzun): record/conflict/reserved-combo validation,
 *          formatCombo/codeToName, reset-to-default flows.
 * changes: no useSlot/theme/msgBox/svg-icon dependencies —
 *          renders into a container given by SettingsCenter; feedback via
 *          toast (errors) + window.confirm (reset). Command list reduced
 *          to our 3 HotkeyCommands. settingChange payload is {key, value}.
 */

import { Config } from '../Config'
import { EVT } from '../EVT'
import { lang } from '../Language'
import { LangTextKey } from '../langText'
import { toast } from '../Toast'
import { setHotkeyRecording } from '../HotkeyListener'
import {
  settings,
  setSetting,
  defaultHotkeys,
  HotkeyCombo,
  HotkeyCommand,
} from './Settings'

/** Ctrl 下瀏覽器不允許頁面攔截的按鍵（Ctrl+T/W/N/Q/Tab；其餘頁面可攔截） */
const RESERVED_CTRL_KEYS = new Set(['KeyT', 'KeyW', 'KeyN', 'KeyQ', 'Tab'])
/** Ctrl+Shift 下瀏覽器不允許頁面攔截的按鍵（重開／新視窗／關閉視窗） */
const RESERVED_CTRL_SHIFT_KEYS = new Set(['KeyT', 'KeyN', 'KeyW'])

/** 是否為瀏覽器／系統保留組合（設了也不會到達頁面 keydown） */
export function isReservedHotkey(combo: HotkeyCombo): boolean {
  // Ctrl（Mac 為 Cmd）的保留鍵；Shift 要納入判斷，否則 Ctrl+Shift+X 會被誤擋
  const primary = combo.ctrl || combo.meta
  if (primary && !(combo.ctrl && combo.meta) && !combo.alt) {
    const keys = combo.shift ? RESERVED_CTRL_SHIFT_KEYS : RESERVED_CTRL_KEYS
    if (keys.has(combo.key)) {
      return true
    }
    // Ctrl+數字切換標籤頁（Ctrl+Shift+數字多數瀏覽器沒有預設行為）
    if (combo.ctrl && !combo.shift && combo.key.startsWith('Digit')) {
      return true
    }
  }
  // Meta 單修飾鍵（macOS Cmd／Windows Win）多為系統或瀏覽器保留
  if (combo.meta && !combo.ctrl && !combo.alt) {
    return true
  }
  return false
}

/** 在設定面板裡查看和修改一級快捷鍵 */
class HotkeyEditor {
  constructor(mount: HTMLDivElement) {
    this.wrap = document.createElement('div')
    this.wrap.className = 'pwp-hotkeys-table'
    this.wrap.innerHTML = `
      <div class="pwp-hotkeys-head">
        <div class="cell" data-xztext="_hk_command"></div>
        <div class="cell" data-xztext="_hk_hotkey"></div>
        <div class="cell" data-xztext="_hk_action"></div>
      </div>
      <div class="listWrap"></div>
      <div class="pwp-hotkeys-btns">
        <button type="button" class="reset" data-xztext="_hk_reset"></button>
      </div>`
    mount.appendChild(this.wrap)
    lang.register(this.wrap)
    this.createAllList()
    this.bindEvents()
  }

  private wrap: HTMLDivElement
  private listWrap!: HTMLDivElement

  /** 是否正在錄製某個快捷鍵，避免同時錄製多個導致錯行 */
  private recording = false

  // 命令與顯示說明的對應（順序即列表順序）
  private readonly commandInfo: {
    command: HotkeyCommand
    nameKey: LangTextKey
  }[] = [
    { command: 'commandToggleCrawlPanel', nameKey: '_hk_togglePanel' },
    { command: 'commandStartDefaultCrawl', nameKey: '_hk_startCrawl' },
    { command: 'commandTogglePreviewWork', nameKey: '_hk_togglePreview' },
  ]

  /** 依設定裡的快捷鍵，重建整個列表 */
  private createAllList(): void {
    this.listWrap = this.wrap.querySelector('.listWrap') as HTMLDivElement
    this.listWrap.innerHTML = ''
    for (const info of this.commandInfo) {
      this.createList(info.command, info.nameKey)
    }
    lang.register(this.listWrap)
  }

  /** 為某個命令建一行 */
  private createList(command: HotkeyCommand, nameKey: LangTextKey): void {
    const combo = settings.get('hotkeys')[command]
    const valueText =
      combo && combo.key ? this.formatCombo(combo) : lang.transl('_hk_unset')

    const item = document.createElement('div')
    item.className = 'pwp-hotkeys-row'
    item.dataset.command = command
    item.innerHTML = `
      <div class="cell cellCommand">
        <span data-xztext="${nameKey}">${lang.transl(nameKey)}</span>
      </div>
      <div class="cell cellHotkey">
        <span class="value">${valueText}</span>
        <button type="button" class="escCancel" data-xztext="_hk_escCancel">${lang.transl('_hk_escCancel')}</button>
      </div>
      <div class="cell cellAction">
        <button type="button" class="edit" data-xztitle="_hk_edit">✎ <span data-xztext="_hk_edit">${lang.transl('_hk_edit')}</span></button>
        <button type="button" class="delete" data-xztitle="_hk_clear">× <span data-xztext="_hk_clear">${lang.transl('_hk_clear')}</span></button>
      </div>`
    this.listWrap.appendChild(item)
    lang.register(item)

    const editBtn = item.querySelector('.edit') as HTMLButtonElement
    const deleteBtn = item.querySelector('.delete') as HTMLButtonElement
    editBtn.addEventListener('click', () => {
      this.startRecord(item, command)
    })
    deleteBtn.addEventListener('click', () => {
      this.deleteHotkey(command)
    })
  }

  /** 進入錄製態：監聽使用者按鍵，只在按下「主鍵」時結束錄製 */
  private startRecord(item: HTMLDivElement, command: HotkeyCommand): void {
    // 已經在錄製其他快捷鍵時，忽略本次點擊
    if (this.recording) {
      return
    }
    this.recording = true
    // 通知派發端暫停派發已有快捷鍵，避免錄入按鍵誤觸發既有動作
    setHotkeyRecording(true)

    const valueEl = item.querySelector('.value') as HTMLElement
    valueEl.textContent = lang.transl('_hk_pressKey')
    valueEl.classList.add('recording')
    item.classList.add('recording')

    // 錄製期間累計的修飾鍵狀態（解決「先按修飾鍵、後按主鍵」時，
    // 按下修飾鍵就直接結束錄製的問題）
    const collected = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    }

    const finish = () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', cancel)
      valueEl.classList.remove('recording')
      item.classList.remove('recording')
      this.recording = false
      // 恢復派發已有快捷鍵
      setHotkeyRecording(false)
    }

    // 取消錄製：還原顯示，不保存（Esc、視窗失焦、點擊任意區域均可觸發）
    const cancel = () => {
      finish()
      this.refreshItem(command)
    }

    const handler = (ev: KeyboardEvent) => {
      // 阻止瀏覽器／系統對保留組合的預設行為，避免錄製時頁面被帶走
      ev.preventDefault()
      ev.stopPropagation()

      // 按下 Esc 取消錄製
      if (ev.code === 'Escape') {
        cancel()
        return
      }

      // 只按下修飾鍵時：記錄修飾鍵狀態，繼續等待主鍵（不結束錄製）
      const modifierCodes = [
        'ShiftLeft',
        'ShiftRight',
        'ControlLeft',
        'ControlRight',
        'AltLeft',
        'AltRight',
        'MetaLeft',
        'MetaRight',
      ]
      if (modifierCodes.includes(ev.code) || ev.code.startsWith('OS')) {
        collected.ctrl = ev.ctrlKey
        collected.alt = ev.altKey
        collected.shift = ev.shiftKey
        collected.meta = ev.metaKey
        return
      }

      // 主鍵必須是數字或字母，其餘按鍵（如 Tab、CapsLock、功能鍵）不接受
      const isMainKey = ev.code.startsWith('Key') || ev.code.startsWith('Digit')
      if (!isMainKey) {
        finish()
        toast.error(lang.transl('_hk_needMainKey'))
        this.refreshItem(command)
        return
      }

      // 主鍵：組裝組合並結束錄製
      const combo: HotkeyCombo = {
        key: ev.code,
        ctrl: ev.ctrlKey || collected.ctrl,
        alt: ev.altKey || collected.alt,
        shift: ev.shiftKey || collected.shift,
        meta: ev.metaKey || collected.meta,
      }

      // 校验：與另一個一級快捷鍵重複
      const conflict = this.findConflict(command, combo)
      if (conflict) {
        finish()
        toast.error(lang.transl('_hk_conflict', conflict))
        this.refreshItem(command)
        return
      }

      // 校验：瀏覽器／系統保留組合
      if (this.isReserved(combo)) {
        finish()
        toast.error(lang.transl('_hk_reserved'))
        this.refreshItem(command)
        return
      }

      // 通過校驗，保存
      const map = { ...settings.get('hotkeys') }
      map[command] = combo
      finish()
      toast.success(lang.transl('_hk_changed'))
      setSetting('hotkeys', map)
      this.refreshItem(command)
    }

    // 視窗失焦、或點擊任意區域都取消錄製，避免錄製態卡死
    window.addEventListener('keydown', handler, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', cancel)
  }

  /** 找出與 combo 衝突的其他命令（回傳其顯示名，無衝突回 null） */
  private findConflict(self: HotkeyCommand, combo: HotkeyCombo): string | null {
    const hotkeys = settings.get('hotkeys')
    for (const info of this.commandInfo) {
      if (info.command === self) {
        continue
      }
      const other = hotkeys[info.command]
      if (other && other.key && this.sameCombo(other, combo)) {
        return lang.transl(info.nameKey)
      }
    }
    return null
  }

  /** 比較兩個組合是否相同 */
  private sameCombo(a: HotkeyCombo, b: HotkeyCombo): boolean {
    return (
      a.key === b.key &&
      a.ctrl === b.ctrl &&
      a.alt === b.alt &&
      a.shift === b.shift &&
      a.meta === b.meta
    )
  }

  /** 是否為瀏覽器／系統保留組合（設了也不會到達頁面 keydown） */
  private isReserved(combo: HotkeyCombo): boolean {
    return isReservedHotkey(combo)
  }

  /** 清除某個命令的快捷鍵 */
  private deleteHotkey(command: HotkeyCommand): void {
    const map = { ...settings.get('hotkeys') }
    delete map[command]
    setSetting('hotkeys', map)
    this.refreshItem(command)
    toast.success(lang.transl('_hk_cleared'))
  }

  /** 依目前設定，刷新某一行的顯示 */
  private refreshItem(command: HotkeyCommand): void {
    const item = this.listWrap.querySelector(
      `.pwp-hotkeys-row[data-command='${command}']`
    )
    if (!item) {
      return
    }
    const combo = settings.get('hotkeys')[command]
    const valueEl = item.querySelector('.value') as HTMLElement
    valueEl.textContent =
      combo && combo.key ? this.formatCombo(combo) : lang.transl('_hk_unset')
  }

  /** 把組合格式化為可讀文字。Mac 用特殊符號 */
  private formatCombo(combo: HotkeyCombo): string {
    const parts: string[] = []
    if (combo.ctrl) {
      parts.push(Config.isMac ? '⌃' : 'Ctrl')
    }
    if (combo.alt) {
      parts.push(Config.isMac ? '⌥' : 'Alt')
    }
    if (combo.shift) {
      parts.push(Config.isMac ? '⇧' : 'Shift')
    }
    if (combo.meta) {
      parts.push(Config.isMac ? '⌘' : Config.isWin ? '⊞' : 'Meta')
    }
    parts.push(this.codeToName(combo.key))
    return parts.join(Config.isMac ? '' : '+')
  }

  /** 把 KeyboardEvent.code 轉為可讀的按鍵名 */
  private codeToName(code: string): string {
    if (code.startsWith('Key')) {
      return code.slice(3)
    }
    if (code.startsWith('Digit')) {
      return code.slice(5)
    }
    return code
  }

  private bindEvents(): void {
    // 快捷鍵設定被外部修改（例如重置）時，重建整個列表
    EVT.on(EVT.list.settingChange, (ev: CustomEventInit) => {
      const data = ev.detail.data as { key?: string }
      if (data.key === 'hotkeys') {
        this.createAllList()
      }
    })
    // restore() 直接寫 store：面板建得早，這裡補一次重建
    EVT.on(
      EVT.list.settingInitialized,
      () => {
        this.createAllList()
      },
      { once: true }
    )

    // 重置為預設
    const resetBtn = this.wrap.querySelector('.reset') as HTMLButtonElement
    resetBtn.addEventListener('click', () => {
      if (window.confirm(lang.transl('_hk_resetConfirm'))) {
        setSetting('hotkeys', { ...defaultHotkeys })
        toast.success(lang.transl('_hk_resetDone'))
      }
    })
  }
}

export { HotkeyEditor }
