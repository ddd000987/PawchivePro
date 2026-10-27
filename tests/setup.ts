import { beforeEach, vi } from 'vitest'

// node 環境沒有瀏覽器全域物件，先 stub（模組求值期就會碰到 window）
// 注意：src/EVT.ts 的內部事件走模組私有的 EventTarget，不經過這個 window stub；
// 這裡的 window 監聽只服務原生事件（keydown 等）。測試要派發／觀察內部事件請用 EVT.fire／EVT.on。
type Listener = (...args: any[]) => void
const listeners = new Map<string, Listener[]>()

;(globalThis as any).window = {
  addEventListener: (type: string, fn: Listener) => {
    const list = listeners.get(type) ?? []
    list.push(fn)
    listeners.set(type, list)
  },
  dispatchEvent: (ev: { type: string }) => {
    for (const fn of listeners.get(ev.type) ?? []) {
      fn(ev)
    }
    return true
  },
  setTimeout: (fn: (...args: any[]) => void, ms?: number, ...args: any[]) =>
    setTimeout(fn, ms, ...args),
  clearTimeout: (id: any) => clearTimeout(id),
  location: { href: 'https://kemono.su/patreon/user/1' },
}

;(globalThis as any).document = {
  title: 'test',
  documentElement: { lang: 'en' },
  createElement: () => {
    throw new Error('document.createElement not stubbed in tests')
  },
}

// 部分模組用 location.pathname 做預設參數
;(globalThis as any).location = { pathname: '/', host: 'kemono.su' }

// 介面語言「自動」跟瀏覽器語言；Node 的 navigator 會帶本機語系，固定成英文讓測試結果不隨機器變
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en-US', languages: ['en-US'] },
  configurable: true,
  writable: true,
})

;(globalThis as any).chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  runtime: { sendMessage: async () => {} },
}

beforeEach(() => {
  listeners.clear()
  vi.restoreAllMocks()
})
