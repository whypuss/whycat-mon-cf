import { describe, expect, it } from 'vitest'
import {
  buildDetailCards,
  buildGeneralCards,
  daysUntilExpiry,
  isExpiring,
  isHighLoad,
  isTrafficWarning,
  parseTrafficLimitBytes,
  remainingValue,
  resolveChartFamilies,
  resolveDetailCardKeys,
  resolveGeneralCardKeys,
  resolveQuickControlKeys,
} from '@/domain/theme-presentation'
import { probeSeries, visibleLoadCards } from '@/domain/detail-chart-options'
import { EMPTY_RATE_VIEW } from '@/domain/finance'
import { buildChartRows } from '@/domain/server-detail'
import { normalizeHistory, normalizeServer } from '@/services/cfsm/adapters'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

const source = { base: 'https://status.example', label: 'status.example' }

function glass(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'source:node', id: 'node', sourceBase: source.base, sourceLabel: source.label,
    name: 'Acme Hong Kong Edge', group: 'Production', tags: ['premium'], providerTags: { asn: null, org: null }, region: 'HK',
    price: null, billingCycle: null, currency: null, expireDate: null, trafficLimit: null,
    trafficCalculationType: null, showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: null, cpu: null, load: { one: null, five: null, fifteen: null },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: { inSpeed: null, outSpeed: null, received: null, transmitted: null, monthlyReceived: null, monthlyTransmitted: null },
    processes: null, tcpConnections: null, udpConnections: null, latency: [],
    history: { latencySeries: {}, packetLossSeries: {} }, gpus: [],
    connectivity: { ipv4: null, ipv6: null }, operatingSystem: null, architecture: null,
    cpuInfo: null, cpuCores: null, kernelVersion: null, agentVersion: null, bootTime: null, lastUpdated: null,
    ...overrides,
  }
}

describe('round 7 theme presentation contracts', () => {
  it('resolves presets and custom keys in configured order while dropping unsupported keys', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.generalCardPreset = '自定义'
    settings.generalCardKeys = 'trafficWarnings\navgCpu\nremainingValue\navgCpu'
    settings.homeQuickControlPreset = '自定义'
    settings.homeQuickControlKeys = 'offline,peak,fake'
    settings.detailMetricCardPreset = '自定义'
    settings.detailMetricCardKeys = 'cpuUsage\ntemperature\nconnections'
    settings.chartDashboardPreset = '自定义'
    settings.chartDashboardTemplate = '{"pingLoss":true,"connections":true,"cpu":true}'

    // remainingValue 自 v1.1.7 起是可换算的真实卡片，保留在自定义列表里；重复的 avgCpu 仍只出现一次。
    expect(resolveGeneralCardKeys(settings)).toEqual(['trafficWarnings', 'avgCpu', 'remainingValue'])
    expect(resolveQuickControlKeys(settings)).toEqual(['offline', 'peak'])
    expect(resolveDetailCardKeys(settings)).toEqual(['cpuUsage', 'connections'])
    // 连接数现在是真实可画的图表卡（`tcp_conn` / `udp_conn` 历史列），不再被当成不支持的 key 丢掉。
    expect(resolveChartFamilies(settings)).toEqual(['pingLoss', 'connections', 'cpu'])
  })

  it('aligns chart presets with Komari CHART_DASHBOARD_PRESETS and accepts its Chinese aliases', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    // 上游默认七张卡 + 本主题独有的磁盘 IO（没有数据时不出现）。
    expect(resolveChartFamilies(settings)).toEqual(['cpu', 'memory', 'disk', 'network', 'gpu', 'connections', 'process', 'diskIo'])
    settings.chartDashboardPreset = '自定义'
    settings.chartDashboardTemplate = '内存\n连接\n磁盘IO\n温度\n内存'
    // 温度需要 CFSM 历史里没有的列，与重复项一起被丢掉。
    expect(resolveChartFamilies(settings)).toEqual(['memory', 'connections', 'diskIo'])
  })

  it('uses only reliable CFSM limits, expiry dates and normalized metrics for warnings', () => {
    const now = Date.UTC(2026, 8, 8, 12)
    const server = glass({
      cpu: 80,
      expireDate: '2026-09-18',
      trafficLimit: '1TB',
      trafficCalculationType: 'total',
      network: { inSpeed: 10, outSpeed: 20, received: 100, transmitted: 200, monthlyReceived: 600 * 1024 ** 3, monthlyTransmitted: 300 * 1024 ** 3 },
    })

    expect(parseTrafficLimitBytes('100')).toBe(100 * 1024 ** 3)
    expect(parseTrafficLimitBytes('1TB')).toBe(1024 ** 4)
    expect(parseTrafficLimitBytes('unlimited')).toBeNull()
    expect(isTrafficWarning(server, 80)).toBe(true)
    expect(daysUntilExpiry(server.expireDate, now)).toBe(10)
    expect(isExpiring(server, 30, now)).toBe(true)
    expect(isHighLoad(server, 80)).toBe(true)
  })

  it('keeps expiry summaries strict and computes remaining value only for official CFSM cycles', () => {
    const now = Date.UTC(2026, 0, 1)
    const annual = glass({ price: '60', currency: '€', billingCycle: 'five_years', expireDate: '2027-01-01T00:00:00Z' })

    expect(daysUntilExpiry('2025-12-31T23:59:59Z', now)).toBe(-1)
    expect(daysUntilExpiry('invalid', now)).toBeNull()
    expect(remainingValue(annual, now)).toBe(12)
    expect(remainingValue({ ...annual, billingCycle: 'custom' }, now)).toBeNull()
    expect(remainingValue({ ...annual, expireDate: 'invalid' }, now)).toBeNull()
    expect(remainingValue({ ...annual, expireDate: '2025-12-31T23:59:59Z' }, now)).toBe(0)
  })

  it('builds truthful overview cards in the requested order', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.generalCardPreset = '自定义'
    settings.generalCardKeys = 'onlineNodes\navgCpu\ntrafficWarnings'
    const server = glass({ cpu: 25 })

    expect(buildGeneralCards([server], settings).map((card) => card.key)).toEqual(['onlineNodes', 'avgCpu', 'trafficWarnings'])
  })

  it('builds detail cards and filters charts without synthesizing unavailable families', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.detailMetricCardPreset = '综合'
    settings.chartDashboardPreset = '自定义'
    settings.chartDashboardTemplate = 'cpu\npingLoss\ngpu'
    settings.gpuChartEnabled = true
    const server = normalizeServer({
      id: 'node', cpu: 20, ram_used: 512, ram_total: 1024, processes: 8,
      price: '30', billing_cycle: 'quarter', currency: '¥', expire_date: '2026-12-31',
      boot_time: 1_700_000_000,
    }, source)
    const rows = buildChartRows(normalizeHistory([{ timestamp: 1, cpu: 10, loss_node_1: 0 }]))
    const cards = buildDetailCards(server, settings, Date.UTC(2026, 8, 8))
    const lossSeries = probeSeries(rows, [{ target: 'node_1', label: 'Node 1' }], 'packetLoss', ['#FF6B6B'], false)
    const charts = visibleLoadCards(resolveChartFamilies(settings), rows, settings.gpuChartEnabled, {
      traffic: 0,
      ping: 0,
      pingLoss: lossSeries.length,
    })

    expect(cards.find((card) => card.key === 'monthlyCost')).toMatchObject({ value: '¥10.00', unit: '/ 月' })
    expect(cards.some((card) => card.key === 'memoryUsage')).toBe(true)
    expect(cards.some((card) => card.key === 'trafficQuota')).toBe(false)
    // GPU 在方案里且开关打开，但历史里没有 GPU 采样，卡片不出现；丢包 0 是有效值，卡片出现。
    expect(charts).toEqual(['cpu', 'pingLoss'])
  })
})

describe('总览卡片对齐 Komari NodeGeneralCards 的统计口径与 tooltip', () => {
  const now = Date.UTC(2026, 9, 2, 12)
  function card(key: string, servers: GlassServer[]) {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.generalCardPreset = '自定义'
    settings.generalCardKeys = key
    const [first] = buildGeneralCards(servers, settings, now)
    if (!first) throw new Error(`card ${key} missing`)
    return first
  }
  const network = glass().network

  it('高负载只统计在线节点，tooltip 列出节点与超阈值的指标', () => {
    const busy = glass({ key: 'a', name: 'Busy', cpu: 95, memory: { used: 9, total: 10, percentage: 90 } })
    const offline = glass({ key: 'b', name: 'Gone', online: false, cpu: 99 })
    const calm = glass({ key: 'c', name: 'Calm', cpu: 10 })
    // 离线节点的最后一次上报不代表当前负载（上游 getHighLoadMetrics），快捷筛选也经由这里判断。
    expect(isHighLoad(offline, 80)).toBe(false)
    expect(card('highLoadNodes', [busy, offline, calm])).toMatchObject({ value: '1', unit: '/ 2', hint: 'Busy: CPU 95.0% / 内存 90.0%' })
  })

  it('资源合计只取已用与总量成对的节点，不把缺失的一侧当 0', () => {
    const complete = glass({ key: 'a', memory: { used: 4096, total: 8192, percentage: 50 } })
    const partial = glass({ key: 'b', memory: { used: null, total: 16384, percentage: null } })
    expect(card('memory', [complete, partial]).percentage).toBe(50)
  })

  it('即将到期与上游一致：含已过期，排除免费，阈值至少 1 天', () => {
    const expired = glass({ name: 'Old', expireDate: '2026-09-30' })
    const soon = glass({ name: 'Soon', expireDate: '2026-10-05' })
    const free = glass({ name: 'Free', price: '-1', expireDate: '2026-10-05' })
    const later = glass({ name: 'Later', expireDate: '2027-01-01' })
    expect(isExpiring(expired, 7, now)).toBe(true)
    expect(isExpiring(free, 7, now)).toBe(false)
    expect(isExpiring(later, 7, now)).toBe(false)
    expect(isExpiring(glass({ expireDate: '2026-10-03T11:00:00Z' }), 0, now)).toBe(true)
    expect(card('expiringNodes', [expired, soon, free, later])).toMatchObject({ value: '2', hint: 'Old: 已过期\nSoon: 3 天' })
  })

  it('名单最多列 8 台，超出写还有几台，没有节点写暂无节点', () => {
    const offline = Array.from({ length: 10 }, (_, index) => glass({ key: `n${index}`, name: `Node ${index}`, online: false }))
    const lines = card('offlineNodes', offline).hint.split('\n')
    expect(lines).toHaveLength(9)
    expect(lines[8]).toBe('… 还有 2 台')
    expect(card('offlineNodes', [glass()]).hint).toBe('暂无节点')
  })

  it('实时峰值取上下行合计最高的在线节点', () => {
    const a = glass({ key: 'a', name: 'A', network: { ...network, inSpeed: 600, outSpeed: 0 } })
    const b = glass({ key: 'b', name: 'B', network: { ...network, inSpeed: 400, outSpeed: 400 } })
    expect(card('trafficPeak', [a, b])).toMatchObject({ value: '800', unit: 'B/s', hint: 'B\n↑ 400 B/s\n↓ 400 B/s' })
    expect(card('trafficPeak', [glass({ network: { ...network, inSpeed: 0, outSpeed: 0 } })]).value).toBe('-')
  })

  it('上游没有 tooltip 的卡片不放说明文字', () => {
    const server = glass({ cpu: 20, processes: 100, cpuCores: 4, network: { ...network, inSpeed: 1, outSpeed: 1 } })
    for (const key of ['uploadSpeed', 'downloadSpeed', 'onlineNodes', 'avgCpu', 'processes', 'cpuCores']) {
      expect(card(key, [server]).hint).toBe('')
    }
  })

  it('GPU 卡按节点列出名称与利用率，多卡先取节点平均', () => {
    const server = glass({ name: 'G', gpus: [{ id: '0', name: 'A100', utilization: 50 }, { id: '1', name: 'A100', utilization: 70 }] })
    expect(card('avgGpu', [server])).toMatchObject({ value: '60.0', hint: 'G: 60.0%' })
    expect(card('gpuNodes', [server]).hint).toBe('G: A100')
  })

  it('详情页剩余价值换算失败时按真实原因说明', () => {
    const server = normalizeServer({ id: 'n', price: '10.00', billing_cycle: 'month', expire_date: '2026-11-02' }, source)
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.detailMetricCardPreset = '财务'
    const remaining = buildDetailCards(server, settings, now, { target: 'USD', view: EMPTY_RATE_VIEW })
      .find((item) => item.key === 'remainingValue')
    expect(remaining?.hint).toContain('未标明币种，无法换算')
  })

  it('峰值节点只在在线节点里取：第一台先入选，之后严格更大才替换', () => {
    const a = glass({ key: 'a', name: 'A', tcpConnections: 30, udpConnections: 5, network: { ...network, inSpeed: 100, outSpeed: 900 } })
    const b = glass({ key: 'b', name: 'B', tcpConnections: 30, udpConnections: 5, network: { ...network, inSpeed: 700, outSpeed: 100 } })
    const gone = glass({ key: 'c', name: 'Gone', online: false, tcpConnections: 999, network: { ...network, inSpeed: 9999, outSpeed: 9999 } })
    expect(card('uploadPeakNode', [a, b, gone])).toMatchObject({ value: '900', unit: 'B/s', hint: 'A\n↑ 900 B/s\n↓ 100 B/s' })
    expect(card('downloadPeakNode', [a, b, gone])).toMatchObject({ value: '700', unit: 'B/s', hint: 'B\n↑ 100 B/s\n↓ 700 B/s' })
    // 两台连接数相同，保留第一台（上游 updateTopMetric 只在严格更大时替换）。
    expect(card('connectionPeakNode', [a, b, gone])).toMatchObject({ value: '35', hint: 'A\nTCP 30\nUDP 5' })
    expect(card('connectionPeakNode', [glass()])).toMatchObject({ value: '-', hint: '暂无数据' })
  })

  it('GPU 峰值取利用率最高的在线 GPU 节点', () => {
    const low = glass({ key: 'a', name: 'Low', gpus: [{ id: '0', name: 'T4', utilization: 20 }] })
    const high = glass({ key: 'b', name: 'High', gpus: [{ id: '0', name: 'A100', utilization: 80 }] })
    expect(card('gpuPeakNode', [low, high])).toMatchObject({ value: '80.0', unit: '%', hint: 'High\nA100\nGPU 80.0%' })
    expect(card('gpuPeakNode', [glass()])).toMatchObject({ value: '-' })
  })

  it('流量配额合计设了上限的节点，缺月度数据的不当作 0', () => {
    const GiB = 1024 ** 3
    const monthly = (received: number | null, transmitted: number | null) => ({ ...network, monthlyReceived: received, monthlyTransmitted: transmitted })
    const a = glass({ key: 'a', trafficLimit: '100', trafficCalculationType: 'total', network: monthly(30 * GiB, 10 * GiB) })
    const b = glass({ key: 'b', trafficLimit: '300', trafficCalculationType: 'dl', network: monthly(60 * GiB, 5 * GiB) })
    const unlimited = glass({ key: 'c', trafficLimit: null, network: monthly(500 * GiB, 500 * GiB) })
    const missing = glass({ key: 'd', trafficLimit: '100', trafficCalculationType: 'total', network: monthly(null, 5 * GiB) })
    const hidden = glass({ key: 'e', trafficLimit: '100', showTraffic: false, network: monthly(90 * GiB, 0) })
    // (40 + 60) / (100 + 300) = 25%；不限流量与站点隐藏流量的节点不参与，缺数据的节点单独说明。
    expect(card('trafficQuota', [a, b, unlimited, missing, hidden])).toMatchObject({
      value: '25.0',
      unit: '%',
      hint: '100.0 GB / 400.0 GB\n部分 · 1 台缺少流量数据，未计入',
    })
    expect(card('trafficQuota', [unlimited])).toMatchObject({ value: '-', hint: '无限流量' })
  })
})
