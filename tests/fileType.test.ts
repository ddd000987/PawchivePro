import { describe, expect, it } from 'vitest'
import {
  extensionOf,
  fileKind,
  isImageFile,
  isVideoFile,
} from '../src/kemono/fileType'

describe('extensionOf', () => {
  it('取小寫副檔名，忽略路徑', () => {
    expect(extensionOf('/a/b/c.PNG')).toBe('png')
    expect(extensionOf('c.tar.gz')).toBe('gz')
  })

  it('無副檔名或空值回空字串', () => {
    expect(extensionOf('/a/b')).toBe('')
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('')).toBe('')
    expect(extensionOf(undefined as any)).toBe('')
  })
})

describe('isImageFile / isVideoFile', () => {
  it('缺 path／空物件不崩潰', () => {
    expect(isImageFile({})).toBe(false)
    expect(isImageFile(undefined)).toBe(false)
    expect(isImageFile({ path: undefined as any })).toBe(false)
    expect(isVideoFile({ name: 'a.mp4' })).toBe(true)
    expect(isVideoFile(null)).toBe(false)
  })
})

describe('fileKind', () => {
  it('統一 image/video/other 判定', () => {
    expect(fileKind({ path: '/a/a.jpg' })).toBe('image')
    expect(fileKind({ name: 'b.MP4', path: '/b/b' })).toBe('video')
    expect(fileKind({ path: '/c/c.zip' })).toBe('other')
  })
})
