/* PawchivePro 圖示產生器：純 Node 內建模組手寫 PNG，繪製藍底圓角方形 + 白色肉球。
 * 用法：npm run make-icons
 * 輸出：src/icons/icon16.png、icon32.png、icon48.png、icon128.png
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SS = 4 // 4x4 超取樣
const SIZES = [16, 32, 48, 128]
const BG = [0x0a, 0x84, 0xff]

// 單位座標 (0..1) 的肉球橢圓：cx, cy, rx, ry, 旋轉角(度)
const SHAPES = [
  [0.5, 0.65, 0.2, 0.16, 0],
  [0.22, 0.48, 0.075, 0.105, -22],
  [0.395, 0.31, 0.08, 0.108, -7],
  [0.605, 0.31, 0.08, 0.108, 7],
  [0.78, 0.48, 0.075, 0.105, 22],
]

const CORNER = 0.22

function inRoundedSquare(x, y) {
  const r = CORNER
  const dx = Math.max(r - x, x - (1 - r), 0)
  const dy = Math.max(r - y, y - (1 - r), 0)
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 && dx * dx + dy * dy <= r * r
}

function inPaw(x, y) {
  for (const [cx, cy, rx, ry, deg] of SHAPES) {
    const a = (deg * Math.PI) / 180
    const px = x - cx
    const py = y - cy
    const u = px * Math.cos(a) + py * Math.sin(a)
    const v = -px * Math.sin(a) + py * Math.cos(a)
    if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) return true
  }
  return false
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const n = SS * SS
  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1)
    raw[rowStart] = 0 // filter: none
    for (let px = 0; px < size; px++) {
      let bgCount = 0
      let pawCount = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          if (inRoundedSquare(x, y)) {
            bgCount++
            if (inPaw(x, y)) pawCount++
          }
        }
      }
      const o = rowStart + 1 + px * 4
      if (bgCount === 0) continue // 全透明
      // 在覆蓋範圍內：白色佔 pawCount、藍色佔其餘
      const blueCount = bgCount - pawCount
      const r = (BG[0] * blueCount + 255 * pawCount) / bgCount
      const g = (BG[1] * blueCount + 255 * pawCount) / bgCount
      const b = (BG[2] * blueCount + 255 * pawCount) / bgCount
      raw[o] = Math.round(r)
      raw[o + 1] = Math.round(g)
      raw[o + 2] = Math.round(b)
      raw[o + 3] = Math.round((255 * bgCount) / n)
    }
  }
  return raw
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++)
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = path.resolve(__dirname, '..', 'src', 'icons')
fs.mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`)
  fs.writeFileSync(file, encodePng(size))
  console.log(`wrote ${path.relative(path.resolve(__dirname, '..'), file)}`)
}
