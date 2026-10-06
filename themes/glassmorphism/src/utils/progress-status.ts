/*
 * 节点卡与列表视图的进度条状态，逐条对照 Komari：
 * - `utils/helper.ts` 的 `getStatus`：CPU / 内存 / 硬盘，<60 success，<80 warning，其余 error；
 * - `components/NodeCard.vue` 的 `trafficStatus` 与 `trafficPercentageClass`：流量另有一套阈值。
 *
 * 此前本主题用主题设置里的「高负载阈值」给进度条上色（阈值 × 0.8 起算警告），
 * 那是首页「高负载」筛选的参数，上游的进度条并不受它影响。
 */

export type ProgressStatus = 'success' | 'warning' | 'error' | 'info'

export function usageStatus(percentage: number | null): ProgressStatus {
  if (percentage === null || percentage < 60) return 'success'
  if (percentage < 80) return 'warning'
  return 'error'
}

/** 没有流量配额时 `percentage` 为 null，上游此时同样是 success。 */
export function trafficStatus(percentage: number | null): ProgressStatus {
  if (percentage === null) return 'success'
  if (percentage >= 95) return 'error'
  if (percentage >= 80) return 'warning'
  if (percentage >= 60) return 'info'
  return 'success'
}

export type TrafficTextTone = 'muted' | 'success' | 'warning' | 'danger'

/** 流量百分比文字：没有配额 muted，≥95 destructive，≥60 warning，其余 success。 */
export function trafficTextTone(percentage: number | null): TrafficTextTone {
  if (percentage === null) return 'muted'
  if (percentage >= 95) return 'danger'
  if (percentage >= 60) return 'warning'
  return 'success'
}
