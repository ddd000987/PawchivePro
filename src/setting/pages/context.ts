/* license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt */
/* 設定中心：分頁模組需要從外殼取用的能力（避免分頁反向依賴 SettingsCenter） */

export interface CenterContext {
  /** 刷新命名規則預覽（輸入／下拉控件變更後呼叫） */
  refreshNamingPreview(): void
  /** 重建內容後，若正在搜尋就重新套用過濾 */
  reapplySearch(): void
}
