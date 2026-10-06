import type { IconName } from '@/constants/icons'
import {
  convertAmount,
  describeSkipped,
  describeSources,
  EMPTY_RATE_VIEW,
  formatFinanceAmount,
  monthlyCost as monthlyCostOf,
  parseBillingPrice,
  remainingValueOf,
  resolveSourceCurrency,
  SKIP_REASONS,
  skipReasonLabel,
  summarizeFinance,
  type BillableNode,
  type Conversion,
  type DisplayCurrency,
  type FinanceSummary,
  type FinanceTotal,
  type RateSource,
  type RateView,
} from '@/domain/finance'
import { summarizeResource } from '@/domain/dashboard'
import { parseSettingKeys, type ThemeSettings } from '@/theme/settings'
import type { CfsmServer } from '@/types/cfsm'
import type { GlassServer } from '@/types/glassmorphism'
import {
  detailExpireStatus,
  formatCount,
  formatCurrencyValue,
  formatDetailExpireText,
  formatDetailUptime,
  formatDisplayBytes,
  formatDisplayBytesSplit,
  formatDisplayMebibytes,
  formatDisplayMebibytesSplit,
  formatDisplayPrice,
  formatDisplaySpeed,
  formatDisplaySpeedSplit,
  formatLoad,
  formatPercent,
  formatPrice,
  MISSING_TEXT,
  parseCfsmDate,
  type SplitAmount,
} from '@/utils/format'

/*
 * 总览卡片的 key 与顺序取自 Komari `stores/app.ts` 的 `ALL_GENERAL_CARD_KEYS`。
 * 剩余价值、月费用与年费用按财务显示币种换算（`domain/finance.ts`）；峰值节点与流量配额
 * 由 CFSM 的实时网速、连接数、GPU 利用率、流量上限与月度流量真实计算。
 * 只有 `virtualizationDistribution` 不出现：CFSM 不提供虚拟化类型，不用估算值补位。
 */
export type GeneralCardKey =
  | 'currentTime' | 'memory' | 'disk' | 'remainingValue' | 'monthlyCost'
  | 'totalTraffic' | 'uploadSpeed' | 'downloadSpeed'
  | 'onlineNodes' | 'offlineNodes' | 'avgCpu' | 'avgGpu' | 'avgLoad'
  | 'swap' | 'processes' | 'connections' | 'cpuCores' | 'gpuNodes'
  | 'gpuPeakNode' | 'trafficQuota' | 'trafficPeak' | 'uploadPeakNode' | 'downloadPeakNode'
  | 'highLoadNodes' | 'expiringNodes' | 'trafficWarnings' | 'connectionPeakNode'
  | 'regionDistribution' | 'systemDistribution' | 'yearlyCost'

export type QuickControlKey = 'favorite' | 'totalTraffic' | 'upload' | 'download' | 'peak' | 'offline' | 'highLoad' | 'expiring'
/*
 * 详情指标卡的 key 与顺序取自 Komari `stores/app.ts` 的 `ALL_DETAIL_METRIC_CARD_KEYS`。
 * 唯一删去的是 `temperature`：CFSM 的公开接口里没有温度——`/api/server` 不返回，
 * 历史列集合 `HISTORY_ALL_QUERY_COLUMNS` 里也没有这一列（实读服务端 `1dc0dc4`）。
 * 因此不制造一张永远显示 `-` 的卡片。
 */
export type DetailCardKey =
  | 'nodePrice' | 'monthlyCost' | 'remainingTime' | 'remainingValue'
  | 'cpuUsage' | 'gpuUsage' | 'memoryUsage' | 'swapUsage' | 'diskUsage'
  | 'load' | 'processes' | 'connections' | 'uptime'
  | 'uploadSpeed' | 'downloadSpeed' | 'totalTraffic' | 'trafficQuota'
/*
 * 图表卡片 key 对应 Komari `ChartDashboardCardKey`。上游的 `gpuMemory` / `temperature`
 * 需要 CFSM 历史里没有的显存与温度列，不收；`diskIo` 是本主题独有的磁盘 IO 卡。
 */
export type ChartFamily =
  | 'cpu' | 'memory' | 'disk' | 'network' | 'traffic' | 'gpu'
  | 'connections' | 'process' | 'diskIo' | 'ping' | 'pingLoss'

/** Komari `ALL_GENERAL_CARD_KEYS` 的顺序，只去掉 CFSM 没有数据的虚拟化分布。 */
const ALL_GENERAL_CARD_KEYS: readonly GeneralCardKey[] = [
  'currentTime', 'memory', 'disk', 'remainingValue', 'monthlyCost',
  'totalTraffic', 'uploadSpeed', 'downloadSpeed',
  'onlineNodes', 'offlineNodes', 'avgCpu', 'avgGpu', 'avgLoad', 'swap',
  'processes', 'connections', 'cpuCores', 'gpuNodes', 'gpuPeakNode', 'trafficQuota', 'trafficPeak',
  'uploadPeakNode', 'downloadPeakNode', 'highLoadNodes', 'expiringNodes', 'trafficWarnings', 'connectionPeakNode',
  'regionDistribution', 'systemDistribution', 'yearlyCost',
]

/*
 * 逐项对应 Komari `GENERAL_CARD_PRESETS`（official / basic / ops / resource /
 * finance / traffic / gpu / asset / full / custom），保持同一顺序与张数；
 * 唯一删去的是「资产」里的虚拟化分布（CFSM 没有这项数据），因此「资产」是 5 张。
 */
const GENERAL_PRESETS: Record<ThemeSettings['generalCardPreset'], readonly GeneralCardKey[]> = {
  官方: ['currentTime', 'onlineNodes', 'regionDistribution', 'totalTraffic', 'uploadSpeed', 'downloadSpeed'],
  基础: ['memory', 'disk', 'remainingValue', 'totalTraffic', 'uploadSpeed', 'downloadSpeed'],
  运维: ['onlineNodes', 'offlineNodes', 'highLoadNodes', 'trafficWarnings', 'avgCpu', 'avgLoad'],
  资源: ['avgCpu', 'avgLoad', 'memory', 'disk', 'swap', 'cpuCores'],
  财务: ['remainingValue', 'monthlyCost', 'yearlyCost', 'expiringNodes', 'totalTraffic', 'trafficQuota'],
  流量: ['totalTraffic', 'trafficQuota', 'uploadSpeed', 'downloadSpeed', 'trafficPeak', 'trafficWarnings'],
  GPU: ['gpuNodes', 'avgGpu', 'gpuPeakNode', 'avgCpu', 'memory', 'trafficPeak'],
  资产: ['onlineNodes', 'regionDistribution', 'systemDistribution', 'cpuCores', 'gpuNodes'],
  完整: ALL_GENERAL_CARD_KEYS,
  自定义: [],
}

/*
 * 快捷控制预设对应 Komari `HOME_QUICK_CONTROL_PRESETS`，去掉 `monthlyCost`：
 * 上游预设里虽然列着它，但 `HomeView` 渲染前用
 * `homeQuickControlOrder.filter(key => key !== 'monthlyCost')` 把它过滤掉了，
 * 运行时从不出现。上游的「完整」因此实际显示 6 项，这里也是 6 项。
 */
const QUICK_PRESETS: Record<ThemeSettings['homeQuickControlPreset'], readonly QuickControlKey[]> = {
  基础: ['favorite', 'peak', 'offline'],
  流量: ['favorite', 'totalTraffic', 'peak'],
  运维: ['favorite', 'offline', 'highLoad', 'expiring'],
  完整: ['favorite', 'totalTraffic', 'peak', 'offline', 'highLoad', 'expiring'],
  自定义: [],
}

/*
 * 允许出现在自定义列表里的全部 key，对应 Komari `ALL_HOME_QUICK_CONTROL_KEYS`
 * （默认顺序 + upload + download）。这一份必须独立于「完整」预设：
 * 上游的默认预设里同样没有 upload / download，但自定义模式仍可选中它们。
 */
const ALL_QUICK_CONTROL_KEYS: readonly QuickControlKey[] = [
  ...QUICK_PRESETS.完整,
  'upload',
  'download',
]

/** Komari `ALL_DETAIL_METRIC_CARD_KEYS` 的顺序，去掉 CFSM 不提供的 `temperature`。 */
const ALL_DETAIL_CARD_KEYS: readonly DetailCardKey[] = [
  'nodePrice', 'monthlyCost', 'remainingTime', 'remainingValue',
  'cpuUsage', 'gpuUsage', 'memoryUsage', 'swapUsage', 'diskUsage',
  'load', 'processes', 'connections', 'uptime',
  'uploadSpeed', 'downloadSpeed', 'totalTraffic', 'trafficQuota',
]

/*
 * 逐项对应 Komari `DETAIL_METRIC_CARD_PRESETS`（finance / status / resource /
 * network / gpu / full / custom），保持同一顺序，只删去 `temperature`。
 * 上游的 `full` 本来就不含 uptime 与 trafficQuota，这里也照原样保留。
 */
const DETAIL_PRESETS: Record<ThemeSettings['detailMetricCardPreset'], readonly DetailCardKey[]> = {
  财务: ['nodePrice', 'monthlyCost', 'remainingTime', 'remainingValue', 'totalTraffic', 'trafficQuota', 'uptime', 'connections'],
  状态: ['cpuUsage', 'memoryUsage', 'diskUsage', 'load', 'uptime', 'processes', 'connections'],
  资源: ['cpuUsage', 'gpuUsage', 'memoryUsage', 'swapUsage', 'diskUsage', 'load', 'processes', 'connections', 'uptime', 'uploadSpeed', 'downloadSpeed'],
  网络: ['uploadSpeed', 'downloadSpeed', 'totalTraffic', 'trafficQuota', 'connections', 'processes', 'uptime', 'remainingTime'],
  GPU: ['gpuUsage', 'cpuUsage', 'memoryUsage', 'load', 'processes', 'connections', 'uptime'],
  综合: ['nodePrice', 'monthlyCost', 'remainingTime', 'remainingValue', 'cpuUsage', 'gpuUsage', 'memoryUsage', 'swapUsage', 'diskUsage', 'load', 'processes', 'connections', 'uploadSpeed', 'downloadSpeed', 'totalTraffic'],
  自定义: [],
}

/*
 * 逐项对应 Komari `CHART_DASHBOARD_PRESETS`（all / compact / resource / network /
 * gpu / latency / ops / full / custom），保持同一顺序：
 * - 删去 CFSM 历史里不存在的 `gpuMemory` 与 `temperature`；
 * - 本主题独有的 `diskIo` 追加在「默认」「资源」「运维」「完整」的末尾，
 *   节点没有磁盘 IO 数据时这张卡本来就不出现。
 * 此前这张表是按本主题旧图表拆分自拟的，「默认」里没有连接数与进程，与上游不一致。
 */
const CHART_PRESETS: Record<ThemeSettings['chartDashboardPreset'], readonly ChartFamily[]> = {
  默认: ['cpu', 'memory', 'disk', 'network', 'gpu', 'connections', 'process', 'diskIo'],
  精简: ['cpu', 'memory', 'network'],
  资源: ['cpu', 'memory', 'disk', 'process', 'diskIo'],
  网络: ['network', 'traffic', 'connections'],
  GPU: ['gpu', 'cpu', 'memory'],
  延迟: ['ping', 'pingLoss', 'network'],
  运维: ['cpu', 'memory', 'disk', 'network', 'connections', 'process', 'ping', 'pingLoss', 'diskIo'],
  完整: ['cpu', 'memory', 'disk', 'network', 'traffic', 'gpu', 'connections', 'process', 'ping', 'pingLoss', 'diskIo'],
  自定义: [],
}

/** 上游 `CHART_DASHBOARD_LABEL_ALIASES`：自定义模板里也可以写中文名。 */
const CHART_LABEL_ALIASES: Readonly<Record<string, ChartFamily>> = {
  CPU: 'cpu',
  内存: 'memory',
  硬盘: 'disk',
  网络: 'network',
  流量: 'traffic',
  GPU: 'gpu',
  连接: 'connections',
  进程: 'process',
  延迟: 'ping',
  丢包: 'pingLoss',
  磁盘IO: 'diskIo',
}

function selectedKeys<T extends string>(preset: readonly T[], custom: string, allowed: ReadonlySet<string>): T[] {
  const requested = preset.length > 0 ? preset : parseSettingKeys(custom)
  return requested.filter((key): key is T => allowed.has(key))
}

const GENERAL_KEYS = new Set<string>(ALL_GENERAL_CARD_KEYS)
const QUICK_KEYS = new Set<string>(ALL_QUICK_CONTROL_KEYS)
const DETAIL_KEYS = new Set<string>(ALL_DETAIL_CARD_KEYS)
const CHART_KEYS = new Set<string>(CHART_PRESETS.完整)

export function resolveGeneralCardKeys(settings: ThemeSettings): GeneralCardKey[] {
  return selectedKeys(GENERAL_PRESETS[settings.generalCardPreset], settings.generalCardKeys, GENERAL_KEYS)
}

export function resolveQuickControlKeys(settings: ThemeSettings): QuickControlKey[] {
  return selectedKeys(QUICK_PRESETS[settings.homeQuickControlPreset], settings.homeQuickControlKeys, QUICK_KEYS)
}

export function resolveDetailCardKeys(settings: ThemeSettings): DetailCardKey[] {
  return selectedKeys(DETAIL_PRESETS[settings.detailMetricCardPreset], settings.detailMetricCardKeys, DETAIL_KEYS)
}

export function resolveChartFamilies(settings: ThemeSettings): ChartFamily[] {
  const template = parseSettingKeys(settings.chartDashboardTemplate)
    .map((key) => CHART_LABEL_ALIASES[key] ?? key)
    .join('\n')
  return [...new Set(selectedKeys(CHART_PRESETS[settings.chartDashboardPreset], template, CHART_KEYS))]
}

export interface HighLoadMetric {
  label: 'CPU' | '内存' | '硬盘'
  percentage: number
}

/**
 * 对应 Komari `getHighLoadMetrics`：离线节点一律不算（最后一次上报不代表当前负载），
 * 在线节点按 CPU / 内存 / 硬盘逐项与阈值比较。缺失的指标不参与，不当作 0。
 * 总览卡片与快捷筛选都经由这里判断，因此都只统计在线节点，与上游一致。
 */
export function highLoadMetrics(server: GlassServer, threshold: number): HighLoadMetric[] {
  if (!server.online) return []
  const metrics: HighLoadMetric[] = []
  if (server.cpu !== null && server.cpu >= threshold) metrics.push({ label: 'CPU', percentage: server.cpu })
  if (server.memory.percentage !== null && server.memory.percentage >= threshold) {
    metrics.push({ label: '内存', percentage: server.memory.percentage })
  }
  if (server.disk.percentage !== null && server.disk.percentage >= threshold) {
    metrics.push({ label: '硬盘', percentage: server.disk.percentage })
  }
  return metrics
}

export function isHighLoad(server: GlassServer, threshold: number): boolean {
  return highLoadMetrics(server, threshold).length > 0
}

export function daysUntilExpiry(value: string | null, now = Date.now()): number | null {
  const date = parseCfsmDate(value)
  if (!date) return null
  const difference = date.getTime() - now
  return difference <= 0
    ? Math.floor(difference / 86_400_000)
    : Math.ceil(difference / 86_400_000)
}

/**
 * 按 CFSM 官方计费周期计算节点当前剩余价值（原币）。首页节点卡与上游一样显示原币，
 * 计算本身交给 `domain/finance.ts`，与详情页、明细弹窗共用一套口径。
 * 免费、未设置价格、未知周期、缺失或无效到期都返回 null。
 */
export interface BillableServer {
  price: string | null
  billingCycle: string | null
  expireDate: string | null
}

export function remainingValue(server: BillableServer, now = Date.now()): number | null {
  const result = remainingValueOf(server, now)
  return result.status === 'ok' ? result.amount : null
}

/**
 * 对应 Komari `isExpiringNode`：免费节点不算；已经过期的节点也算在内（上游名单里写「已过期」）；
 * 阈值至少 1 天。站点关闭到期展示（`show_expire`）时不透露。
 */
export function isExpiring(server: GlassServer, days: number, now = Date.now()): boolean {
  if (!server.showExpire) return false
  if (parseBillingPrice(server.price).status === 'free') return false
  const remaining = daysUntilExpiry(server.expireDate, now)
  return remaining !== null && remaining <= Math.max(1, days)
}

export function parseTrafficLimitBytes(value: string | null): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)?$/i)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = (match[2] ?? 'gb').toLowerCase()
  const power: Record<string, number> = { b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 }
  return amount * (1024 ** (power[unit] ?? 3))
}

export function trafficUsageBytes(
  received: number | null,
  transmitted: number | null,
  calculationType: string | null,
): number | null {
  const calculation = calculationType?.trim().toLowerCase()
  if (calculation === 'dl') return received
  if (calculation === 'ul') return transmitted
  // MAX 与 SUM 都需要两向数据完整；缺一向时不能把未知伪装成 0。
  if (received === null || transmitted === null) return null
  return calculation === 'max'
    ? Math.max(received, transmitted)
    : received + transmitted
}

export function trafficUsage(server: GlassServer): { used: number, limit: number, percent: number } | null {
  if (!server.showTraffic) return null
  const limit = parseTrafficLimitBytes(server.trafficLimit)
  const rx = server.network.monthlyReceived
  const tx = server.network.monthlyTransmitted
  const used = trafficUsageBytes(rx, tx, server.trafficCalculationType)
  if (limit === null || used === null) return null
  return { used, limit, percent: (used / limit) * 100 }
}

/**
 * 节点卡与节点列表的流量显示口径；配额告警、排序仍用上面的 `trafficUsage`。
 *
 * Komari NodeCard 有上限时显示百分比与 `已用 / 上限`，没有上限时显示 `∞` 与真实的
 * `已用 / ∞`。已用量与 CFSM 自己的计算一致：月度收发按 `traffic_calc_type` 合计；
 * 上限按 CFSM 的 `parseFloat(traffic_limit) || 0` 语义，空、0 或无法解析都是不限流量。
 *
 * 只在两种上游没有的情况下如实降级：
 * - 站点关闭流量展示（`show_tf`）：Komari 没有这个开关，CFSM 自己会整行隐藏。
 *   这里不透露数据，也不写成「∞」冒充不限流量；
 * - 有上限但月度计数缺失：上游把缺失按 0 计，这里保留未知，不写成 0。
 */
export type TrafficDisplay =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'unlimited', readonly used: number | null }
  | { readonly kind: 'limited', readonly used: number | null, readonly limit: number, readonly percent: number | null }

export function trafficDisplay(server: GlassServer): TrafficDisplay {
  if (!server.showTraffic) return { kind: 'hidden' }
  const used = trafficUsageBytes(
    server.network.monthlyReceived,
    server.network.monthlyTransmitted,
    server.trafficCalculationType,
  )
  const limit = parseTrafficLimitBytes(server.trafficLimit)
  if (limit === null) return { kind: 'unlimited', used }
  return { kind: 'limited', used, limit, percent: used === null ? null : (used / limit) * 100 }
}

/** 进度条与配色只认有上限且已用量已知的百分比。 */
export function trafficDisplayPercent(view: TrafficDisplay): number | null {
  return view.kind === 'limited' ? view.percent : null
}

/** 流量格右上角：百分比，不限流量为 `∞`，其余为占位。 */
export function trafficHeadText(view: TrafficDisplay): string {
  if (view.kind === 'unlimited') return '∞'
  const percent = trafficDisplayPercent(view)
  return percent === null ? MISSING_TEXT : formatPercent(percent)
}

/** 流量格下方的 `已用 / 上限`，不限流量时上限为 `∞`。 */
export function trafficRatioText(view: TrafficDisplay): string {
  if (view.kind === 'hidden') return `${MISSING_TEXT} / ${MISSING_TEXT}`
  const limit = view.kind === 'unlimited' ? '∞' : formatDisplayBytes(view.limit)
  return `${formatDisplayBytes(view.used)} / ${limit}`
}

export function isTrafficWarning(server: GlassServer, threshold: number): boolean {
  const usage = trafficUsage(server)
  return usage !== null && usage.percent >= threshold
}

function average(values: Array<number | null>): number | null {
  const samples = values.filter((value): value is number => value !== null)
  return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null
}

function sum(values: Array<number | null>): number | null {
  const samples = values.filter((value): value is number => value !== null)
  return samples.length ? samples.reduce((total, value) => total + value, 0) : null
}

/**
 * `icon` 使用与 Komari 一致的图标名（见 `@/constants/icons`），由 `AppIcon` 渲染。
 *
 * 总览卡片使用 `value` + `unit`，与上游 `GeneralMetricCard` 的两段式一致：
 * 主数值大字，单位小字并与主数值基线对齐；`hint` 此时是 tooltip 文本。
 * 详情页卡片结构已冻结，仍然把 `hint` 当作可见副文本。
 */
export interface PresentationCard {
  key: string
  icon: IconName
  label: string
  value: string
  hint: string
  unit?: string
  /** 数值着色，对应 Komari 详情卡的 `valueClass`（目前只有剩余时间使用）。 */
  tone?: 'danger' | 'warning' | 'muted' | 'ok'
  percentage?: number | null
  /** 对应上游 `GeneralMetricCard.action`：目前只有剩余价值卡能打开财务明细。 */
  action?: 'financeDetails'
}

/*
 * ===== 财务卡 =====
 *
 * 首页总览的剩余价值、月费用估算、年费用估算（Komari `NodeGeneralCards`）按财务显示币种合计。
 * 汇率与合计由 `domain/finance.ts` 算好传进来，这里只负责上游的卡片文案与格式。
 * 上游这三张卡没有单位；本主题只在需要交代时借用单位位置放一个短标记：
 * 汇率载入中、部分节点没能换算、用了参考 / 旧缓存 / 手动汇率。细节写进 tooltip。
 */
export type GeneralFinanceContext =
  /** 没有任何节点允许显示价格（站点关闭了 show_price）：财务卡整张不出现。 */
  | { state: 'hidden' }
  /** 未登录隐藏价格：卡片显示 `***`，不能点开明细，也不需要汇率。 */
  | { state: 'masked' }
  /** 合计只含价格对访客可见的节点。 */
  | { state: 'visible', summary: FinanceSummary, target: DisplayCurrency }

export const FINANCE_GENERAL_CARD_KEYS: readonly GeneralCardKey[] = ['remainingValue', 'monthlyCost', 'yearlyCost']

/** 参与财务合计的节点：只取站点允许显示价格（`show_price`）的节点。 */
export function financeNodesOf(servers: readonly GlassServer[]): BillableNode[] {
  return servers
    .filter((server) => server.showPrice)
    .map((server) => ({
      key: server.key,
      name: server.name,
      tags: server.tags,
      price: server.price,
      currency: server.currency,
      billingCycle: server.billingCycle,
      expireDate: server.expireDate,
    }))
}

export interface GeneralFinanceInput {
  /** 主题级「未登录隐藏价格」之后，访客能否看到价格。 */
  priceVisible: boolean
  target: DisplayCurrency
  view: RateView
  excludeFree: boolean
  now: number
}

/**
 * 首页总览财务卡的上下文。没有选用任何财务卡时返回 undefined，调用方也就不会去算合计、不会请求汇率。
 */
export function generalFinanceContext(
  servers: readonly GlassServer[],
  settings: ThemeSettings,
  input: GeneralFinanceInput,
): GeneralFinanceContext | undefined {
  if (!resolveGeneralCardKeys(settings).some((key) => FINANCE_GENERAL_CARD_KEYS.includes(key))) return undefined
  const nodes = financeNodesOf(servers)
  if (nodes.length === 0) return { state: 'hidden' }
  if (!input.priceVisible) return { state: 'masked' }
  return {
    state: 'visible',
    target: input.target,
    summary: summarizeFinance(nodes, {
      target: input.target,
      view: input.view,
      excludeFree: input.excludeFree,
      now: input.now,
    }),
  }
}

const CONVERSION_SKIPS = SKIP_REASONS.filter((reason) => reason.startsWith('currency-') || reason === 'rate-missing')

function hasSkips(total: FinanceTotal): boolean {
  return SKIP_REASONS.some((reason) => (total.skipped[reason] ?? 0) > 0)
}

/** 数值旁的短标记；一切正常（当日汇率、全部计入）时不显示，与上游一致。 */
export function rateMarker(sources: readonly RateSource[]): string | undefined {
  if (sources.includes('reference')) return '参考'
  if (sources.includes('stale-cache')) return '旧汇率'
  if (sources.includes('manual')) return '手动'
  return undefined
}

/**
 * 「部分」（有节点没能换算）与汇率质量（参考 / 旧汇率 / 手动）是两件事，同时存在时一起显示，
 * 例如「部分 · 参考」；单位位置放不下时按上游的 truncate 截断，完整说明在 tooltip 里。
 */
function financeMarker(total: FinanceTotal, sources: readonly RateSource[]): string | undefined {
  if (total.pending) return '载入中'
  if (total.counted === 0 && hasSkips(total)) return '不可用'
  const partial = CONVERSION_SKIPS.some((reason) => (total.skipped[reason] ?? 0) > 0) ? '部分' : undefined
  const markers = [partial, rateMarker(sources)].filter((marker): marker is string => marker !== undefined)
  return markers.length > 0 ? markers.join(' · ') : undefined
}

function financeValue(total: FinanceTotal, target: DisplayCurrency): string {
  if (total.pending || (total.counted === 0 && hasSkips(total))) return MISSING_TEXT
  return formatFinanceAmount(total.amount, target)
}

function financeNotes(total: FinanceTotal, sources: readonly RateSource[], alwaysShowSources: boolean): string[] {
  const lines: string[] = []
  if (total.pending) lines.push('汇率载入中')
  const fresh = sources.every((source) => source === 'network' || source === 'cache')
  const described = describeSources(sources)
  if (described && (alwaysShowSources || !fresh)) lines.push(`汇率：${described}`)
  lines.push(...describeSkipped(total))
  return lines
}

function financeCards(context: GeneralFinanceContext | undefined): Pick<Record<GeneralCardKey, PresentationCard | null>, 'remainingValue' | 'monthlyCost' | 'yearlyCost'> {
  if (!context || context.state === 'hidden') return { remainingValue: null, monthlyCost: null, yearlyCost: null }
  if (context.state === 'masked') {
    return {
      remainingValue: { key: 'remainingValue', icon: 'tabler:cash', label: '剩余价值', value: '***', hint: '总价值\n***' },
      monthlyCost: { key: 'monthlyCost', icon: 'tabler:calendar-dollar', label: '月费用估算', value: '***', hint: '' },
      yearlyCost: { key: 'yearlyCost', icon: 'tabler:receipt-2', label: '年费用估算', value: '***', hint: '' },
    }
  }
  const { summary, target } = context
  const costCard =(key: 'monthlyCost' | 'yearlyCost', icon: IconName, label: string, total: FinanceTotal): PresentationCard => ({
    key,
    icon,
    label,
    value: financeValue(total, target),
    unit: financeMarker(total, summary.sources),
    hint: financeNotes(total, summary.sources, false).join('\n'),
  })
  return {
    remainingValue: {
      key: 'remainingValue',
      icon: 'tabler:cash',
      label: '剩余价值',
      value: financeValue(summary.remaining, target),
      unit: financeMarker(summary.remaining, summary.sources),
      hint: [
        '总价值',
        financeValue(summary.totalValue, target),
        ...financeNotes(summary.remaining, summary.sources, true),
      ].join('\n'),
      action: 'financeDetails',
    },
    monthlyCost: costCard('monthlyCost', 'tabler:calendar-dollar', '月费用估算', summary.monthly),
    yearlyCost: costCard('yearlyCost', 'tabler:receipt-2', '年费用估算', summary.yearly),
  }
}

interface TopNode {
  server: GlassServer
  value: number
}

/**
 * 对应 Komari `updateTopMetric`：在候选节点里取指标最高的一台，第一台先入选、之后严格大于才替换。
 * 指标缺失（null）的节点不参与，不当作 0。
 */
function topNode(servers: readonly GlassServer[], metric: (server: GlassServer) => number | null): TopNode | null {
  let best: TopNode | null = null
  for (const server of servers) {
    const value = metric(server)
    if (value === null || !Number.isFinite(value)) continue
    if (best === null || value > best.value) best = { server, value: Math.max(0, value) }
  }
  return best
}

/** Komari `getRealtimeTotalSpeed`：上下行合计；只缺一向时按另一向计（上游 `|| 0`），两向都缺时不参与。 */
function totalSpeed(server: GlassServer): number | null {
  const { inSpeed, outSpeed } = server.network
  return inSpeed === null && outSpeed === null ? null : (inSpeed ?? 0) + (outSpeed ?? 0)
}

/** Komari `getConnectionCount`：TCP + UDP；两项都缺时不参与。 */
function nodeConnections(server: GlassServer): number | null {
  return server.tcpConnections === null && server.udpConnections === null
    ? null
    : (server.tcpConnections ?? 0) + (server.udpConnections ?? 0)
}

/** GPU 型号，多卡同型号只写一次（上游的 `gpu_name` 是一个字符串）。 */
function gpuModels(server: GlassServer): string {
  return [...new Set(server.gpus.map((gpu) => gpu.name.trim()).filter(Boolean))].join(' / ')
}

/** 对应 Komari `formatNodeNames`：最多列 8 台，超出写「… 还有 N 台」，没有节点时写「暂无节点」。 */
function formatNodeNames(
  servers: readonly GlassServer[],
  formatter: (server: GlassServer) => string = (server) => server.name,
  max = 8,
): string {
  if (servers.length === 0) return '暂无节点'
  const lines = servers.slice(0, max).map(formatter)
  if (servers.length > max) lines.push(`… 还有 ${servers.length - max} 台`)
  return lines.join('\n')
}

/** 节点 GPU 利用率：多卡取平均；全部缺失时为 null，不当作 0。 */
function gpuUtilization(server: GlassServer): number | null {
  return average(server.gpus.map((gpu) => gpu.utilization))
}

// 「当前时间」卡片每次重算都会用到，格式器只建一次。
const CLOCK_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const CLOCK_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

/** 按出现次数降序的取值分布，对应 Komari `getDistribution`。 */
function distribution(values: Array<string | null>): Array<{ label: string, count: number }> {
  const counters = new Map<string, number>()
  for (const value of values) {
    const label = value?.trim()
    if (!label) continue
    counters.set(label, (counters.get(label) ?? 0) + 1)
  }
  return [...counters].map(([label, count]) => ({ label, count })).sort((l, r) => r.count - l.count)
}

/**
 * 对应 Komari `formatDistributionTooltip`：最多列出前 8 项 `名称: N 台`。
 * 卡片主数值只放占比最高的一项且会被截断，完整名称靠这个 tooltip 读出来。
 */
function distributionTooltip(entries: Array<{ label: string, count: number }>): string {
  if (entries.length === 0) return '暂无数据'
  return entries.slice(0, 8).map((entry) => `${entry.label}: ${entry.count} 台`).join('\n')
}

/*
 * 总览卡片。value / unit 的拆分方式与 Komari `NodeGeneralCards` 完全一致：
 * 内存与硬盘是「已用数值 + 已用单位 / 总量」，流量与速率是「数值 + 单位」，
 * 计数类是「数值 + / 总数」或「数值 + 台 / 个」。
 * 单位一栏只放真正的单位，不再塞「接收 + 发送」「在线节点合计」这类说明文字，
 * 那些说明改由 tooltip（`hint`）承担，手机端因此不会再被长文本挤到省略。
 */
export function buildGeneralCards(
  servers: GlassServer[],
  settings: ThemeSettings,
  now = Date.now(),
  finance?: GeneralFinanceContext,
): PresentationCard[] {
  const online = servers.filter((server) => server.online)
  const offlineNodes = servers.filter((server) => !server.online)
  /** 内存 / 硬盘 / 交换内存：`已用值` + `已用单位 / 总量 单位`。 */
  const usageCard = (
    key: 'memory' | 'disk' | 'swap',
    icon: IconName,
    label: string,
    metric: { used: number | null, total: number | null, percentage: number | null },
  ): PresentationCard | null => {
    if (metric.percentage === null) return null
    const used = formatDisplayMebibytesSplit(metric.used)
    const total = formatDisplayMebibytesSplit(metric.total)
    return {
      key,
      icon,
      label,
      value: used.value,
      unit: `${used.unit} / ${total.value} ${total.unit}`,
      /*
       * 六列栅格下这张卡的内容宽度只有 90 多 px，`455.0` + `GB / 1.56 TB` 一定放不下：
       * 768px 实测主数值被截成 `45…`、单位被截成 `GB / 1.5…`。上游在同宽度下截得更狠
       * （`258.6` 只剩 38px），而且这三张卡**根本没有 tooltip**，完整值无从读取。
       * 这里沿用本主题已有的 tooltip，把同一数据源格式化出的完整「已用 / 总量」
       * 与占比一起放进气泡：不改几何、不加新元素，只是让被截断的值仍然可读。
       */
      hint: `${used.value} ${used.unit} / ${total.value} ${total.unit}\n${formatPercent(metric.percentage)}`,
      percentage: metric.percentage,
    }
  }

  // 只累计已用与总量都有值的节点，与首页其它汇总同一口径；缺的一侧不当作 0 混进合计。
  const memory = summarizeResource(servers, (server) => server.memory)
  const disk = summarizeResource(servers, (server) => server.disk)
  const swap = summarizeResource(servers, (server) => server.swap)
  // 单节点仍须双向完整；缺失的一向绝不能被当作 0 加进全站总量。
  const trafficReady = servers.filter((server) => (
    server.network.transmitted !== null && server.network.received !== null
  ))
  const missingTrafficCount = servers.length - trafficReady.length
  const trafficUp = sum(trafficReady.map((server) => server.network.transmitted))
  const trafficDown = sum(trafficReady.map((server) => server.network.received))
  const totalTraffic = trafficUp !== null && trafficDown !== null ? trafficUp + trafficDown : null
  const upload = sum(online.map((server) => server.network.outSpeed))
  const download = sum(online.map((server) => server.network.inSpeed))
  const avgCpu = average(online.map((server) => server.cpu))
  // 与上游一样按节点平均：多卡节点先取自身平均，不按卡数加权。
  const gpuNodes = servers.filter((server) => server.gpus.length > 0)
  const onlineGpuNodes = gpuNodes.filter((server) => server.online)
  const avgGpu = average(onlineGpuNodes.map(gpuUtilization))
  // 峰值节点与上游 `onlineStats` 一样只在在线节点里取。
  const trafficTop = topNode(online, totalSpeed)
  const uploadTop = topNode(online, (server) => server.network.outSpeed)
  const downloadTop = topNode(online, (server) => server.network.inSpeed)
  const connectionTop = topNode(online, nodeConnections)
  const gpuTop = topNode(onlineGpuNodes, gpuUtilization)
  // 流量配额：上游只合计设了上限的节点。站点关闭流量展示的节点不透露；已用量缺失的不当作 0，单独说明。
  const quotaNodes = servers.filter((server) => server.showTraffic && parseTrafficLimitBytes(server.trafficLimit) !== null)
  const quotaUsage = quotaNodes.flatMap((server) => {
    const usage = trafficUsage(server)
    return usage === null ? [] : [usage]
  })
  const quotaMissing = quotaNodes.length - quotaUsage.length
  const quotaUsed = sum(quotaUsage.map((usage) => usage.used))
  const quotaLimit = sum(quotaUsage.map((usage) => usage.limit))
  const avgLoad = average(online.map((server) => server.load.one))
  const avgLoad5 = average(online.map((server) => server.load.five))
  const avgLoad15 = average(online.map((server) => server.load.fifteen))
  const processCount = sum(online.map((server) => server.processes))
  const tcpCount = sum(online.map((server) => server.tcpConnections))
  const udpCount = sum(online.map((server) => server.udpConnections))
  const connectionCount = tcpCount === null && udpCount === null ? null : (tcpCount ?? 0) + (udpCount ?? 0)
  const coreCount = sum(servers.map((server) => server.cpuCores))
  const regionEntries = distribution(servers.map((server) => server.region ?? null))
  const regions = regionEntries.length
  const systemEntries = distribution(servers.map((server) => server.operatingSystem))
  const topSystem = systemEntries[0] ?? null
  const highLoadNodes = servers.filter((server) => isHighLoad(server, settings.homeHighLoadThreshold))
  const expiringNodes = servers.filter((server) => isExpiring(server, settings.homeExpiringDays, now))
  const trafficWarningNodes = servers.filter((server) => isTrafficWarning(server, settings.homeTrafficWarningThreshold))
  /*
   * 以下几张卡的 tooltip 逐条对应 Komari `NodeGeneralCards` 的 `formatNodeNames(...)`：
   * 列出具体节点与指标。上游没有 tooltip 的卡（实时上下行、在线节点、平均 CPU、进程、核心）这里也不放。
   */
  const gpuText = (server: GlassServer) => {
    const value = gpuUtilization(server)
    return `${server.name}: ${value === null ? MISSING_TEXT : `${value.toFixed(1)}%`}`
  }
  const gpuNameText = (server: GlassServer) => `${server.name}: ${gpuModels(server) || 'GPU'}`
  const highLoadText = (server: GlassServer) => (
    `${server.name}: ${highLoadMetrics(server, settings.homeHighLoadThreshold)
      .map((metric) => `${metric.label} ${metric.percentage.toFixed(1)}%`)
      .join(' / ')}`
  )
  const expiryText = (server: GlassServer) => {
    const days = daysUntilExpiry(server.expireDate, now)
    if (days === null) return `${server.name}: 未知`
    return days <= 0 ? `${server.name}: 已过期` : `${server.name}: ${days} 天`
  }
  const trafficWarningText = (server: GlassServer) => {
    const usage = trafficUsage(server)
    return `${server.name}: ${usage === null ? MISSING_TEXT : `${Math.min(100, usage.percent).toFixed(1)}%`}`
  }
  const totalTrafficSplit = formatDisplayBytesSplit(totalTraffic)
  const uploadSplit = formatDisplaySpeedSplit(upload)
  const downloadSplit = formatDisplaySpeedSplit(download)
  /** 上游 `formatTopNodeSpeed`：没有候选或速度为 0 时只显示 `-`；否则给出这台节点的上下行。 */
  const speedCard = (
    key: 'trafficPeak' | 'uploadPeakNode' | 'downloadPeakNode',
    icon: IconName,
    label: string,
    top: TopNode | null,
  ): PresentationCard => {
    if (top === null || top.value <= 0) return { key, icon, label, value: MISSING_TEXT, hint: '' }
    const split = formatDisplaySpeedSplit(top.value)
    return {
      key,
      icon,
      label,
      value: split.value,
      unit: split.unit,
      hint: `${top.server.name}\n↑ ${formatDisplaySpeed(top.server.network.outSpeed)}\n↓ ${formatDisplaySpeed(top.server.network.inSpeed)}`,
    }
  }
  /** 上游 `trafficQuota`：已用合计 ÷ 上限合计；没有任何节点设上限时显示 `-` 与「无限流量」。 */
  const quotaCard = (): PresentationCard => {
    const card: Pick<PresentationCard, 'key' | 'icon' | 'label'> = { key: 'trafficQuota', icon: 'tabler:gauge', label: '流量配额' }
    if (quotaUsed === null || quotaLimit === null || quotaLimit <= 0) {
      return { ...card, value: MISSING_TEXT, hint: quotaNodes.length === 0 ? '无限流量' : `${quotaMissing} 台缺少流量数据，未计入` }
    }
    const missing = quotaMissing > 0 ? `\n部分 · ${quotaMissing} 台缺少流量数据，未计入` : ''
    return {
      ...card,
      value: (quotaUsed / quotaLimit * 100).toFixed(1),
      unit: '%',
      hint: `${formatDisplayBytes(quotaUsed)} / ${formatDisplayBytes(quotaLimit)}${missing}`,
    }
  }

  const values: Record<GeneralCardKey, PresentationCard | null> = {
    ...financeCards(finance),
    currentTime: { key: 'currentTime', icon: 'tabler:clock', label: '当前时间', value: CLOCK_TIME_FORMAT.format(now), hint: CLOCK_DATE_FORMAT.format(now) },
    memory: usageCard('memory', 'icon-park-outline:memory', '内存用量', memory),
    disk: usageCard('disk', 'tabler:server-2', '硬盘用量', disk),
    totalTraffic: totalTraffic === null ? null : { key: 'totalTraffic', icon: 'tabler:download', label: '累计流量', value: totalTrafficSplit.value, unit: totalTrafficSplit.unit, hint: `↑ ${formatDisplayBytes(trafficUp)}\n↓ ${formatDisplayBytes(trafficDown)}${missingTrafficCount > 0 ? `\n部分 · ${missingTrafficCount} 台缺少流量数据，未计入` : ''}` },
    uploadSpeed: upload === null ? null : { key: 'uploadSpeed', icon: 'tabler:chevrons-up', label: '实时上行', value: uploadSplit.value, unit: uploadSplit.unit, hint: '' },
    downloadSpeed: download === null ? null : { key: 'downloadSpeed', icon: 'tabler:chevrons-down', label: '实时下行', value: downloadSplit.value, unit: downloadSplit.unit, hint: '' },
    onlineNodes: { key: 'onlineNodes', icon: 'tabler:activity-heartbeat', label: '在线节点', value: formatCount(online.length), unit: `/ ${formatCount(servers.length)}`, hint: '' },
    offlineNodes: { key: 'offlineNodes', icon: 'tabler:plug-connected-x', label: '离线节点', value: formatCount(offlineNodes.length), unit: `/ ${formatCount(servers.length)}`, hint: formatNodeNames(offlineNodes) },
    avgCpu: avgCpu === null ? null : { key: 'avgCpu', icon: 'tabler:cpu', label: '平均 CPU', value: avgCpu.toFixed(1), unit: '%', hint: '' },
    avgGpu: avgGpu === null ? null : { key: 'avgGpu', icon: 'tabler:device-desktop-analytics', label: '平均 GPU', value: avgGpu.toFixed(1), unit: '%', hint: formatNodeNames(onlineGpuNodes, gpuText) },
    avgLoad: avgLoad === null ? null : { key: 'avgLoad', icon: 'tabler:chart-line', label: '平均负载', value: formatLoad(avgLoad), hint: `1m ${formatLoad(avgLoad)}\n5m ${formatLoad(avgLoad5)}\n15m ${formatLoad(avgLoad15)}` },
    swap: usageCard('swap', 'icon-park-outline:switch', '交换内存', swap),
    processes: processCount === null ? null : { key: 'processes', icon: 'tabler:list-numbers', label: '进程总数', value: formatCount(processCount), hint: '' },
    connections: connectionCount === null ? null : { key: 'connections', icon: 'tabler:plug-connected', label: '连接数', value: formatCount(connectionCount), hint: `TCP ${formatCount(tcpCount)}\nUDP ${formatCount(udpCount)}` },
    // 上游用 `tabler:chip`，该名称已不在 Iconify Tabler 集内，改用同族的 `tabler:cpu`。
    cpuCores: coreCount === null ? null : { key: 'cpuCores', icon: 'tabler:cpu', label: 'CPU 核心', value: formatCount(coreCount), unit: 'Core', hint: '' },
    gpuNodes: { key: 'gpuNodes', icon: 'tabler:device-imac', label: 'GPU 节点', value: formatCount(gpuNodes.length), unit: `/ ${formatCount(servers.length)}`, hint: formatNodeNames(gpuNodes, gpuNameText) },
    // 上游 `formatTopNodePercentage`：没有 GPU 节点时只显示 `-`。
    gpuPeakNode: gpuTop === null
      ? { key: 'gpuPeakNode', icon: 'tabler:chart-histogram', label: 'GPU 峰值', value: MISSING_TEXT, hint: '' }
      : { key: 'gpuPeakNode', icon: 'tabler:chart-histogram', label: 'GPU 峰值', value: gpuTop.value.toFixed(1), unit: '%', hint: [gpuTop.server.name, gpuModels(gpuTop.server), `GPU ${gpuTop.value.toFixed(1)}%`].filter(Boolean).join('\n') },
    trafficQuota: quotaCard(),
    trafficPeak: speedCard('trafficPeak', 'tabler:activity', '实时峰值', trafficTop),
    uploadPeakNode: speedCard('uploadPeakNode', 'tabler:arrow-big-up-lines', '上行最高', uploadTop),
    downloadPeakNode: speedCard('downloadPeakNode', 'tabler:arrow-big-down-lines', '下行最高', downloadTop),
    // 上游 `connectionPeakTooltip`：节点名与 TCP / UDP；没有候选时写「暂无数据」。
    connectionPeakNode: connectionTop === null
      ? { key: 'connectionPeakNode', icon: 'tabler:plug-connected', label: '连接峰值', value: MISSING_TEXT, hint: '暂无数据' }
      : { key: 'connectionPeakNode', icon: 'tabler:plug-connected', label: '连接峰值', value: formatCount(connectionTop.value), hint: `${connectionTop.server.name}\nTCP ${formatCount(connectionTop.server.tcpConnections)}\nUDP ${formatCount(connectionTop.server.udpConnections)}` },
    highLoadNodes: { key: 'highLoadNodes', icon: 'tabler:alert-triangle', label: '高负载节点', value: formatCount(highLoadNodes.length), unit: `/ ${formatCount(online.length)}`, hint: formatNodeNames(highLoadNodes, highLoadText) },
    expiringNodes: { key: 'expiringNodes', icon: 'tabler:calendar-exclamation', label: '即将到期', value: formatCount(expiringNodes.length), unit: '台', hint: formatNodeNames(expiringNodes, expiryText) },
    trafficWarnings: { key: 'trafficWarnings', icon: 'tabler:traffic-cone', label: '流量预警', value: formatCount(trafficWarningNodes.length), unit: '台', hint: formatNodeNames(trafficWarningNodes, trafficWarningText) },
    regionDistribution: { key: 'regionDistribution', icon: 'tabler:map-pin', label: '地区分布', value: formatCount(regions), unit: '个', hint: distributionTooltip(regionEntries) },
    // 上游这张卡的 tooltip 是 `formatDistributionTooltip`，会列出完整的系统名与台数；
    // 此前这里放的是一句说明文字，长系统名（`Ubuntu 24.04.4 LTS`）被截断后就读不回来了。
    systemDistribution: { key: 'systemDistribution', icon: 'tabler:device-desktop', label: '系统分布', value: topSystem?.label ?? '-', unit: topSystem ? `${formatCount(topSystem.count)} 台` : undefined, hint: distributionTooltip(systemEntries) },
  }
  return resolveGeneralCardKeys(settings).flatMap((key) => values[key] ? [values[key] as PresentationCard] : [])
}

/*
 * 详情指标卡的 value / unit 拆分，逐条对应 Komari `splitMetricValue`：
 * 先按 ` / ` 拆出计费周期，再按 `N 天` 拆出剩余天数，最后按尾随的三字母币种码拆分。
 */
const EXPIRES_IN_SUFFIX_PATTERN = /^(\d+)\s*(天)$/
const CURRENCY_SUFFIX_PATTERN = /^(\S.*\S)\s+([A-Z]{3})$/

function splitMetricValue(value: string): SplitAmount {
  const cycleIndex = value.indexOf(' / ')
  if (cycleIndex > -1) return { value: value.slice(0, cycleIndex), unit: value.slice(cycleIndex + 1) }
  const expiresIn = EXPIRES_IN_SUFFIX_PATTERN.exec(value)
  if (expiresIn) return { value: expiresIn[1] ?? value, unit: expiresIn[2] ?? '' }
  const currency = CURRENCY_SUFFIX_PATTERN.exec(value)
  if (currency) return { value: currency[1] ?? value, unit: currency[2] ?? '' }
  return { value, unit: '' }
}

/** 对应 Komari `splitMeasurement`：把 `1.5 GB/s` 拆成数值与单位。 */
function splitMeasurement(value: string): SplitAmount {
  const separator = value.lastIndexOf(' ')
  if (separator <= 0) return { value, unit: '' }
  return { value: value.slice(0, separator), unit: value.slice(separator + 1) }
}

/**
 * 月均支出（原币，与上游详情页的分工一致）。上游把计费周期当成天数直接除；CFSM 的
 * `billing_cycle` 是枚举文本，按官方周期天数表折算成 30 天口径（`domain/finance.ts`）。
 * 未知周期返回「不适用」，不猜测；未设置或无法识别的价格不出这张卡，与节点价格卡一致。
 */
function monthlyAverageCost(server: CfsmServer): string | null {
  const result = monthlyCostOf(server)
  if (result.status === 'free') return formatPrice(server.price, server.currency, null)
  // 未填价格（适配层里就是 null）或价格无法识别时整卡不显示，与「节点价格」「剩余价值」一致。
  if (result.status === 'unavailable') return result.reason === 'cycle-unknown' ? '不适用' : null
  const monthly = result.amount
  const digits = Math.abs(monthly) >= 100 ? 0 : 2
  return `${server.currency?.trim() ?? ''}${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(monthly)} / 月`
}

/** 详情页剩余价值的换算上下文：显示币种与当前汇率。 */
export interface DetailFinanceContext {
  target: DisplayCurrency
  view: RateView
}

const DEFAULT_DETAIL_FINANCE: DetailFinanceContext = { target: 'CNY', view: EMPTY_RATE_VIEW }

function conversionFailure(converted: Exclude<Conversion, { status: 'ok' }>): { unit: string, note: string } {
  if (converted.status === 'pending') return { unit: '载入中', note: '汇率载入中' }
  if (converted.reason === 'rate-missing') return { unit: '汇率不可用', note: '缺少汇率，无法换算' }
  return { unit: '不可换算', note: `${skipReasonLabel(converted.reason)}，无法换算` }
}

/**
 * 详情页剩余价值：与上游 `InstanceDetail` 一样换算成财务显示币种（节点价格与月均支出保留原币）。
 * 原币金额与汇率来源放进 tooltip；换算不了时如实显示，不拿原币冒充换算结果。
 */
function detailRemainingValue(server: CfsmServer, now: number, finance: DetailFinanceContext): { value: string, unit?: string, hint: string } | null {
  if (server.price === null) return null
  const result = remainingValueOf(server, now)
  if (result.status === 'free') return { value: '无', hint: '' }
  if (result.status === 'unavailable') return null
  const original = formatCurrencyValue(result.amount, server.currency)
  const converted = convertAmount(result.amount, resolveSourceCurrency(server.currency), finance.target, finance.view)
  if (converted.status !== 'ok') {
    const failure = conversionFailure(converted)
    return { value: MISSING_TEXT, unit: failure.unit, hint: `原币 ${original}\n${failure.note}` }
  }
  const split = splitMetricValue(formatFinanceAmount(converted.amount, finance.target))
  const sources = describeSources(converted.sources)
  return {
    value: split.value,
    unit: rateMarker(converted.sources) ?? (split.unit || undefined),
    hint: sources ? `原币 ${original}\n汇率：${sources}` : '',
  }
}

export function buildDetailCards(
  server: CfsmServer,
  settings: ThemeSettings,
  now = Date.now(),
  finance: DetailFinanceContext = DEFAULT_DETAIL_FINANCE,
): PresentationCard[] {
  const percent = (used: number | null, total: number | null) => used !== null && total !== null && total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : null
  const totalTraffic = server.networkReceived !== null && server.networkTransmitted !== null
    ? server.networkReceived + server.networkTransmitted
    : null
  const gpu = average(server.gpus.map((item) => item.utilization))
  const days = daysUntilExpiry(server.expireDate, now)
  const quotaLimit = parseTrafficLimitBytes(server.trafficLimit)
  const rx = server.monthlyNetworkReceived
  const tx = server.monthlyNetworkTransmitted
  const quotaUsed = trafficUsageBytes(rx, tx, server.trafficCalculationType)
  const monthly = monthlyAverageCost(server)
  const priceText = server.price === null ? null : formatDisplayPrice(server.price, server.currency, server.billingCycle)
  const remaining = detailRemainingValue(server, now, finance)
  const memoryPercent = percent(server.memoryUsed, server.memoryTotal)
  const swapPercent = percent(server.swapUsed, server.swapTotal)
  const diskPercent = percent(server.diskUsed, server.diskTotal)
  const uploadSplit = splitMeasurement(formatDisplaySpeed(server.networkOutSpeed))
  const downloadSplit = splitMeasurement(formatDisplaySpeed(server.networkInSpeed))
  const trafficSplit = splitMeasurement(formatDisplayBytes(totalTraffic))
  const hasQuota = quotaLimit !== null && quotaUsed !== null
  const quotaPercent = hasQuota ? Math.min(100, quotaUsed / quotaLimit * 100) : null
  const card = (
    key: DetailCardKey,
    icon: IconName,
    label: string,
    value: string,
    unit = '',
    hint = '',
  ): PresentationCard => ({ key, icon, label, value, unit: unit || undefined, hint })

  /*
   * 逐条对应 Komari `getDetailMetricCard`：label、icon、value / unit 拆分与 tooltip 都取自上游。
   * 上游用 `-` 表示缺数据，本主题保持同一写法，不把缺失或超时写成 0。
   */
  const model: Record<DetailCardKey, PresentationCard | null> = {
    nodePrice: priceText === null ? null : (() => { const s = splitMetricValue(priceText); return card('nodePrice', 'tabler:cash', '节点价格', s.value, s.unit) })(),
    monthlyCost: monthly === null ? null : (() => { const s = splitMetricValue(monthly); return card('monthlyCost', 'tabler:receipt-2', '月均支出', s.value, s.unit) })(),
    remainingTime: server.expireDate === null ? null : (() => {
      const s = splitMetricValue(formatDetailExpireText(days))
      const status = detailExpireStatus(days)
      const tone = status === 'expired' || status === 'critical' ? 'danger'
        : status === 'warning' ? 'warning'
          : status === 'long_term' || status === 'unknown' ? 'muted' : 'ok'
      return { ...card('remainingTime', 'tabler:calendar-dollar', '剩余时间', s.value, s.unit), tone }
    })(),
    remainingValue: remaining === null ? null : card('remainingValue', 'tabler:coins', '剩余价值', remaining.value, remaining.unit, remaining.hint),
    cpuUsage: server.cpu === null ? null : card('cpuUsage', 'tabler:cpu', 'CPU 使用率', server.cpu.toFixed(1), '%'),
    gpuUsage: server.gpus.length === 0 ? null : card('gpuUsage', 'tabler:device-desktop-analytics', 'GPU 使用率', gpu === null ? '-' : gpu.toFixed(1), gpu === null ? '' : '%', server.gpus.map((item) => item.name).filter(Boolean).join('\n')),
    memoryUsage: memoryPercent === null ? null : card('memoryUsage', 'icon-park-outline:memory', '内存使用率', memoryPercent.toFixed(1), '%', `${formatDisplayMebibytes(server.memoryUsed)} / ${formatDisplayMebibytes(server.memoryTotal)}`),
    swapUsage: swapPercent === null ? null : card('swapUsage', 'icon-park-outline:switch', '交换内存', swapPercent.toFixed(1), '%', `${formatDisplayMebibytes(server.swapUsed)} / ${formatDisplayMebibytes(server.swapTotal)}`),
    diskUsage: diskPercent === null ? null : card('diskUsage', 'tabler:server-2', '硬盘使用率', diskPercent.toFixed(1), '%', `${formatDisplayMebibytes(server.diskUsed)} / ${formatDisplayMebibytes(server.diskTotal)}`),
    load: server.load1 === null ? null : card('load', 'tabler:chart-line', '系统负载', formatLoad(server.load1), '1m', `5m ${formatLoad(server.load5)} / 15m ${formatLoad(server.load15)}`),
    processes: server.processes === null ? null : card('processes', 'tabler:list-numbers', '进程数', formatCount(server.processes)),
    connections: server.tcpConnections === null && server.udpConnections === null ? null : card('connections', 'tabler:plug-connected', '连接数', formatCount((server.tcpConnections ?? 0) + (server.udpConnections ?? 0)), '', `TCP ${formatCount(server.tcpConnections)} / UDP ${formatCount(server.udpConnections)}`),
    uptime: server.bootTime === null ? null : card('uptime', 'tabler:clock-up', '运行时间', formatDetailUptime(server.bootTime, now)),
    uploadSpeed: server.networkOutSpeed === null ? null : card('uploadSpeed', 'tabler:chevrons-up', '实时上行', uploadSplit.value, uploadSplit.unit),
    downloadSpeed: server.networkInSpeed === null ? null : card('downloadSpeed', 'tabler:chevrons-down', '实时下行', downloadSplit.value, downloadSplit.unit),
    totalTraffic: totalTraffic === null ? null : card('totalTraffic', 'tabler:arrows-transfer-up-down', '累计流量', trafficSplit.value, trafficSplit.unit, `↑ ${formatDisplayBytes(server.networkTransmitted)} / ↓ ${formatDisplayBytes(server.networkReceived)}`),
    trafficQuota: !server.trafficLimit ? null
      : quotaLimit === null
        ? card('trafficQuota', 'tabler:gauge', '流量配额', '∞', '', '无限流量')
        : quotaUsed === null
          ? card('trafficQuota', 'tabler:gauge', '流量配额', MISSING_TEXT, '', `${MISSING_TEXT} / ${formatDisplayBytes(quotaLimit)}`)
          : card('trafficQuota', 'tabler:gauge', '流量配额', (quotaPercent ?? 0).toFixed(1), '%', `${formatDisplayBytes(quotaUsed)} / ${formatDisplayBytes(quotaLimit)}`),
  }
  return resolveDetailCardKeys(settings).flatMap((key) => model[key] ? [model[key] as PresentationCard] : [])
}
