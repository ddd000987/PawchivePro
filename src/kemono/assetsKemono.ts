/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/sites/kemono.ts (assets section)
 *   + murmurhash split_clients semantics
 * changes: exposes the Kemono fileserver split only (fileserverFor);
 *          thumbnails and per-post preview servers are resolved in
 *          preview/previewAssets.ts. FILESERVERS hardcoding kept verbatim
 *          (n1–n4.kemono.cr). The hash input (`/data${path}`)
 *          was verified against kemono.cr on 2026-10-26; the list depends
 *          on the live site, so update it if the file hosts change.
 *          Uses a tiny inline murmur2 instead of the murmurhash-js package.
 */

import { isImageFile } from './fileType'

/** murmur2 (32-bit) — 與 murmurhash-js 同算法，供 n1–n4 分流用 */
function murmur2(str: string, seed = 0): number {
  let l = str.length
  let h = seed ^ l
  let i = 0
  let k: number
  while (l >= 4) {
    k =
      (str.charCodeAt(i) & 0xff) |
      ((str.charCodeAt(i + 1) & 0xff) << 8) |
      ((str.charCodeAt(i + 2) & 0xff) << 16) |
      ((str.charCodeAt(i + 3) & 0xff) << 24)
    k =
      (((k & 0xffff) * 0x5bd1e995 +
        ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)) &
        0xffffffff) >>>
      0
    k ^= k >>> 24
    k =
      (((k & 0xffff) * 0x5bd1e995 +
        ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)) &
        0xffffffff) >>>
      0
    h =
      ((((h & 0xffff) * 0x5bd1e995 +
        ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) &
        0xffffffff) ^
        k) >>>
      0
    i += 4
    l -= 4
  }
  switch (l) {
    case 3:
      h ^= (str.charCodeAt(i + 2) & 0xff) << 16
    // fallthrough
    case 2:
      h ^= (str.charCodeAt(i + 1) & 0xff) << 8
    // fallthrough
    case 1:
      h ^= str.charCodeAt(i) & 0xff
      h =
        (((h & 0xffff) * 0x5bd1e995 +
          ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) &
          0xffffffff) >>>
        0
  }
  h ^= h >>> 13
  h =
    (((h & 0xffff) * 0x5bd1e995 +
      ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) &
      0xffffffff) >>>
    0
  h ^= h >>> 15
  return h >>> 0
}

/** ⚠️ 唯一硬編碼點：依線上站點佈局而定，檔案伺服器變動時改這裡（n1–n4.kemono.cr） */
const FILESERVERS = [
  'https://n1.kemono.cr',
  'https://n2.kemono.cr',
  'https://n3.kemono.cr',
  'https://n4.kemono.cr',
]

const MAX_HASH = 2 ** 32 - 1
const BOUNDS = [0.25, 0.5, 0.75].map((p) => Math.floor(p * MAX_HASH))

/** path 不含 /data；站點實際分流是對 `/data${path}` 取雜湊（2026-10-26 對 kemono.cr 實測） */
function fileserverFor(path: string): string {
  const hash = murmur2('/data' + path)
  for (let i = 0; i < BOUNDS.length; i++) {
    if (hash < BOUNDS[i]) return FILESERVERS[i]
  }
  return FILESERVERS[3]
}

/** 縮圖（兩站相同）：https://img.{host}/thumbnail/data{path} */
function thumbnail(path: string, host = location.host): string {
  return `https://img.${host}/thumbnail/data${path}`
}

export { thumbnail, fileserverFor, FILESERVERS, isImageFile }
