import { describe, expect, it, vi } from 'vitest'

import { FolderChecker, locateUnderRoot } from '../src/folder/folderCore'

function domErr(name: string) {
  return { name, message: name }
}

/** 以巢狀物件模擬資料夾：數字為檔案大小，物件為子資料夾 */
type Tree = { [name: string]: number | Tree }

function fakeDir(name: string, tree: Tree): any {
  return {
    name,
    queryPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    getDirectoryHandle: vi.fn(async (n: string) => {
      const node = tree[n]
      if (node === undefined) throw domErr('NotFoundError')
      if (typeof node === 'number') throw domErr('TypeMismatchError')
      return fakeDir(n, node)
    }),
    getFileHandle: vi.fn(async (n: string) => {
      const node = tree[n]
      if (node === undefined) throw domErr('NotFoundError')
      if (typeof node !== 'number') throw domErr('TypeMismatchError')
      return { kind: 'file', name: n, getFile: async () => ({ size: node }) }
    }),
    values: vi.fn(async function* () {
      for (const [n, node] of Object.entries(tree)) {
        yield typeof node === 'number'
          ? { kind: 'file', name: n, getFile: async () => ({ size: node }) }
          : { kind: 'directory', name: n }
      }
    }),
  }
}

describe('locateUnderRoot', () => {
  it('根在第 0 段', () => {
    expect(locateUnderRoot('kemono', 'kemono/fanbox/a/1.png')).toEqual([
      'fanbox',
      'a',
      '1.png',
    ])
  })

  it('根在路徑中間', () => {
    expect(locateUnderRoot('kemono', 'Pawchive/kemono/x/1.png')).toEqual([
      'x',
      '1.png',
    ])
  })

  it('不分大小寫', () => {
    expect(locateUnderRoot('Kemono', 'kEMONO/x/1.png')).toEqual(['x', '1.png'])
  })

  it('找不到根回 null', () => {
    expect(locateUnderRoot('other', 'kemono/x/1.png')).toBeNull()
  })

  it('根是最後一段回 null', () => {
    expect(locateUnderRoot('kemono', 'a/b/kemono')).toBeNull()
  })

  it('忽略空段', () => {
    expect(locateUnderRoot('kemono', '/kemono//x//1.png')).toEqual([
      'x',
      '1.png',
    ])
  })
})

describe('FolderChecker.exists', () => {
  it('檔案存在且非空回 true', async () => {
    const root = fakeDir('kemono', { fanbox: { a: { '1.png': 100 } } })
    const r = await new FolderChecker(root).exists('kemono/fanbox/a/1.png')
    expect(r).toEqual({ exists: true, mismatch: false })
  })

  it('檔案直接放在根底下', async () => {
    const root = fakeDir('kemono', { '1.png': 5 })
    const r = await new FolderChecker(root).exists('kemono/1.png')
    expect(r.exists).toBe(true)
  })

  it('0 位元組視為不存在', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 0 } })
    const r = await new FolderChecker(root).exists('kemono/a/1.png')
    expect(r.exists).toBe(false)
  })

  it('檔案不存在回 false', async () => {
    const root = fakeDir('kemono', { a: {} })
    const r = await new FolderChecker(root).exists('kemono/a/1.png')
    expect(r.exists).toBe(false)
  })

  it('資料夾不存在回 false，且同資料夾只查一次（快取）', async () => {
    const root = fakeDir('kemono', {})
    const checker = new FolderChecker(root)
    expect((await checker.exists('kemono/a/1.png')).exists).toBe(false)
    expect((await checker.exists('kemono/a/2.png')).exists).toBe(false)
    expect(root.getDirectoryHandle).toHaveBeenCalledTimes(1)
  })

  it('路徑中某段其實是檔案（TypeMismatchError）回 false', async () => {
    const root = fakeDir('kemono', { a: 10 })
    const r = await new FolderChecker(root).exists('kemono/a/1.png')
    expect(r.exists).toBe(false)
  })

  it('其他錯誤回 null（不算路徑不符）', async () => {
    const root = fakeDir('kemono', {})
    root.getDirectoryHandle = vi.fn(async () => {
      throw domErr('SecurityError')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await new FolderChecker(root).exists('kemono/a/1.png')
    expect(r).toEqual({ exists: null, mismatch: false })
  })

  it('路徑不在根底下回 null 並標記 mismatch', async () => {
    const r = await new FolderChecker(fakeDir('kemono', {})).exists(
      'other/a/1.png'
    )
    expect(r).toEqual({ exists: null, mismatch: true })
  })
})

describe('FolderChecker.existsMany', () => {
  it('回傳已存在的路徑，不存在的不在其中', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 10, '2.png': 20 } })
    const r = await new FolderChecker(root).existsMany([
      'kemono/a/1.png',
      'kemono/a/2.png',
      'kemono/a/3.png',
    ])
    expect(new Set(r.found)).toEqual(
      new Set(['kemono/a/1.png', 'kemono/a/2.png'])
    )
    expect(r.mismatch).toBe(false)
  })

  it('檔名不分大小寫', async () => {
    const root = fakeDir('kemono', { a: { 'Photo.PNG': 10 } })
    const r = await new FolderChecker(root).existsMany(['kemono/a/photo.png'])
    expect(r.found).toEqual(['kemono/a/photo.png'])
  })

  it('0 位元組不算已存在', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 0, '2.png': 5 } })
    const r = await new FolderChecker(root).existsMany([
      'kemono/a/1.png',
      'kemono/a/2.png',
    ])
    expect(r.found).toEqual(['kemono/a/2.png'])
  })

  it('同名子資料夾不算檔案', async () => {
    const root = fakeDir('kemono', { a: { '1.png': {} } })
    const r = await new FolderChecker(root).existsMany(['kemono/a/1.png'])
    expect(r.found).toEqual([])
  })

  it('資料夾不存在時該資料夾的檔案都不在結果中', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 5 } })
    const r = await new FolderChecker(root).existsMany([
      'kemono/missing/1.png',
      'kemono/a/1.png',
    ])
    expect(r.found).toEqual(['kemono/a/1.png'])
  })

  it('同一個資料夾只列一次目錄，即使有很多檔案', async () => {
    const files: Record<string, number> = {}
    const paths: string[] = []
    for (let i = 0; i < 50; i++) {
      files[`${i}.png`] = 1
      paths.push(`kemono/a/${i}.png`)
    }
    let aDir: any
    const root = fakeDir('kemono', { a: files })
    const orig = root.getDirectoryHandle
    root.getDirectoryHandle = vi.fn(async (n: string) => {
      aDir = await orig(n)
      return aDir
    })
    const r = await new FolderChecker(root).existsMany(paths)
    expect(r.found.length).toBe(50)
    expect(aDir.values).toHaveBeenCalledTimes(1)
    expect(root.getDirectoryHandle).toHaveBeenCalledTimes(1)
  })

  it('路徑不在根底下的不納入，並標記 mismatch', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 5 } })
    const r = await new FolderChecker(root).existsMany([
      'other/a/1.png',
      'other/a/2.png',
      'kemono/a/1.png',
    ])
    expect(r.found).toEqual(['kemono/a/1.png'])
    expect(r.mismatch).toBe(true)
  })

  it('單一資料夾出錯不影響其他資料夾', async () => {
    const root = fakeDir('kemono', { a: { '1.png': 5 }, b: { '2.png': 5 } })
    const orig = root.getDirectoryHandle
    root.getDirectoryHandle = vi.fn(async (n: string) => {
      if (n === 'a') {
        throw domErr('SecurityError')
      }
      return orig(n)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await new FolderChecker(root).existsMany([
      'kemono/a/1.png',
      'kemono/b/2.png',
    ])
    expect(r.found).toEqual(['kemono/b/2.png'])
    expect(r.mismatch).toBe(false)
  })
})
