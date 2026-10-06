import { PROBE_TARGETS } from '@/constants/probes'
import type { CfsmServer, HistoryPoint, ProbeLabels, ProbeTarget, ProbeValue } from '@/types/cfsm'
import { normalizeTimestampMilliseconds } from '@/utils/format'

/**
 * 详情图表的一行：一个真实采样，或者两次采样之间的缺口标记。
 *
 * 缺口标记只占一个时间位置，`point` 为 null、没有任何数值——它不是采样，
 * 图表在这里只会画出断点。
 */
export interface ChartRow {
  timestamp: number
  point: HistoryPoint | null
}

/*
 * 上游 LoadChart 的历史视图用类目轴，并先经过 `fillMissingTimePoints`：
 * 按固定间隔铺时间点，超过 `maxGap = 2 × 间隔` 的空档留成空值行，线条因此断开。
 *
 * CFSM 的采样间隔取决于上报频率与 `long_history_points` 聚合，不能照搬上游
 * 按时段写死的 60s / 15min / 1h，否则间隔稍大的站点会被判成处处都是缺口。
 * 这里改用**实测采样间隔的中位数**，沿用上游的 2 倍阈值。
 *
 * 不补点的后果比补空值更糟：类目轴会把离线几小时压成相邻两格，
 * 折线直接跨过空档相连，看起来像这段时间有数据——那才是凭空连出来的线。
 */
const GAP_FACTOR = 2
const MAX_GAP_MARKERS = 1500

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) return null
  const lower = sorted[middle - 1]
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper
}

export function buildChartRows(points: readonly HistoryPoint[]): ChartRow[] {
  const samples = points
    .flatMap((point) => {
      const timestamp = normalizeTimestampMilliseconds(point.timestamp)
      return timestamp === null ? [] : [{ timestamp, point }]
    })
    .sort((left, right) => left.timestamp - right.timestamp)
  if (samples.length < 3) return samples

  const interval = median(samples
    .slice(1)
    .map((sample, index) => sample.timestamp - (samples[index]?.timestamp ?? sample.timestamp))
    .filter((delta) => delta > 0))
  if (interval === null) return samples

  const rows: ChartRow[] = []
  let budget = MAX_GAP_MARKERS
  samples.forEach((sample, index) => {
    const previous = samples[index - 1]
    const gap = previous ? sample.timestamp - previous.timestamp : 0
    if (previous && gap > interval * GAP_FACTOR) {
      // 预算用完也至少留一个标记：断点必须存在，只是不再按间隔铺满。
      const markers = Math.max(1, Math.min(Math.round(gap / interval) - 1, budget))
      budget = Math.max(0, budget - markers)
      for (let step = 1; step <= markers; step += 1) {
        rows.push({ timestamp: previous.timestamp + (gap * step) / (markers + 1), point: null })
      }
    }
    rows.push(sample)
  })
  return rows
}

function numeric(value: ProbeValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 延迟面板任务卡的统计值，对应上游 `PingTaskInfo` 里能由历史行算出的那部分。
 *
 * 上游的平均延迟 / 丢包率由后端 `getPingMetricStats` 按原始探测计算；CFSM 没有
 * 这个接口，这里**只用所选时段 `/api/history/all` 返回的采样**计算：
 * 延迟取数值点（`null` 超时与 `false` 未配置都不参与），丢包取丢包列数值点的
 * 算术平均。长时段的历史点本身是 CFSM 按桶聚合后的值，统计口径随之是桶值。
 * 上游的「间隔」「类型」CFSM 不提供，不出现。
 */
export interface ProbeStats {
  target: ProbeTarget
  /** latency 不为 false 的历史点数，含超时。 */
  total: number
  /** 有延迟数值的历史点数。 */
  valid: number
  avg: number | null
  min: number | null
  max: number | null
  latest: number | null
  p50: number | null
  p99: number | null
  /** P99 / P50，上游叫「波动率」。 */
  ratio: number | null
  stddev: number | null
  /** 丢包列数值点的算术平均（%）；没有丢包数值时为 null，不写成 0。 */
  loss: number | null
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1))
  return sorted[rank] ?? null
}

export function probeStats(points: readonly HistoryPoint[], target: ProbeTarget): ProbeStats {
  const ordered = [...points].sort((left, right) => left.timestamp - right.timestamp)
  const latencies = ordered.map((point) => point.latency[target])
  const values = latencies.filter(numeric)
  const losses = ordered.map((point) => point.packetLoss[target]).filter(numeric)
  const sorted = [...values].sort((left, right) => left - right)
  const avg = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const p50 = percentile(sorted, 0.5)
  const p99 = percentile(sorted, 0.99)
  return {
    target,
    total: latencies.filter((value) => value !== false).length,
    valid: values.length,
    avg,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    latest: values.at(-1) ?? null,
    p50,
    p99,
    ratio: p50 !== null && p99 !== null && p50 > 0 ? p99 / p50 : null,
    stddev: avg === null
      ? null
      : Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length),
    loss: losses.length > 0 ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null,
  }
}

export interface LabeledProbeTarget {
  target: ProbeTarget
  label: string
}

/**
 * 探测目标的显示名来自运营者配置，可能重名。ECharts 的图例按名字开关序列，
 * 重名会让两条线被一起开关，因此重名时在名字后补上目标 key 区分。
 */
export function labeledProbeTargets(
  targets: readonly ProbeTarget[],
  labels: ProbeLabels,
): LabeledProbeTarget[] {
  return targets.map((target) => {
    const label = labels[target]
    const duplicated = targets.filter((other) => labels[other] === label).length > 1
    return { target, label: duplicated ? `${label} (${target})` : label }
  })
}

/**
 * 当前快照或历史里出现过的探测目标。`false` 表示未配置，全程 `false` 的目标不出现；
 * 只有超时（`null`）的目标仍然保留，任务卡会显示为没有有效延迟。
 */
export function activeProbeTargets(
  server: CfsmServer,
  points: readonly HistoryPoint[],
): ProbeTarget[] {
  return PROBE_TARGETS.filter((target) => (
    server.latency[target] !== false
    || server.packetLoss[target] !== false
    || points.some((point) => (
      point.latency[target] !== false || point.packetLoss[target] !== false
    ))
  ))
}

/*
 * 「实时」档位的样本缓冲。
 *
 * CFSM 的 `/api/history/all` 只有 9 个固定时段，取回来就是静止的快照；页面上真正持续
 * 到达的是详情页那条 WebSocket 推送。这里把每条推送后的节点快照转成一个历史点，攒在
 * 浏览器内存里供负载图画「实时」。
 *
 * 边界写死在这里，不给调用方放宽的余地：
 * - 只收本次打开页面之后到达的样本，刷新或离开就重新开始；
 * - 按真实时间保留最近 `LIVE_WINDOW_MS`，同时限制条数，避免长时间停留后无上限增长；
 * - 时间戳用推送到达的时刻，与图表其余部分一样按毫秒升序；
 * - 延迟与丢包照抄当前值，但延迟区不使用这个缓冲（它仍然走自己的历史窗口）。
 */
export const LIVE_WINDOW_MS = 600_000
export const LIVE_MAX_POINTS = 600

/** 把一份节点快照转成历史点；字段一一对应，缺失仍是缺失，不补 0。 */
export function liveHistoryPoint(server: CfsmServer, timestamp: number): HistoryPoint {
  return {
    timestamp,
    cpu: server.cpu,
    gpus: server.gpus,
    memoryUsed: server.memoryUsed,
    memoryTotal: server.memoryTotal,
    swapUsed: server.swapUsed,
    swapTotal: server.swapTotal,
    diskUsed: server.diskUsed,
    diskTotal: server.diskTotal,
    networkInSpeed: server.networkInSpeed,
    networkOutSpeed: server.networkOutSpeed,
    networkReceived: server.networkReceived,
    networkTransmitted: server.networkTransmitted,
    processes: server.processes,
    tcpConnections: server.tcpConnections,
    udpConnections: server.udpConnections,
    load1: server.load1,
    load5: server.load5,
    load15: server.load15,
    temperature: null,
    latency: server.latency,
    packetLoss: server.packetLoss,
    ...(server.diskIo ? { diskIo: server.diskIo } : {}),
  }
}

/** 追加一个点并裁掉超出时间窗口或条数上限的旧点；返回新数组，输入不变。 */
export function appendLivePoint(
  points: readonly HistoryPoint[],
  point: HistoryPoint,
  windowMs = LIVE_WINDOW_MS,
  maxPoints = LIVE_MAX_POINTS,
): HistoryPoint[] {
  // WSS 上报间隔由 Agent / CFSM 配置决定；每条真实推送都必须进入图表，前端不降采样。
  const next = [...points, point]
  const earliest = point.timestamp - windowMs
  const withinWindow = next.filter((item) => item.timestamp >= earliest)
  return withinWindow.length > maxPoints ? withinWindow.slice(withinWindow.length - maxPoints) : withinWindow
}

/** 垫底用的历史窗口：10 分钟，与 `HISTORY_HOURS` 的第一档相同。 */
export const LIVE_SEED_HOURS = 0.167

/**
 * 用最近一段历史给实时缓冲垫底：只取还在窗口内的点，与已经收到的推送样本合并，
 * 同一时刻以推送样本为准（它更新），最后按时间升序并遵守条数上限。
 */
export function seedLivePoints(
  history: readonly HistoryPoint[],
  live: readonly HistoryPoint[],
  now: number,
  windowMs = LIVE_WINDOW_MS,
  maxPoints = LIVE_MAX_POINTS,
): HistoryPoint[] {
  const earliest = now - windowMs
  const byTimestamp = new Map<number, HistoryPoint>()
  for (const point of history) {
    if (point.timestamp >= earliest) byTimestamp.set(point.timestamp, point)
  }
  for (const point of live) {
    if (point.timestamp >= earliest) byTimestamp.set(point.timestamp, point)
  }
  const merged = [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp)
  return merged.length > maxPoints ? merged.slice(merged.length - maxPoints) : merged
}

/**
 * 「实时」档位的绘图行。
 *
 * 历史用的 `buildChartRows` 按「中位间隔 × 2」判断缺口，那套阈值在实时缓冲上会误判：
 * 垫底历史与推送样本的密度不同，稀的那一段就被整段当成断线，图上出现一条条空白。
 * 这里改用绝对阈值：只有真的断了 `gapMs`（默认一分钟）才插占位行，密度差异不算缺口。
 */
export function buildLiveChartRows(points: readonly HistoryPoint[], gapMs = 60_000): ChartRow[] {
  const samples = [...points]
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((point) => ({ timestamp: point.timestamp, point }))
  const rows: ChartRow[] = []
  samples.forEach((sample, index) => {
    const previous = samples[index - 1]
    if (previous && sample.timestamp - previous.timestamp > gapMs) {
      rows.push({ timestamp: (previous.timestamp + sample.timestamp) / 2, point: null })
    }
    rows.push(sample)
  })
  return rows
}
