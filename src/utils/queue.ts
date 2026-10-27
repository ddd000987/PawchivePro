/*
 * license: GPL-3.0-or-later; http://www.gnu.org/licenses/gpl-3.0.txt
 * derived from: Kemono-Downloader src/utils/helpers/js-utils.ts (Queue class)
 * changes: removed vue/mitt/hooks imports (only Queue ported);
 *          config semantics kept: max/sleep/preserve + enqueue(func, signal?).
 */

/** 佇列任務 */
interface Task {
  func: (signal?: AbortSignal) => unknown
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  status: 'queue' | 'ongoing' | 'resolved' | 'rejected' | 'aborted'
  executed: boolean
  signal?: AbortSignal
}

interface QueueConfig {
  /** 最大同時執行任務數量 @default 3 */
  max: number
  /**
   * 相鄰任務啟動間隔（毫秒） @default 500
   * 新間隔從下一個排程的任務起生效（已排定的任務不重算）
   */
  sleep: number
  /** 任務結束後是否保留 @default false */
  preserve: boolean
}

/** 併發上限 + 相鄰啟動間隔 + AbortSignal 的任務佇列（全域 Queue(3, 500ms)） */
class Queue {
  private tasks: Task[] = []
  private ongoing = 0
  private nextStartAt = 0
  private config: QueueConfig

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      max: config?.max ?? 3,
      sleep: config?.sleep ?? 500,
      preserve: config?.preserve ?? false,
    }
  }

  /** 更新設定；sleep 的新值從下一個排程的任務起生效 */
  public updateConfig(newConfig: Partial<QueueConfig>): QueueConfig {
    Object.assign(this.config, newConfig)
    if (newConfig.max !== undefined) this.checkTask()
    return { ...this.config }
  }

  public getConfig(): QueueConfig {
    return { ...this.config }
  }

  public enqueue<R>(
    func: (signal?: AbortSignal) => R,
    signal?: AbortSignal
  ): Promise<Awaited<R>> {
    // 進場時信號就已中止：abort 事件不會再觸發，直接拒絕且不入佇列
    if (signal?.aborted) {
      return Promise.reject('aborted')
    }
    const { promise, reject, resolve } = Promise.withResolvers<Awaited<R>>()
    const task: Task = {
      func,
      reject,
      // 佇列內統一存成 unknown；func 的回傳值就是 R，型別在 enqueue 的回傳 promise 上
      resolve: resolve as (value: unknown) => void,
      status: 'queue',
      executed: false,
      signal,
    }
    this.tasks.push(task)

    promise
      .then(() => {
        task.status = 'resolved'
      })
      .catch(() => {
        if (task.status !== 'aborted') task.status = 'rejected'
      })
      .finally(() => {
        if (task.executed) this.ongoing--
        if (!this.config.preserve) {
          const index = this.tasks.indexOf(task)
          if (index >= 0) this.tasks.splice(index, 1)
        }
        this.checkTask()
      })

    signal?.addEventListener('abort', () => {
      // 不論還在 queue 或已開始執行，都標記為 aborted 並 reject；
      // 尚未啟動的 setTimeout 回呼會檢查狀態後直接跳過
      task.status = 'aborted'
      task.reject('aborted')
    })

    this.checkTask()
    return promise
  }

  private checkTask() {
    while (this.ongoing < this.config.max) {
      const task = this.tasks.find((t) => t.status === 'queue')
      if (!task) break
      this.run(task)
    }
  }

  private run(task: Task) {
    this.ongoing++
    task.executed = true
    task.status = 'ongoing'
    // 相鄰任務啟動間隔：第一個任務立即執行，之後每個至少相隔 sleep ms
    const now = Date.now()
    const startAt = Math.max(now, this.nextStartAt)
    this.nextStartAt = startAt + this.config.sleep
    setTimeout(async () => {
      // 等待期間被 abort 或 clear：promise 已 reject，不再執行 func
      if (task.status === 'aborted') return
      try {
        const val = await Promise.resolve(task.func(task.signal))
        task.resolve(val)
      } catch (err) {
        task.reject(err)
      }
    }, startAt - now)
  }

  public getStatus() {
    return {
      pending: this.tasks.length,
      ongoing: this.ongoing,
      maxConcurrent: this.config.max,
      sleepBetweenTasks: this.config.sleep,
    }
  }

  public clear() {
    // 尚未結束的任務全部標記 aborted 並 reject；
    // 不清掉 executed 標記，讓 finally 照常把 ongoing 減回 0
    for (const task of this.tasks) {
      if (task.status === 'resolved' || task.status === 'rejected') continue
      task.status = 'aborted'
      task.reject(new Error('Queue cleared'))
    }
    this.tasks = []
    this.nextStartAt = 0
  }
}

export { Queue }
export type { QueueConfig }
