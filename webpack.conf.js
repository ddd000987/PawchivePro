const path = require('path')

// production（npm run build）關掉 source-map，避免洩漏源碼與體積膨脹；
// 開發期（npm run build:dev / ts）保留 source-map 方便除錯。
// `--mode production` 時 webpack-cli 會置 NODE_ENV；argv 判斷是雙保險。
const prod =
  process.env.NODE_ENV === 'production' || process.argv.includes('production')

module.exports = {
  mode: prod ? 'production' : 'development',
  devtool: prod ? false : 'source-map',
  entry: {
    content: './src/content.ts',
    background: './src/background.ts',
    folder: './src/folder.ts',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist/js'),
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
}
