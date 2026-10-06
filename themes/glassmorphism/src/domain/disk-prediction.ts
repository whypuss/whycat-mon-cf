import type { HistoryPoint } from '@/types/cfsm'

/*
 * 移植自 Komari `services/prediction.service.ts`：对历史采样里的磁盘已用量做最小二乘
 * 线性回归，得到每天增长量与「还要多久写满」。上游的两条硬门槛原样保留——至少两个
 * 样本，且样本跨度不少于 `LOAD_CONFIG.diskPrediction.minSampleDays`（2 天）。
 *
 * 与上游的唯一差别是数据来源：CFSM 没有独立的 load records 接口，这里直接复用详情页
 * `/api/history/all` 已经取回的采样点，不为预测追加任何请求。因此预测能否成立取决于
 * 当前选中的时间范围：只有 48 小时以上的范围才可能跨满两天，1 天及以下一律是
 * `insufficient_duration`，页面照上游显示「趋势积累中」而不是编一个数字。
 *
 * 已用与总量同为 MiB，同单位相除，预测天数与单位无关。
 */
export const DISK_PREDICTION_MIN_SAMPLE_DAYS = 2

const DAY_MS = 86_400_000

export interface DiskPrediction {
  /** 预计写满还需要的天数；已经写满时为 0。 */
  daysUntilFull: number
  /** 回归斜率，单位与 `HistoryPoint.diskUsed` 一致（MiB/天）。 */
  dailyGrowth: number
  currentDisk: number
  diskTotal: number
  sampleDays: number
  /** 拟合优度 R²，落在 0–1 之间。 */
  confidence: number
}

export type DiskPredictionReason =
  | 'no_samples'
  | 'insufficient_samples'
  | 'insufficient_duration'
  | 'no_growth'
  | 'invalid_total'

export interface DiskPredictionState {
  prediction: DiskPrediction | null
  reason?: DiskPredictionReason
  sampleDays: number
  sampleCount: number
}

interface DiskSample {
  timestamp: number
  used: number
  total: number
}

/**
 * 只收「已用与总量都是正数」的采样点，与上游 `analyzeDiskPrediction` 的过滤一致。
 * 缺失值直接跳过，绝不当作 0 参与回归。
 */
function diskSamples(
  points: readonly HistoryPoint[],
  fallbackDiskTotal: number | null,
): DiskSample[] {
  const samples: DiskSample[] = []
  for (const point of points) {
    const used = point.diskUsed
    const total = point.diskTotal === null ? fallbackDiskTotal : point.diskTotal
    if (used === null || total === null) continue
    if (!Number.isFinite(point.timestamp) || used <= 0 || total <= 0) continue
    samples.push({ timestamp: point.timestamp, used, total })
  }
  return samples.sort((left, right) => left.timestamp - right.timestamp)
}

export interface DiskPredictionSummary {
  text: string
  /** 预计天数已经落进预警阈值，对应设置项 `diskPredictionThresholdDays`。 */
  warning: boolean
}

/*
 * 文案逐条对应上游 `LoadChart.vue` 的 `diskPredictionSummary`：有预测时是「预计已满」
 * 或「预计 N 天后满」；没有预测时按原因给出「暂无趋势」「样本不足」「趋势积累中」，
 * 其余原因（未增长、总量无效）与上游一样留空，不占位。
 *
 * 阈值的用法：上游把 `diskPredictionThresholdDays` 用在健康面板的磁盘风险榜上，
 * 而 CFSM 首页没有逐节点历史，复刻那张榜单需要为每台节点各发一次 history 请求。
 * 因此这里按该设置项自己的说明——「预计剩余天数小于等于该值时…在详情负载图中显示
 * 提示」——把它用在详情负载图的这行副标题上。
 */
export function diskPredictionSummary(
  state: DiskPredictionState,
  thresholdDays: number,
): DiskPredictionSummary {
  const prediction = state.prediction
  if (prediction !== null) {
    const days = Math.max(0, Math.ceil(prediction.daysUntilFull))
    return {
      text: days <= 0 ? '预计已满' : `预计 ${days} 天后满`,
      warning: days <= thresholdDays,
    }
  }
  if (state.reason === 'no_samples') return { text: '暂无趋势', warning: false }
  if (state.reason === 'insufficient_samples') return { text: '样本不足', warning: false }
  if (state.reason === 'insufficient_duration') return { text: '趋势积累中', warning: false }
  return { text: '', warning: false }
}

export function analyzeDiskPrediction(
  points: readonly HistoryPoint[],
  fallbackDiskTotal: number | null = null,
): DiskPredictionState {
  const samples = diskSamples(points, fallbackDiskTotal)
  const first = samples[0]
  const latest = samples[samples.length - 1]
  if (first === undefined || latest === undefined) {
    return { prediction: null, reason: 'no_samples', sampleDays: 0, sampleCount: 0 }
  }

  const sampleDays = (latest.timestamp - first.timestamp) / DAY_MS
  const base = { sampleDays, sampleCount: samples.length }

  if (samples.length < 2) return { ...base, prediction: null, reason: 'insufficient_samples' }
  if (sampleDays < DISK_PREDICTION_MIN_SAMPLE_DAYS) {
    return { ...base, prediction: null, reason: 'insufficient_duration' }
  }

  const xs = samples.map((sample) => (sample.timestamp - first.timestamp) / DAY_MS)
  const ys = samples.map((sample) => sample.used)
  const averageX = xs.reduce((total, value) => total + value, 0) / xs.length
  const averageY = ys.reduce((total, value) => total + value, 0) / ys.length

  let numerator = 0
  let denominator = 0
  let totalVariance = 0
  for (let index = 0; index < samples.length; index += 1) {
    const x = xs[index]
    const y = ys[index]
    if (x === undefined || y === undefined) continue
    numerator += (x - averageX) * (y - averageY)
    denominator += (x - averageX) ** 2
    totalVariance += (y - averageY) ** 2
  }

  if (denominator <= 0) return { ...base, prediction: null, reason: 'insufficient_duration' }

  const dailyGrowth = numerator / denominator
  if (!Number.isFinite(dailyGrowth) || dailyGrowth <= 0) {
    return { ...base, prediction: null, reason: 'no_growth' }
  }

  const diskTotal = latest.total
  if (!Number.isFinite(diskTotal) || diskTotal <= 0) {
    return { ...base, prediction: null, reason: 'invalid_total' }
  }

  const currentDisk = latest.used
  const remaining = diskTotal - currentDisk
  if (remaining <= 0) {
    return {
      ...base,
      prediction: {
        daysUntilFull: 0,
        dailyGrowth,
        currentDisk,
        diskTotal,
        sampleDays,
        confidence: 1,
      },
    }
  }

  let residualVariance = 0
  for (let index = 0; index < samples.length; index += 1) {
    const x = xs[index]
    const y = ys[index]
    if (x === undefined || y === undefined) continue
    residualVariance += (y - (averageY + dailyGrowth * (x - averageX))) ** 2
  }

  return {
    ...base,
    prediction: {
      daysUntilFull: remaining / dailyGrowth,
      dailyGrowth,
      currentDisk,
      diskTotal,
      sampleDays,
      confidence: totalVariance <= 0
        ? 0
        : Math.min(Math.max(1 - residualVariance / totalVariance, 0), 1),
    },
  }
}
