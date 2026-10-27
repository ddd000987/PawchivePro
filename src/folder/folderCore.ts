/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * 本機資料夾比對的核心邏輯（跑在 service worker 與資料夾授權頁，沒有 DOM 依賴）。
 *
 * 目錄 handle 存在「擴充功能來源」的 IndexedDB，授權也屬於擴充功能，
 * 網站的腳本看不到 handle、也讀不到資料夾。
 * 注意：這個檔案不可 import lang／Log／Toast 等會碰 DOM 的模組。
 */

/** lib.dom 沒有 queryPermission／requestPermission，這裡只宣告用到的部分 */
export interface FileLike {
  size: number
}
export interface FileHandleLike {
  kind: 'file' | 'directory'
  name: string
  getFile(): Promise<FileLike>
}
export interface DirHandleLike {
  name: string
  queryPermission(desc: { mode: 'read' }): Promise<PermissionState>
  requestPermission(desc: { mode: 'read' }): Promise<PermissionState>
  getDirectoryHandle(name: string): Promise<DirHandleLike>
  getFileHandle(name: string): Promise<FileHandleLike>
  /** 列出直接子項（只有一層）。目錄項沒有 getFile，不會被呼叫 */
  values(): AsyncIterable<FileHandleLike>
}

/** 'none' = 還沒選過資料夾 */
export type FolderPermission = PermissionState | 'none'

/** folder_status 的回覆 */
export interface FolderStatus {
  name: string | null
  permission: FolderPermission
}

/** 無法檢查的兩種原因（沒選資料夾／沒有讀取權限） */
export type FolderGate =
  { status: 'noFolder' } | { status: 'noPermission'; name: string }

/** SW 處理訊息時出錯（酬載不合法、未預期的例外） */
export interface FolderErrorResponse {
  status: 'error'
  error: string
}

/** folder_exists_many 的回覆 */
export type FolderExistsManyResponse =
  | FolderGate
  | FolderErrorResponse
  | { status: 'ok'; name: string; found: string[]; mismatch: boolean }

/** folder_exists 的回覆 */
export type FolderExistsResponse =
  | FolderGate
  | FolderErrorResponse
  | {
      status: 'ok'
      name: string
      exists: boolean | null
      mismatch: boolean
    }

/** folder_open_page 的回覆 */
export type FolderOpenPageResponse = { ok: true } | { ok: false; error: string }

/** 資料夾授權頁的模式：pick = 選資料夾；reauth = 重新允許讀取 */
export type FolderPageMode = 'pick' | 'reauth'

const DB_NAME = 'pawchivePro'
const STORE_NAME = 'handles'
const ROOT_KEY = 'downloadRoot'

/** 在相對路徑中找到根資料夾名稱，回傳它底下的路徑片段。
 * 找不到根、或根後面沒有任何片段時回 null。
 * Windows 不分大小寫，所以比對時忽略大小寫。 */
export function locateUnderRoot(
  rootName: string,
  relPath: string
): string[] | null {
  const segments = relPath.split('/').filter((s) => s !== '')
  const root = rootName.toLowerCase()
  const at = segments.findIndex((s) => s.toLowerCase() === root)
  if (at === -1) {
    return null
  }
  const rest = segments.slice(at + 1)
  return rest.length >= 1 ? rest : null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<unknown> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const req = db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('[PawchivePro] read folder handle failed', e)
    return undefined
  }
}

async function idbPut(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('[PawchivePro] save folder handle failed', e)
    return false
  }
}

/** 是否為「找不到／型別不符」這類代表檔案不存在的錯誤 */
function isMissingError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  return name === 'NotFoundError' || name === 'TypeMismatchError'
}

/** 讀出已保存的根資料夾 handle（沒有回 null） */
export async function loadRootHandle(): Promise<DirHandleLike | null> {
  const saved = await idbGet(ROOT_KEY)
  return (saved as DirHandleLike | undefined) ?? null
}

/** 保存根資料夾 handle */
export function saveRootHandle(handle: DirHandleLike): Promise<boolean> {
  return idbPut(ROOT_KEY, handle)
}

/** 目前資料夾名稱與讀取權限狀態 */
export async function getFolderStatus(): Promise<FolderStatus> {
  const handle = await loadRootHandle()
  if (!handle) {
    return { name: null, permission: 'none' }
  }
  try {
    const permission = await handle.queryPermission({ mode: 'read' })
    return { name: handle.name, permission }
  } catch (e) {
    console.error('[PawchivePro] query folder permission failed', e)
    return { name: handle.name, permission: 'denied' }
  }
}

/** 以一個根資料夾 handle 檢查相對路徑的檔案是否已存在 */
export class FolderChecker {
  /** 子資料夾 handle 快取：鍵為相對根的路徑，null = 該資料夾不存在 */
  private dirCache = new Map<string, DirHandleLike | null>()

  constructor(private readonly root: DirHandleLike) {}

  /** 逐層取得子資料夾（有快取）；資料夾不存在回 null */
  async getDir(dirs: string[]): Promise<DirHandleLike | null> {
    let cur: DirHandleLike = this.root
    let key = ''
    for (const seg of dirs) {
      key = key === '' ? seg : key + '/' + seg
      let next = this.dirCache.get(key)
      if (next === undefined) {
        try {
          next = await cur.getDirectoryHandle(seg)
        } catch (e) {
          if (!isMissingError(e)) {
            throw e
          }
          next = null
        }
        this.dirCache.set(key, next)
      }
      if (next === null) {
        return null
      }
      cur = next
    }
    return cur
  }

  /** 相對下載資料夾的路徑是否已有（非空）檔案。
   * 無法檢查（路徑不在根底下、其他錯誤）exists 為 null；
   * 路徑不在根底下時另外標記 mismatch */
  async exists(
    relPath: string
  ): Promise<{ exists: boolean | null; mismatch: boolean }> {
    const segments = locateUnderRoot(this.root.name, relPath)
    if (!segments) {
      return { exists: null, mismatch: true }
    }
    try {
      const dir = await this.getDir(segments.slice(0, -1))
      if (!dir) {
        return { exists: false, mismatch: false }
      }
      const fh = await dir.getFileHandle(segments[segments.length - 1])
      const file = await fh.getFile()
      // 0 位元組多半是中斷留下的殘檔，不算已存在
      return { exists: file.size > 0, mismatch: false }
    } catch (e) {
      if (isMissingError(e)) {
        return { exists: false, mismatch: false }
      }
      console.error('[PawchivePro] check local file failed', e)
      return { exists: null, mismatch: false }
    }
  }

  /** 批量檢查：回傳「已有（非空）檔案」的相對路徑。
   * 同一個資料夾只列一次目錄，比逐檔 getFileHandle 快得多（上千檔時差很大）。
   * 路徑不在根底下的不納入結果，並標記 mismatch */
  async existsMany(
    relPaths: string[]
  ): Promise<{ found: string[]; mismatch: boolean }> {
    let mismatch = false

    // 依父資料夾分組
    const groups = new Map<
      string,
      { dirs: string[]; files: Array<{ rel: string; name: string }> }
    >()
    for (const rel of relPaths) {
      const segments = locateUnderRoot(this.root.name, rel)
      if (!segments) {
        mismatch = true
        continue
      }
      const dirs = segments.slice(0, -1)
      const key = dirs.join('/')
      let group = groups.get(key)
      if (!group) {
        group = { dirs, files: [] }
        groups.set(key, group)
      }
      group.files.push({ rel, name: segments[segments.length - 1] })
    }

    const found: string[] = []
    for (const { dirs, files } of groups.values()) {
      try {
        const dir = await this.getDir(dirs)
        if (!dir) {
          continue
        }
        // Windows 不分大小寫：用小寫檔名建索引
        const entries = new Map<string, FileHandleLike>()
        for await (const entry of dir.values()) {
          if (entry.kind === 'file') {
            entries.set(entry.name.toLowerCase(), entry)
          }
        }
        for (const f of files) {
          const entry = entries.get(f.name.toLowerCase())
          if (!entry) {
            continue
          }
          // 0 位元組多半是中斷留下的殘檔，不算已存在
          if ((await entry.getFile()).size > 0) {
            found.push(f.rel)
          }
        }
      } catch (e) {
        // 單一資料夾出錯不拖垮整批：該資料夾視為都不存在
        console.error('[PawchivePro] check local folder failed', e)
      }
    }
    return { found, mismatch }
  }
}
