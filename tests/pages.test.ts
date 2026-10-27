import { describe, expect, it } from 'vitest'
import { detectPage, isKemonoService, makePostKey } from '../src/kemono/pages'

describe('pages.detectPage', () => {
  it('detects creator pages incl. discord|afdian', () => {
    expect(detectPage('/patreon/user/123')).toMatchObject({
      kind: 'creator',
      service: 'patreon',
      creatorId: '123',
    })
    expect(detectPage('/discord/user/abc')).toMatchObject({ kind: 'creator' })
    expect(detectPage('/afdian/user/abc')).toMatchObject({ kind: 'creator' })
  })

  it('detects post pages', () => {
    expect(detectPage('/fanbox/user/1/post/2')).toMatchObject({
      kind: 'post',
      service: 'fanbox',
      creatorId: '1',
      postId: '2',
    })
  })

  it('容忍尾斜線', () => {
    expect(detectPage('/patreon/user/123/')).toMatchObject({
      kind: 'creator',
      creatorId: '123',
    })
    expect(detectPage('/fanbox/user/1/post/2/')).toMatchObject({
      kind: 'post',
      postId: '2',
    })
  })

  it('服務名白名單以外視為 other', () => {
    expect(detectPage('/evil/user/1')).toEqual({ kind: 'other' })
    expect(detectPage('/patreon/user/1/post/2/extra')).toEqual({
      kind: 'other',
    })
  })

  it('returns other otherwise', () => {
    expect(detectPage('/')).toEqual({ kind: 'other' })
  })
})

describe('isKemonoService', () => {
  it('只接受白名單服務', () => {
    expect(isKemonoService('patreon')).toBe(true)
    expect(isKemonoService('evil')).toBe(false)
    expect(isKemonoService('')).toBe(false)
  })
})

describe('makePostKey', () => {
  it('合法零件組出 postKey', () => {
    expect(makePostKey('patreon', '1', '2')).toBe('patreon/1/2')
  })

  it('非法服務或空 ID 直接拋錯', () => {
    expect(() => makePostKey('evil' as any, '1', '2')).toThrow(
      'invalid postKey parts'
    )
    expect(() => makePostKey('patreon', '', '2')).toThrow(
      'invalid postKey parts'
    )
  })
})
