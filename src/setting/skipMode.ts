/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* skipDownloaded 設定值的判讀：按下載記錄跳過／按本機資料夾跳過（純函數，無依賴） */

type SkipMode = 'none' | 'record' | 'folder' | 'both'

/** 是否按下載記錄跳過已下載的作品 */
export function skipByRecord(mode: SkipMode): boolean {
  return mode === 'record' || mode === 'both'
}

/** 是否按已授權資料夾裡同路徑已有的檔案跳過 */
export function skipByFolder(mode: SkipMode): boolean {
  return mode === 'folder' || mode === 'both'
}
