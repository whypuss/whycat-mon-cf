import type {
  CfsmServer,
  LatencyWindowSample,
  ProbeTarget,
  ProbeValue,
  SiteConfig,
} from '@/types/cfsm'
import { DEFAULT_PROBE_LABELS, PROBE_TARGETS } from '@/constants/probes'
import type {
  GlassLatencySample,
  GlassResourceMetric,
  GlassServer,
} from '@/types/glassmorphism'

function finiteNonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null
}

function probeMetric(value: ProbeValue): ProbeValue {
  if (value === false || value === null) return value
  return finiteNonNegative(value) ?? false
}

function probeTargetKeys(): readonly ProbeTarget[] {
  return PROBE_TARGETS
}

/*
 * 把 `/api/servers` 的窗口按探测目标拆成等长时间序列。
 *
 * 每个目标都保留全部时间桶，`null`（无采样）与 `false`（未配置）原样保留：
 * 首页柱状图按桶逐格渲染，过滤掉空洞会让后续柱子前移并造成时间轴错位。
 * 某个目标在整段窗口里都是 `false` 时不产出序列——那表示该探测点没有配置。
 */
function probeSeries(
  window: readonly LatencyWindowSample[],
): Partial<Record<ProbeTarget, GlassLatencySample[]>> {
  const series: Partial<Record<ProbeTarget, GlassLatencySample[]>> = {}
  for (const target of PROBE_TARGETS) {
    const points = window.map((sample) => ({
      timestamp: sample.timestamp,
      value: probeMetric(sample[target]),
    }))
    if (points.length === 0 || points.every((point) => point.value === false)) continue
    series[target] = points
  }
  return series
}
function boundedPercentage(value: number | null): number | null {
  const metric = finiteNonNegative(value)
  return metric === null ? null : Math.min(metric, 100)
}

function resourceMetric(usedValue: number | null, totalValue: number | null): GlassResourceMetric {
  const used = finiteNonNegative(usedValue)
  const total = finiteNonNegative(totalValue)
  const percentage = used !== null && total !== null && total > 0
    ? Math.min(Math.max((used / total) * 100, 0), 100)
    : null
  return { used, total, percentage }
}

function serverKey(server: CfsmServer): string {
  return encodeURIComponent(server.source.base) + ':' + server.id
}

export function toGlassServer(server: CfsmServer, config: SiteConfig | null): GlassServer {
  const labels = config?.probeLabels ?? DEFAULT_PROBE_LABELS

  return {
    key: serverKey(server),
    id: server.id,
    sourceBase: server.source.base,
    sourceLabel: server.source.label,
    name: server.name,
    group: server.group,
    tags: server.tags,
    providerTags: server.providerTags,
    region: server.region,
    price: server.price,
    billingCycle: server.billingCycle,
    currency: server.currency,
    expireDate: server.expireDate,
    trafficLimit: server.trafficLimit,
    trafficCalculationType: server.trafficCalculationType,
    showPrice: server.systemConfig?.showPrice !== false,
    showExpire: server.systemConfig?.showExpire !== false,
    showTraffic: server.systemConfig?.showTraffic !== false,
    online: server.online,
    sortOrder: server.sortOrder,
    cpu: boundedPercentage(server.cpu),
    load: {
      one: finiteNonNegative(server.load1),
      five: finiteNonNegative(server.load5),
      fifteen: finiteNonNegative(server.load15),
    },
    memory: resourceMetric(server.memoryUsed, server.memoryTotal),
    swap: resourceMetric(server.swapUsed, server.swapTotal),
    disk: resourceMetric(server.diskUsed, server.diskTotal),
    network: {
      inSpeed: finiteNonNegative(server.networkInSpeed),
      outSpeed: finiteNonNegative(server.networkOutSpeed),
      received: finiteNonNegative(server.networkReceived),
      transmitted: finiteNonNegative(server.networkTransmitted),
      monthlyReceived: finiteNonNegative(server.monthlyNetworkReceived),
      monthlyTransmitted: finiteNonNegative(server.monthlyNetworkTransmitted),
    },
    processes: finiteNonNegative(server.processes),
    tcpConnections: finiteNonNegative(server.tcpConnections),
    udpConnections: finiteNonNegative(server.udpConnections),
    /*
     * 八个探测目标全部参与，与 CFSM `mergeMetricsIntoServer` 写入的字段集一致。
     * 只有延迟与丢包都为 `false`（未配置）时才整条略过；`null`（超时）要保留，
     * 否则会把「探测超时」误报成「没有这个探测点」。
     */
    latency: probeTargetKeys().flatMap((target) => {
      const latency = probeMetric(server.latency[target])
      const packetLossValue = probeMetric(server.packetLoss[target])
      const packetLoss = typeof packetLossValue === 'number'
        ? Math.min(packetLossValue, 100)
        : packetLossValue
      if (latency === false && packetLoss === false) return []
      return [{
        target,
        label: labels[target],
        latency,
        packetLoss,
      }]
    }),
    history: {
      latencySeries: probeSeries(server.latencyWindow),
      packetLossSeries: probeSeries(server.packetLossWindow),
    },
    gpus: server.gpus.map((gpu) => ({
      id: gpu.id,
      name: gpu.name,
      utilization: boundedPercentage(gpu.utilization),
    })),
    connectivity: {
      ipv4: server.ipV4Reachable,
      ipv6: server.ipV6Reachable,
    },
    operatingSystem: server.operatingSystem,
    architecture: server.architecture,
    cpuInfo: server.cpuInfo,
    cpuCores: finiteNonNegative(server.cpuCores),
    kernelVersion: server.kernelVersion,
    agentVersion: server.agentVersion,
    bootTime: finiteNonNegative(server.bootTime),
    lastUpdated: server.lastUpdated ?? server.timestamp,
  }
}

export interface GlassServerMapper {
  map(servers: readonly CfsmServer[], config: SiteConfig | null): GlassServer[]
}

export function createGlassServerMapper(): GlassServerMapper {
  const cache = new WeakMap<CfsmServer, { config: SiteConfig | null, value: GlassServer }>()

  return {
    map(servers, config) {
      return servers.map((server) => {
        const cached = cache.get(server)
        if (cached?.config === config) return cached.value
        const value = toGlassServer(server, config)
        cache.set(server, { config, value })
        return value
      })
    },
  }
}
