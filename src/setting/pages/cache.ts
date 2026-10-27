/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：抓取頁下方的抓取快取區塊（自動掛載開關、快取列表、掛載／重新命名／刪除） */

import { crawlCache } from '../../download/CrawlCache'
import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { states } from '../../store/States'
import { toast } from '../../Toast'
import { checkRow, section, tipCard } from './controls'
import type { CenterContext } from './context'

export class CacheView {
  private cacheList!: HTMLDivElement

  constructor(private readonly ctx: CenterContext) {}

  public build(host: HTMLDivElement): void {
    const body = section(host, '_secCache')
    tipCard(body, '_cacheTip')
    checkRow(body, 'autoMountCache', '_f_autoMountCache')
    this.cacheList = document.createElement('div')
    body.appendChild(this.cacheList)
    this.render()
  }

  /** 重繪快取列表（快取異動／切換語言時呼叫） */
  public render(): void {
    if (!this.cacheList) {
      return
    }
    this.cacheList.innerHTML = ''
    const entries = crawlCache.list()
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'pwpSC-row pwpSC-status'
      empty.dataset.xztext = '_cacheEmpty'
      empty.textContent = lang.transl('_cacheEmpty')
      this.cacheList.appendChild(empty)
      this.ctx.reapplySearch()
      return
    }
    // 下載中（含暫停）／抓取中不能換掛載目標
    const locked = states.busy || states.hasDownloadTask
    for (const e of entries) {
      const mountedHere = crawlCache.isMounted(e.id)
      const card = document.createElement('div')
      card.className =
        'pwpSC-row pwpSC-cacheCard' + (mountedHere ? ' mounted' : '')
      const head = document.createElement('div')
      head.className = 'pwpSC-cacheTitle'
      head.textContent = e.title
      const meta = document.createElement('div')
      meta.className = 'pwpSC-row pwpSC-status'
      meta.textContent = lang.transl(
        '_cacheMeta',
        `${e.service}@${e.host}`,
        String(e.postCount),
        String(e.fileCount),
        new Date(e.createdAt).toLocaleString()
      )
      const row = document.createElement('div')
      row.className = 'pwpSC-row pwpSC-btnRow'
      const mkBtn = (
        labelKey: LangTextKey,
        onClick: () => void
      ): HTMLButtonElement => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.dataset.xztext = labelKey
        btn.textContent = lang.transl(labelKey)
        btn.addEventListener('click', onClick)
        return btn
      }
      const mountBtn = mkBtn(
        mountedHere ? '_mountedLabel' : '_mount',
        () => void crawlCache.mount(e.id)
      )
      if (mountedHere) {
        mountBtn.disabled = true
      } else if (locked) {
        mountBtn.disabled = true
        mountBtn.title = lang.transl('_mountBusy')
      }
      const delBtn = mkBtn('_cacheDelete', () => {
        if (!window.confirm(lang.transl('_cacheDeleteConfirm', e.title))) {
          return
        }
        void crawlCache.remove(e.id)
      })
      // 掛載中的快取在下載任務期間不能刪
      if (mountedHere && locked) {
        delBtn.disabled = true
        delBtn.title = lang.transl('_cacheDeleteMountedBusy')
      }
      row.append(
        mountBtn,
        mkBtn('_cacheRename', () => this.promptRenameCache(e.id, e.title)),
        delBtn
      )
      card.append(head, meta, row)
      this.cacheList.appendChild(card)
    }
    this.ctx.reapplySearch()
  }

  private promptRenameCache(id: string, oldTitle: string): void {
    const name = window.prompt(lang.transl('_cacheRenamePrompt'), oldTitle)
    if (name === null) {
      return
    }
    if (!name.trim()) {
      toast.error(lang.transl('_cacheRenameEmpty'))
      return
    }
    void crawlCache.rename(id, name)
  }
}
