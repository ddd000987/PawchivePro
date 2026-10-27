import { describe, expect, it } from 'vitest'
import {
  getDirectDownloadThreshold,
  getRetryDelayMs,
  parseRetryAfter,
  retryBackoffMaxMs,
  retryAfterMaxMs,
} from '../src/download/DownloadPolicy'
import { Config } from '../src/Config'

describe('getDirectDownloadThreshold', () => {
  it('一般視窗使用 200MB', () => {
    expect(getDirectDownloadThreshold(false)).toBe(
      Config.directDownloadThreshold
    )
  })

  it('隱身視窗使用較低的 32MB', () => {
    expect(getDirectDownloadThreshold(true)).toBe(
      Config.directDownloadThresholdIncognito
    )
  })
})

describe('parseRetryAfter', () => {
  it('解析秒數', () => {
    expect(parseRetryAfter('120')).toBe(120000)
    expect(parseRetryAfter(' 5 ')).toBe(5000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('解析 HTTP 日期', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const at = new Date(now + 5000).toUTCString()
    expect(parseRetryAfter(at, now)).toBe(5000)
  })

  it('已過去的日期回 0', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const at = new Date(now - 5000).toUTCString()
    expect(parseRetryAfter(at, now)).toBe(0)
  })

  it('空值或無效值回 undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
    expect(parseRetryAfter('   ')).toBeUndefined()
    expect(parseRetryAfter('not-a-date')).toBeUndefined()
  })
})

describe('getRetryDelayMs', () => {
  it('指數退避：2s、4s、8s', () => {
    expect(getRetryDelayMs(1)).toBe(2000)
    expect(getRetryDelayMs(2)).toBe(4000)
    expect(getRetryDelayMs(3)).toBe(8000)
  })

  it('一般退避上限 30s', () => {
    expect(getRetryDelayMs(20)).toBe(retryBackoffMaxMs)
  })

  it('429 有 Retry-After 秒數時改用它', () => {
    expect(getRetryDelayMs(1, 429, '60')).toBe(60000)
  })

  it('503 的 Retry-After HTTP 日期也可解析', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const at = new Date(now + 10000).toUTCString()
    expect(getRetryDelayMs(1, 503, at, now)).toBe(10000)
  })

  it('Retry-After 上限 120s', () => {
    expect(getRetryDelayMs(1, 429, '9999')).toBe(retryAfterMaxMs)
  })

  it('非 429／503 忽略 Retry-After，走一般退避', () => {
    expect(getRetryDelayMs(2, 500, '60')).toBe(4000)
  })

  it('Retry-After 無效時退回一般退避', () => {
    expect(getRetryDelayMs(3, 429, 'not-a-date')).toBe(8000)
  })
})
