import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { buildEarthPoints } from '@/domain/advanced-tools'
import type { GlassServer } from '@/types/glassmorphism'

/**
 * Komari `useNodeGeoClusters` 的 CFSM 等价实现。
 *
 * 与上游的唯一差异是定位来源：Komari 允许外部 IP Geo 查询得到城市级坐标，
 * 而 CFSM 公开主题 API 不提供真实 IP、ASN 或城市，`ip_v4`/`ip_v6` 只是可达性标志。
 * 因此这里只接受可可靠归一化的 `region`，并聚合到国家/地区中心；
 * 无法定位的节点不放点，也绝不按名称、标签或可达性猜测位置。
 */
export interface RegionCluster {
  id: string
  code: string
  coord: [number, number]
  label: string
  servers: number
  onlineServers: number
  members: readonly GlassServer[]
}

export function clusterKey(cluster: RegionCluster): string {
  return [
    cluster.id,
    `${cluster.coord[0]},${cluster.coord[1]}`,
    cluster.label,
    cluster.servers,
    cluster.onlineServers,
  ].join(':')
}

export function useServerGeoClusters(source: MaybeRefOrGetter<readonly GlassServer[]>) {
  const allServers = computed(() => toValue(source))

  const regionClusters = computed<RegionCluster[]>(() => buildEarthPoints(allServers.value)
    .map((point) => ({
      id: point.code.toLowerCase(),
      code: point.code,
      coord: [point.latitude, point.longitude] as [number, number],
      label: point.region,
      servers: point.total,
      onlineServers: point.online,
      members: point.servers,
    }))
    // 与 Komari 一致：节点多的聚合优先，保证标记与图例编号顺序稳定。
    .sort((left, right) => right.servers - left.servers || left.code.localeCompare(right.code)))

  const totalServers = computed(() => allServers.value.length)
  const onlineServers = computed(() => allServers.value.reduce(
    (sum, server) => sum + (server.online ? 1 : 0),
    0,
  ))
  const offlineServers = computed(() => totalServers.value - onlineServers.value)
  const locatedServers = computed(() => regionClusters.value.reduce(
    (sum, cluster) => sum + cluster.servers,
    0,
  ))
  const unlocatedServers = computed(() => totalServers.value - locatedServers.value)

  return {
    regionClusters,
    totalServers,
    onlineServers,
    offlineServers,
    locatedServers,
    unlocatedServers,
    clusterKey,
  }
}
