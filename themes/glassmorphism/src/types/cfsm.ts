export type NullableNumber = number | null
export type Reachability = '0' | '1' | null
export type LatencyCarrier = 'ct' | 'cu' | 'cm' | 'bd'
export type ProbeNode = 'node_1' | 'node_2' | 'node_3' | 'node_4'
export type ProbeTarget = LatencyCarrier | ProbeNode
export type ProbeValue = number | null | false

export interface ApiSource {
  base: string
  label: string
}

export type LatencyValues = Record<LatencyCarrier, ProbeValue>
export type ProbeValues = Record<ProbeTarget, ProbeValue>
export type ProbeLabels = Record<ProbeTarget, string>

/**
 * `/api/servers` 的 `servers[].ping` / `servers[].loss` 单个采样点。
 *
 * 服务端 `getDashboardLatencyHistory` 每台节点固定返回
 * `DASHBOARD_LATENCY_WINDOW_POINTS`(20) 个点，覆盖
 * `DASHBOARD_LATENCY_WINDOW_HOURS`(2) 小时，`ts` 是毫秒桶时间戳且已按升序排序。
 * 每个点包含**全部 8 个**探测目标（`LATENCY_NODE_FIELDS`），取值三态：
 * 数值 / `null`（该桶无采样）/ `false`（该探测点未配置）。
 * 旧库缺列时对应 key 直接缺席，因此这里按目标逐个解析而不是假定齐全。
 */
export interface LatencyWindowSample extends ProbeValues {
  timestamp: number
}

export interface DiskIoMetrics {
  readBps: number
  writeBps: number
  readIops: number
  writeIops: number
  awaitMs: number
  utilization: number
}

export interface GpuMetrics {
  id: string
  name: string
  utilization: NullableNumber
}

export interface ServerSystemConfig {
  showPrice?: boolean
  showExpire?: boolean
  showTraffic?: boolean
  longHistoryPoints?: number
}

export interface ReportSample {
  timestamp: number
  data: Record<string, unknown>
}

export interface LatestReportUpdate {
  serverId: string
  reportTimestamp: NullableNumber
  reportAgeMs: NullableNumber
  samples: ReportSample[]
}

/**
 * 运营者按约定写进 tags 的厂商信息（见 `services/cfsm/provider-tags.ts`）。
 * 适配层会把这类标签从 `tags` 里拿出来，不再作为普通标签渲染。
 */
export interface ProviderTags {
  /** 规范成 `AS12345` 形式；没有写就是 null。 */
  asn: string | null
  /** 组织 / 厂商名原文；没有写就是 null。 */
  org: string | null
}

export interface CfsmServer {
  id: string
  source: ApiSource
  name: string
  group: string
  tags: string[]
  providerTags: ProviderTags
  price: string | null
  billingCycle: string | null
  autoRenewal: string | null
  currency: string | null
  expireDate: string | null
  trafficLimit: string | null
  trafficCalculationType: string | null
  resetDay: NullableNumber
  reportInterval: NullableNumber
  websocketReportInterval: NullableNumber
  hidden: boolean
  sortOrder: NullableNumber
  online: boolean
  cpu: NullableNumber
  load1: NullableNumber
  load5: NullableNumber
  load15: NullableNumber
  networkInSpeed: NullableNumber
  networkOutSpeed: NullableNumber
  networkReceived: NullableNumber
  networkTransmitted: NullableNumber
  monthlyNetworkReceived: NullableNumber
  monthlyNetworkTransmitted: NullableNumber
  processes: NullableNumber
  tcpConnections: NullableNumber
  udpConnections: NullableNumber
  latency: ProbeValues
  packetLoss: ProbeValues
  latencyWindow: LatencyWindowSample[]
  packetLossWindow: LatencyWindowSample[]
  memoryTotal: NullableNumber
  memoryUsed: NullableNumber
  swapTotal: NullableNumber
  swapUsed: NullableNumber
  diskTotal: NullableNumber
  diskUsed: NullableNumber
  diskIo?: DiskIoMetrics
  cpuCores: NullableNumber
  cpuInfo: string | null
  gpus: GpuMetrics[]
  architecture: string | null
  operatingSystem: string | null
  kernelVersion: string | null
  region: string | null
  ipV4Reachable: Reachability
  ipV6Reachable: Reachability
  bootTime: NullableNumber
  agentVersion: string | null
  lastUpdated: NullableNumber
  timestamp: NullableNumber
  latestReportUpdates: LatestReportUpdate[]
  systemConfig?: ServerSystemConfig
}

export interface SiteConfig {
  version: string | null
  latestWorkersVersion: string | null
  latestAgentVersion: string | null
  isPublic: boolean
  authorization: boolean
  turnstileEnabled: boolean
  turnstileLoginEnabled: boolean
  turnstileSiteKey: string | null
  probeLabels: ProbeLabels
  siteTitle: string
  preferredTheme: 'auto' | 'dark' | 'light'
  defaultLanguage: 'auto' | 'zh' | 'en'
  themeOptions: Record<string, unknown>
  verified: boolean
  turnstileVerified: string | null
  frontendWebsocketTimeoutMinutes: number
  longHistoryPoints: number
  latencyWindow: {
    points: number
    hours: number
  }
}

export interface ServerCollection {
  source: ApiSource
  servers: CfsmServer[]
  stats: Record<string, unknown>
  systemConfig?: ServerSystemConfig
}

export interface ServerSourceFailure {
  source: ApiSource
  message: string
  status: number | null
  code: string | null
}

export interface ServerSourcesResult {
  collections: ServerCollection[]
  failures: ServerSourceFailure[]
}

export interface HistoryPoint {
  timestamp: number
  cpu: NullableNumber
  gpus: GpuMetrics[]
  memoryUsed: NullableNumber
  memoryTotal: NullableNumber
  swapUsed: NullableNumber
  swapTotal: NullableNumber
  diskUsed: NullableNumber
  diskTotal: NullableNumber
  networkInSpeed: NullableNumber
  networkOutSpeed: NullableNumber
  networkReceived: NullableNumber
  networkTransmitted: NullableNumber
  /*
   * `/api/history/all` 的 `processes` / `tcp_conn` / `udp_conn`。
   * 长时段聚合时 CFSM 对这三列取桶内最大值（`HISTORY_METRIC_AGGREGATION_POLICY`），
   * 不是平均值。
   */
  processes: NullableNumber
  tcpConnections: NullableNumber
  udpConnections: NullableNumber
  load1: NullableNumber
  load5: NullableNumber
  load15: NullableNumber
  temperature: NullableNumber
  latency: ProbeValues
  packetLoss: ProbeValues
  diskIo?: DiskIoMetrics
}

export interface HistorySeries {
  serverId: string
  source: ApiSource
  points: HistoryPoint[]
}

export interface ThemeOptionsSaveResult {
  success: boolean
  themeOptions: Record<string, unknown>
  message: string | null
}

export type CfsmSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'backoff'
  | 'unavailable'
  | 'timed-out'
  | 'closed'

export interface CfsmSocketSubscription {
  type: 'subscribe'
  scope: string
  ids: string[]
}

export interface CfsmRealtimeSample {
  serverId: string
  timestamp: NullableNumber
  data: Record<string, unknown>
}

/** 同一个首页刷新周期内、按 owning API base 分组的真实 WebSocket 样本。 */
export interface CfsmRealtimeBatch {
  base: string
  samples: readonly CfsmRealtimeSample[]
}

export type CfsmRequestIssueKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'upgrade-required'
  | 'unavailable'
  | 'server-error'
  | 'network'
  | 'invalid-request'
  | 'unknown'

export interface CfsmRequestIssue {
  kind: CfsmRequestIssueKind
  status: number | null
  code: string | null
  message: string
}
