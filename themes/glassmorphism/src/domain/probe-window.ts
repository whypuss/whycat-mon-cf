import type { ProbeTarget } from '@/types/cfsm'
import type { GlassLatencySample, GlassHistorySummary } from '@/types/glassmorphism'

/*
 * 首页延迟 / 丢包小窗口的读取工具。
 *
 * 窗口来自 `/api/servers` 的 `servers[].ping` / `servers[].loss`，
 * 服务端按时间桶输出固定 20 个点、覆盖 2 小时，每个点含全部 8 个探测目标。
 * 序列按目标分组保存，`null`（该桶无采样）与 `false`（该探测点未配置）都必须保留：
 * 柱状图是按桶逐格渲染的，过滤空洞会让后续柱子前移、时间轴错位。
 */

export type ProbeSeriesMap = Partial<Record<ProbeTarget, GlassLatencySample[]>>

/** 取某个探测目标的窗口序列；该目标没有序列时返回空数组。 */
export function probeSeriesFor(series: ProbeSeriesMap, target: ProbeTarget): GlassLatencySample[] {
  return series[target] ?? []
}

/** 窗口里出现过序列的探测目标，按传入顺序返回。 */
export function seriesTargets(
  series: ProbeSeriesMap,
  order: readonly ProbeTarget[],
): ProbeTarget[] {
  return order.filter((target) => (series[target]?.length ?? 0) > 0)
}

/**
 * 把整个窗口压成纯数值样本，供健康度这类**聚合统计**使用。
 *
 * 这里丢弃 `null` / `false` 是正确的：平均值本来就只能由真实采样构成。
 * 但它不能用来画柱状图——那需要保留时间桶。
 */
export function numericWindowSamples(series: ProbeSeriesMap): number[] {
  return Object.values(series).flatMap((points) => (
    (points ?? []).flatMap((point) => (
      typeof point.value === 'number' && Number.isFinite(point.value) && point.value >= 0
        ? [point.value]
        : []
    ))
  ))
}

export interface ProbeWindowAverage {
  /** 窗口内真实采样的平均值；没有任何真实采样时为 null。 */
  value: number | null
  /** 参与平均的真实采样数，用于在提示里说明口径。 */
  samples: number
}

/*
 * 单个探测目标在窗口内的平均值。
 *
 * 对应上游 `useNodePingStats` 的 `avgLatency` / `avgLoss`：Komari 首页卡片显示的是
 * 窗口平均，而不是最近一次采样（`useNodePingDisplay` 的 `latencyDisplay` /
 * `lossDisplay` 都取 stats 的平均值）。上游按每个任务的探测次数加权，CFSM 的
 * `/api/servers` 只返回按时间桶抽样的数值、不返回探测次数，因此落在上游没有
 * metric stats 时的同一形态——对该目标窗口内的真实采样取平均。
 *
 * `null`（该桶无采样）与 `false`（该探测点未配置）都不参与平均：平均值只能由
 * 真实采样构成，把它们当成 0 会把"没数据"说成"零延迟 / 零丢包"。
 */
export function windowAverage(series: ProbeSeriesMap, target: ProbeTarget): ProbeWindowAverage {
  let sum = 0
  let samples = 0
  for (const point of probeSeriesFor(series, target)) {
    const value = point.value
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    sum += value
    samples += 1
  }
  return { value: samples === 0 ? null : sum / samples, samples }
}

/** 深拷贝窗口序列，用于快照导出。 */
export function cloneProbeSeries(series: ProbeSeriesMap): ProbeSeriesMap {
  return Object.fromEntries(
    Object.entries(series).map(([target, points]) => [target, (points ?? []).map((point) => ({ ...point }))]),
  ) as ProbeSeriesMap
}

/** 深拷贝整段窗口摘要。 */
export function cloneHistorySummary(history: GlassHistorySummary): GlassHistorySummary {
  return {
    latencySeries: cloneProbeSeries(history.latencySeries),
    packetLossSeries: cloneProbeSeries(history.packetLossSeries),
  }
}
