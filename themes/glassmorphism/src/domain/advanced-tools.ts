import { monthlyCost, resolveSourceCurrency } from '@/domain/finance'
import { cloneHistorySummary, numericWindowSamples } from '@/domain/probe-window'
import { daysUntilExpiry, parseTrafficLimitBytes, trafficUsage } from '@/domain/theme-presentation'
import type { ThemeSettings } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

type Coordinates = readonly [latitude: number, longitude: number]

const REGION_CENTERS: Readonly<Record<string, Coordinates>> = {
  AD: [42.55, 1.58], AE: [24.4, 54.3], AR: [-38.4, -63.6], AT: [47.5, 14.5], AU: [-25.3, 133.8],
  BD: [23.7, 90.4], BE: [50.5, 4.5], BG: [42.7, 25.5], BH: [26.1, 50.6], BR: [-14.2, -51.9],
  CA: [56.1, -106.3], CH: [46.8, 8.2], CL: [-35.7, -71.5], CN: [35.9, 104.2], CO: [4.6, -74.3],
  CZ: [49.8, 15.5], DE: [51.2, 10.5], DK: [56.3, 9.5], EE: [58.6, 25.0], EG: [26.8, 30.8],
  ES: [40.5, -3.7], FI: [61.9, 25.7], FR: [46.2, 2.2], GB: [55.4, -3.4], GR: [39.1, 21.8],
  HK: [22.3, 114.2], HR: [45.1, 15.2], HU: [47.2, 19.5], ID: [-0.8, 113.9], IE: [53.1, -8.2],
  IL: [31.0, 34.9], IN: [20.6, 79.0], IS: [65.0, -18.6], IT: [41.9, 12.6], JP: [36.2, 138.3],
  KR: [35.9, 127.8], KW: [29.3, 47.5], KZ: [48.0, 66.9], LT: [55.2, 23.9], LU: [49.8, 6.1],
  LV: [56.9, 24.6], MO: [22.2, 113.5], MX: [23.6, -102.6], MY: [4.2, 101.98], NL: [52.1, 5.3],
  NO: [60.5, 8.5], NZ: [-40.9, 174.9], PE: [-9.2, -75.0], PH: [12.9, 121.8], PK: [30.4, 69.3],
  PL: [51.9, 19.1], PT: [39.4, -8.2], QA: [25.4, 51.2], RO: [45.9, 24.97], RS: [44.0, 21.0],
  RU: [61.5, 105.3], SA: [23.9, 45.1], SE: [60.1, 18.6], SG: [1.35, 103.8], SI: [46.2, 14.8],
  SK: [48.7, 19.7], TH: [15.9, 100.99], TR: [39.0, 35.2], TW: [23.7, 121.0], UA: [48.4, 31.2],
  US: [37.1, -95.7], VN: [14.1, 108.3], ZA: [-30.6, 22.9],
}

const REGION_ALIASES: Readonly<Record<string, string>> = {
  'UNITED STATES': 'US', USA: 'US', 美国: 'US',
  'UNITED KINGDOM': 'GB', UK: 'GB', 英国: 'GB',
  CHINA: 'CN', 中国: 'CN',
  'HONG KONG': 'HK', 香港: 'HK',
  JAPAN: 'JP', 日本: 'JP',
  SINGAPORE: 'SG', 新加坡: 'SG',
  GERMANY: 'DE', 德国: 'DE',
  FRANCE: 'FR', 法国: 'FR',
  CANADA: 'CA', 加拿大: 'CA',
  AUSTRALIA: 'AU', 澳大利亚: 'AU',
  TAIWAN: 'TW', 台湾: 'TW',
  KOREA: 'KR', 'SOUTH KOREA': 'KR', 韩国: 'KR',
  NETHERLANDS: 'NL', 荷兰: 'NL',
}

export interface EarthPoint {
  code: string
  region: string
  latitude: number
  longitude: number
  x: number
  y: number
  total: number
  online: number
  servers: GlassServer[]
}

export function resolveRegionCoordinates(region: string | null): { code: string, latitude: number, longitude: number } | null {
  const normalized = region?.normalize('NFKC').trim().toUpperCase()
  if (!normalized) return null
  const code = REGION_CENTERS[normalized] ? normalized : REGION_ALIASES[normalized]
  const coordinates = code ? REGION_CENTERS[code] : undefined
  if (!code || !coordinates) return null
  return { code, latitude: coordinates[0], longitude: coordinates[1] }
}

export function buildEarthPoints(servers: readonly GlassServer[]): EarthPoint[] {
  const grouped = new Map<string, EarthPoint>()
  for (const server of servers) {
    const location = resolveRegionCoordinates(server.region)
    if (!location) continue
    const current = grouped.get(location.code)
    if (current) {
      current.total += 1
      current.online += server.online ? 1 : 0
      current.servers.push(server)
      continue
    }
    grouped.set(location.code, {
      ...location,
      region: server.region?.trim() || location.code,
      x: (location.longitude + 180) / 360 * 100,
      y: (90 - location.latitude) / 180 * 100,
      total: 1,
      online: server.online ? 1 : 0,
      servers: [server],
    })
  }
  return [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code))
}

export type HealthTone = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface HealthIssue {
  metric: string
  message: string
  tone: Exclude<HealthTone, 'healthy' | 'unknown'>
}

export interface ServerHealth {
  server: GlassServer
  tone: HealthTone
  score: number | null
  evaluatedSignals: number
  historySamples: number
  issues: HealthIssue[]
}

function average(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function addThresholdIssue(
  issues: HealthIssue[],
  metric: string,
  value: number | null,
  warning: number,
  critical: number,
  suffix = '%',
): number {
  if (value === null) return 0
  if (value >= critical) issues.push({ metric, message: `${metric} ${value.toFixed(1)}${suffix}`, tone: 'critical' })
  else if (value >= warning) issues.push({ metric, message: `${metric} ${value.toFixed(1)}${suffix}`, tone: 'warning' })
  return 1
}

export function evaluateServerHealth(server: GlassServer, settings: Pick<ThemeSettings, 'homeHighLoadThreshold' | 'homeTrafficWarningThreshold' | 'homeExpiringDays'>, now = Date.now()): ServerHealth {
  const issues: HealthIssue[] = []
  let evaluatedSignals = 1
  if (!server.online) issues.push({ metric: '在线状态', message: '节点离线', tone: 'critical' })

  /*
   * 离线节点的最后一次上报不代表当前状态（与首页高负载判定同一口径）：只报离线，
   * 不再拿旧的 CPU / 内存 / 交换 / 硬盘 / 负载 / GPU / 实时探测评级。
   * 流量配额、到期与历史平均不是瞬时值，离线时照常评估。
   */
  if (server.online) {
    evaluatedSignals += addThresholdIssue(issues, 'CPU', server.cpu, settings.homeHighLoadThreshold, 95)
    evaluatedSignals += addThresholdIssue(issues, 'RAM', server.memory.percentage, settings.homeHighLoadThreshold, 95)
    evaluatedSignals += addThresholdIssue(issues, 'Swap', server.swap.percentage, 80, 95)
    evaluatedSignals += addThresholdIssue(issues, 'Disk', server.disk.percentage, settings.homeHighLoadThreshold, 95)

    const loadRatio = server.load.one !== null && server.cpuCores !== null && server.cpuCores > 0
      ? server.load.one / server.cpuCores
      : null
    evaluatedSignals += addThresholdIssue(issues, 'Load/Core', loadRatio, 1, 2, '×')

    const gpuValues = server.gpus.flatMap((gpu) => gpu.utilization === null ? [] : [gpu.utilization])
    evaluatedSignals += addThresholdIssue(issues, 'GPU', gpuValues.length ? Math.max(...gpuValues) : null, settings.homeHighLoadThreshold, 95)
  }

  const usage = trafficUsage(server)
  evaluatedSignals += addThresholdIssue(issues, '流量配额', usage?.percent ?? null, settings.homeTrafficWarningThreshold, 100)

  const days = server.showExpire ? daysUntilExpiry(server.expireDate, now) : null
  if (days !== null) {
    evaluatedSignals += 1
    if (days < 0) issues.push({ metric: '到期', message: `已过期 ${Math.abs(days)} 天`, tone: 'critical' })
    else if (days <= settings.homeExpiringDays) issues.push({ metric: '到期', message: `${days} 天后到期`, tone: 'warning' })
  }

  const probeLatency = server.latency.flatMap((probe) => typeof probe.latency === 'number' ? [probe.latency] : [])
  const timedOut = server.latency.filter((probe) => probe.latency === null || probe.packetLoss === null).length
  if (server.online && server.latency.length > 0) {
    evaluatedSignals += 1
    if (timedOut > 0) issues.push({ metric: '探测', message: `${timedOut} 个 Ping/Loss 目标超时`, tone: 'critical' })
    const peakLatency = probeLatency.length ? Math.max(...probeLatency) : null
    addThresholdIssue(issues, 'Ping', peakLatency, 250, 500, ' ms')
    const lossValues = server.latency.flatMap((probe) => typeof probe.packetLoss === 'number' ? [probe.packetLoss] : [])
    addThresholdIssue(issues, 'Loss', lossValues.length ? Math.max(...lossValues) : null, 5, 20)
  }

  // 健康度只做聚合统计，因此把窗口压成纯数值样本；柱状图另走按桶渲染的路径。
  const latencySamples = numericWindowSamples(server.history.latencySeries)
  const lossSamples = numericWindowSamples(server.history.packetLossSeries)
  const historicalLatency = average(latencySamples)
  const historicalLoss = average(lossSamples)
  const historySamples = latencySamples.length + lossSamples.length
  if (historySamples > 0) {
    evaluatedSignals += 1
    addThresholdIssue(issues, '历史平均 Ping', historicalLatency, 250, 500, ' ms')
    addThresholdIssue(issues, '历史平均 Loss', historicalLoss, 5, 20)
  }

  const criticalCount = issues.filter((issue) => issue.tone === 'critical').length
  const warningCount = issues.length - criticalCount
  const score = Math.max(0, 100 - criticalCount * 25 - warningCount * 10)
  // 有严重问题（例如离线）就是明确结论，不因其余信号不足而判为「数据不足」。
  const tone: HealthTone = criticalCount > 0
    ? 'critical'
    : evaluatedSignals < 2
      ? 'unknown'
      : score < 50
        ? 'critical'
        : warningCount > 0 || score < 80
          ? 'warning'
          : 'healthy'
  return { server, tone, score: tone === 'unknown' ? null : score, evaluatedSignals, historySamples, issues }
}

export function buildHealthSummary(servers: readonly GlassServer[], settings: Pick<ThemeSettings, 'homeHighLoadThreshold' | 'homeTrafficWarningThreshold' | 'homeExpiringDays'>, now = Date.now()): ServerHealth[] {
  return servers.map((server) => evaluateServerHealth(server, settings, now)).sort((left, right) => {
    const rank: Record<HealthTone, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 }
    return rank[left.tone] - rank[right.tone] || (left.score ?? -1) - (right.score ?? -1) || left.server.name.localeCompare(right.server.name)
  })
}

export interface ValueRow {
  server: GlassServer
  currency: string
  monthlyCost: number
  score: number
  coverage: number
  resources: { cpuCores: number | null, memoryGiB: number | null, diskGiB: number | null, trafficTiB: number | null }
}

export interface ValueGroup {
  currency: string
  rows: ValueRow[]
}

/** 与详情页「月均支出」、CFSM 同一口径（价格 ÷ 周期天数 × 30）；免费、未设置价格或未知周期不参与。 */
export function monthlyPrice(server: GlassServer): number | null {
  const result = monthlyCost(server)
  return result.status === 'ok' && result.amount > 0 ? result.amount : null
}

export function buildValueGroups(servers: readonly GlassServer[]): ValueGroup[] {
  const groups = new Map<string, ValueRow[]>()
  for (const server of servers) {
    const cost = monthlyPrice(server)
    if (cost === null) continue
    const cpuCores = server.cpuCores !== null && server.cpuCores > 0 ? server.cpuCores : null
    const memoryGiB = server.memory.total !== null && server.memory.total > 0 ? server.memory.total / 1024 : null
    const diskGiB = server.disk.total !== null && server.disk.total > 0 ? server.disk.total / 1024 : null
    const trafficBytes = parseTrafficLimitBytes(server.trafficLimit)
    const trafficTiB = trafficBytes === null ? null : trafficBytes / 1024 ** 4
    const values = [cpuCores, memoryGiB, diskGiB, trafficTiB]
    const coverage = values.filter((value) => value !== null).length
    if (coverage === 0) continue
    const resourcePoints = (cpuCores ?? 0) * 4 + (memoryGiB ?? 0) * 2 + (diskGiB ?? 0) / 25 + (trafficTiB ?? 0) * 8
    // 按规范化后的币种分组：`$`、`US$` 与 `USD` 是同一种钱，排在同一张表里比较。
    const source = resolveSourceCurrency(server.currency)
    const currency = source.status === 'known' ? source.code : server.currency?.trim() || '未标明币种'
    const row: ValueRow = { server, currency, monthlyCost: cost, score: resourcePoints / cost, coverage, resources: { cpuCores, memoryGiB, diskGiB, trafficTiB } }
    groups.set(currency, [...(groups.get(currency) ?? []), row])
  }
  return [...groups.entries()].map(([currency, rows]) => ({
    currency,
    rows: rows.sort((left, right) => right.score - left.score || left.server.name.localeCompare(right.server.name)),
  })).sort((left, right) => left.currency.localeCompare(right.currency))
}

export interface TopologyRegion {
  region: string
  groups: Array<{ group: string, servers: GlassServer[] }>
}

export function buildTopology(servers: readonly GlassServer[]): TopologyRegion[] {
  const regions = new Map<string, Map<string, GlassServer[]>>()
  for (const server of servers) {
    const region = server.region?.trim() || '未提供地区'
    const group = server.group.trim() || '未分组'
    const groups = regions.get(region) ?? new Map<string, GlassServer[]>()
    groups.set(group, [...(groups.get(group) ?? []), server])
    regions.set(region, groups)
  }
  return [...regions.entries()].map(([region, groups]) => ({
    region,
    groups: [...groups.entries()].map(([group, groupServers]) => ({ group, servers: groupServers })),
  })).sort((left, right) => left.region.localeCompare(right.region))
}

function probeSnapshot(value: number | null | false): number | 'timeout' | 'unconfigured' {
  return value === null ? 'timeout' : value === false ? 'unconfigured' : value
}

export function buildSnapshot(servers: readonly GlassServer[], siteTitle: string, generatedAt = new Date()): Record<string, unknown> {
  return {
    schema: 'cfsm-glassmorphism.snapshot.v1',
    generatedAt: generatedAt.toISOString(),
    siteTitle,
    nodeCount: servers.length,
    nodes: servers.map((server) => ({
      id: server.id,
      sourceBase: server.sourceBase,
      sourceLabel: server.sourceLabel,
      name: server.name,
      group: server.group,
      tags: [...server.tags],
      region: server.region,
      online: server.online,
      price: server.price,
      billingCycle: server.billingCycle,
      currency: server.currency,
      expireDate: server.expireDate,
      trafficLimit: server.trafficLimit,
      trafficCalculationType: server.trafficCalculationType,
      cpu: server.cpu,
      load: { ...server.load },
      memory: { ...server.memory },
      swap: { ...server.swap },
      disk: { ...server.disk },
      network: { ...server.network },
      processes: server.processes,
      tcpConnections: server.tcpConnections,
      udpConnections: server.udpConnections,
      latency: server.latency.map((probe) => ({ ...probe, latency: probeSnapshot(probe.latency), packetLoss: probeSnapshot(probe.packetLoss) })),
      history: cloneHistorySummary(server.history),
      gpus: server.gpus.map((gpu) => ({ ...gpu })),
      connectivity: { ...server.connectivity },
      operatingSystem: server.operatingSystem,
      architecture: server.architecture,
      cpuInfo: server.cpuInfo,
      cpuCores: server.cpuCores,
      kernelVersion: server.kernelVersion,
      agentVersion: server.agentVersion,
      bootTime: server.bootTime,
      lastUpdated: server.lastUpdated,
    })),
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${protectedText.replaceAll('"', '""')}"`
}

export function buildSnapshotCsv(servers: readonly GlassServer[]): string {
  const header = ['ID', '数据源', '名称', '分组', '标签', '地区', '在线', 'CPU %', 'RAM %', 'Disk %', '下载 B/s', '上传 B/s', '价格', '账期', '币种', '到期', '流量限制', '最后更新']
  const rows = servers.map((server) => [
    server.id, server.sourceBase, server.name, server.group, server.tags.join('|'), server.region,
    server.online, server.cpu, server.memory.percentage, server.disk.percentage,
    server.network.inSpeed, server.network.outSpeed, server.price, server.billingCycle,
    server.currency, server.expireDate, server.trafficLimit, server.lastUpdated,
  ])
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
