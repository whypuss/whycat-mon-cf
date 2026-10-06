import { splitProviderTags } from './provider-tags'
import type {
  ApiSource,
  CfsmRealtimeSample,
  CfsmServer,
  DiskIoMetrics,
  GpuMetrics,
  HistoryPoint,
  LatencyCarrier,
  LatencyWindowSample,
  LatestReportUpdate,
  ProbeValue,
  ProbeValues,
  ServerCollection,
  ServerSystemConfig,
  SiteConfig,
  ThemeOptionsSaveResult,
} from '@/types/cfsm'
import {
  DEFAULT_PROBE_LABELS,
  LEGACY_PROBE_TARGETS,
  PROBE_TARGETS,
} from '@/constants/probes'

const FIVE_MINUTES_MS = 5 * 60 * 1000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function preferredThemeValue(value: unknown): SiteConfig['preferredTheme'] {
  return value === 'dark' || value === 'light' ? value : 'auto'
}

function liveSocketTimeoutMinutes(value: unknown): number {
  const minutes = numberValue(value)
  return minutes !== null && Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440
    ? minutes
    : 0
}

function defaultLanguageValue(value: unknown): SiteConfig['defaultLanguage'] {
  return value === 'zh' || value === 'en' ? value : 'auto'
}

function reachabilityValue(value: unknown): '0' | '1' | null {
  if (value === '1' || value === 1 || value === true) return '1'
  if (value === '0' || value === 0 || value === false) return '0'
  return null
}

function splitTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return [...new Set(values.map(stringValue).filter((item): item is string => item !== null))]
}

function loadValues(value: unknown): [number | null, number | null, number | null] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.trim().split(/\s+/)
      : []
  return [numberValue(values[0]), numberValue(values[1]), numberValue(values[2])]
}

function probeValue(value: unknown): ProbeValue {
  if (value === null) return null
  if (value === false || value === undefined) return false
  return numberValue(value) ?? false
}

function probeValues(value: Record<string, unknown>, prefix: 'ping' | 'loss'): ProbeValues {
  return {
    ct: probeValue(value[`${prefix}_ct`]),
    cu: probeValue(value[`${prefix}_cu`]),
    cm: probeValue(value[`${prefix}_cm`]),
    bd: probeValue(value[`${prefix}_bd`]),
    node_1: probeValue(value[`${prefix}_node_1`]),
    node_2: probeValue(value[`${prefix}_node_2`]),
    node_3: probeValue(value[`${prefix}_node_3`]),
    node_4: probeValue(value[`${prefix}_node_4`]),
  }
}

/**
 * 解析 `/api/servers` 的延迟 / 丢包窗口。
 *
 * 服务端会给每个点写入全部 8 个探测目标，因此这里也必须读全 8 个——
 * 只读旧四线路会静默丢掉 `node_1`～`node_4`，而 CFSM 2.8.5 起这四个是正式功能。
 * 点顺序服务端已保证升序，这里按 `ts` 再稳一次，避免旧库或缓存返回乱序。
 */
function latencyWindow(value: unknown): LatencyWindowSample[] {
  if (!Array.isArray(value)) return []

  return value
    .flatMap((entry) => {
      if (!isRecord(entry)) return []
      const timestamp = numberValue(entry.ts)
      if (timestamp === null) return []
      return [{
        timestamp,
        ...Object.fromEntries(PROBE_TARGETS.map((target) => [target, probeValue(entry[target])])),
      } as LatencyWindowSample]
    })
    .sort((left, right) => left.timestamp - right.timestamp)
}

/*
 * 与 CFSM 服务端 `hasDiskMetricsPayload` 一致：六项全为 0 或缺失视为没有磁盘 IO 数据。
 * 服务端把这种采样以 null 写入历史、输出时去掉 `disk` 对象；这里同样返回 undefined，
 * 实时与历史因此表现一致（图上是缺口，而不是一条 0 线）。
 */
function diskIoValue(value: unknown): DiskIoMetrics | undefined {
  if (!isRecord(value)) return undefined
  const disk = {
    readBps: numberValue(value.read_bps) ?? 0,
    writeBps: numberValue(value.write_bps) ?? 0,
    readIops: numberValue(value.read_iops) ?? 0,
    writeIops: numberValue(value.write_iops) ?? 0,
    awaitMs: numberValue(value.await_ms) ?? 0,
    utilization: numberValue(value.util) ?? 0,
  }
  return Object.values(disk).some((metric) => metric !== 0) ? disk : undefined
}

function legacyHistoryDiskIoValue(value: Record<string, unknown>): DiskIoMetrics | undefined {
  return diskIoValue({
    read_bps: value.disk_read_bps,
    write_bps: value.disk_write_bps,
    read_iops: value.disk_read_iops,
    write_iops: value.disk_write_iops,
    await_ms: value.disk_await_ms,
    util: value.disk_util,
  })
}

function gpuValues(value: unknown): GpuMetrics[] {
  let candidate = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(candidate)) return []

  return candidate.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = stringValue(entry.id)
    const name = stringValue(entry.name)
    if (id === null || name === null) return []
    return [{ id, name, utilization: numberValue(entry.info) }]
  })
}

function latestReportUpdates(value: unknown): LatestReportUpdate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const serverId = stringValue(entry.serverId)
    if (serverId === null) return []
    const samples = Array.isArray(entry.samples)
      ? entry.samples.flatMap((sample) => {
          if (!isRecord(sample)) return []
          const timestamp = numberValue(sample.ts)
          const data = objectValue(sample.data)
          return timestamp === null ? [] : [{ timestamp, data }]
        })
      : []
    return [{
      serverId,
      reportTimestamp: numberValue(entry.reportTs),
      reportAgeMs: numberValue(entry.reportAgeMs),
      samples,
    }]
  })
}

function systemConfig(value: unknown): ServerSystemConfig | undefined {
  if (!isRecord(value)) return undefined
  const result: ServerSystemConfig = {}
  if ('show_price' in value) result.showPrice = booleanValue(value.show_price)
  if ('show_expire' in value) result.showExpire = booleanValue(value.show_expire)
  if ('show_tf' in value) result.showTraffic = booleanValue(value.show_tf)
  const historyPoints = numberValue(value.long_history_points)
  if (historyPoints !== null) result.longHistoryPoints = historyPoints
  return Object.keys(result).length > 0 ? result : undefined
}

function isOnline(value: Record<string, unknown>, now: number): boolean {
  if (value.is_online === true || value.is_online === false
    || value.is_online === 1 || value.is_online === 0
    || value.is_online === '1' || value.is_online === '0'
    || value.is_online === 'true' || value.is_online === 'false') {
    return booleanValue(value.is_online)
  }
  const updated = numberValue(value.last_updated) ?? numberValue(value.timestamp)
  return updated !== null && updated <= now + FIVE_MINUTES_MS && now - updated <= FIVE_MINUTES_MS
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(label + ' response must be an object')
  return value
}

export function normalizeSiteConfig(value: unknown): SiteConfig {
  const input = requiredRecord(value, 'Config')
  const latencyConfig = objectValue(input.latency_window)
  const title = stringValue(input.site_title)

  return {
    version: stringValue(input.version),
    latestWorkersVersion: stringValue(input.last_workers_version),
    latestAgentVersion: stringValue(input.last_agent_version),
    isPublic: booleanValue(input.is_public),
    authorization: booleanValue(input.authorization),
    turnstileEnabled: booleanValue(input.turnstile_enabled),
    turnstileLoginEnabled: booleanValue(input.turnstile_login_enabled),
    turnstileSiteKey: stringValue(input.turnstile_site_key),
    probeLabels: {
      ct: stringValue(input.custom_ct_name) ?? DEFAULT_PROBE_LABELS.ct,
      cu: stringValue(input.custom_cu_name) ?? DEFAULT_PROBE_LABELS.cu,
      cm: stringValue(input.custom_cm_name) ?? DEFAULT_PROBE_LABELS.cm,
      bd: stringValue(input.custom_bd_name) ?? DEFAULT_PROBE_LABELS.bd,
      node_1: stringValue(input.node_1_name) ?? DEFAULT_PROBE_LABELS.node_1,
      node_2: stringValue(input.node_2_name) ?? DEFAULT_PROBE_LABELS.node_2,
      node_3: stringValue(input.node_3_name) ?? DEFAULT_PROBE_LABELS.node_3,
      node_4: stringValue(input.node_4_name) ?? DEFAULT_PROBE_LABELS.node_4,
    },
    siteTitle: title ?? 'CF Server Monitor',
    preferredTheme: preferredThemeValue(input.preferred_theme),
    defaultLanguage: defaultLanguageValue(input.default_language),
    themeOptions: objectValue(input.theme_options),
    verified: booleanValue(input.verified),
    turnstileVerified: stringValue(input.turnstile_verified),
    frontendWebsocketTimeoutMinutes: liveSocketTimeoutMinutes(input.frontend_ws_timeout_minutes),
    longHistoryPoints: numberValue(input.long_history_points) ?? 120,
    latencyWindow: {
      points: numberValue(latencyConfig.points) ?? 20,
      hours: numberValue(latencyConfig.hours) ?? 2,
    },
  }
}

export function normalizeServer(
  value: unknown,
  source: ApiSource,
  now = Date.now(),
): CfsmServer {
  const input = requiredRecord(value, 'Server')
  const id = stringValue(input.id)
  if (id === null) throw new Error('Server response is missing a valid id')
  const [load1, load5, load15] = loadValues(input.load_avg)
  const { tags, providerTags } = splitProviderTags(splitTags(input.tags))

  return {
    id,
    source,
    name: stringValue(input.name) ?? id,
    group: stringValue(input.server_group) ?? '',
    tags,
    providerTags,
    price: stringValue(input.price),
    billingCycle: stringValue(input.billing_cycle),
    autoRenewal: stringValue(input.auto_renewal),
    currency: stringValue(input.currency),
    expireDate: stringValue(input.expire_date),
    trafficLimit: stringValue(input.traffic_limit),
    trafficCalculationType: stringValue(input.traffic_calc_type),
    resetDay: numberValue(input.reset_day),
    reportInterval: numberValue(input.report_interval),
    websocketReportInterval: numberValue(input.wss_report_interval),
    hidden: booleanValue(input.is_hidden),
    sortOrder: numberValue(input.sort_order),
    online: isOnline(input, now),
    cpu: numberValue(input.cpu),
    load1,
    load5,
    load15,
    networkInSpeed: numberValue(input.net_in_speed),
    networkOutSpeed: numberValue(input.net_out_speed),
    networkReceived: numberValue(input.net_rx),
    networkTransmitted: numberValue(input.net_tx),
    monthlyNetworkReceived: numberValue(input.net_rx_monthly),
    monthlyNetworkTransmitted: numberValue(input.net_tx_monthly),
    processes: numberValue(input.processes),
    tcpConnections: numberValue(input.tcp_conn),
    udpConnections: numberValue(input.udp_conn),
    latency: probeValues(input, 'ping'),
    packetLoss: probeValues(input, 'loss'),
    latencyWindow: latencyWindow(input.ping),
    packetLossWindow: latencyWindow(input.loss),
    memoryTotal: numberValue(input.ram_total),
    memoryUsed: numberValue(input.ram_used),
    swapTotal: numberValue(input.swap_total),
    swapUsed: numberValue(input.swap_used),
    diskTotal: numberValue(input.disk_total),
    diskUsed: numberValue(input.disk_used),
    diskIo: diskIoValue(input.disk),
    cpuCores: numberValue(input.cpu_cores),
    cpuInfo: stringValue(input.cpu_info),
    gpus: gpuValues(input.gpu_info),
    architecture: stringValue(input.arch),
    operatingSystem: stringValue(input.os),
    kernelVersion: stringValue(input.kernel_version),
    region: stringValue(input.region),
    ipV4Reachable: reachabilityValue(input.ip_v4),
    ipV6Reachable: reachabilityValue(input.ip_v6),
    bootTime: numberValue(input.boot_time),
    agentVersion: stringValue(input.agent_version),
    lastUpdated: numberValue(input.last_updated),
    timestamp: numberValue(input.timestamp),
    latestReportUpdates: latestReportUpdates(input.latestReportUpdates),
    systemConfig: systemConfig(input.sysConfig),
  }
}

/*
 * `/api/servers` 把 `show_price` / `show_expire` / `show_tf` 放在**响应顶层**的
 * `sysConfig` 里，而不是每台节点上（见 CFSM `handleServersAPI`）。
 * 这里把站点级开关下发到每台节点，节点自身若带同名字段则以节点为准。
 * 不下发的话这些开关会被解析后直接丢弃，运营方隐藏价格 / 到期 / 流量的设置将完全失效。
 */
function withSiteVisibility(
  server: CfsmServer,
  site: ServerSystemConfig | undefined,
): CfsmServer {
  if (!site) return server
  const merged: ServerSystemConfig = { ...site, ...server.systemConfig }
  return { ...server, systemConfig: merged }
}

export function normalizeServerCollection(
  value: unknown,
  source: ApiSource,
  now = Date.now(),
): ServerCollection {
  const input = requiredRecord(value, 'Servers')
  if (!Array.isArray(input.servers)) throw new Error('Servers response is missing the servers array')

  const site = systemConfig(input.sysConfig)

  return {
    source,
    servers: input.servers.flatMap((server) => {
      if (!isRecord(server) || stringValue(server.id) === null) return []
      return [withSiteVisibility(normalizeServer(server, source, now), site)]
    }),
    stats: objectValue(input.stats),
    systemConfig: site,
  }
}

function realtimeSampleData(value: Record<string, unknown>): Record<string, unknown> | null {
  const candidates = [value.data, value.payload, value.metrics]
  return candidates.find(isRecord) ?? null
}

export function normalizeSocketBatch(value: unknown): CfsmRealtimeSample[] {
  if (!isRecord(value) || value.type !== 'batchUpdate' || !Array.isArray(value.updates)) return []
  const messageTimestamp = numberValue(value.ts) ?? numberValue(value.timestamp)

  return value.updates.flatMap((rawUpdate) => {
    if (!isRecord(rawUpdate) || !Array.isArray(rawUpdate.samples)) return []
    const serverId = stringValue(rawUpdate.serverId)
    if (serverId === null) return []
    const updateTimestamp = numberValue(rawUpdate.ts)
      ?? numberValue(rawUpdate.timestamp)
      ?? messageTimestamp

    return rawUpdate.samples
      .flatMap((rawSample, index) => {
        if (!isRecord(rawSample)) return []
        const data = realtimeSampleData(rawSample)
        if (data === null) return []
        const timestamp = numberValue(rawSample.ts)
          ?? numberValue(rawSample.timestamp)
          ?? numberValue(data.sample_timestamp)
          ?? numberValue(data.last_updated)
          ?? numberValue(data.timestamp)
          ?? updateTimestamp
        return [{ serverId, timestamp, data: { ...data }, index }]
      })
      .sort((left, right) => {
        if (left.timestamp === null && right.timestamp === null) return left.index - right.index
        if (left.timestamp === null) return 1
        if (right.timestamp === null) return -1
        return left.timestamp - right.timestamp || left.index - right.index
      })
      .map((sample) => ({
        serverId: sample.serverId,
        timestamp: sample.timestamp,
        data: sample.data,
      }))
  })
}

export function mergeRealtimeSample(
  server: CfsmServer,
  sample: CfsmRealtimeSample,
  receivedAt = Date.now(),
): CfsmServer {
  if (server.id !== sample.serverId) return server
  const input = sample.data
  const normalized = normalizeServer({ ...input, id: server.id }, server.source, receivedAt)
  const next: CfsmServer = {
    ...server,
    online: true,
    lastUpdated: receivedAt,
    timestamp: sample.timestamp ?? receivedAt,
  }

  const name = stringValue(input.name)
  if (name !== null) next.name = name
  if ('server_group' in input) next.group = normalized.group
  if ('tags' in input) {
    next.tags = normalized.tags
    next.providerTags = normalized.providerTags
  }
  if ('price' in input) next.price = normalized.price
  if ('billing_cycle' in input) next.billingCycle = normalized.billingCycle
  if ('auto_renewal' in input) next.autoRenewal = normalized.autoRenewal
  if ('currency' in input) next.currency = normalized.currency
  if ('expire_date' in input) next.expireDate = normalized.expireDate
  if ('traffic_limit' in input) next.trafficLimit = normalized.trafficLimit
  if ('traffic_calc_type' in input) next.trafficCalculationType = normalized.trafficCalculationType
  if ('reset_day' in input) next.resetDay = normalized.resetDay
  if ('report_interval' in input) next.reportInterval = normalized.reportInterval
  if ('wss_report_interval' in input) next.websocketReportInterval = normalized.websocketReportInterval
  if ('is_hidden' in input) next.hidden = normalized.hidden
  if ('sort_order' in input) next.sortOrder = normalized.sortOrder
  if ('is_online' in input) next.online = normalized.online
  if ('cpu' in input) next.cpu = normalized.cpu
  if ('load_avg' in input) {
    next.load1 = normalized.load1
    next.load5 = normalized.load5
    next.load15 = normalized.load15
  }
  if ('net_in_speed' in input) next.networkInSpeed = normalized.networkInSpeed
  if ('net_out_speed' in input) next.networkOutSpeed = normalized.networkOutSpeed
  if ('net_rx' in input) next.networkReceived = normalized.networkReceived
  if ('net_tx' in input) next.networkTransmitted = normalized.networkTransmitted
  if ('net_rx_monthly' in input) next.monthlyNetworkReceived = normalized.monthlyNetworkReceived
  if ('net_tx_monthly' in input) next.monthlyNetworkTransmitted = normalized.monthlyNetworkTransmitted
  if ('processes' in input) next.processes = normalized.processes
  if ('tcp_conn' in input) next.tcpConnections = normalized.tcpConnections
  if ('udp_conn' in input) next.udpConnections = normalized.udpConnections
  if ('ram_total' in input) next.memoryTotal = normalized.memoryTotal
  if ('ram_used' in input) next.memoryUsed = normalized.memoryUsed
  if ('swap_total' in input) next.swapTotal = normalized.swapTotal
  if ('swap_used' in input) next.swapUsed = normalized.swapUsed
  if ('disk_total' in input) next.diskTotal = normalized.diskTotal
  if ('disk_used' in input) next.diskUsed = normalized.diskUsed
  if ('disk' in input) next.diskIo = normalized.diskIo
  if ('cpu_cores' in input) next.cpuCores = normalized.cpuCores
  if ('cpu_info' in input) next.cpuInfo = normalized.cpuInfo
  if ('gpu_info' in input) next.gpus = normalized.gpus
  if ('arch' in input) next.architecture = normalized.architecture
  if ('os' in input) next.operatingSystem = normalized.operatingSystem
  if ('kernel_version' in input) next.kernelVersion = normalized.kernelVersion
  if ('region' in input) next.region = normalized.region
  if ('ip_v4' in input) next.ipV4Reachable = normalized.ipV4Reachable
  if ('ip_v6' in input) next.ipV6Reachable = normalized.ipV6Reachable
  if ('boot_time' in input) next.bootTime = normalized.bootTime
  if ('agent_version' in input) next.agentVersion = normalized.agentVersion

  const latency = { ...server.latency }
  const packetLoss = { ...server.packetLoss }
  for (const target of PROBE_TARGETS) {
    const pingKey = `ping_${target}`
    const lossKey = `loss_${target}`
    if (pingKey in input) latency[target] = normalized.latency[target]
    if (lossKey in input) packetLoss[target] = normalized.packetLoss[target]
  }
  next.latency = latency
  next.packetLoss = packetLoss

  return next
}

export function normalizeHistory(value: unknown): HistoryPoint[] {
  if (!Array.isArray(value)) throw new Error('History response must be an array')

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const timestamp = numberValue(entry.timestamp)
    if (timestamp === null) return []
    const [load1, load5, load15] = loadValues(entry.load_avg)

    return [{
      timestamp,
      cpu: numberValue(entry.cpu),
      gpus: gpuValues(entry.gpu_info),
      memoryUsed: numberValue(entry.ram_used),
      memoryTotal: numberValue(entry.ram_total),
      swapUsed: numberValue(entry.swap_used),
      swapTotal: numberValue(entry.swap_total),
      diskUsed: numberValue(entry.disk_used),
      diskTotal: numberValue(entry.disk_total),
      networkInSpeed: numberValue(entry.net_in_speed),
      networkOutSpeed: numberValue(entry.net_out_speed),
      networkReceived: numberValue(entry.net_rx),
      networkTransmitted: numberValue(entry.net_tx),
      processes: numberValue(entry.processes),
      tcpConnections: numberValue(entry.tcp_conn),
      udpConnections: numberValue(entry.udp_conn),
      load1,
      load5,
      load15,
      temperature: numberValue(entry.temperature),
      latency: probeValues(entry, 'ping'),
      packetLoss: probeValues(entry, 'loss'),
      diskIo: diskIoValue(entry.disk) ?? legacyHistoryDiskIoValue(entry),
    }]
  })
}

export function normalizeThemeOptionsSave(value: unknown): ThemeOptionsSaveResult {
  const input = requiredRecord(value, 'Theme options save')
  return {
    success: input.success === true,
    themeOptions: objectValue(input.theme_options),
    message: stringValue(input.message),
  }
}

export function latencyCarrierKeys(): readonly LatencyCarrier[] {
  return LEGACY_PROBE_TARGETS
}
