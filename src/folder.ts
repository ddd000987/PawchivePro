/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 本機資料夾授權頁（擴充功能自己的頂層頁面，由 service worker 以彈出視窗開啟）。
 *
 * File System Access 的選擇器不能在 service worker 或跨來源 iframe 使用，
 * 所以選資料夾與重新允許讀取都在這裡做；handle 存進擴充功能來源的 IndexedDB，
 * 網站看不到。URL 參數 mode：pick（選資料夾）／reauth（重新允許讀取），
 * 只決定哪一顆按鈕是主要按鈕。
 */

import { lang } from './Language'
import { settings } from './setting/Settings'
import {
  getFolderStatus,
  loadRootHandle,
  saveRootHandle,
} from './folder/folderCore'
import type { DirHandleLike, FolderStatus } from './folder/folderCore'

/** 成功後自動關閉視窗的延遲 */
const CLOSE_DELAY = 1500

type DirectoryPicker = (opts: object) => Promise<DirHandleLike>

const app = document.getElementById('app') as HTMLElement
const mode = new URLSearchParams(location.search).get('mode')

/** 操作結果訊息（選好、授權成功／失敗） */
let message = ''
/** 動作進行中時停用按鈕，避免重複觸發 */
let busy = false
let status: FolderStatus = { name: null, permission: 'none' }
let handle: DirHandleLike | null = null

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) {
    node.textContent = text
  }
  if (className) {
    node.className = className
  }
  return node
}

function button(
  label: string,
  primary: boolean,
  onClick: () => void
): HTMLButtonElement {
  const btn = el('button', label, primary ? 'primary' : undefined)
  btn.type = 'button'
  btn.disabled = busy
  btn.addEventListener('click', onClick)
  return btn
}

function closeSoon(): void {
  setTimeout(() => window.close(), CLOSE_DELAY)
}

async function refresh(): Promise<void> {
  handle = await loadRootHandle()
  status = await getFolderStatus()
}

function render(): void {
  app.replaceChildren()
  app.appendChild(el('h1', lang.transl('_folderPageTitle')))
  app.appendChild(
    el(
      'p',
      status.name
        ? lang.transl('_folderCurrent', status.name)
        : lang.transl('_folderNone')
    )
  )
  if (status.permission !== 'none') {
    app.appendChild(
      el(
        'p',
        status.permission === 'granted'
          ? lang.transl('_folderPermGranted')
          : lang.transl('_folderPermNeeded')
      )
    )
  }
  app.appendChild(el('p', lang.transl('_folderPageHint'), 'muted'))

  const buttons = el('div', undefined, 'buttons')
  const needAllow =
    status.permission !== 'none' && status.permission !== 'granted'
  buttons.appendChild(
    button(
      lang.transl('_pickLocalFolder'),
      mode !== 'reauth' || !needAllow,
      () => void pickFolder()
    )
  )
  if (needAllow) {
    buttons.appendChild(
      button(
        lang.transl('_reauthLocalFolder'),
        mode === 'reauth',
        () => void allowAccess()
      )
    )
  }
  app.appendChild(buttons)

  if (message) {
    const p = el('p', message)
    p.setAttribute('role', 'status')
    app.appendChild(p)
  }
}

function setBusy(value: boolean): void {
  busy = value
  render()
}

async function pickFolder(): Promise<void> {
  const picker = (window as { showDirectoryPicker?: unknown })
    .showDirectoryPicker as DirectoryPicker | undefined
  if (typeof picker !== 'function') {
    message = lang.transl(
      '_localFolderPickFailed',
      'showDirectoryPicker unavailable'
    )
    render()
    return
  }
  setBusy(true)
  try {
    // 要在點擊的使用者操作內直接呼叫選擇器，前面不能有 await
    const picked = await picker.call(window, {
      id: 'pawchivePro',
      mode: 'read',
    })
    if (!(await saveRootHandle(picked))) {
      throw new Error('save folder handle failed')
    }
    await refresh()
    message = lang.transl('_localFolderPicked', picked.name)
    closeSoon()
  } catch (e) {
    // 使用者取消選擇：不提示
    if ((e as { name?: string } | null)?.name !== 'AbortError') {
      console.error('[PawchivePro] pick folder failed', e)
      message = lang.transl(
        '_localFolderPickFailed',
        e instanceof Error ? e.message : String(e)
      )
    }
  } finally {
    setBusy(false)
  }
}

async function allowAccess(): Promise<void> {
  if (!handle) {
    return
  }
  setBusy(true)
  try {
    const state = await handle.requestPermission({ mode: 'read' })
    await refresh()
    if (state === 'granted') {
      message = lang.transl('_localFolderReady', status.name ?? '')
      closeSoon()
    } else {
      message = lang.transl('_localFolderNotReady')
    }
  } catch (e) {
    console.error('[PawchivePro] request folder permission failed', e)
    message = lang.transl('_localFolderNotReady')
  } finally {
    setBusy(false)
  }
}

async function init(): Promise<void> {
  // 讀回設定，介面語言才會跟著使用者的選擇
  await settings.restore()
  await refresh()
  render()
}

void init()
