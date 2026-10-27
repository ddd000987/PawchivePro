import { describe, expect, it } from 'vitest'
import {
  allFiles,
  coverUrl,
  downloadUrl,
  imageFiles,
  imageUrl,
  isKemonoHost,
  parsePostKey,
  parsePostKeyFromHref,
  resolveDownloadUrl,
} from '../src/preview/previewAssets'
import { fileserverFor } from '../src/kemono/assetsKemono'
import type { PostApiResponse } from '../src/kemono/apiTypes'

const K_HOST = 'kemono.su'
const P_HOST = 'pawchive.pw'

function fixture(): PostApiResponse {
  return {
    post: {
      id: '999',
      user: 'u1',
      service: 'patreon',
      title: 't',
      content: '',
      embed: {},
      shared_file: false,
      added: '',
      published: '2024-01-02T03:04:05',
      edited: '',
      file: { name: 'cover.jpg', path: '/a/cover.jpg' },
      attachments: [{ name: 'a.png', path: '/a/a.png' }],
    },
    attachments: [
      { name: 'a.png', path: '/a/a.png' },
      { name: 'b.zip', path: '/b/b.zip' },
    ],
    previews: [
      {
        name: 'a.png',
        path: '/a/a.png',
        server: 'https://n3.kemono.cr',
        type: 'thumbnail',
      },
    ],
  }
}

describe('parsePostKeyFromHref', () => {
  it('parses absolute + relative hrefs', () => {
    expect(
      parsePostKeyFromHref('https://kemono.su/patreon/user/1/post/2')
    ).toBe('patreon/1/2')
    expect(parsePostKeyFromHref('/fanbox/user/x/post/y')).toBe('fanbox/x/y')
    expect(parsePostKeyFromHref('/discord/user/a/post/b')).toBe('discord/a/b')
  })
  it('rejects non-post links', () => {
    expect(parsePostKeyFromHref('/patreon/user/1')).toBeNull()
    expect(parsePostKeyFromHref('https://kemono.su/')).toBeNull()
    expect(parsePostKeyFromHref('::::')).toBeNull()
  })
})

describe('parsePostKey', () => {
  it('splits service/creatorId/postId', () => {
    expect(parsePostKey('patreon/1/2')).toEqual({
      service: 'patreon',
      creatorId: '1',
      postId: '2',
    })
    expect(parsePostKey('bad')).toBeNull()
  })
  it('服務名不在白名單時回 null', () => {
    expect(parsePostKey('evil/1/2')).toBeNull()
  })
})

describe('isKemonoHost / coverUrl', () => {
  it('distinguishes families', () => {
    expect(isKemonoHost('kemono.su')).toBe(true)
    expect(isKemonoHost('www.kemono.cr')).toBe(true)
    expect(isKemonoHost('pawchive.pw')).toBe(false)
  })
  it('域名精確匹配，不誤判相似網域', () => {
    expect(isKemonoHost('kemono.su.evil.com')).toBe(false)
    expect(isKemonoHost('fakekemono.com')).toBe(false)
  })
  it('builds thumbnail or empty', () => {
    expect(coverUrl({ path: '/a/b.jpg' }, K_HOST)).toBe(
      'https://img.kemono.su/thumbnail/data/a/b.jpg'
    )
    expect(coverUrl(undefined, K_HOST)).toBe('')
    expect(coverUrl({}, K_HOST)).toBe('')
  })
})

describe('file merging', () => {
  it('allFiles dedupes post.file + both attachment lists', () => {
    expect(allFiles(fixture()).map((f) => f.path)).toEqual([
      '/a/cover.jpg',
      '/a/a.png',
      '/b/b.zip',
    ])
  })
  it('imageFiles keeps images only', () => {
    expect(imageFiles(fixture()).map((f) => f.path)).toEqual([
      '/a/cover.jpg',
      '/a/a.png',
    ])
  })
})

describe('kemono URL rules', () => {
  const data = fixture()
  const img = { name: 'a.png', path: '/a/a.png' }
  const zip = { name: 'b.zip', path: '/b/b.zip' }
  it('original prefers previews.server, falls back to fileserverFor', () => {
    expect(imageUrl(img, data, true, K_HOST)).toBe(
      'https://n3.kemono.cr/data/a/a.png'
    )
    const noPreview: PostApiResponse = { ...data, previews: [] }
    expect(imageUrl(img, noPreview, true, K_HOST)).toBe(
      `${fileserverFor(img.path)}/data/a/a.png`
    )
  })
  it('thumbnail mode + non-image guard', () => {
    expect(imageUrl(img, data, false, K_HOST)).toBe(
      'https://img.kemono.su/thumbnail/data/a/a.png'
    )
    expect(imageUrl(zip, data, true, K_HOST)).toBe('')
  })
  it('non-image download goes to murmur fileserver', () => {
    const url = downloadUrl(zip, data, true, K_HOST)
    expect(url).toMatch(/^https:\/\/n[1-4]\.kemono\.cr\/data\/b\/b\.zip$/)
  })
})

describe('pawchive URL rules', () => {
  const data = fixture()
  const img = { name: 'a.png', path: '/a/a.png' }
  const zip = { name: 'b.zip', path: '/b/b.zip' }
  it('image follows the original switch', () => {
    expect(imageUrl(img, data, true, P_HOST)).toBe(
      'https://file.pawchive.pw/data/a/a.png'
    )
    expect(imageUrl(img, data, false, P_HOST)).toBe(
      'https://img.pawchive.pw/thumbnail/data/a/a.png'
    )
  })
  it('preview_only ignores the switch; non-image uses file.', () => {
    const locked = { name: 'x.jpg', path: '/x/x.jpg', preview_only: true }
    expect(imageUrl(locked, data, true, P_HOST)).toBe(
      'https://img.pawchive.pw/thumbnail/data/x/x.jpg'
    )
    expect(downloadUrl(zip, data, false, P_HOST)).toBe(
      'https://file.pawchive.pw/data/b/b.zip'
    )
  })
})

describe('fileserverFor', () => {
  // 向量取自 kemono.cr 實際連結的檔案伺服器（雜湊輸入為 /data + path）
  it.each([
    [
      '/3a/76/3a76ad3927d5f04fe5592b531dfc6da6f0cd402a774e74e92edfdb4713ce587e.bin',
      'https://n4.kemono.cr',
    ],
    [
      '/71/a0/71a0cf7404ee7c6766de5957825d88c4eea9015cdd448702093bea497fb796ac.bin',
      'https://n4.kemono.cr',
    ],
    [
      '/7d/14/7d141c8aa85eaa94c5ab48302e063e8eab35329af720acf6e36d22aa1de4b910.png',
      'https://n1.kemono.cr',
    ],
    [
      '/ba/26/ba26513ea5eb6aa9760398f2122ba272cbff8314286a18f3622c5aed23a27b7d.gif',
      'https://n2.kemono.cr',
    ],
  ])('%s → %s', (path, server) => {
    expect(fileserverFor(path)).toBe(server)
  })
})

describe('resolveDownloadUrl', () => {
  const kThumb = 'https://img.kemono.su/thumbnail/data/a/a.png'
  const pThumb = 'https://img.pawchive.pw/thumbnail/data/a/a.png'
  it('kemono 縮圖網址換回 murmur fileserver 原圖', () => {
    expect(
      resolveDownloadUrl({ fileUrl: kThumb, previewOnly: false }, true, K_HOST)
    ).toBe(`${fileserverFor('/a/a.png')}/data/a/a.png`)
  })
  it('pawchive 縮圖網址換回 file. 原圖', () => {
    expect(
      resolveDownloadUrl({ fileUrl: pThumb, previewOnly: false }, true, P_HOST)
    ).toBe('https://file.pawchive.pw/data/a/a.png')
  })
  it('previewOnly 不換', () => {
    expect(
      resolveDownloadUrl({ fileUrl: kThumb, previewOnly: true }, true, K_HOST)
    ).toBe(kThumb)
    expect(
      resolveDownloadUrl({ fileUrl: pThumb, previewOnly: true }, true, P_HOST)
    ).toBe(pThumb)
  })
  it('非縮圖網址原樣返回', () => {
    const u = 'https://n1.kemono.cr/data/b/b.zip'
    expect(
      resolveDownloadUrl({ fileUrl: u, previewOnly: false }, true, K_HOST)
    ).toBe(u)
    expect(
      resolveDownloadUrl({ fileUrl: '', previewOnly: false }, true, K_HOST)
    ).toBe('')
  })
  it('original=false 原樣返回', () => {
    expect(
      resolveDownloadUrl({ fileUrl: kThumb, previewOnly: false }, false, K_HOST)
    ).toBe(kThumb)
  })
})
