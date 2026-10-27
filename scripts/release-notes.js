/* PawchivePro 發佈說明：上面是英文區，下面是繁體中文區。
 * 各區內容取自 CHANGELOG.md／CHANGELOG.zh-TW.md 裡該版本的段落，再附上安裝與更新說明。
 * 用法：node scripts/release-notes.js v1.0.1 > release-notes.md（CI 發佈時呼叫）。
 * 任一份 CHANGELOG 找不到該版本的段落就以錯誤結束，避免發出沒有更新內容的版本。
 */
const fs = require('fs')
const path = require('path')

const tag = process.argv[2]
if (!tag) {
  console.error('usage: node scripts/release-notes.js <tag>')
  process.exit(1)
}
const version = tag.replace(/^v/, '')
const zip = `pawchive-pro-${tag}.zip`

/** 取出指定版本的段落（不含版本標題），### 標題降成 ##，讓它和安裝說明同級 */
function versionSection(file) {
  const text = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start === -1) {
    console.error(`${file} has no section for ${version}`)
    process.exit(1)
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
  if (end === -1) end = lines.length
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
    .replace(/^### /gm, '## ')
}

const english = `# English

${versionSection('CHANGELOG.md')}

## Install

1. Download \`${zip}\` below and unzip it to a folder you will keep (not Downloads or the desktop).
2. Open \`chrome://extensions\` (or \`edge://extensions\`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder that contains \`manifest.json\`.

## Updating

Unzip the new version over the old folder, then click reload on the extension card. Settings and download history are kept.`

const chinese = `# 繁體中文

${versionSection('CHANGELOG.zh-TW.md')}

## 安裝

1. 下載下方的 \`${zip}\`，解壓縮到會長期保留的資料夾（不要放在「下載」或桌面）。
2. 打開 \`chrome://extensions\`（或 \`edge://extensions\`），開啟「開發人員模式」。
3. 按「載入未封裝項目」，選擇解壓縮後含有 \`manifest.json\` 的資料夾。

## 更新

把新版解壓縮覆蓋原本的資料夾，再到擴充功能頁按卡片上的重新載入。設定和下載記錄都會保留。`

process.stdout.write(`${english}\n\n---\n\n${chinese}\n`)
