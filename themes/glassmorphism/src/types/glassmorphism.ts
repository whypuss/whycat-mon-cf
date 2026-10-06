import type { ProbeTarget, ProbeValue, ProviderTags, Reachability } from './cfsm'

export interface GlassResourceMetric {
  used: number | null
  total: number | null
  percentage: number | null
}
export interface GlassLatencyMetric {
  /** 八个探测目标之一：旧四线路 ct/cu/cm/bd 与 CFSM 2.8.5 起的 node_1～node_4。 */
  target: ProbeTarget
  label: string
  latency: ProbeValue
  packetLoss: ProbeValue
}

export interface GlassGpuMetric {
  id: string
  name: string
  utilization: number | null
}

/**
 * 首页延迟 / 丢包小窗口的一个采样点。
 *
 * 必须保留 `null`（该时间桶无采样）与 `false`（该探测点未配置），
 * 因为柱状图是**按时间桶**逐格渲染的：把空洞过滤掉会让后面的柱子整体前移，
 * 时间轴随之错位——这正是第 14 轮修掉的 BUG-001。
 */
export interface GlassLatencySample {
  timestamp: number
  value: ProbeValue
}

/** 按探测目标分组的窗口序列；每个目标各自是一条等长的时间序列。 */
export interface GlassHistorySummary {
  latencySeries: Partial<Record<ProbeTarget, GlassLatencySample[]>>
  packetLossSeries: Partial<Record<ProbeTarget, GlassLatencySample[]>>
}

export interface GlassServer {
  key: string
  id: string
  sourceBase: string
  sourceLabel: string
  name: string
  group: string
  tags: string[]
  /** 运营者在标签里约定的 ASN / 组织名（见 `services/cfsm/provider-tags.ts`），只用于厂商识别。 */
  providerTags: ProviderTags
  region: string | null
  price: string | null
  billingCycle: string | null
  currency: string | null
  expireDate: string | null
  trafficLimit: string | null
  trafficCalculationType: string | null
  showPrice: boolean
  showExpire: boolean
  showTraffic: boolean
  online: boolean
  sortOrder: number | null
  cpu: number | null
  load: {
    one: number | null
    five: number | null
    fifteen: number | null
  }
  memory: GlassResourceMetric
  swap: GlassResourceMetric
  disk: GlassResourceMetric
  network: {
    inSpeed: number | null
    outSpeed: number | null
    received: number | null
    transmitted: number | null
    monthlyReceived: number | null
    monthlyTransmitted: number | null
  }
  processes: number | null
  tcpConnections: number | null
  udpConnections: number | null
  latency: GlassLatencyMetric[]
  history: GlassHistorySummary
  gpus: GlassGpuMetric[]
  connectivity: {
    ipv4: Reachability
    ipv6: Reachability
  }
  operatingSystem: string | null
  architecture: string | null
  cpuInfo: string | null
  cpuCores: number | null
  kernelVersion: string | null
  agentVersion: string | null
  bootTime: number | null
  lastUpdated: number | null
}

/**
 * 首页视图模式只有卡片与列表两种，与 Komari `appStore.nodeViewMode` 一致。
 * 卡片的密度（mini / compact / comfortable / large）是独立的主题设置
 * `nodeCardSize`，不折叠进视图模式，否则首页控制区会多出上游没有的按钮。
 */
export type DashboardViewMode = 'card' | 'list'
export type DashboardThemeMode = 'system' | 'light' | 'dark'
export type DashboardSort = 'order' | 'name' | 'status' | 'cpu' | 'memory' | 'network'
  | 'traffic' | 'upload' | 'download' | 'peak'

export interface DashboardSummary {
  total: number
  online: number
  offline: number
  averageCpu: number | null
  memory: GlassResourceMetric
  disk: GlassResourceMetric
  networkInSpeed: number | null
  networkOutSpeed: number | null
  trafficReceived: number | null
  trafficTransmitted: number | null
}

export interface GlassServerGroup {
  name: string
  servers: GlassServer[]
}
