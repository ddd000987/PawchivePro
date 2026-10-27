/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: PixivBatchDownloader src/ts/download/ExportResult2CSV.ts
 *          concept (xuejianxianzun)
 * changes: columns rewritten for Kemono resultMeta; downloaded via
 *          anchor (no background round-trip needed for a local blob).
 */

import { EVT } from '../EVT'
import { lang } from '../Language'
import { log } from '../Log'
import { store } from '../store/Store'
import { downloadStates } from './DownloadStates'

function csvCell(value: string | number | boolean): string {
  const s = String(value)
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

class ExportResult2CSV {
  constructor() {
    EVT.on(EVT.list.exportCSV, () => {
      this.export()
    })
  }

  private export() {
    if (store.resultMeta.length === 0) {
      log.warning(lang.transl('_noExportResults'))
      return
    }
    const header = [
      'service',
      'creator',
      'creatorId',
      'postId',
      'title',
      'published',
      'fileCount',
      'pending',
      'postKey',
      // 該帖附件的下載狀態（done/partial/pending），供對帳用；
      // 被過濾掉的帖從不入庫，不會出現在此表
      'status',
    ]
    const lines = [header.join(',')]
    for (const r of store.resultMeta) {
      lines.push(
        [
          csvCell(r.service),
          csvCell(r.creator),
          csvCell(r.creatorId),
          csvCell(r.postId),
          csvCell(r.title),
          csvCell(r.published),
          csvCell(r.fileCount),
          csvCell(r.pending),
          csvCell(r.postKey),
          csvCell(this.postStatus(r.postKey)),
        ].join(',')
      )
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pawchive-result-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
    log.success(
      lang.transl('_exportedResults', String(store.resultMeta.length))
    )
  }

  /** 一帖的下載狀態：附件全完成 done、部分完成 partial、否則 pending */
  private postStatus(postKey: string): string {
    let total = 0
    let done = 0
    for (let i = 0; i < store.result.length; i++) {
      if (store.result[i].postKey !== postKey) {
        continue
      }
      total++
      if (downloadStates.states[i] === 1) {
        done++
      }
    }
    if (total === 0 || done === 0) {
      return 'pending'
    }
    return done === total ? 'done' : 'partial'
  }
}

new ExportResult2CSV()
