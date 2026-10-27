/* PawchivePro 打包輔助：把 webpack 管線外的靜態檔案複製到 dist/。
 * 用法：npm run pack（npm run build 已包含）。
 * 複製：src/manifest.json、src/declarative_net_request_rules.json、src/folder.html、src/lib/、src/icons/、src/_locales/
 * 複製後 dist/ 可直接用「載入未封裝項目」載入 Chrome。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log(
    `copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`
  )
}

copyFile(
  path.join(root, 'src', 'manifest.json'),
  path.join(dist, 'manifest.json')
)
copyFile(
  path.join(root, 'src', 'declarative_net_request_rules.json'),
  path.join(dist, 'declarative_net_request_rules.json')
)

// 資料夾授權頁（腳本由 webpack 打成 dist/js/folder.js）
copyFile(path.join(root, 'src', 'folder.html'), path.join(dist, 'folder.html'))

function copyDir(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else copyFile(from, to)
  }
}

for (const dir of ['lib', 'icons', '_locales']) {
  copyDir(path.join(root, 'src', dir), path.join(dist, dir))
}

// production 構建不再輸出 source-map，刪掉舊 dev 構建殘留的 .map（洩漏源碼）
const jsDir = path.join(dist, 'js')
if (fs.existsSync(jsDir)) {
  for (const name of fs.readdirSync(jsDir)) {
    if (name.endsWith('.map')) {
      fs.unlinkSync(path.join(jsDir, name))
      console.log(`removed stale dist/js/${name}`)
    }
  }
}
