/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 本機資料夾比對的後台服務（service worker）。
 *
 * 資料夾 handle 與讀取授權都屬於擴充功能，網站腳本碰不到。
 * 內容腳本只能透過訊息請 SW 比對，並且只拿到「哪些路徑已存在」的結果。
 *
 * 訊息（msg 以 folder_ 開頭，且 sender.id 必須是本擴充功能）：
 *   folder_status                         → FolderStatus
 *   folder_exists_many { paths }          → FolderExistsManyResponse
 *   folder_exists { path }                → FolderExistsResponse
 *   folder_open_page { mode }             → FolderOpenPageResponse
 */

import { FolderChecker, getFolderStatus, loadRootHandle } from './folderCore'
import type {
  DirHandleLike,
  FolderErrorResponse,
  FolderExistsManyResponse,
  FolderExistsResponse,
  FolderGate,
  FolderOpenPageResponse,
} from './folderCore'

const POPUP_WIDTH = 460
const POPUP_HEIGHT = 360

/** 取得可讀的根資料夾；不可用時回「擋下的原因」 */
async function openReadable(): Promise<
  { handle: DirHandleLike } | { gate: FolderGate }
> {
  const handle = await loadRootHandle()
  if (!handle) {
    return { gate: { status: 'noFolder' } }
  }
  let permission: PermissionState
  try {
    permission = await handle.queryPermission({ mode: 'read' })
  } catch (e) {
    console.error('[PawchivePro] query folder permission failed', e)
    permission = 'denied'
  }
  if (permission !== 'granted') {
    return { gate: { status: 'noPermission', name: handle.name } }
  }
  return { handle }
}

async function existsMany(paths: string[]): Promise<FolderExistsManyResponse> {
  const opened = await openReadable()
  if ('gate' in opened) {
    return opened.gate
  }
  const { handle } = opened
  const { found, mismatch } = await new FolderChecker(handle).existsMany(paths)
  return { status: 'ok', name: handle.name, found, mismatch }
}

async function exists(path: string): Promise<FolderExistsResponse> {
  const opened = await openReadable()
  if ('gate' in opened) {
    return opened.gate
  }
  const { handle } = opened
  const result = await new FolderChecker(handle).exists(path)
  return { status: 'ok', name: handle.name, ...result }
}

async function openPage(mode: unknown): Promise<FolderOpenPageResponse> {
  if (mode !== 'pick' && mode !== 'reauth') {
    return { ok: false, error: 'invalid mode' }
  }
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL('folder.html?mode=' + mode),
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string')
}

function invalid(error: string): FolderErrorResponse {
  return { status: 'error', error }
}

/** 依 msg 分派；回傳要回覆的內容 */
async function dispatch(
  msg: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  switch (msg) {
    case 'folder_status':
      return getFolderStatus()
    case 'folder_exists_many':
      if (!isStringArray(payload.paths)) {
        return invalid('invalid paths')
      }
      return existsMany(payload.paths)
    case 'folder_exists':
      if (typeof payload.path !== 'string') {
        return invalid('invalid path')
      }
      return exists(payload.path)
    case 'folder_open_page':
      return openPage(payload.mode)
    default:
      return invalid('unknown folder message')
  }
}

chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
  if (!rawMsg || typeof rawMsg !== 'object') {
    return false
  }
  const payload = rawMsg as Record<string, unknown>
  const msg = payload.msg
  if (typeof msg !== 'string' || !msg.startsWith('folder_')) {
    return false
  }
  // 只服務本擴充功能自己的內容腳本與頁面
  if (sender.id !== chrome.runtime.id) {
    return false
  }
  dispatch(msg, payload)
    .then(sendResponse)
    .catch((e) => {
      console.error('[PawchivePro] folder message failed', e)
      sendResponse(invalid(e instanceof Error ? e.message : String(e)))
    })
  return true
})
