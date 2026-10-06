import { describe, expect, it } from 'vitest'
import {
  ALL_GROUPS,
  UNGROUPED_LABEL,
  availableGroups,
  filterServers,
  groupServers,
  sortServers,
  summarizeServers,
} from '@/domain/dashboard'
import type { GlassServer } from '@/types/glassmorphism'

function makeServer(id: string, overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'https%3A%2F%2Fstatus.example:' + id,
    id,
    sourceBase: 'https://status.example',
    sourceLabel: 'status.example',
    name: 'Node ' + id,
    group: '',
    tags: [],
    providerTags: { asn: null, org: null },
    region: null,
    price: null,
    billingCycle: null,
    currency: null,
    expireDate: null,
    trafficLimit: null,
    trafficCalculationType: null,
    showPrice: true,
    showExpire: true,
    showTraffic: true,
    online: true,
    sortOrder: null,
    cpu: null,
    load: { one: null, five: null, fifteen: null },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: {
      inSpeed: null,
      outSpeed: null,
      received: null,
      transmitted: null,
      monthlyReceived: null,
      monthlyTransmitted: null,
    },
    processes: null,
    tcpConnections: null,
    udpConnections: null,
    latency: [],
    history: { latencySeries: {}, packetLossSeries: {} },
    gpus: [],
    connectivity: { ipv4: null, ipv6: null },
    operatingSystem: null,
    architecture: null,
    cpuInfo: null,
    cpuCores: null,
    kernelVersion: null,
    agentVersion: null,
    bootTime: null,
    lastUpdated: null,
    ...overrides,
  }
}

describe('dashboard selectors', () => {
  it('summarizes an empty list without synthetic metric zeroes', () => {
    expect(summarizeServers([])).toEqual({
      total: 0,
      online: 0,
      offline: 0,
      averageCpu: null,
      memory: { used: null, total: null, percentage: null },
      disk: { used: null, total: null, percentage: null },
      networkInSpeed: null,
      networkOutSpeed: null,
      trafficReceived: null,
      trafficTransmitted: null,
    })
  })

  it('reports all-offline state without treating stale CPU as online average', () => {
    const summary = summarizeServers([
      makeServer('a', { online: false, cpu: 90 }),
      makeServer('b', { online: false, cpu: 20 }),
    ])

    expect(summary).toMatchObject({ total: 2, online: 0, offline: 2 })
    expect(summary.averageCpu).toBeNull()
  })

  it('aggregates only available capacity and online network speed', () => {
    const summary = summarizeServers([
      makeServer('a', {
        cpu: 20,
        memory: { used: 2, total: 8, percentage: 25 },
        disk: { used: 30, total: 100, percentage: 30 },
        network: {
          inSpeed: 10,
          outSpeed: 20,
          received: 100,
          transmitted: 200,
          monthlyReceived: null,
          monthlyTransmitted: null,
        },
      }),
      makeServer('b', {
        online: false,
        cpu: 90,
        memory: { used: 1, total: 2, percentage: 50 },
        network: {
          inSpeed: 999,
          outSpeed: 999,
          received: 300,
          transmitted: null,
          monthlyReceived: null,
          monthlyTransmitted: null,
        },
      }),
    ])

    expect(summary.averageCpu).toBe(20)
    expect(summary.memory).toEqual({ used: 3, total: 10, percentage: 30 })
    expect(summary.networkInSpeed).toBe(10)
    expect(summary.trafficReceived).toBe(400)
  })

  it('searches only normalized real metadata fields', () => {
    const servers = [
      makeServer('a', {
        name: 'Hong Kong Edge',
        group: 'Production',
        tags: ['premium'],
        region: 'HK',
        operatingSystem: 'Ubuntu',
        cpuInfo: 'AMD EPYC',
      }),
      makeServer('b', { name: 'Tokyo' }),
    ]

    expect(filterServers(servers, 'epyc', ALL_GROUPS).map((server) => server.id)).toEqual(['a'])
    expect(filterServers(servers, 'premium', ALL_GROUPS).map((server) => server.id)).toEqual(['a'])
    expect(filterServers(servers, 'hong ubuntu', ALL_GROUPS).map((server) => server.id)).toEqual(['a'])
    expect(filterServers(servers, 'tokyo', 'Production')).toEqual([])
  })

  it('filters favorites by stable source-owned key', () => {
    const servers = [makeServer('a'), makeServer('b')]
    const favorites = new Set([servers[1]?.key ?? ''])

    expect(filterServers(servers, '', ALL_GROUPS, favorites).map((server) => server.id)).toEqual(['b'])
  })

  it('groups blank values explicitly and sorts unavailable metrics last', () => {
    const servers = [
      makeServer('a', { group: 'Edge', cpu: null }),
      makeServer('b', { group: '', cpu: 5 }),
      makeServer('c', { group: 'Edge', cpu: 90 }),
    ]

    expect(availableGroups(servers)).toEqual(['Edge', UNGROUPED_LABEL])
    expect(groupServers(servers).map((group) => group.name)).toEqual(['Edge', UNGROUPED_LABEL])
    expect(sortServers(servers, 'cpu').map((server) => server.id)).toEqual(['c', 'b', 'a'])
  })

  it('places offline nodes last without changing the selected metric order', () => {
    const servers = [
      makeServer('offline-fast', { online: false, cpu: 99 }),
      makeServer('online-fast', { cpu: 60 }),
      makeServer('online-slow', { cpu: 10 }),
    ]

    expect(sortServers(servers, 'cpu', true).map((server) => server.id)).toEqual([
      'online-fast',
      'online-slow',
      'offline-fast',
    ])
  })

  it.each([0, 1, 10, 30, 64])('preserves truthful collection cardinality for %i nodes', (count) => {
    const servers = Array.from({ length: count }, (_, index) => makeServer(String(index), {
      name: index === 0 ? 'A very long production server name that must remain searchable' : `Node ${index}`,
      tags: index === 0 ? Array.from({ length: 14 }, (__, tagIndex) => `tag-${tagIndex}`) : [],
    }))

    expect(sortServers(filterServers(servers, '', ALL_GROUPS), 'order')).toHaveLength(count)
    if (count > 0) {
      expect(filterServers(servers, 'very long production', ALL_GROUPS)[0]?.tags).toHaveLength(14)
    }
  })
})
