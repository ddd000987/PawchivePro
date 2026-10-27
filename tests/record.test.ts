import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadRecord } from '../src/download/DownloadRecord'
import { settings } from '../src/setting/Settings'
import type { Result } from '../src/store/StoreType'

function file(id: string, overrides: Partial<Result> = {}): Result {
  return {
    id,
    postKey: 'patreon/u1/999',
    service: 'patreon',
    creator: 'artist',
    creatorId: 'u1',
    postId: '999',
    title: 't',
    published: '2024-01-02T03:04:05',
    fileCount: 2,
    pending: false,
    fileUrl: 'https://x/1.png',
    fileName: '1.png',
    ext: 'png',
    kind: 'image',
    previewOnly: false,
    textData: '',
    fileIndex: 0,
    ...overrides,
  }
}

describe('downloadRecord', () => {
  beforeEach(async () => {
    settings.set('skipDownloaded', 'record')
    settings.set(
      'namingRule',
      'kemono/{service}/{creator}-{creator_id}/{post_id}-{title}/{index}-{file_name}.{ext}'
    )
    await downloadRecord.clear(true)
  })

  it('未記錄不重複；登記後重複（只認 id）', async () => {
    const r = file('patreon/u1/999#0')
    expect(await downloadRecord.checkDeduplication(r)).toBe(false)
    await downloadRecord.addRecord(r)
    expect(await downloadRecord.checkDeduplication(r)).toBe(true)
  })

  it('不按記錄跳過（none／folder）總是放行；record／both 才比對', async () => {
    const r = file('patreon/u1/999#0')
    await downloadRecord.addRecord(r)
    for (const mode of ['none', 'folder'] as const) {
      settings.set('skipDownloaded', mode)
      expect(await downloadRecord.checkDeduplication(r)).toBe(false)
    }
    for (const mode of ['record', 'both'] as const) {
      settings.set('skipDownloaded', mode)
      expect(await downloadRecord.checkDeduplication(r)).toBe(true)
    }
  })

  it('命名規則改了仍認 id（不重下）', async () => {
    const r = file('patreon/u1/999#0')
    await downloadRecord.addRecord(r)
    settings.set('namingRule', '{post_id}/{index}.{ext}')
    expect(await downloadRecord.checkDeduplication(r)).toBe(true)
  })

  it('發布日期變了視為新檔', async () => {
    const r = file('patreon/u1/999#0')
    await downloadRecord.addRecord(r)
    expect(
      await downloadRecord.checkDeduplication(
        file('patreon/u1/999#0', { published: '2024-02-02T00:00:00' })
      )
    ).toBe(false)
  })

  it('hasPost：檔齊才算整帖下完（檔名集合比對）', async () => {
    const r0 = file('patreon/u1/999#0')
    const r1 = file('patreon/u1/999#1', { fileIndex: 1, fileName: '2.png' })
    const { fileName } = await import('../src/filename/FileName')
    const n0 = fileName.createFileName(r0)
    const n1 = fileName.createFileName(r1)
    const published = '2024-01-02T03:04:05'
    await downloadRecord.addRecord(r0)
    expect(
      await downloadRecord.hasPost('patreon/u1/999', published, [n0, n1])
    ).toBe(false)
    await downloadRecord.addRecord(r1)
    expect(
      await downloadRecord.hasPost('patreon/u1/999', published, [n0, n1])
    ).toBe(true)
    expect(await downloadRecord.hasPost('patreon/u1/999', published, [])).toBe(
      false
    )
    // 發布日期變了：舊記錄不算數
    expect(
      await downloadRecord.hasPost('patreon/u1/999', '2024-03-03T00:00:00', [
        n0,
        n1,
      ])
    ).toBe(false)
  })

  it('hasPost：只看數量，不比對檔名', async () => {
    const postKey = 'patreon/u1/999'
    const published = '2024-01-02T03:04:05'
    const r = file('patreon/u1/999#0')
    const { fileName } = await import('../src/filename/FileName')
    const name = fileName.createFileName(r)
    await downloadRecord.addRecord(r)

    expect(
      await downloadRecord.hasPost(postKey, published, ['other.png'])
    ).toBe(true)
    expect(await downloadRecord.hasPost(postKey, published, [name])).toBe(true)
    // 期望數量多於記錄數：不算整帖下完
    expect(
      await downloadRecord.hasPost(postKey, published, [name, 'other.png'])
    ).toBe(false)
  })

  it('hasPost：新增記錄後索引會更新', async () => {
    const postKey = 'patreon/u1/999'
    const published = '2024-01-02T03:04:05'
    const r0 = file('patreon/u1/999#0')
    const r1 = file('patreon/u1/999#1', { fileIndex: 1, fileName: '2.png' })
    const { fileName } = await import('../src/filename/FileName')
    const n0 = fileName.createFileName(r0)
    const n1 = fileName.createFileName(r1)
    await downloadRecord.addRecord(r0)
    expect(await downloadRecord.hasPost(postKey, published, [n0, n1])).toBe(
      false
    )
    await downloadRecord.addRecord(r1)
    expect(await downloadRecord.hasPost(postKey, published, [n0, n1])).toBe(
      true
    )
  })

  it('切換 textContent 後不位移誤判（形狀變了退回檔名比對）', async () => {
    settings.set('textContent', 'txt')
    const r = file('patreon/u1/999#0')
    await downloadRecord.addRecord(r)
    // 同形狀：認 id，通過
    expect(await downloadRecord.checkDeduplication(r)).toBe(true)
    // 切換形狀：退回檔名比對，同名仍判重複（不誤判新檔）
    settings.set('textContent', 'none')
    expect(await downloadRecord.checkDeduplication(r)).toBe(true)
    // 檔名真變了（規則改了）才視為新檔
    settings.set(
      'namingRule',
      'kemono/{service}/{creator}-{creator_id}/{post_id}-{title}/x-{file_name}.{ext}'
    )
    expect(await downloadRecord.checkDeduplication(r)).toBe(false)
    settings.set('textContent', 'txt')
  })

  it('冷啟動併發 addRecord 不覆寫舊記錄', async () => {
    vi.resetModules()
    let resolveGet: (value: any) => void = () => {}
    const pendingGet = new Promise((resolve) => {
      resolveGet = resolve
    })
    const oldRecord = {
      id: 'patreon/u1/888#0',
      n: 'old.png',
      d: '2024-01-01T00:00:00',
    }
    ;(globalThis as any).chrome.storage.local.get = vi.fn(() => pendingGet)
    const { downloadRecord: fresh } =
      await import('../src/download/DownloadRecord')

    // 兩次呼叫在 storage 回傳前就開始，共用同一次載入
    const p1 = fresh.addRecord(file('patreon/u1/999#0'))
    const p2 = fresh.addRecord(file('patreon/u1/999#1', { fileIndex: 1 }))
    resolveGet({ pawchiveProDownloadRecord: { [oldRecord.id]: oldRecord } })
    await Promise.all([p1, p2])

    expect(await fresh.getRecord(oldRecord.id)).not.toBeNull()
    expect(await fresh.getRecord('patreon/u1/999#0')).not.toBeNull()
    expect(await fresh.getRecord('patreon/u1/999#1')).not.toBeNull()
    expect(await fresh.count()).toBe(3)
  })

  it('clear 清空', async () => {
    await downloadRecord.addRecord(file('patreon/u1/999#0'))
    expect(await downloadRecord.count()).toBe(1)
    await downloadRecord.clear(true)
    expect(await downloadRecord.count()).toBe(0)
  })
})
