import type { ProbeValue } from '@/types/cfsm'

/**
 * 缺失值占位符。Komari 界面上所有缺失值都显示 ASCII 短横 `-`
 * （NodeCard 剩余天数、`formatDateTime`、`getExpireText`、图表提示等），
 * 长破折号只出现在它的代码注释里。本主题此前统一写成 `—`，属于自定义写法，
 * 不是 CFSM 平台差异，因此按上游对齐；所有占位都从这里取，不在组件里另写字面量。
 */
export const MISSING_TEXT = '-'

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

function normalizedNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null
}
export function formatBytes(value: number | null, suffix = ''): string {
  const bytes = normalizedNumber(value)
  if (bytes === null) return MISSING_TEXT
  if (bytes === 0) return '0 B' + suffix

  // 不足 1 字节时对数为负，下标钳到 0（与 formatChartBytes 一致），否则单位会越界。
  const unitIndex = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    BYTE_UNITS.length - 1,
  )
  const scaled = bytes / (1024 ** unitIndex)
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return scaled.toFixed(digits) + ' ' + BYTE_UNITS[unitIndex] + suffix
}

export function formatMebibytes(value: number | null): string {
  const mebibytes = normalizedNumber(value)
  return mebibytes === null ? MISSING_TEXT : formatBytes(mebibytes * 1024 * 1024)
}

export function formatSpeed(value: number | null): string {
  return formatBytes(value, '/s')
}

export function formatPercent(value: number | null): string {
  const percentage = normalizedNumber(value)
  return percentage === null ? MISSING_TEXT : percentage.toFixed(1) + '%'
}

export function formatLoad(value: number | null): string {
  const load = normalizedNumber(value)
  return load === null ? MISSING_TEXT : load.toFixed(2)
}

export function formatCount(value: number | null): string {
  const count = normalizedNumber(value)
  return count === null ? MISSING_TEXT : Math.round(count).toLocaleString('zh-CN')
}

export function formatLatency(value: ProbeValue): string {
  if (value === null) return '超时'
  if (value === false) return MISSING_TEXT
  const latency = normalizedNumber(value)
  return latency === null ? MISSING_TEXT : latency.toFixed(latency >= 100 ? 0 : 1) + ' ms'
}

export function formatProbePercent(value: ProbeValue): string {
  if (value === null) return '超时'
  if (value === false) return MISSING_TEXT
  return formatPercent(value)
}

export function normalizeTimestampMilliseconds(value: number | null): number | null {
  const timestamp = normalizedNumber(value)
  if (timestamp === null || timestamp === 0) return null
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

export function formatTimestamp(value: number | null): string {
  const timestamp = normalizeTimestampMilliseconds(value)
  if (timestamp === null) return MISSING_TEXT
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return MISSING_TEXT
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatUptime(bootTime: number | null, now = Date.now()): string {
  const startedAt = normalizeTimestampMilliseconds(bootTime)
  if (startedAt === null || startedAt > now) return MISSING_TEXT
  const totalMinutes = Math.floor((now - startedAt) / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const NUMERIC_TIMESTAMP_PATTERN = /^\d{10,13}$/

function calendarDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const validation = new Date(Date.UTC(year, month - 1, day))
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
  ) return null
  return { year, month, day }
}

export function parseCfsmDate(value: string | null): Date | null {
  const candidate = value?.trim()
  if (!candidate) return null

  if (NUMERIC_TIMESTAMP_PATTERN.test(candidate)) {
    const timestamp = normalizeTimestampMilliseconds(Number(candidate))
    if (timestamp === null) return null
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const dateOnly = calendarDate(candidate)
  if (dateOnly) {
    return new Date(Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day, 12))
  }

  if (!ISO_DATE_TIME_PATTERN.test(candidate)) return null
  if (calendarDate(candidate.slice(0, 10)) === null) return null
  const timestamp = Date.parse(candidate)
  return Number.isNaN(timestamp) ? null : new Date(timestamp)
}

export function formatCfsmDate(value: string | null): string {
  const dateOnly = value ? calendarDate(value.trim()) : null
  if (dateOnly) {
    return `${dateOnly.year}/${String(dateOnly.month).padStart(2, '0')}/${String(dateOnly.day).padStart(2, '0')}`
  }
  const date = parseCfsmDate(value)
  if (date === null) return MISSING_TEXT
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function priceWithCycleLabel(
  price: string | null,
  currency: string | null,
  cycleLabel: string,
): string {
  const normalizedPrice = price?.trim()
  if (!normalizedPrice) return MISSING_TEXT
  const amount = Number(normalizedPrice)
  if (!Number.isFinite(amount)) return MISSING_TEXT
  if (amount === 0 || amount === -1) return '免费'
  if (amount < 0) return MISSING_TEXT
  const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(amount)
  const prefix = currency?.trim() ?? ''
  return `${prefix}${formatted}${cycleLabel ? ` / ${cycleLabel}` : ''}`
}

export function formatPrice(
  price: string | null,
  currency: string | null,
  billingCycle: string | null,
): string {
  return priceWithCycleLabel(price, currency, billingCycle?.trim() ?? '')
}

export function formatCurrencyValue(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return MISSING_TEXT
  const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
  return `${currency?.trim() ?? ''}${formatted}`
}

/*
 * ===== 展示层显示格式 =====
 *
 * Komari 的首页与详情页共用同一套字节与价格规则（上游两处都调用
 * `formatBytesWithConfig` / `formatPriceWithCycle`）：
 * 单位 B / KB / MB / GB / TB / PB，换算基数仍是 1024，
 * 精度 B 0、KB 0、MB 1、GB 1、TB 2，速度在单位后加 `/s`；
 * 计费周期显示为中文。
 *
 * 第 11 轮引入这组函数时它们只服务首页，因此叫 `formatHome*`；
 * 第 13 轮实测确认详情页用的是同一套规则，故改名为 `formatDisplay*`。
 * 只是改名，行为与首页输出完全不变。
 *
 * 运行时间是两页**唯一不同**的地方，各自单列：
 * 首页节点卡只到天（`formatHomeUptimeDays`），
 * 详情页到分钟且省略为零的单位（`formatDetailUptime`），
 * 节点列表到小时（沿用上面的 `formatUptime`）。
 *
 * 这些改动全部发生在展示层，normalized data model 不受影响。
 */

const DISPLAY_BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const
const DISPLAY_BYTE_DECIMALS: Readonly<Record<string, number>> = {
  B: 0,
  KB: 0,
  MB: 1,
  GB: 1,
  TB: 2,
  PB: 2,
}

/** 数值与单位分离，对应 Komari `formatBytesSplit`；总览卡片的 value / unit 两段就来自它。 */
export interface SplitAmount {
  readonly value: string
  readonly unit: string
}

export function formatDisplayBytesSplit(value: number | null): SplitAmount {
  const bytes = normalizedNumber(value)
  if (bytes === null) return { value: MISSING_TEXT, unit: '' }
  if (bytes === 0) return { value: '0', unit: 'B' }

  // 不足 1 字节时对数为负；不钳到 0 的话会落到下面的 'PB' 兜底，把 0.5 B 显示成 512.00 PB。
  const unitIndex = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    DISPLAY_BYTE_UNITS.length - 1,
  )
  const unit = DISPLAY_BYTE_UNITS[unitIndex] ?? 'PB'
  return { value: (bytes / 1024 ** unitIndex).toFixed(DISPLAY_BYTE_DECIMALS[unit] ?? 1), unit }
}

export function formatDisplaySpeedSplit(value: number | null): SplitAmount {
  const split = formatDisplayBytesSplit(value)
  return split.unit === '' ? split : { value: split.value, unit: `${split.unit}/s` }
}

function joinSplit(split: SplitAmount): string {
  return split.unit === '' ? split.value : `${split.value} ${split.unit}`
}

export function formatDisplayBytes(value: number | null): string {
  return joinSplit(formatDisplayBytesSplit(value))
}

export function formatDisplaySpeed(value: number | null): string {
  return joinSplit(formatDisplaySpeedSplit(value))
}

/** CFSM 的内存 / 硬盘用量以 MiB 上报，首页仍按 Komari 的显示规则渲染。 */
export function formatDisplayMebibytesSplit(value: number | null): SplitAmount {
  const mebibytes = normalizedNumber(value)
  return mebibytes === null
    ? { value: MISSING_TEXT, unit: '' }
    : formatDisplayBytesSplit(mebibytes * 1024 * 1024)
}

export function formatDisplayMebibytes(value: number | null): string {
  return joinSplit(formatDisplayMebibytesSplit(value))
}

/** Komari NodeCard 的运行时间只显示整天数（`在线 N 天`），不显示小时。 */
export function formatHomeUptimeDays(bootTime: number | null, now = Date.now()): string {
  const startedAt = normalizeTimestampMilliseconds(bootTime)
  if (startedAt === null || startedAt > now) return MISSING_TEXT
  return `在线 ${Math.floor((now - startedAt) / 86_400_000)} 天`
}

/*
 * CFSM 的 `billing_cycle` 是自由文本。官方枚举值可以安全本地化；
 * 其它取值原样保留，不猜测它代表哪个周期。
 */
const DISPLAY_BILLING_CYCLE_LABELS: Readonly<Record<string, string>> = {
  month: '月',
  quarter: '季',
  half_year: '半年',
  year: '年',
  two_years: '两年',
  three_years: '三年',
  four_years: '四年',
  five_years: '五年',
}

export function formatDisplayBillingCycle(billingCycle: string | null): string {
  const cycle = billingCycle?.trim()
  if (!cycle) return ''
  return DISPLAY_BILLING_CYCLE_LABELS[cycle.toLowerCase()] ?? cycle
}

export function formatDisplayPrice(
  price: string | null,
  currency: string | null,
  billingCycle: string | null,
): string {
  return priceWithCycleLabel(price, currency, formatDisplayBillingCycle(billingCycle))
}

/*
 * ===== 详情页专用显示格式 =====
 *
 * 只有运行时间与到期文案在上游详情页与首页不同，这里单列。
 */

const DETAIL_UPTIME_UNITS = [
  { seconds: 86_400, label: '天' },
  { seconds: 3_600, label: '小时' },
  { seconds: 60, label: '分钟' },
] as const

/**
 * 对应 Komari `formatUptimeWithFormat(seconds, 'minute')`：
 * 最细到分钟，值为 0 的单位直接省略（所以是 `3 天` 而不是 `3 天 0 小时`），
 * 不足一分钟显示「不足 1 分钟」。
 */
export function formatDetailUptime(bootTime: number | null, now = Date.now()): string {
  const startedAt = normalizeTimestampMilliseconds(bootTime)
  if (startedAt === null || startedAt > now) return MISSING_TEXT

  let remaining = Math.floor((now - startedAt) / 1000)
  const parts: string[] = []
  for (const unit of DETAIL_UPTIME_UNITS) {
    const amount = Math.floor(remaining / unit.seconds)
    if (amount > 0) {
      parts.push(`${amount} ${unit.label}`)
      remaining %= unit.seconds
    }
  }
  return parts.length > 0 ? parts.join(' ') : '不足 1 分钟'
}

export type ExpireStatus = 'unknown' | 'expired' | 'critical' | 'warning' | 'normal' | 'long_term'

/** 阈值取自 Komari `EXPIRE_THRESHOLDS`：5 天内 critical、10 天内 warning、超过 36500 天视为长期。 */
export function detailExpireStatus(days: number | null): ExpireStatus {
  if (days === null) return 'unknown'
  if (days <= 0) return 'expired'
  if (days <= 5) return 'critical'
  if (days <= 10) return 'warning'
  if (days > 36_500) return 'long_term'
  return 'normal'
}

/** 对应 Komari `getExpireText`：未知 `-`、已过期、长期，否则 `N 天`。 */
export function formatDetailExpireText(days: number | null): string {
  switch (detailExpireStatus(days)) {
    case 'unknown': return '-'
    case 'expired': return '已过期'
    case 'long_term': return '长期'
    default: return `${days} 天`
  }
}
