import { describe, expect, it } from 'vitest'
import {
  PREVIEW_INFO_FIELDS,
  defaultPreviewInfoPlacement,
  sanitizePreviewInfoPlacement,
  buildPreviewInfoFields,
  composePreviewInfo,
} from '../src/preview/previewInfo'
import type {
  PreviewInfoPlacement,
  PreviewInfoSource,
  Translate,
} from '../src/preview/previewInfo'
import { defaultSettings, settings } from '../src/setting/Settings'

/** 假翻譯（真實 lang.transl 語義：key 對應文案，`{}` 由參數填入） */
const t: Translate = (key, ...args) => {
  switch (key) {
    case '_previewFiles':
      return `附件${args[0]}`
    case '_pendingOnly':
      return '⚠僅預覽'
    case '_previewKeys':
      return 'D 整帖 C 單張 V 原圖 Esc 關閉'
    default:
      return String(key)
  }
}

function source(over: Partial<PreviewInfoSource> = {}): PreviewInfoSource {
  return {
    index: 0,
    total: 3,
    title: '標題',
    creatorId: 'creator42',
    service: 'patreon',
    postId: '999',
    published: '2024-01-02T03:04:05',
    pendingOnly: false,
    ...over,
  }
}

describe('sanitizePreviewInfoPlacement', () => {
  it('非物件輸入（null／字串／陣列）全部回預設', () => {
    for (const bad of [null, undefined, 'top', 42, [], true]) {
      expect(sanitizePreviewInfoPlacement(bad)).toEqual(
        defaultPreviewInfoPlacement
      )
    }
  })

  it('部分欄位合法時逐欄覆寫，缺欄沿用預設', () => {
    const out = sanitizePreviewInfoPlacement({
      title: 'bottom',
      keys: 'none',
    })
    expect(out.title).toBe('bottom')
    expect(out.keys).toBe('none')
    expect(out.index).toBe('top')
    expect(out.date).toBe('top')
  })

  it('髒值（未知字串／null／數字）回該欄預設', () => {
    const out = sanitizePreviewInfoPlacement({
      title: 'up',
      index: null,
      date: 3,
      service: 'TOP',
      creator: 'bottom',
    })
    expect(out.title).toBe('top')
    expect(out.index).toBe('top')
    expect(out.date).toBe('top')
    expect(out.service).toBe('top')
    expect(out.creator).toBe('bottom')
  })

  it('三種合法值都收，且每次回新物件（不共用預設）', () => {
    const out = sanitizePreviewInfoPlacement({
      index: 'top',
      title: 'bottom',
      creator: 'none',
    })
    expect([out.index, out.title, out.creator]).toEqual([
      'top',
      'bottom',
      'none',
    ])
    expect(out).not.toBe(defaultPreviewInfoPlacement)
    expect(sanitizePreviewInfoPlacement(defaultPreviewInfoPlacement)).not.toBe(
      defaultPreviewInfoPlacement
    )
    // 覆寫回傳值不影響預設
    out.title = 'none'
    expect(defaultPreviewInfoPlacement.title).toBe('top')
  })

  it('預設＝全部顯示在上方（本輪需求）', () => {
    for (const field of PREVIEW_INFO_FIELDS) {
      expect(defaultPreviewInfoPlacement[field]).toBe('top')
    }
  })
})

describe('buildPreviewInfoFields', () => {
  it('多圖顯示序號、日期取前 10 碼、附件數走翻譯', () => {
    const f = buildPreviewInfoFields(source({ index: 1, total: 3 }), t)
    expect(f.index).toBe('2/3')
    expect(f.date).toBe('2024-01-02')
    expect(f.files).toBe('附件3')
    expect(f.title).toBe('標題')
    expect(f.creator).toBe('creator42')
    expect(f.service).toBe('patreon')
    expect(f.postId).toBe('999')
    expect(f.keys).toBe('D 整帖 C 單張 V 原圖 Esc 關閉')
  })

  it('單圖不顯示序號（1/1 只是噪音）', () => {
    expect(buildPreviewInfoFields(source({ total: 1 }), t).index).toBe('')
  })

  it('僅預覽警告只在 has_full=false 時有內容', () => {
    expect(
      buildPreviewInfoFields(source({ pendingOnly: true }), t).pendingOnly
    ).toBe('⚠僅預覽')
    expect(buildPreviewInfoFields(source(), t).pendingOnly).toBe('')
  })

  it('缺資料（空字串）不產生內容', () => {
    const f = buildPreviewInfoFields(
      source({ title: '', published: '', creatorId: '', postId: '' }),
      t
    )
    expect(f.title).toBe('')
    expect(f.date).toBe('')
    expect(f.creator).toBe('')
    expect(f.postId).toBe('')
  })
})

describe('composePreviewInfo', () => {
  const fields = buildPreviewInfoFields(source({ index: 1, total: 3 }), t)

  it('預設全部在上方 → 下列為空、上列依固定順序以｜串接', () => {
    const out = composePreviewInfo(fields, defaultPreviewInfoPlacement)
    expect(out.bottom).toBe('')
    expect(out.top).toBe(
      '2/3｜2024-01-02｜標題｜附件3｜patreon｜creator42｜999｜D 整帖 C 單張 V 原圖 Esc 關閉'
    )
  })

  it('欄位可下移／隱藏，空欄不留多餘分隔線', () => {
    const placement: PreviewInfoPlacement = {
      ...defaultPreviewInfoPlacement,
      keys: 'bottom',
      files: 'none',
      index: 'none',
    }
    const out = composePreviewInfo(fields, placement)
    expect(out.top).toBe('2024-01-02｜標題｜patreon｜creator42｜999')
    expect(out.bottom).toBe('D 整帖 C 單張 V 原圖 Esc 關閉')

    const single = buildPreviewInfoFields(
      source({ total: 1, pendingOnly: false }),
      t
    )
    const withWarning = composePreviewInfo(single, defaultPreviewInfoPlacement)
    expect(withWarning.top.startsWith('｜')).toBe(false)
    expect(withWarning.top).not.toContain('｜｜')
  })

  it('位置表缺欄或髒值 → 該欄回預設位置，不從兩列消失', () => {
    const partial = { keys: 'bottom' } as unknown as PreviewInfoPlacement
    const out = composePreviewInfo(fields, partial)
    expect(out.bottom).toBe('D 整帖 C 單張 V 原圖 Esc 關閉')
    expect(out.top).toBe(
      '2/3｜2024-01-02｜標題｜附件3｜patreon｜creator42｜999'
    )

    const dirty = {
      ...defaultPreviewInfoPlacement,
      title: 'up',
      date: null,
    } as unknown as PreviewInfoPlacement
    const dirtyOut = composePreviewInfo(fields, dirty)
    expect(dirtyOut.top).toContain('標題')
    expect(dirtyOut.top).toContain('2024-01-02')
  })

  it('顯示順序固定，不隨位置表的鍵序變動', () => {
    const reversed = {} as PreviewInfoPlacement
    for (const field of [...PREVIEW_INFO_FIELDS].reverse()) {
      reversed[field] = 'top'
    }
    expect(composePreviewInfo(fields, reversed).top).toBe(
      composePreviewInfo(fields, defaultPreviewInfoPlacement).top
    )
  })

  it('全部不顯示 → 上下兩列都空（浮層只剩圖片）', () => {
    const none = {} as PreviewInfoPlacement
    for (const field of PREVIEW_INFO_FIELDS) none[field] = 'none'
    expect(composePreviewInfo(fields, none)).toEqual({ top: '', bottom: '' })
  })
})

describe('Settings 接線（set／restore 逐欄清洗）', () => {
  it('預設值就是 previewInfo 的表（同一形狀）', () => {
    expect(defaultSettings.previewInfoPlacement).toEqual(
      defaultPreviewInfoPlacement
    )
  })

  it('set 寫入缺欄／髒值會先清洗成完整表', () => {
    settings.set('previewInfoPlacement', { title: 'up' } as never)
    const stored = settings.get('previewInfoPlacement')
    expect(stored.title).toBe('top')
    expect(Object.keys(stored).sort()).toEqual([...PREVIEW_INFO_FIELDS].sort())
  })

  it('restore 把損壞存檔（null）洗回完整預設表，且不共用預設物件', async () => {
    ;(globalThis as any).chrome.storage.local.get = async () => ({
      pawchiveProSettings: { previewInfoPlacement: null },
    })
    await settings.restore()
    const stored = settings.get('previewInfoPlacement')
    expect(stored).toEqual(defaultPreviewInfoPlacement)
    expect(stored).not.toBe(defaultPreviewInfoPlacement)
    // 改動讀出的表不會污染預設
    stored.title = 'none'
    expect(defaultPreviewInfoPlacement.title).toBe('top')
  })
})
