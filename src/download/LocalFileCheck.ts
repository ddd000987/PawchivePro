/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 下載前檢查檔案是否已存在於本機資料夾（內容腳本端的薄客戶端）。
 *
 * 資料夾 handle 與讀取授權由擴充功能自己保管（見 src/folder/）：
 * 選資料夾與重新授權都在擴充功能的彈出頁面進行，比對在 service worker 做，
 * 內容腳本只送訊息、拿結果，網站的腳本碰不到 handle，也讀不到資料夾。
 * Chrome 不允許選「下載」資料夾本身，只能選它底下的子資料夾（如 kemono）。
 */

import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import type {
  FolderExistsManyResponse,
  FolderExistsResponse,
  FolderOpenPageResponse,
  FolderPageMode,
  FolderStatus,
} from '../folder/folderCore'

/** 舊版把 handle 存在網站來源的 IndexedDB，這個 DB 名稱要清掉 */
const LEGACY_DB_NAME = 'pawchivePro'

/** 傳訊息給 service worker；任何失敗（SW 不可用、沒有回覆）都回 null */
async function send<T>(message: object): Promise<T | null> {
  try {
    const res = await chrome.runtime.sendMessage(message)
    if (res === undefined || res === null) {
      console.error('[PawchivePro] folder message got no reply', message)
      return null
    }
    return res as T
  } catch (e) {
    console.error('[PawchivePro] folder message failed', e)
    return null
  }
}

class LocalFileCheck {
  /** 本批已警告過的訊息（每批每種只提示一次，避免洗版） */
  private warned = new Set<string>()

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) {
      return
    }
    this.warned.add(key)
    log.warning(msg)
  }

  /** 已選資料夾的名稱（尚未選擇或無法取得回 null） */
  async folderName(): Promise<string | null> {
    const status = await send<FolderStatus>({ msg: 'folder_status' })
    return status?.name ?? null
  }

  /** 資料夾名稱與讀取權限（設定頁顯示授權狀態用）。訊息失敗回 null */
  async status(): Promise<FolderStatus | null> {
    return send<FolderStatus>({ msg: 'folder_status' })
  }

  /** 請擴充功能開啟授權頁讓使用者選擇資料夾 */
  async pickFolder(): Promise<void> {
    const res = await this.openPage('pick')
    if (!res || !res.ok) {
      toast.error(
        lang.transl(
          '_localFolderPickFailed',
          res && !res.ok ? res.error : 'service worker unavailable'
        )
      )
    }
  }

  private openPage(
    mode: FolderPageMode
  ): Promise<FolderOpenPageResponse | null> {
    return send<FolderOpenPageResponse>({ msg: 'folder_open_page', mode })
  }

  /** 確認資料夾可讀。interactive 且有使用者操作時，權限不足會開啟授權視窗
   * （沿用舊行為：自動開始的下載沒有使用者操作，不會跳出視窗）。
   * 授權要在視窗裡完成，所以這次仍回 false */
  async prepare(interactive: boolean): Promise<boolean> {
    const status = await send<FolderStatus>({ msg: 'folder_status' })
    if (!status || status.permission === 'none') {
      return false
    }
    if (status.permission === 'granted') {
      return true
    }
    if (interactive && navigator.userActivation?.isActive) {
      const res = await this.openPage('reauth')
      if (res?.ok) {
        toast.show(lang.transl('_localFolderReauthOpened'))
      }
    }
    return false
  }

  /** 新一批下載開始：清掉警告旗標 */
  beginBatch(): void {
    this.warned.clear()
  }

  /** 把「沒選資料夾／沒權限」的回覆轉成警告；回 true 代表已被擋下 */
  private gated(res: { status: string; name?: string }): boolean {
    if (res.status === 'noFolder') {
      this.warnOnce('noFolder', lang.transl('_localCheckNoFolder'))
      return true
    }
    if (res.status === 'noPermission') {
      this.warnOnce('noPermission', lang.transl('_localCheckNoPermission'))
      return true
    }
    return false
  }

  private warnMismatch(name: string): void {
    this.warnOnce('pathMismatch', lang.transl('_localCheckPathMismatch', name))
  }

  /** 相對下載資料夾的路徑是否已有（非空）檔案。
   * 無法檢查（沒選資料夾、沒權限、路徑不在根底下、其他錯誤）回 null */
  async exists(relPath: string): Promise<boolean | null> {
    const res = await send<FolderExistsResponse>({
      msg: 'folder_exists',
      path: relPath,
    })
    if (!res || this.gated(res)) {
      return null
    }
    if (res.status !== 'ok') {
      console.error('[PawchivePro] folder check failed', res)
      return null
    }
    if (res.mismatch) {
      this.warnMismatch(res.name)
    }
    return res.exists
  }

  /** 批量檢查：回傳「已有（非空）檔案」的相對路徑集合。
   * 無法檢查（沒選資料夾、沒權限、訊息失敗）回 null；路徑不在根底下的不納入結果 */
  async existsMany(relPaths: string[]): Promise<Set<string> | null> {
    const res = await send<FolderExistsManyResponse>({
      msg: 'folder_exists_many',
      paths: relPaths,
    })
    if (!res || this.gated(res)) {
      return null
    }
    if (res.status !== 'ok') {
      console.error('[PawchivePro] folder check failed', res)
      return null
    }
    if (res.mismatch) {
      this.warnMismatch(res.name)
    }
    return new Set(res.found)
  }
}

/** 清掉舊版留在網站來源 IndexedDB 裡的資料夾 handle */
function cleanupLegacyHandle(): void {
  if (
    typeof indexedDB === 'undefined' ||
    typeof indexedDB.databases !== 'function'
  ) {
    return
  }
  indexedDB
    .databases()
    .then((dbs) => {
      if (dbs.some((db) => db.name === LEGACY_DB_NAME)) {
        indexedDB.deleteDatabase(LEGACY_DB_NAME)
        log.warning(lang.transl('_localFolderMoved'))
      }
    })
    .catch((e) =>
      console.error('[PawchivePro] legacy handle cleanup failed', e)
    )
}

cleanupLegacyHandle()

const localFileCheck = new LocalFileCheck()
export { localFileCheck }
