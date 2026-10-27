/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：通用 DOM 控件（分區、提示卡、開關、輸入、下拉、按鈕列、說明條目） */

import { lang } from '../../Language'
import { LangTextKey } from '../../langText'
import { settings, SettingKey } from '../Settings'

/** 可折疊分區：回傳內容容器（head 點擊收合） */
export function section(
  host: HTMLDivElement,
  titleKey: LangTextKey
): HTMLDivElement {
  const sec = document.createElement('div')
  sec.className = 'pwpSC-section'
  const head = document.createElement('div')
  head.className = 'pwpSC-secHead'
  const title = document.createElement('span')
  title.dataset.xztext = titleKey
  title.textContent = lang.transl(titleKey)
  const chev = document.createElement('span')
  chev.className = 'pwpSC-chev'
  chev.textContent = '∧'
  head.append(title, chev)
  head.addEventListener('click', () => sec.classList.toggle('collapsed'))
  const body = document.createElement('div')
  body.className = 'pwpSC-secBody'
  sec.append(head, body)
  host.appendChild(sec)
  return body
}

/** 藍色提示卡 */
export function tipCard(host: HTMLDivElement, textKey: LangTextKey): void {
  const tip = document.createElement('div')
  tip.className = 'pwpSC-tip'
  tip.dataset.xztext = textKey
  tip.textContent = lang.transl(textKey)
  host.appendChild(tip)
}

/** 布林開關列（懸停半秒顯示 _d_＋鍵名的介紹） */
export function checkRow(
  host: HTMLDivElement,
  key: SettingKey,
  labelKey: LangTextKey
): void {
  const row = document.createElement('label')
  row.className = 'pwpSC-row'
  row.dataset.key = key
  row.dataset.desc = `_d_${key}`
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.dataset.skey = key
  box.checked = settings.get(key) as boolean
  box.addEventListener('change', () => {
    settings.set(key, box.checked as never)
  })
  const text = document.createElement('span')
  text.dataset.xztext = labelKey
  text.textContent = lang.transl(labelKey)
  row.append(box, text)
  host.appendChild(row)
}

/** 文字／數字／日期輸入列（懸停半秒顯示 _d_＋鍵名的介紹；onChange 在寫入後呼叫） */
export function inputRow(
  host: HTMLDivElement,
  key: SettingKey,
  labelKey: LangTextKey,
  type: string,
  onChange?: () => void,
  attrs?: { min?: string; max?: string; step?: string }
): void {
  const row = document.createElement('label')
  row.className = 'pwpSC-row pwpSC-field'
  row.dataset.key = key
  row.dataset.desc = `_d_${key}`
  const name = document.createElement('span')
  name.dataset.xztext = labelKey
  name.textContent = lang.transl(labelKey)
  const input = document.createElement('input')
  input.type = type
  input.dataset.skey = key
  if (attrs?.min !== undefined) input.min = attrs.min
  if (attrs?.max !== undefined) input.max = attrs.max
  if (attrs?.step !== undefined) input.step = attrs.step
  input.value = String(settings.get(key))
  input.addEventListener('change', () => {
    const v = type === 'number' ? Number(input.value) : input.value
    settings.set(key, v as never)
    // 回顯清洗後的值（NaN／越界會回預設或夾取）
    input.value = String(settings.get(key))
    onChange?.()
  })
  row.append(name, input)
  host.appendChild(row)
}

/** 下拉選單列（選項固定字串；labelMap 可覆寫顯示文字；懸停半秒顯示介紹；onChange 在寫入後呼叫） */
export function selectRow(
  host: HTMLDivElement,
  key: SettingKey,
  labelKey: LangTextKey,
  options: string[],
  onChange?: () => void,
  labelMap?: (v: string) => string
): void {
  const row = document.createElement('label')
  row.className = 'pwpSC-row pwpSC-field'
  row.dataset.key = key
  row.dataset.desc = `_d_${key}`
  const name = document.createElement('span')
  name.dataset.xztext = labelKey
  name.textContent = lang.transl(labelKey)
  const select = document.createElement('select')
  select.dataset.skey = key
  for (const v of options) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = labelMap ? labelMap(v) : v
    select.appendChild(opt)
  }
  select.value = String(settings.get(key))
  select.addEventListener('change', () => {
    settings.set(key, select.value as never)
    onChange?.()
  })
  row.append(name, select)
  host.appendChild(row)
}

/** 按鈕列 */
export function btnRow(
  host: HTMLDivElement,
  btns: Array<{ labelKey: LangTextKey; onClick: () => void; key?: string }>
): void {
  const row = document.createElement('div')
  row.className = 'pwpSC-row pwpSC-btnRow'
  if (btns.length === 1 && btns[0].key) row.dataset.key = btns[0].key
  for (const b of btns) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.xztext = b.labelKey
    btn.textContent = lang.transl(b.labelKey)
    btn.addEventListener('click', b.onClick)
    row.appendChild(btn)
  }
  host.appendChild(row)
}

/** 說明文字條目（帶 data-key，才能被面板搜尋找到） */
export function helpItem(body: HTMLDivElement, key: LangTextKey): void {
  const p = document.createElement('p')
  p.className = 'pwpSC-row pwpSC-helpItem'
  p.dataset.key = key
  p.dataset.xztext = key
  p.textContent = lang.transl(key)
  body.appendChild(p)
}

/** Clipboard API 不可用時的 textarea 複製方案（失敗會丟錯） */
export function copyFallback(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('copy failed')
}
