/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader AutoExportSettings concept
 *          (xuejianxianzun)
 * changes: minimal version — export all keys as JSON via anchor
 *          download; import validates keys against defaults before
 *          applying. No version-migration logic (single settings shape).
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'
import { toast } from '../Toast'
import { defaultSettings, migrateLegacySettings, settings } from './Settings'

class AutoExportSettings {
  constructor() {
    this.bindEvents()
  }

  private bindEvents() {
    EVT.on(EVT.list.exportSettings, () => {
      const data: Record<string, unknown> = {}
      for (const key of Object.keys(defaultSettings)) {
        data[key] = settings.get(key as keyof typeof defaultSettings)
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pawchive-settings-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 3000)
      toast.show(lang.transl('_settingsExported'))
    })

    EVT.on(EVT.list.importSettings, () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result as string) as unknown
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              Array.isArray(parsed)
            ) {
              throw new Error('not an object')
            }
            // 舊版匯出檔：合併跳過選項、忽略已移除的鍵
            const data = migrateLegacySettings(
              parsed as Record<string, unknown>
            )
            let n = 0
            for (const key of Object.keys(defaultSettings) as Array<
              keyof typeof defaultSettings
            >) {
              // 已知鍵直接交給 settings.set（內部統一清洗，非法值回預設）
              if (data[key] !== undefined) {
                settings.set(key, data[key] as never)
                n++
              }
            }
            if (n === 0) {
              throw new Error('no known keys')
            }
            toast.show(lang.transl('_settingsImported'))
            log.success(lang.transl('_settingsImported'))
          } catch {
            toast.error(lang.transl('_settingsImportFailed'))
          }
        }
        reader.readAsText(file)
      })
      input.click()
    })
  }
}

new AutoExportSettings()
