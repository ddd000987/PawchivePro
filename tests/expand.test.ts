import { beforeEach, describe, expect, it } from 'vitest'
import { expandPost } from '../src/kemono/expand'
import { defaultSettings, settings } from '../src/setting/Settings'
import { isPendingPost } from '../src/kemono/apiTypes'
import type { Post, PostApiResponse } from '../src/kemono/apiTypes'

const HOST = 'kemono.su'

function fixture(overrides: Partial<Post> = {}): PostApiResponse {
  return {
    post: {
      id: '999',
      user: 'u1',
      service: 'patreon',
      title: 'hello',
      content: '<p>hi<br>there</p>',
      embed: {},
      shared_file: false,
      added: '',
      published: '2024-01-02T03:04:05',
      edited: '',
      file: { name: 'cover.jpg', path: '/a/cover.jpg' },
      attachments: [
        { name: 'a.png', path: '/a/a.png' },
        { name: 'b.mp4', path: '/b/b.mp4' },
        { name: 'c.zip', path: '/c/c.zip' },
      ],
      ...overrides,
    },
    attachments: [],
  }
}

describe('expandPost', () => {
  beforeEach(() => {
    settings.set('textContent', 'txt')
    settings.set('noCoverFile', false)
    settings.set('downloadOriginalImage', true)
  })

  it('展開附件+封面+文字檔，URL 一次算好', () => {
    const { pending, files } = expandPost(fixture(), 'creator', HOST)
    expect(pending).toBe(false)
    // txt + 3 附件 + 封面
    expect(files).toHaveLength(5)
    expect(files[0].kind).toBe('text')
    expect(files[0].fileName).toBe('content.txt')
    expect(files[0].textData).toBe('hi\nthere')
    const kinds = files.slice(1).map((f) => f.kind)
    expect(kinds).toEqual(['image', 'video', 'other', 'cover'])
    for (const f of files.slice(1)) {
      expect(f.fileUrl).toContain('/data')
    }
  })

  it('has_full=false 標記 pending', () => {
    const { pending } = expandPost(fixture({ has_full: false }), 'c', HOST)
    expect(pending).toBe(true)
  })

  it('缺 has_full 欄位視為完整帖（pending=false）', () => {
    const { pending } = expandPost(fixture(), 'c', HOST)
    expect(pending).toBe(false)
  })

  it('扁平回包的頂層附件也會併入且不重複', () => {
    const data = fixture()
    data.attachments = [
      { name: 'a.png', path: '/a/a.png' },
      { name: 'd.jpg', path: '/d/d.jpg' },
    ]
    const { files } = expandPost(data, 'c', HOST)
    expect(files.map((f) => f.fileName)).toEqual([
      'content.txt',
      'a.png',
      'b.mp4',
      'c.zip',
      'd.jpg',
      'cover.jpg',
    ])
  })

  it('畸形附件（缺 path）直接跳過，不崩潰', () => {
    const data = fixture()
    data.post.attachments = [
      { name: 'a.png' } as any,
      null as any,
      { name: 'b.mp4', path: '/b/b.mp4' },
    ]
    const { files } = expandPost(data, 'c', HOST)
    expect(files.some((f) => f.fileName === 'b.mp4')).toBe(true)
    expect(files.every((f) => typeof f.fileUrl === 'string')).toBe(true)
  })

  it('非圖片封面不覆寫實際種類', () => {
    const data = fixture({ file: { name: 'cover.zip', path: '/c/cover.zip' } })
    const { files } = expandPost(data, 'c', HOST)
    expect(files.find((f) => f.fileName === 'cover.zip')?.kind).toBe('other')
  })

  it('封面與附件同 path 時只保留一筆（不覆寫原種類）', () => {
    const data = fixture({ file: { name: 'a.png', path: '/a/a.png' } })
    const { files } = expandPost(data, 'c', HOST)
    const same = files.filter((f) => f.fileName === 'a.png')
    expect(same).toHaveLength(1)
    expect(same[0].kind).toBe('image')
  })

  it('文字項 fileUrl 固定為空字串（下游先判 kind）', () => {
    const { files } = expandPost(fixture(), 'c', HOST)
    expect(files[0].kind).toBe('text')
    expect(files[0].fileUrl).toBe('')
  })

  it('textContent=none 時不含文字檔', () => {
    settings.set('textContent', 'none')
    const { files } = expandPost(fixture(), 'c', HOST)
    expect(files.every((f) => f.kind !== 'text')).toBe(true)
  })

  it('noCoverFile 時不含封面', () => {
    settings.set('noCoverFile', true)
    const { files } = expandPost(fixture(), 'c', HOST)
    expect(files.every((f) => f.kind !== 'cover')).toBe(true)
  })

  it('下載原圖開關決定圖片網址，與預覽開關無關', () => {
    settings.set('previewOriginalImage', false)
    settings.set('downloadOriginalImage', true)
    const on = expandPost(fixture(), 'c', HOST).files.find(
      (f) => f.fileName === 'a.png'
    )
    expect(on?.fileUrl).not.toContain('/thumbnail/')
    settings.set('previewOriginalImage', true)
    settings.set('downloadOriginalImage', false)
    const off = expandPost(fixture(), 'c', HOST).files.find(
      (f) => f.fileName === 'a.png'
    )
    expect(off?.fileUrl).toContain('/thumbnail/data')
    settings.set('previewOriginalImage', false)
  })

  it('downloadOriginalImage 預設為 true', () => {
    expect(defaultSettings.downloadOriginalImage).toBe(true)
  })

  it('html 模式包一層可離線閱讀的 HTML', () => {
    settings.set('textContent', 'html')
    const { files } = expandPost(fixture(), 'c', HOST)
    expect(files[0].fileName).toBe('content.html')
    expect(files[0].textData).toContain('<meta charset="utf-8">')
  })

  it('輸出契約：非文字項必有 fileUrl，文字項必有 textData', () => {
    for (const mode of ['txt', 'html', 'none'] as const) {
      settings.set('textContent', mode)
      const { files } = expandPost(fixture(), 'c', HOST)
      for (const f of files) {
        if (f.kind === 'text') {
          expect(f.textData).not.toBe('')
        } else {
          expect(f.fileUrl).not.toBe('')
        }
      }
    }
    // 畸形附件（缺 path）不會變成空網址項
    const { files } = expandPost(
      fixture({
        attachments: [
          { name: 'x.png' } as any,
          { name: 'a.png', path: '/a/a.png' },
        ],
      }),
      'c',
      HOST
    )
    expect(
      files.filter((f) => f.kind !== 'text').every((f) => f.fileUrl !== '')
    ).toBe(true)
  })

  it('has_full：只有明確 false 才是 pending，缺欄位視為完整', () => {
    expect(expandPost(fixture({ has_full: false }), 'c', HOST).pending).toBe(
      true
    )
    expect(expandPost(fixture({ has_full: true }), 'c', HOST).pending).toBe(
      false
    )
    expect(expandPost(fixture(), 'c', HOST).pending).toBe(false)
  })
})

describe('isPendingPost', () => {
  it('只有明確 false 為 pending', () => {
    expect(isPendingPost({ has_full: false })).toBe(true)
    expect(isPendingPost({ has_full: true })).toBe(false)
  })

  it('缺欄位、null、undefined 都視為完整', () => {
    expect(isPendingPost({})).toBe(false)
    expect(isPendingPost(null)).toBe(false)
    expect(isPendingPost(undefined)).toBe(false)
  })
})
