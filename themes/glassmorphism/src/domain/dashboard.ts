import type {
  DashboardSort,
  DashboardSummary,
  GlassResourceMetric,
  GlassServer,
  GlassServerGroup,
} from '@/types/glassmorphism'

export const ALL_GROUPS = '__all__'
export const UNGROUPED_LABEL = '未分组'

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

export function displayGroup(server: GlassServer): string {
  return server.group.trim() || UNGROUPED_LABEL
}

export function availableGroups(servers: GlassServer[]): string[] {
  return [...new Set(servers.map(displayGroup))]
    .sort((left, right) => {
      if (left === UNGROUPED_LABEL) return 1
      if (right === UNGROUPED_LABEL) return -1
      return left.localeCompare(right, 'zh-CN')
    })
}

export function filterServers(
  servers: GlassServer[],
  query: string,
  group = ALL_GROUPS,
  favoriteKeys?: ReadonlySet<string>,
): GlassServer[] {
  const terms = normalizedText(query).split(/\s+/).filter(Boolean)

  return servers.filter((server) => {
    if (group !== ALL_GROUPS && displayGroup(server) !== group) return false
    if (favoriteKeys && !favoriteKeys.has(server.key)) return false
    if (terms.length === 0) return true

    const searchable = [
      server.id,
      server.name,
      server.group,
      server.region,
      server.cpuInfo,
      server.operatingSystem,
      server.architecture,
      server.kernelVersion,
      server.agentVersion,
      server.sourceLabel,
      ...server.tags,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map(normalizedText)
      .join('\n')

    return terms.every((term) => searchable.includes(term))
  })
}

function compareNullable(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return (left - right) * direction
}

function serverNameOrder(left: GlassServer, right: GlassServer): number {
  return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
}

export function sortServers(
  servers: GlassServer[],
  sort: DashboardSort,
  offlineLast = false,
): GlassServer[] {
  return [...servers].sort((left, right) => {
    if (offlineLast && left.online !== right.online) return left.online ? -1 : 1

    let result = 0
    switch (sort) {
      case 'name':
        result = serverNameOrder(left, right)
        break
      case 'status':
        result = Number(right.online) - Number(left.online)
        break
      case 'cpu':
        result = compareNullable(left.cpu, right.cpu, -1)
        break
      case 'memory':
        result = compareNullable(left.memory.percentage, right.memory.percentage, -1)
        break
      case 'network': {
        const leftSpeed = left.network.inSpeed === null && left.network.outSpeed === null
          ? null
          : (left.network.inSpeed ?? 0) + (left.network.outSpeed ?? 0)
        const rightSpeed = right.network.inSpeed === null && right.network.outSpeed === null
          ? null
          : (right.network.inSpeed ?? 0) + (right.network.outSpeed ?? 0)
        result = compareNullable(leftSpeed, rightSpeed, -1)
        break
      }
      case 'traffic':
        result = compareNullable(
          left.network.received !== null && left.network.transmitted !== null ? left.network.received + left.network.transmitted : null,
          right.network.received !== null && right.network.transmitted !== null ? right.network.received + right.network.transmitted : null,
          -1,
        )
        break
      case 'upload':
        result = compareNullable(left.network.outSpeed, right.network.outSpeed, -1)
        break
      case 'download':
        result = compareNullable(left.network.inSpeed, right.network.inSpeed, -1)
        break
      case 'peak':
        result = compareNullable(
          left.network.inSpeed === null && left.network.outSpeed === null ? null : Math.max(left.network.inSpeed ?? 0, left.network.outSpeed ?? 0),
          right.network.inSpeed === null && right.network.outSpeed === null ? null : Math.max(right.network.inSpeed ?? 0, right.network.outSpeed ?? 0),
          -1,
        )
        break
      case 'order':
        result = compareNullable(left.sortOrder, right.sortOrder, 1)
        break
    }

    return result || serverNameOrder(left, right)
  })
}

export function groupServers(servers: GlassServer[]): GlassServerGroup[] {
  const groups = new Map<string, GlassServer[]>()
  for (const server of servers) {
    const name = displayGroup(server)
    const group = groups.get(name) ?? []
    group.push(server)
    groups.set(name, group)
  }
  return [...groups].map(([name, group]) => ({ name, servers: group }))
}

/** 只累计已用与总量都有值、且总量为正的节点：缺的一侧不能当 0 混进合计。 */
export function summarizeResource(
  servers: GlassServer[],
  selector: (server: GlassServer) => GlassResourceMetric,
): GlassResourceMetric {
  let used = 0
  let total = 0
  let samples = 0

  for (const server of servers) {
    const metric = selector(server)
    if (metric.used === null || metric.total === null || metric.total <= 0) continue
    used += metric.used
    total += metric.total
    samples += 1
  }

  if (samples === 0 || total <= 0) return { used: null, total: null, percentage: null }
  return {
    used,
    total,
    percentage: Math.min(Math.max((used / total) * 100, 0), 100),
  }
}

function sumNullable(servers: GlassServer[], selector: (server: GlassServer) => number | null): number | null {
  let total = 0
  let samples = 0
  for (const server of servers) {
    const value = selector(server)
    if (value === null) continue
    total += value
    samples += 1
  }
  return samples > 0 ? total : null
}

export function summarizeServers(servers: GlassServer[]): DashboardSummary {
  const onlineServers = servers.filter((server) => server.online)
  const cpuSamples = onlineServers
    .map((server) => server.cpu)
    .filter((value): value is number => value !== null)

  return {
    total: servers.length,
    online: onlineServers.length,
    offline: servers.length - onlineServers.length,
    averageCpu: cpuSamples.length > 0
      ? cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length
      : null,
    memory: summarizeResource(servers, (server) => server.memory),
    disk: summarizeResource(servers, (server) => server.disk),
    networkInSpeed: sumNullable(onlineServers, (server) => server.network.inSpeed),
    networkOutSpeed: sumNullable(onlineServers, (server) => server.network.outSpeed),
    trafficReceived: sumNullable(servers, (server) => server.network.received),
    trafficTransmitted: sumNullable(servers, (server) => server.network.transmitted),
  }
}
