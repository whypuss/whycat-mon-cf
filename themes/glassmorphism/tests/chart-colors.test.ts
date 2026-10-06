import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  connectionsChartOption,
  cpuChartOption,
  diskChartOption,
  diskIoChartOption,
  gpuChartOption,
  loadChartHours,
  memoryChartOption,
  metricSeriesChartOption,
  networkChartOption,
  pingChartOption,
  probeSeries,
  processChartOption,
  trafficSeries,
  type LoadChartContext,
  type PingTaskLine,
} from '@/domain/detail-chart-options'
import { buildChartRows } from '@/domain/server-detail'
import {
  ACCESSIBLE_LINE_TYPES,
  getChartSeriesPalette,
  getChartThemeColors,
  getLoadChartPalette,
  getPingChartThemeColors,
} from '@/utils/chart-palette'
import type { HistoryPoint } from '@/types/cfsm'

const optionsSource = readFileSync(new URL('../src/domain/detail-chart-options.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

/*
 * 详情图表的颜色与数据语义回归。
 *
 * 第 15 轮的根因仍然成立：ECharts 走 `CanvasRenderer`，颜色落到 canvas 2D 的
 * `strokeStyle` / `fillStyle`，canvas **不解析 CSS 变量**，`var(--x)` 会被直接丢弃，
 * 折线被画成纯黑。所以这里断言的是「进入图表的颜色一定是具体值」。
 *
 * 第二阶段详情页高保真移植后，图表按上游拆成三类 option：
 * - `LoadChart.vue` 内联卡（CPU 与负载、内存与 Swap、磁盘、实时网络、GPU、网络连接、进程）
 *   用 `getLoadChartPalette()` 的角色色，1.5 + 圆线帽，总量线 1.2 虚线；
 * - `MetricSeriesChartCard`（累计流量、Ping 延迟、Ping 丢包）1.6、无线帽；
 * - `PingChart.vue` 延迟大图，序列板取色，色觉友好模式下轮换线型。
 * 以下逐序列的取值直接读自 Komari `bf83765`。
 */

const CSS_VAR = /var\(\s*--/
const HEX = /^#[0-9A-Fa-f]{6}$/

interface LooseSeries {
  name: string
  data: unknown[]
  connectNulls?: boolean
  yAxisIndex?: number
  smooth?: number | boolean
  lineStyle: { color: string, width: number, cap?: string, type?: string }
  itemStyle: { color: string }
  areaStyle?: { color: { colorStops: Array<{ offset: number, color: string }> } }
}

function seriesOf(option: { series: unknown }): LooseSeries[] {
  return option.series as LooseSeries[]
}

function point(timestamp: number, index: number): HistoryPoint {
  return {
    timestamp,
    cpu: 10 + index,
    gpus: [
      { id: '0', name: 'NVIDIA T4', utilization: 20 + index },
      { id: '1', name: 'NVIDIA L4', utilization: 30 + index },
    ],
    memoryUsed: 2048 + index,
    memoryTotal: 8192,
    swapUsed: 256,
    swapTotal: 2048,
    diskUsed: 61440,
    diskTotal: 163840,
    networkInSpeed: 1_000_000 + index,
    networkOutSpeed: 600_000 + index,
    networkReceived: 4_000_000_000 + index,
    networkTransmitted: 2_000_000_000 + index,
    processes: 90 + index,
    tcpConnections: 7 + index,
    udpConnections: 2,
    load1: 0.1,
    load5: 0.2,
    load15: 0.3,
    temperature: null,
    latency: { ct: 20 + index, cu: 30, cm: 40, bd: false, node_1: 50, node_2: false, node_3: false, node_4: false },
    packetLoss: { ct: 0, cu: 1, cm: 2, bd: false, node_1: 0, node_2: false, node_3: false, node_4: false },
    diskIo: { readBps: 8_000_000, writeBps: 3_000_000, readIops: 100, writeIops: 50, awaitMs: 0.4, utilization: 12 },
  }
}

const START = 1_700_000_000_000
const points = Array.from({ length: 6 }, (_, index) => point(START + index * 300_000, index))
const rows = buildChartRows(points)

function context(accessible = false, dark = false, source: readonly HistoryPoint[] = points): LoadChartContext {
  return {
    rows: buildChartRows(source),
    hours: 1,
    load: getLoadChartPalette(accessible),
    series: getChartSeriesPalette(accessible),
    theme: getChartThemeColors(dark),
  }
}

function inlineOptions(ctx: LoadChartContext = context()) {
  return {
    cpu: cpuChartOption(ctx),
    memory: memoryChartOption(ctx),
    disk: diskChartOption(ctx),
    network: networkChartOption(ctx),
    gpu: gpuChartOption(ctx),
    connections: connectionsChartOption(ctx),
    process: processChartOption(ctx),
    diskIo: diskIoChartOption(ctx),
  }
}

function named(option: { series: unknown }, name: string): LooseSeries {
  const item = seriesOf(option).find((series) => series.name === name)
  expect(item, `${name} 缺失`).toBeDefined()
  return item as LooseSeries
}

const PROBES = [
  { target: 'ct', label: '电信' },
  { target: 'cu', label: '联通' },
  { target: 'cm', label: '移动' },
  { target: 'bd', label: 'BGP' },
  { target: 'node_1', label: 'Tokyo' },
] as const

function pingTasks(accessible = false): PingTaskLine[] {
  const palette = getChartSeriesPalette(accessible)
  return PROBES.map((probe, index) => ({ ...probe, color: palette[index % palette.length] as string }))
}

describe('进入 canvas 的颜色必须是具体色值', () => {
  it('内联卡每条序列的线色与色点都是具体 hex，且二者同源', () => {
    for (const [key, option] of Object.entries(inlineOptions())) {
      const series = seriesOf(option)
      expect(series.length, key).toBeGreaterThan(0)
      for (const item of series) {
        expect(item.lineStyle.color, `${key}/${item.name}`).toMatch(HEX)
        expect(item.itemStyle.color, `${key}/${item.name}`).toBe(item.lineStyle.color)
        for (const stop of item.areaStyle?.color.colorStops ?? []) expect(stop.color).toMatch(/^rgba\(/)
      }
    }
  })

  it('序列颜色全部来自两块调色板，不出现调色板之外的自造色', () => {
    const allowed = new Set([...getChartSeriesPalette(false), ...Object.values(getLoadChartPalette(false))])
    for (const [key, option] of Object.entries(inlineOptions())) {
      for (const item of seriesOf(option)) {
        expect(allowed.has(item.lineStyle.color), `${key}/${item.name} = ${item.lineStyle.color}`).toBe(true)
      }
    }
  })

  it('图表主题色在深浅两种模式下都是具体 rgba，且逐项不同', () => {
    const light = getChartThemeColors(false)
    const dark = getChartThemeColors(true)
    for (const key of Object.keys(light) as Array<keyof typeof light>) {
      expect(light[key]).not.toMatch(CSS_VAR)
      expect(dark[key]).not.toMatch(CSS_VAR)
      expect(light[key]).toMatch(/^rgba\(/)
      // 切换主题后不能残留同一个值，否则深色下坐标轴文字会看不见。
      expect(dark[key], key).not.toBe(light[key])
    }
  })

  it('延迟大图的主题色只有浅色边框与负载图不同（上游是 0.06 对 0.1）', () => {
    expect(getPingChartThemeColors(false)).toEqual({ ...getChartThemeColors(false), borderColor: 'rgba(0, 0, 0, 0.06)' })
    expect(getPingChartThemeColors(true)).toEqual(getChartThemeColors(true))
  })

  it('option 构建模块里不出现任何 CSS 变量', () => {
    expect(optionsSource).not.toMatch(CSS_VAR)
  })

  it('流量 / Ping / 丢包卡的 option 同样只有具体色值（上游这个组件写的是 var(--color-*)）', () => {
    const ctx = context()
    const option = metricSeriesChartOption(probeSeries(ctx.rows, PROBES, 'latency', ctx.series, false), ctx.theme)
    expect(JSON.stringify(option)).not.toMatch(CSS_VAR)
    expect(option.tooltip.backgroundColor).toBe(ctx.theme.tooltipBg)
    expect(option.legend.textStyle.color).toBe(ctx.theme.textSecondary)
  })
})

describe('逐序列对照上游 LoadChart', () => {
  const load = getLoadChartPalette(false)
  const options = inlineOptions()

  it('CPU 与负载：CPU = primary 带渐变，负载 = secondary 且在第二根 Y 轴', () => {
    const cpu = named(options.cpu, 'CPU')
    expect(cpu.lineStyle.color).toBe(load.primary)
    expect(cpu.areaStyle?.color.colorStops.map((stop) => stop.color)).toEqual([load.primaryAreaStrong, load.primaryAreaFaint])
    expect(cpu.yAxisIndex).toBe(0)
    const loadLine = named(options.cpu, '负载')
    expect(loadLine.lineStyle.color).toBe(load.secondary)
    expect(loadLine.yAxisIndex).toBe(1)
    expect(loadLine.areaStyle).toBeUndefined()
  })

  it('内存与 Swap：RAM = primary 带渐变，RAM 总量 / Swap 总量是 1.2 虚线', () => {
    expect(named(options.memory, 'RAM').lineStyle.color).toBe(load.primary)
    expect(named(options.memory, 'RAM').areaStyle).toBeDefined()
    expect(named(options.memory, 'RAM 总量').lineStyle).toMatchObject({ color: load.quinary, width: 1.2, type: 'dashed' })
    expect(named(options.memory, 'Swap').lineStyle.color).toBe(load.secondary)
    expect(named(options.memory, 'Swap').areaStyle).toBeUndefined()
    expect(named(options.memory, 'Swap 总量').lineStyle).toMatchObject({ color: load.quaternary, width: 1.2, type: 'dashed' })
  })

  it('磁盘：已用 = tertiary 带渐变，总量 = quinary 1.2 虚线', () => {
    const used = named(options.disk, '磁盘已用')
    expect(used.lineStyle.color).toBe(load.tertiary)
    expect(used.areaStyle?.color.colorStops.map((stop) => stop.color)).toEqual([load.tertiaryAreaStrong, load.tertiaryAreaFaint])
    expect(named(options.disk, '磁盘总量').lineStyle).toMatchObject({ color: load.quinary, width: 1.2, type: 'dashed' })
  })

  it('实时网络：下载 = quinary、上传 = quaternary，两条都没有填充', () => {
    expect(named(options.network, '下载').lineStyle.color).toBe(load.quinary)
    expect(named(options.network, '上传').lineStyle.color).toBe(load.quaternary)
    for (const item of seriesOf(options.network)) expect(item.areaStyle, item.name).toBeUndefined()
  })

  it('GPU：平均使用率 = senary，设备线取序列板且为 1.2 虚线；CFSM 没有显存，不画显存线', () => {
    const palette = getChartSeriesPalette(false)
    expect(named(options.gpu, 'GPU 使用率').lineStyle.color).toBe(load.senary)
    expect(named(options.gpu, 'NVIDIA T4').lineStyle).toMatchObject({ color: palette[0], width: 1.2, type: 'dashed' })
    expect(named(options.gpu, 'NVIDIA L4').lineStyle).toMatchObject({ color: palette[1], width: 1.2, type: 'dashed' })
    expect(seriesOf(options.gpu).some((item) => item.name === '显存使用率')).toBe(false)
  })

  it('网络连接：TCP = primary、UDP = tertiary；进程 = quaternary 并带上游写死的紫色填充', () => {
    expect(named(options.connections, 'TCP').lineStyle.color).toBe(load.primary)
    expect(named(options.connections, 'UDP').lineStyle.color).toBe(load.tertiary)
    const processLine = named(options.process, '进程数')
    expect(processLine.lineStyle.color).toBe(load.quaternary)
    expect(processLine.areaStyle?.color.colorStops.map((stop) => stop.color))
      .toEqual(['rgba(167, 139, 250, 0.25)', 'rgba(167, 139, 250, 0.02)'])
  })

  it('累计与周期流量卡：累计下载 = quinary、累计上传 = quaternary', () => {
    expect(trafficSeries(context()).map((item) => [item.name, item.color, item.kind])).toEqual([
      ['累计下载', load.quinary, 'bytes'],
      ['累计上传', load.quaternary, 'bytes'],
    ])
  })

  it('内联卡线宽 1.5（总量与设备虚线 1.2）+ 圆线帽；卡片图 1.6 且没有线帽', () => {
    for (const [key, option] of Object.entries(options)) {
      for (const item of seriesOf(option)) {
        expect(item.lineStyle.cap, `${key}/${item.name}`).toBe('round')
        expect(item.lineStyle.width, `${key}/${item.name}`).toBe(item.lineStyle.type === 'dashed' ? 1.2 : 1.5)
      }
    }
    const ctx = context()
    for (const item of seriesOf(metricSeriesChartOption(trafficSeries(ctx), ctx.theme))) {
      expect(item.lineStyle.width).toBe(1.6)
      expect(item.lineStyle.cap).toBeUndefined()
    }
  })
})

describe('色觉友好模式', () => {
  it('换成上游的无障碍调色板，而不是仅改线型', () => {
    const standard = getChartSeriesPalette(false)
    const accessible = getChartSeriesPalette(true)
    expect(accessible).not.toEqual(standard)
    expect(accessible[0]).toBe('#0072B2')
    for (const color of accessible) expect(color).toMatch(HEX)
  })

  it('内联卡整体切到无障碍角色板', () => {
    const roles = new Set(Object.values(getLoadChartPalette(true)))
    const series = new Set(getChartSeriesPalette(true))
    for (const [key, option] of Object.entries(inlineOptions(context(true)))) {
      for (const item of seriesOf(option)) {
        expect(roles.has(item.lineStyle.color) || series.has(item.lineStyle.color), `${key}/${item.name}`).toBe(true)
      }
    }
  })

  it('延迟大图按选中顺序轮换上游 ACCESSIBLE_LINE_TYPES，普通模式全是实线', () => {
    expect([...ACCESSIBLE_LINE_TYPES]).toEqual(['solid', 'dashed', 'dotted'])
    const tasks = pingTasks(true)
    const base = { rows, hours: 1, theme: getPingChartThemeColors(false), tasks, selected: tasks }
    expect(seriesOf(pingChartOption({ ...base, accessible: true })).map((item) => item.lineStyle.type))
      .toEqual(['solid', 'dashed', 'dotted', 'solid', 'dashed'])
    expect(seriesOf(pingChartOption({ ...base, accessible: false })).every((item) => item.lineStyle.type === 'solid')).toBe(true)
  })

  it('Ping 卡片的颜色与虚线按目标在完整列表里的位置决定（与上游 pingSeries 相同）', () => {
    const palette = getChartSeriesPalette(true)
    // BGP 全程未配置，序列被滤掉，但 Tokyo 仍按第 5 位取色、按第 5 位决定虚线。
    expect(probeSeries(rows, PROBES, 'latency', palette, true).map((item) => [item.name, item.color, item.dashed])).toEqual([
      ['电信', palette[0], false],
      ['联通', palette[1], true],
      ['移动', palette[2], false],
      ['Tokyo', palette[4], false],
    ])
  })
})

describe('数据语义：不补点、不插值、不写 0', () => {
  it('每一条序列都关闭 connectNulls', () => {
    const ctx = context()
    const tasks = pingTasks()
    const all = [
      ...Object.values(inlineOptions(ctx)),
      metricSeriesChartOption(trafficSeries(ctx), ctx.theme),
      metricSeriesChartOption(probeSeries(ctx.rows, PROBES, 'packetLoss', ctx.series, false), ctx.theme, true),
      pingChartOption({ rows, hours: 1, theme: getPingChartThemeColors(false), tasks, selected: tasks, accessible: false }),
    ]
    for (const option of all) {
      for (const item of seriesOf(option)) expect(item.connectNulls, item.name).toBe(false)
    }
  })

  it('缺失的指标保持 null，不像上游那样写成 0', () => {
    const sparse = points.map((item, index) => (
      index === 2 ? { ...item, networkInSpeed: null, processes: null, tcpConnections: null } : item
    ))
    const ctx = context(false, false, sparse)
    expect(named(networkChartOption(ctx), '下载').data[2]).toBeNull()
    expect(named(processChartOption(ctx), '进程数').data[2]).toBeNull()
    expect(named(connectionsChartOption(ctx), 'TCP').data[2]).toBeNull()
    expect(optionsSource).not.toMatch(/\?\?\s*0\b/)
  })

  it('探针的 false（未配置）与 null（超时）都不进入数值序列', () => {
    const timeouts = points.map((item, index) => (
      index === 1 ? { ...item, latency: { ...item.latency, ct: null } } : item
    ))
    const series = probeSeries(buildChartRows(timeouts), PROBES, 'latency', getChartSeriesPalette(false), false)
    expect(series.some((item) => item.name === 'BGP')).toBe(false)
    const ct = series.find((item) => item.name === '电信')
    expect(ct?.data[1]?.[1]).toBeNull()
    expect(ct?.data.every(([, value]) => value !== 0)).toBe(true)
  })

  it('真实采样的时间戳原样保留，没有被重采样', () => {
    expect(rows.map((row) => row.timestamp)).toEqual(points.map((item) => item.timestamp))
    expect(rows.every((row) => row.point !== null)).toBe(true)
  })

  it('离线空档只放不带数值的缺口标记，tooltip 写明这里没有采样', () => {
    const gapped = [...points, point(START + 5 * 300_000 + 60 * 60_000, 6)]
    const ctx = context(false, false, gapped)
    const markerIndex = ctx.rows.findIndex((row) => row.point === null)
    expect(markerIndex).toBe(6)
    for (const [key, option] of Object.entries(inlineOptions(ctx))) {
      for (const item of seriesOf(option)) expect(item.data[markerIndex], `${key}/${item.name}`).toBeNull()
      const tooltip = option.tooltip as { formatter: (params: unknown) => string }
      expect(tooltip.formatter([{ dataIndex: markerIndex, seriesName: 'x', value: null, color: '#000000' }]), key)
        .toContain('该时段没有采样')
    }
    expect(cpuChartOption(ctx).xAxis.data).toHaveLength(ctx.rows.length)
  })

  it('没有交换分区时不画 Swap 两条线，不把「没有」画成 0', () => {
    const noSwap = points.map((item) => ({ ...item, swapUsed: 0, swapTotal: 0 }))
    expect(seriesOf(memoryChartOption(context(false, false, noSwap))).map((item) => item.name)).toEqual(['RAM', 'RAM 总量'])
  })

  it('折线曲率固定为上游未开启平滑时的取值（v1.1.8 删除了「曲线平滑」开关）', () => {
    const tasks = pingTasks()
    const series = seriesOf(pingChartOption({ rows, hours: 1, theme: getPingChartThemeColors(false), tasks, selected: tasks, accessible: false }))
    expect(series.map((item) => item.smooth)).toEqual(series.map(() => 0.1))
  })

  it('tooltip 里的节点侧文字先转义再拼进 HTML', () => {
    const label = '<img src=x onerror=alert(1)>'
    const tasks = [{ target: 'ct' as const, label, color: '#FF6B6B' }]
    const option = pingChartOption({ rows, hours: 1, theme: getPingChartThemeColors(false), tasks, selected: tasks, accessible: false })
    const html = option.tooltip.formatter([{ dataIndex: 0, seriesName: label, value: 20 }])
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
})

describe('图表提示框统一转义系列名', () => {
  it('GPU 型号里的 HTML 只转义一次', () => {
    const gpuPoints = points.map((item) => ({ ...item, gpus: [{ id: '0', name: '<b>A100</b>', utilization: 40 }] }))
    const option = gpuChartOption(context(false, false, gpuPoints))
    const html = option.tooltip.formatter([{ dataIndex: 0, seriesName: '<b>A100</b>', value: 40, color: '#000000' }])
    expect(html).toContain('&lt;b&gt;A100&lt;/b&gt;')
    expect(html).not.toContain('<b>A100')
    expect(html).not.toContain('&amp;lt;')
  })
})

describe('负载图「实时」档位的时间格式', () => {
  const tooltipOf = (hours: number) => cpuChartOption({ ...context(), hours }).tooltip
    .formatter([{ dataIndex: 0, seriesName: 'CPU', value: 10, color: '#000000' }])

  it('实时档位照上游：坐标轴只显示时刻，tooltip 精确到秒', () => {
    const hours = loadChartHours(true, 168)
    expect(cpuChartOption({ ...context(), hours }).xAxis.data.some((label) => label.includes('/'))).toBe(false)
    expect(tooltipOf(hours)).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('历史档位照旧：1 天及以上带日期', () => {
    const hours = loadChartHours(false, 168)
    expect(hours).toBe(168)
    expect(cpuChartOption({ ...context(), hours }).xAxis.data.every((label) => label.includes('/'))).toBe(true)
    expect(tooltipOf(hours)).not.toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})
