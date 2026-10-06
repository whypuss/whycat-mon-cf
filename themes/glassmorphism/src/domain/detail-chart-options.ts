import { LIVE_SEED_HOURS, type ChartRow } from '@/domain/server-detail'
import { countMasked, detectSpikes } from '@/domain/spike-mask'
import type { ChartFamily } from '@/domain/theme-presentation'
import type { HistoryHours } from '@/services/cfsm'
import type { HistoryPoint, ProbeTarget, ProbeValue } from '@/types/cfsm'
import {
  ACCESSIBLE_LINE_TYPES,
  type ChartLineType,
  type ChartThemeColors,
  type LoadChartPalette,
} from '@/utils/chart-palette'

/*
 * 详情页图表的 ECharts option，逐个对照 Komari Glassmorphism（bf83765）的
 * `LoadChart.vue` / `PingChart.vue` / `MetricSeriesChartCard.vue` 移植：
 * 坐标轴、网格边距、图例、tooltip 结构，以及每条序列的配色角色、线宽、线帽、
 * 虚线与面积填充都照抄上游。
 *
 * 只因数据真实性而与上游不同的地方：
 * 1. 上游网络 / 连接数 / 进程序列把缺失写成 0（`r.net_in ?? 0`），这里保持 null，
 *    `connectNulls: false` 让折线在缺失处断开，不把「没有采样」画成 0；
 * 2. 上游延迟图对空值做线性插值（`interpolateNullsLinear`），「平滑峰值」还会用
 *    EWMA 改写数值；这里两者都不做，开关只改变曲线的绘制曲率；
 * 3. 缺口标记（`ChartRow.point === null`）的 tooltip 明确写出没有采样；
 * 4. tooltip 是 HTML，节点侧文字（探测目标名、GPU 名）先转义再拼接。
 *
 * 颜色一律是具体值：ECharts 走 CanvasRenderer，canvas 不解析 CSS 变量。
 */

export type MetricChartTone = 'rose' | 'amber' | 'emerald' | 'cyan' | 'sky' | 'violet' | 'orange' | 'slate'

/** 范围标签沿用上游写法（`1 天` 而不是 `24 小时`）；可选的时段仍只有 CFSM 支持的这些。 */
export const HISTORY_RANGE_LABELS: Record<HistoryHours, string> = {
  0.167: '10 分钟',
  0.5: '30 分钟',
  1: '1 小时',
  6: '6 小时',
  12: '12 小时',
  24: '1 天',
  48: '2 天',
  96: '4 天',
  168: '7 天',
}

/**
 * 负载图时间格式所用的时段。上游「实时」档位没有时段（`selectedHours ?? 4`），坐标轴只显示
 * 时刻、tooltip 精确到秒；这里的实时档位同样不沿用上一次选中的历史窗口。
 */
export function loadChartHours(liveMode: boolean, historyHours: number): number {
  return liveMode ? LIVE_SEED_HOURS : historyHours
}

export interface LoadChartContext {
  rows: readonly ChartRow[]
  hours: number
  load: LoadChartPalette
  series: readonly string[]
  theme: ChartThemeColors
}

type Value = number | null

interface AxisTooltipItem {
  dataIndex: number
  seriesName: string
  value?: Value
  color: string
}

const MEBIBYTE = 1024 * 1024
const CHART_MARGIN = { top: 30, right: 24, bottom: 32, left: 56 }
const CHART_MARGIN_WITH_LEGEND = { top: 30, right: 24, bottom: 52, left: 56 }
const PING_CHART_MARGIN = { top: 30, right: 24, bottom: 52, left: 56 }
/** 上游进程图的填充是写死的紫色，色觉友好模式下也不变。 */
const PROCESS_AREA = ['rgba(167, 139, 250, 0.25)', 'rgba(167, 139, 250, 0.02)'] as const
const GAP_TEXT = '该时段没有采样'
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/** 上游 `utils/helper.ts` 的 `formatBytes(bytes, decimals = 1)`，坐标轴与 tooltip 都用它。 */
export function formatChartBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const index = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    BYTE_UNITS.length - 1,
  )
  return `${(bytes / 1024 ** index).toFixed(decimals)} ${BYTE_UNITS[index]}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 上游 `formatTime`：`M/D HH:mm` 或 `HH:mm`，时段 ≥ 24 小时带日期。 */
export function formatAxisTime(timestamp: number, showDate: boolean): string {
  const date = new Date(timestamp)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return showDate ? `${date.getMonth() + 1}/${date.getDate()} ${time}` : time
}

/** 上游 `formatTimeForTooltip`：24 小时以内到秒，否则 `MM/DD HH:mm`。 */
export function formatTooltipTime(timestamp: number, hours: number): string {
  const date = new Date(timestamp)
  if (hours < 24) return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

function finite(value: unknown): Value {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pick(row: ChartRow, getter: (point: HistoryPoint) => unknown): Value {
  return row.point ? finite(getter(row.point)) : null
}

function fromMebibytes(value: Value): Value {
  return value === null ? null : value * MEBIBYTE
}

function fixed(value: Value | undefined, digits: number, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '-'
}

function rounded(value: Value | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '-'
}

function speed(value: Value | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatChartBytes(value)}/s` : '-'
}

function hasValue(data: readonly Value[]): boolean {
  return data.some((value) => value !== null)
}

/** 最后一个真实采样（跳过缺口标记），对应上游卡片头部取的 `latestStatus`。 */
export function latestPoint(rows: readonly ChartRow[]): HistoryPoint | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const point = rows[index]?.point
    if (point) return point
  }
  return null
}

/** GPU 平均使用率：上游在后端没给 `gpu_usage` 时同样取各设备使用率的算术平均。 */
export function gpuAverage(point: HistoryPoint): Value {
  const values = point.gpus
    .map((gpu) => finite(gpu.utilization))
    .filter((value): value is number => value !== null)
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export interface GpuDevice {
  id: string
  name: string
}

export function gpuDevices(rows: readonly ChartRow[]): GpuDevice[] {
  const devices = new Map<string, string>()
  for (const row of rows) {
    for (const gpu of row.point?.gpus ?? []) {
      if (!devices.has(gpu.id)) devices.set(gpu.id, gpu.name.trim() || `GPU ${gpu.id}`)
    }
  }
  return [...devices.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => {
      const leftIndex = Number(left.id)
      const rightIndex = Number(right.id)
      return Number.isFinite(leftIndex) && Number.isFinite(rightIndex) ? leftIndex - rightIndex : 0
    })
}

/* ==================== 公共片段（照抄上游 LoadChart） ==================== */

function dot(color: string, radius = '50%'): string {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:${radius};background:${color};margin-right:8px;flex-shrink:0"></span>`
}

/** 标签在这里统一转义：系列名可能来自运营者填写的文本（探测目标、GPU 型号），调用方不必各自处理。 */
function tooltipLine(color: string, label: string, value: string, radius?: string): string {
  return `<div style="display:flex;align-items:center">${dot(color, radius)}<span>${escapeHtml(label)}</span><span style="margin-left:auto;font-weight:600;margin-left:16px">${value}</span></div>`
}

function tooltipFrame(theme: ChartThemeColors, time: string, body: string): string {
  return `<div style="font-weight:600;margin-bottom:6px;color:${theme.textSecondary}">${time}</div>`
    + `<div style="display:flex;flex-direction:column;gap:4px">${body}</div>`
}

interface TooltipContext {
  rows: readonly ChartRow[]
  hours: number
  theme: ChartThemeColors
}

function axisTooltip(
  context: TooltipContext,
  render: (items: AxisTooltipItem[], point: HistoryPoint) => string,
) {
  return (params: unknown): string => {
    const items = (Array.isArray(params) ? params : [params]) as AxisTooltipItem[]
    const first = items[0]
    const row = first ? context.rows[first.dataIndex] : undefined
    if (!row) return ''
    const time = formatTooltipTime(row.timestamp, context.hours)
    return tooltipFrame(context.theme, time, row.point
      ? render(items, row.point)
      : `<div style="color:${context.theme.textSecondary}">${GAP_TEXT}</div>`)
  }
}

/** 上游 `baseTooltipConfig`（LoadChart 与 PingChart 相同）。 */
export function baseTooltip(theme: ChartThemeColors) {
  return {
    trigger: 'axis' as const,
    confine: false,
    backgroundColor: theme.tooltipBg,
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 6,
    textStyle: { color: theme.text, fontSize: 12, lineHeight: 20 },
    extraCssText: `backdrop-filter: blur(5px);z-index:9;box-shadow:0 0 0 1px ${theme.tooltipShadow}, 0 0 16px ${theme.tooltipShadow}`,
    axisPointer: {
      type: 'cross' as const,
      crossStyle: { color: theme.textTertiary },
      lineStyle: { color: theme.crosshairColor, width: 1, type: 'dashed' as const },
      shadowStyle: { color: theme.crosshairColor },
    },
  }
}

/** 上游 `baseXAxisConfig`：类目轴，标签是采样时刻。 */
function categoryAxis(rows: readonly ChartRow[], hours: number, theme: ChartThemeColors) {
  const showDate = hours >= 24
  return {
    type: 'category' as const,
    data: rows.map((row) => formatAxisTime(row.timestamp, showDate)),
    axisLabel: { fontSize: 11, color: theme.textSecondary, margin: 12 },
    axisLine: { show: true, lineStyle: { color: theme.borderColor, width: 1 } },
    axisTick: { show: false },
    boundaryGap: false,
  }
}

/** 上游 `baseYAxisConfig`。 */
function valueAxis(theme: ChartThemeColors) {
  return {
    type: 'value' as const,
    axisLabel: { fontSize: 11, color: theme.textSecondary },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: theme.splitLineColor, type: 'dashed' as const } },
  }
}

function axisName(theme: ChartThemeColors, name: string, padding: [number, number, number, number]) {
  return { name, nameTextStyle: { color: theme.textSecondary, padding } }
}

interface LineSpec {
  name: string
  data: Value[]
  color: string
  width?: number
  dashed?: boolean
  area?: readonly [string, string]
  yAxisIndex?: number
}

function areaGradient([strong, faint]: readonly [string, string]) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: strong },
      { offset: 1, color: faint },
    ],
  }
}

function line(spec: LineSpec) {
  return {
    name: spec.name,
    type: 'line' as const,
    data: spec.data,
    showSymbol: false,
    connectNulls: false,
    ...(spec.yAxisIndex === undefined ? {} : { yAxisIndex: spec.yAxisIndex }),
    lineStyle: {
      width: spec.width ?? 1.5,
      ...(spec.dashed ? { type: 'dashed' as const } : {}),
      color: spec.color,
      cap: 'round' as const,
    },
    // 上游只写了 lineStyle；tooltip 色点取 series 的视觉色，这里一并写死保证同源。
    itemStyle: { color: spec.color },
    ...(spec.area ? { areaStyle: { color: areaGradient(spec.area) } } : {}),
  }
}

/** 内存 / 磁盘图的小图例。 */
function compactLegend(theme: ChartThemeColors, names: string[]) {
  return {
    data: names,
    bottom: 4,
    itemWidth: 10,
    itemHeight: 8,
    textStyle: { fontSize: 10, color: theme.textSecondary },
  }
}

/** 网络 / GPU / 连接数图的圆角方块图例。 */
function roundLegend(theme: ChartThemeColors, names: string[]) {
  return {
    data: names,
    bottom: 4,
    itemWidth: 12,
    itemHeight: 12,
    itemGap: 20,
    icon: 'roundRect',
    textStyle: { fontSize: 11, color: theme.textSecondary },
  }
}

function bytesText(mebibytes: Value | undefined): string {
  const value = finite(mebibytes)
  return value === null ? '-' : formatChartBytes(value * MEBIBYTE)
}

function usageText(usedMebibytes: Value | undefined, totalMebibytes: Value | undefined): string {
  const used = finite(usedMebibytes)
  if (used === null) return '-'
  const total = finite(totalMebibytes)
  const text = formatChartBytes(used * MEBIBYTE)
  return total !== null && total > 0 ? `${text} (${((used / total) * 100).toFixed(1)}%)` : text
}

/* ==================== LoadChart 内联卡片 ==================== */

const INLINE_CARD_FIELDS = {
  cpu: (point: HistoryPoint) => finite(point.cpu) !== null || finite(point.load1) !== null,
  memory: (point: HistoryPoint) => finite(point.memoryUsed) !== null,
  disk: (point: HistoryPoint) => finite(point.diskUsed) !== null,
  network: (point: HistoryPoint) => finite(point.networkInSpeed) !== null || finite(point.networkOutSpeed) !== null,
  gpu: (point: HistoryPoint) => point.gpus.some((gpu) => finite(gpu.utilization) !== null),
  connections: (point: HistoryPoint) => finite(point.tcpConnections) !== null || finite(point.udpConnections) !== null,
  process: (point: HistoryPoint) => finite(point.processes) !== null,
  diskIo: (point: HistoryPoint) => point.diskIo !== undefined,
} satisfies Record<string, (point: HistoryPoint) => boolean>

export type InlineCardKey = keyof typeof INLINE_CARD_FIELDS

/**
 * 上游在模板里的卡片一律渲染，缺数据时画一条 0 线；CFSM 缺失的指标不画成 0，
 * 整张卡在所选时段里没有任何真实采样时就不出现。
 */
export function inlineCardHasData(rows: readonly ChartRow[], key: InlineCardKey): boolean {
  return rows.some((row) => row.point !== null && INLINE_CARD_FIELDS[key](row.point))
}

export interface LoadCardSeriesCounts {
  traffic: number
  ping: number
  pingLoss: number
}

/**
 * 上游 `isChartCardEnabled`：卡片要在「历史图表方案」里，GPU 还要打开 GPU 图表开关。
 * 在此之上多一条：所选时段里没有任何真实采样的卡片不出现（上游会画一条 0 线）。
 * 返回顺序与方案顺序一致。
 */
export function visibleLoadCards(
  families: readonly ChartFamily[],
  rows: readonly ChartRow[],
  gpuEnabled: boolean,
  counts: LoadCardSeriesCounts,
): ChartFamily[] {
  return families.filter((key) => {
    switch (key) {
      case 'gpu':
        return gpuEnabled && inlineCardHasData(rows, 'gpu')
      case 'traffic':
        return counts.traffic > 0
      case 'ping':
        return counts.ping > 0
      case 'pingLoss':
        return counts.pingLoss > 0
      default:
        return inlineCardHasData(rows, key)
    }
  })
}

export function cpuChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.primary, load.secondary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items) => items.map((item) => (
        item.seriesName === 'CPU'
          ? tooltipLine(item.color, 'CPU', fixed(item.value, 1, '%'))
          : tooltipLine(item.color, '系统负载', fixed(item.value, 2))
      )).join('')),
    },
    grid: CHART_MARGIN,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: [
      {
        ...y,
        ...axisName(theme, 'CPU %', [0, 40, 0, 0]),
        min: 0,
        max: 100,
        axisLabel: { ...y.axisLabel, formatter: '{value}%' },
      },
      {
        ...y,
        ...axisName(theme, '负载', [0, 0, 0, 40]),
        min: 0,
        splitLine: { show: false },
      },
    ],
    series: [
      line({
        name: 'CPU',
        data: rows.map((row) => pick(row, (point) => point.cpu)),
        color: load.primary,
        area: [load.primaryAreaStrong, load.primaryAreaFaint],
        yAxisIndex: 0,
      }),
      line({
        name: '负载',
        data: rows.map((row) => pick(row, (point) => point.load1)),
        color: load.secondary,
        yAxisIndex: 1,
      }),
    ],
  }
}

export function memoryChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const swapTotal = rows.map((row) => fromMebibytes(pick(row, (point) => point.swapTotal)))
  // 没有交换分区（总量为 0 或从未上报）时不画 Swap 两条线，不把「没有」画成 0。
  const withSwap = swapTotal.some((value) => value !== null && value > 0)
  const series = [
    line({
      name: 'RAM',
      data: rows.map((row) => fromMebibytes(pick(row, (point) => point.memoryUsed))),
      color: load.primary,
      area: [load.primaryAreaStrong, load.primaryAreaFaint],
    }),
    line({
      name: 'RAM 总量',
      data: rows.map((row) => fromMebibytes(pick(row, (point) => point.memoryTotal))),
      color: load.quinary,
      width: 1.2,
      dashed: true,
    }),
    ...(withSwap
      ? [
          line({
            name: 'Swap',
            data: rows.map((row) => fromMebibytes(pick(row, (point) => point.swapUsed))),
            color: load.secondary,
          }),
          line({ name: 'Swap 总量', data: swapTotal, color: load.quaternary, width: 1.2, dashed: true }),
        ]
      : []),
  ]
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.primary, load.quinary, load.secondary, load.quaternary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items, point) => items.map((item) => {
        switch (item.seriesName) {
          case 'RAM': return tooltipLine(item.color, 'RAM', usageText(point.memoryUsed, point.memoryTotal))
          case 'RAM 总量': return tooltipLine(item.color, 'RAM 总量', bytesText(point.memoryTotal))
          case 'Swap': return tooltipLine(item.color, 'Swap', usageText(point.swapUsed, point.swapTotal))
          default: return tooltipLine(item.color, 'Swap 总量', bytesText(point.swapTotal))
        }
      }).join('')),
    },
    legend: compactLegend(theme, series.map((item) => item.name)),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '内存', [0, 40, 0, 0]),
      axisLabel: { ...y.axisLabel, formatter: (value: number) => formatChartBytes(value) },
    },
    series,
  }
}

export function diskChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.tertiary, load.quinary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items, point) => items.map((item) => (
        item.seriesName === '磁盘总量'
          ? tooltipLine(item.color, '磁盘总量', bytesText(point.diskTotal), '2px')
          : tooltipLine(item.color, '磁盘已用', usageText(point.diskUsed, point.diskTotal), '2px')
      )).join('')),
    },
    legend: compactLegend(theme, ['磁盘已用', '磁盘总量']),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '磁盘', [0, 40, 0, 0]),
      axisLabel: { ...y.axisLabel, formatter: (value: number) => formatChartBytes(value) },
    },
    series: [
      line({
        name: '磁盘已用',
        data: rows.map((row) => fromMebibytes(pick(row, (point) => point.diskUsed))),
        color: load.tertiary,
        area: [load.tertiaryAreaStrong, load.tertiaryAreaFaint],
      }),
      line({
        name: '磁盘总量',
        data: rows.map((row) => fromMebibytes(pick(row, (point) => point.diskTotal))),
        color: load.quinary,
        width: 1.2,
        dashed: true,
      }),
    ],
  }
}

export function networkChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.quinary, load.quaternary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items) => items.map((item) => (
        tooltipLine(item.color, item.seriesName === '下载' ? '↓ 下载' : '↑ 上传', speed(item.value))
      )).join('')),
    },
    legend: roundLegend(theme, ['下载', '上传']),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '速度', [0, 40, 0, 0]),
      axisLabel: { ...y.axisLabel, formatter: (value: number) => formatChartBytes(value) },
    },
    series: [
      line({ name: '下载', data: rows.map((row) => pick(row, (point) => point.networkInSpeed)), color: load.quinary }),
      line({ name: '上传', data: rows.map((row) => pick(row, (point) => point.networkOutSpeed)), color: load.quaternary }),
    ],
  }
}

export function gpuChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const deviceSeries = gpuDevices(rows)
    .map((device, index) => line({
      name: device.name,
      data: rows.map((row) => finite(row.point?.gpus.find((gpu) => gpu.id === device.id)?.utilization)),
      color: context.series[index % context.series.length] ?? load.senary,
      width: 1.2,
      dashed: true,
    }))
    .filter((item) => hasValue(item.data))
  /*
   * 上游第二条是「显存使用率」。CFSM 的 `gpu_info` 只有使用率、没有显存，
   * 这条序列与它的图例一并不出现，而不是画一条不存在的线。
   */
  const series = [
    line({ name: 'GPU 使用率', data: rows.map((row) => (row.point ? gpuAverage(row.point) : null)), color: load.senary }),
    ...deviceSeries,
  ]
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.senary, load.quaternary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items, point) => {
        const lines = items.map((item) => tooltipLine(item.color, item.seriesName, fixed(item.value, 1, '%'))).join('')
        if (point.gpus.length === 0) return lines
        const details = point.gpus.map((gpu) => (
          `<div style="display:flex;align-items:center;gap:8px;color:${theme.textSecondary}"><span>${escapeHtml(gpu.name.trim() || `GPU ${gpu.id}`)}</span><span style="margin-left:auto">${fixed(gpu.utilization, 1, '%')}</span></div>`
        )).join('')
        return `${lines}<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${theme.splitLineColor}">${details}</div>`
      }),
    },
    legend: roundLegend(theme, series.map((item) => item.name)),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, 'GPU %', [0, 40, 0, 0]),
      min: 0,
      max: 100,
      axisLabel: { ...y.axisLabel, formatter: '{value}%' },
    },
    series,
  }
}

export function connectionsChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const series = [
    line({ name: 'TCP', data: rows.map((row) => pick(row, (point) => point.tcpConnections)), color: load.primary }),
    line({ name: 'UDP', data: rows.map((row) => pick(row, (point) => point.udpConnections)), color: load.tertiary }),
  ].filter((item) => hasValue(item.data))
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.primary, load.tertiary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items) => items.map((item) => (
        tooltipLine(item.color, item.seriesName, rounded(item.value))
      )).join('')),
    },
    legend: roundLegend(theme, series.map((item) => item.name)),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '连接数', [0, 40, 0, 0]),
      min: 0,
      axisLabel: { ...y.axisLabel, formatter: (value: number) => Math.round(value).toString() },
    },
    series,
  }
}

export function processChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.quaternary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items) => {
        const first = items[0]
        return first ? tooltipLine(first.color, '进程数', rounded(first.value)) : ''
      }),
    },
    grid: CHART_MARGIN,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '进程', [0, 40, 0, 0]),
      min: 0,
      axisLabel: { ...y.axisLabel, formatter: (value: number) => Math.round(value).toString() },
    },
    series: [
      line({
        name: '进程数',
        data: rows.map((row) => pick(row, (point) => point.processes)),
        color: load.quaternary,
        area: PROCESS_AREA,
      }),
    ],
  }
}

/**
 * CFSM 独有的磁盘 IO 卡。上游没有对应组件，这里沿用网络卡的形态
 * （双线、圆角方块图例、速度坐标轴），读 / 写取角色板里与语义不冲突的两色。
 */
export function diskIoChartOption(context: LoadChartContext) {
  const { load, theme, rows } = context
  const y = valueAxis(theme)
  return {
    animation: false,
    color: [load.tertiary, load.quaternary],
    tooltip: {
      ...baseTooltip(theme),
      formatter: axisTooltip(context, (items, point) => {
        const lines = items.map((item) => tooltipLine(item.color, item.seriesName, speed(item.value))).join('')
        const io = point.diskIo
        if (!io) return lines
        const detail = [
          `读 IOPS ${rounded(io.readIops)}`,
          `写 IOPS ${rounded(io.writeIops)}`,
          `Await ${fixed(io.awaitMs, 1, ' ms')}`,
          `Util ${fixed(io.utilization, 1, '%')}`,
        ].join(' · ')
        return `${lines}<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${theme.splitLineColor};color:${theme.textSecondary}">${detail}</div>`
      }),
    },
    legend: roundLegend(theme, ['读取', '写入']),
    grid: CHART_MARGIN_WITH_LEGEND,
    xAxis: categoryAxis(rows, context.hours, theme),
    yAxis: {
      ...y,
      ...axisName(theme, '速度', [0, 40, 0, 0]),
      axisLabel: { ...y.axisLabel, formatter: (value: number) => formatChartBytes(value) },
    },
    series: [
      line({ name: '读取', data: rows.map((row) => finite(row.point?.diskIo?.readBps)), color: load.tertiary }),
      line({ name: '写入', data: rows.map((row) => finite(row.point?.diskIo?.writeBps)), color: load.quaternary }),
    ],
  }
}

/* ==================== MetricSeriesChartCard（流量 / Ping / 丢包） ==================== */

export type MetricValueKind = 'bytes' | 'bytesPerSecond' | 'count' | 'milliseconds' | 'percent'

export interface MetricSeriesData {
  name: string
  color: string
  kind: MetricValueKind
  data: Array<[number, Value]>
  dashed?: boolean
}

/** 上游 `MetricSeriesChartCard.formatMetricValue`。 */
export function formatMetricValue(value: Value | undefined, kind: MetricValueKind): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  switch (kind) {
    case 'bytes':
      return formatChartBytes(value)
    case 'bytesPerSecond':
      return `${formatChartBytes(value)}/s`
    case 'milliseconds':
      return `${value.toFixed(value >= 100 ? 0 : 1)} ms`
    case 'percent':
      return `${value.toFixed(1)}%`
    default:
      return Math.round(value).toLocaleString('zh-CN')
  }
}

/** 上游 `latestText`：第一条有数值的序列的最后一个值。 */
export function metricSeriesLatestText(series: readonly MetricSeriesData[]): string {
  for (const item of series) {
    const point = [...item.data].reverse().find(([, value]) => value !== null && Number.isFinite(value))
    if (point) return `${item.name} ${formatMetricValue(point[1], item.kind)}`
  }
  return '-'
}

/*
 * 上游这个组件的 option 里写的是 `var(--color-popover)` 等 CSS 变量——
 * 正是本主题第 15 轮修掉的「canvas 不解析 CSS 变量」问题，上游自己也受影响。
 * 这里换成与 LoadChart 同源的具体色值，结构与数值照旧。
 */
export function metricSeriesChartOption(
  series: readonly MetricSeriesData[],
  theme: ChartThemeColors,
  percentScale = false,
) {
  const primaryKind = series[0]?.kind ?? 'count'
  return {
    animation: false,
    color: series.map((item) => item.color),
    tooltip: {
      trigger: 'axis' as const,
      confine: true,
      backgroundColor: theme.tooltipBg,
      borderColor: theme.borderColor,
      borderWidth: 1,
      textStyle: { color: theme.text, fontSize: 12 },
      formatter: (params: unknown): string => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          axisValueLabel?: string
          color: string
          data?: [number, Value]
          seriesIndex: number
          seriesName: string
        }>
        if (items.length === 0) return ''
        const rows = items.map((item) => {
          const kind = series[item.seriesIndex]?.kind ?? primaryKind
          return `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${item.color};flex:none"></span><span>${escapeHtml(item.seriesName)}</span><strong style="margin-left:auto;padding-left:12px">${formatMetricValue(item.data?.[1], kind)}</strong></div>`
        }).join('')
        return `<div style="margin-bottom:6px;color:${theme.textSecondary}">${escapeHtml(items[0]?.axisValueLabel ?? '')}</div><div style="display:flex;flex-direction:column;gap:4px">${rows}</div>`
      },
    },
    legend: {
      type: 'scroll' as const,
      bottom: 2,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: theme.textSecondary, fontSize: 10 },
    },
    grid: { top: 20, right: 18, bottom: 48, left: 58 },
    xAxis: {
      type: 'time' as const,
      axisLine: { lineStyle: { color: theme.borderColor } },
      axisTick: { show: false },
      axisLabel: { color: theme.textSecondary, fontSize: 10, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      min: percentScale ? 0 : undefined,
      max: percentScale ? 100 : undefined,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.textSecondary,
        fontSize: 10,
        formatter: (value: number) => formatMetricValue(value, primaryKind),
      },
      splitLine: { lineStyle: { color: theme.borderColor, opacity: 0.45 } },
    },
    series: series.map((item) => ({
      name: item.name,
      type: 'line' as const,
      data: item.data,
      connectNulls: false,
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 1.6, type: item.dashed ? ('dashed' as const) : ('solid' as const), color: item.color },
      itemStyle: { color: item.color },
    })),
  }
}

function seriesHasData(series: MetricSeriesData): boolean {
  return series.data.some(([, value]) => value !== null && Number.isFinite(value))
}

/** 上游「累计与周期流量」卡：累计下载 = quinary、累计上传 = quaternary。CFSM 没有周期流量历史。 */
export function trafficSeries(context: LoadChartContext): MetricSeriesData[] {
  const { load, rows } = context
  return [
    { name: '累计下载', color: load.quinary, kind: 'bytes' as const, data: rows.map((row): [number, Value] => [row.timestamp, pick(row, (point) => point.networkReceived)]) },
    { name: '累计上传', color: load.quaternary, kind: 'bytes' as const, data: rows.map((row): [number, Value] => [row.timestamp, pick(row, (point) => point.networkTransmitted)]) },
  ].filter(seriesHasData)
}

export interface ProbeSeriesTarget {
  target: ProbeTarget
  label: string
}

function probeNumber(value: ProbeValue | undefined): Value {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 上游 `pingSeries`：按探测目标出序列，颜色取序列板，色觉友好模式下奇数条改虚线。
 * `null`（超时）与 `false`（未配置）都不进入数值序列。
 */
export function probeSeries(
  rows: readonly ChartRow[],
  targets: readonly ProbeSeriesTarget[],
  metric: 'latency' | 'packetLoss',
  palette: readonly string[],
  accessible: boolean,
): MetricSeriesData[] {
  return targets
    .map((entry, index): MetricSeriesData => ({
      name: entry.label,
      color: palette[index % palette.length] ?? '#FF6B6B',
      kind: metric === 'packetLoss' ? 'percent' : 'milliseconds',
      dashed: accessible && index % 2 === 1,
      data: rows.map((row): [number, Value] => [row.timestamp, probeNumber(row.point?.[metric][entry.target])]),
    }))
    .filter(seriesHasData)
}

/* ==================== PingChart 大图 ==================== */

export interface PingTaskLine {
  target: ProbeTarget
  label: string
  color: string
}

interface PingTooltipItem {
  seriesName: string
  value?: Value
  dataIndex: number
}

export interface PingChartContext {
  rows: readonly ChartRow[]
  hours: number
  theme: ChartThemeColors
  /** 全部任务，决定颜色顺序（上游按任务在完整列表里的位置取色）。 */
  tasks: readonly PingTaskLine[]
  /** 当前选中的任务，决定画哪些线与线型轮换。 */
  selected: readonly PingTaskLine[]
  accessible: boolean
  /** 「隐藏尖峰」开关。缺省为关，与此前版本等价。 */
  hideSpikes?: boolean
  /** 每条线路的遮蔽数组，由 `pingSpikeMasks` 从原始行算出；与 `rows` 等长。 */
  spikeMasks?: ReadonlyMap<ProbeTarget, readonly boolean[]>
  /** 图例的显示状态（按线路名）。缺省视为全部显示。 */
  legendSelected?: Readonly<Record<string, boolean>>
}

/*
 * 「隐藏尖峰」只作用于绘图副本：
 * - 遮蔽集合从**原始行**按线路逐条算出，与图例、选中状态无关；
 * - 被遮蔽的位置在副本里写成 null 占位，不删点，横轴与时间映射不变；
 * - `connectNulls` 仍为 false，线在遮蔽处断开，不跨过去连线；
 * - 统计值、任务卡、首页口径都不经过这里。
 */
export function pingSpikeMasks(
  rows: readonly ChartRow[],
  tasks: readonly Pick<PingTaskLine, 'target'>[],
): Map<ProbeTarget, boolean[]> {
  return new Map(tasks.map((task) => [
    task.target,
    detectSpikes(rows.map((row) => ({
      timestamp: row.timestamp,
      value: probeNumber(row.point?.latency[task.target]),
    }))),
  ]))
}

function legendVisible(legend: Readonly<Record<string, boolean>> | undefined, label: string): boolean {
  return legend?.[label] !== false
}

/** 按钮上的 N：只数当前实际画出来的线路（已选中且图例未关闭）里被遮蔽的点。 */
export function visibleSpikeCount(
  selected: readonly PingTaskLine[],
  masks: ReadonlyMap<ProbeTarget, readonly boolean[]>,
  legend?: Readonly<Record<string, boolean>>,
): number {
  return selected
    .filter((task) => legendVisible(legend, task.label))
    .reduce((total, task) => total + countMasked(masks.get(task.target)), 0)
}

export function pingChartOption(context: PingChartContext) {
  const { theme } = context
  // 上游在一个任务都没选时直接返回空数据，图表只剩坐标框。
  const rows = context.selected.length > 0 ? context.rows : []
  const showDate = context.hours >= 24
  const colorByName = new Map(context.tasks.map((task) => [task.label, task.color]))
  const hideSpikes = context.hideSpikes === true
  const series = context.selected.map((task, index) => {
    const lineType: ChartLineType = context.accessible
      ? ACCESSIBLE_LINE_TYPES[index % ACCESSIBLE_LINE_TYPES.length] ?? 'solid'
      : 'solid'
    const mask = hideSpikes ? context.spikeMasks?.get(task.target) : undefined
    return {
      name: task.label,
      type: 'line' as const,
      data: rows.map((row, rowIndex) => (
        mask?.[rowIndex] === true ? null : probeNumber(row.point?.latency[task.target])
      )),
      // 折线曲率固定，数值不变；上游的「平滑峰值」会用 EWMA 改写数值，本主题不做。
      smooth: 0.1,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.5, color: task.color, cap: 'round' as const, type: lineType },
      itemStyle: { color: task.color },
    }
  })

  return {
    animation: false,
    color: context.tasks.map((task) => task.color),
    tooltip: {
      ...baseTooltip(theme),
      formatter: (params: unknown): string => {
        const items = (Array.isArray(params) ? params : [params]) as PingTooltipItem[]
        const rowIndex = items[0]?.dataIndex
        const row = rowIndex === undefined ? undefined : rows[rowIndex]
        if (rowIndex === undefined || !row) return ''
        const time = formatTooltipTime(row.timestamp, context.hours)
        if (!row.point) return tooltipFrame(theme, time, `<div style="color:${theme.textSecondary}">${GAP_TEXT}</div>`)
        const point = row.point
        // 上游按延迟从低到高排列，没有数值的任务不出现。
        const shown = items
          .filter((item): item is PingTooltipItem & { value: number } => (
            typeof item.value === 'number' && Number.isFinite(item.value)
          ))
          .map((item) => ({ name: item.seriesName, value: item.value, hidden: false }))
        /*
         * 被遮蔽的点在绘图副本里是 null，ECharts 不会把它交给 formatter。
         * 这里回到原始行，把此刻被隐藏、且线路仍在显示的真实数值补上，并标明「已隐藏」——
         * 不显示 0，也不假装这一刻没有数据。
         */
        const hiddenHere = hideSpikes
          ? context.selected.flatMap((task) => {
              if (!legendVisible(context.legendSelected, task.label)) return []
              if (context.spikeMasks?.get(task.target)?.[rowIndex] !== true) return []
              const value = probeNumber(point.latency[task.target])
              return value === null ? [] : [{ name: task.label, value, hidden: true }]
            })
          : []
        const body = [...shown, ...hiddenHere]
          .sort((left, right) => left.value - right.value)
          .map((entry) => {
            const color = colorByName.get(entry.name) ?? context.tasks[0]?.color ?? '#FF6B6B'
            const tag = entry.hidden
              ? `<span style="margin-left:6px;padding:0 4px;border-radius:4px;font-size:11px;color:${theme.textSecondary};border:1px solid ${theme.borderColor}">已隐藏</span>`
              : ''
            return `<div style="display:flex;align-items:center">${dot(color)}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(entry.name)}</span>${tag}<span style="margin-left:auto;font-weight:600;margin-left:16px;font-variant-numeric:tabular-nums">${Math.round(entry.value)} ms</span></div>`
          })
          .join('')
        return tooltipFrame(theme, time, body)
      },
    },
    legend: {
      type: 'scroll' as const,
      bottom: 0,
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 16,
      icon: 'roundRect',
      textStyle: { fontSize: 11, color: theme.textSecondary },
      data: context.selected.map((task) => task.label),
      ...(context.legendSelected ? { selected: { ...context.legendSelected } } : {}),
    },
    grid: PING_CHART_MARGIN,
    xAxis: {
      type: 'category' as const,
      data: rows.map((row) => formatAxisTime(row.timestamp, showDate)),
      axisLabel: { fontSize: 11, color: theme.textSecondary, margin: 12 },
      axisLine: { show: true, lineStyle: { color: theme.borderColor, width: 1 } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value' as const,
      name: '延迟 (ms)',
      nameTextStyle: { color: theme.textSecondary },
      axisLabel: { fontSize: 11, color: theme.textSecondary, formatter: '{value}' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.splitLineColor, type: 'dashed' as const } },
    },
    series,
  }
}
