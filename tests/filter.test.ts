import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filter } from '../src/filter/Filter'
import { settings } from '../src/setting/Settings'
import type { PostFilterInput } from '../src/filter/Filter'

function input(overrides: Partial<PostFilterInput> = {}): PostFilterInput {
  return {
    service: 'patreon',
    postId: '100',
    title: 'hello world',
    published: '2024-06-01T00:00:00',
    fileCount: 3,
    kinds: new Set(['image', 'cover']),
    pending: false,
    ...overrides,
  }
}

function resetFilters() {
  settings.set('filterTitle', '')
  settings.set('filterDateFrom', '')
  settings.set('filterDateTo', '')
  settings.set('filterMinFiles', 0)
  settings.set('filterMaxFiles', 0)
  settings.set('downImageFiles', true)
  settings.set('downVideoFiles', true)
  settings.set('downOtherFiles', true)
  settings.set('downloadCover', true)
  settings.set('skipPendingPosts', true)
  settings.set('filterServices', '')
  settings.set('filterPostIdFrom', '')
  settings.set('filterPostIdTo', '')
}

describe('filter.checkPost', () => {
  beforeEach(resetFilters)

  it('非數字 ID 篩選值忽略，不會靜默誤濾', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    settings.set('filterPostIdFrom', 'abc')
    expect(filter.checkPost(input())).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('預設全部通過', () => {
    expect(filter.checkPost(input())).toBe(true)
  })

  it('標題關鍵字（大小寫不敏感）', () => {
    settings.set('filterTitle', 'WORLD')
    expect(filter.checkPost(input())).toBe(true)
    settings.set('filterTitle', 'zzz')
    expect(filter.checkPost(input())).toBe(false)
    expect(filter.lastReason).toBe('title')
  })

  it('日期範圍', () => {
    settings.set('filterDateFrom', '2024-07-01')
    expect(filter.checkPost(input())).toBe(false)
    settings.set('filterDateFrom', '2024-01-01')
    settings.set('filterDateTo', '2024-12-31')
    expect(filter.checkPost(input())).toBe(true)
  })

  it('附件數範圍', () => {
    settings.set('filterMinFiles', 5)
    expect(filter.checkPost(input())).toBe(false)
    settings.set('filterMinFiles', 0)
    settings.set('filterMaxFiles', 2)
    expect(filter.checkPost(input())).toBe(false)
    settings.set('filterMaxFiles', 0)
    expect(filter.checkPost(input())).toBe(true)
  })

  it('種類全關則整帖剔除', () => {
    settings.set('downImageFiles', false)
    settings.set('downloadCover', false)
    expect(filter.checkPost(input())).toBe(false)
    expect(filter.lastReason).toBe('kind')
  })

  it('pending 帖預設跳過', () => {
    expect(filter.checkPost(input({ pending: true }))).toBe(false)
    settings.set('skipPendingPosts', false)
    expect(filter.checkPost(input({ pending: true }))).toBe(true)
  })

  it('服務限定', () => {
    settings.set('filterServices', 'fanbox, fantia')
    expect(filter.checkPost(input())).toBe(false)
    settings.set('filterServices', 'patreon')
    expect(filter.checkPost(input())).toBe(true)
  })

  it('帖子 ID 範圍（數字字串比較）', () => {
    settings.set('filterPostIdFrom', '1000')
    expect(filter.checkPost(input())).toBe(false)
    settings.set('filterPostIdFrom', '50')
    settings.set('filterPostIdTo', '200')
    expect(filter.checkPost(input())).toBe(true)
  })

  it('抓取不做下載記錄去重：skipDownloaded 任何模式下都保留', () => {
    // 去重是下載時的事；抓取結果必須完整，重抓已下載完的創作者也不能為空
    for (const mode of ['none', 'record', 'folder', 'both'] as const) {
      settings.set('skipDownloaded', mode)
      expect(filter.checkPost(input())).toBe(true)
      expect(filter.lastReason).not.toBe('duplicate')
    }
    settings.set('skipDownloaded', 'record')
  })

  it('單檔體積上限', () => {
    settings.set('filterMaxSizeMiB', 10)
    expect(filter.checkFileSize(5 * 1024 * 1024)).toBe(true)
    expect(filter.checkFileSize(11 * 1024 * 1024)).toBe(false)
    expect(filter.checkFileSize(0)).toBe(true)
  })
})
