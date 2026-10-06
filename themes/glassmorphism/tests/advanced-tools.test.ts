import { describe, expect, it } from 'vitest'
import {
  buildEarthPoints,
  buildHealthSummary,
  buildSnapshot,
  buildSnapshotCsv,
  buildTopology,
  buildValueGroups,
  evaluateServerHealth,
  monthlyPrice,
  resolveRegionCoordinates,
} from '@/domain/advanced-tools'
import { DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

function server(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'source:node-1', id: 'node-1', sourceBase: 'https://monitor.example', sourceLabel: 'Primary',
    name: '真实节点', group: '生产', tags: ['边缘'], providerTags: { asn: null, org: null }, region: 'HK', price: '120', billingCycle: 'year', currency: 'CNY',
    expireDate: '2027-01-01', trafficLimit: '2 TiB', trafficCalculationType: 'total', showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: 1, cpu: 25, load: { one: 0.5, five: 0.4, fifteen: 0.3 },
    memory: { used: 4096, total: 8192, percentage: 50 }, swap: { used: 0, total: 1024, percentage: 0 },
    disk: { used: 51200, total: 102400, percentage: 50 },
    network: { inSpeed: 1024, outSpeed: 2048, received: 3000, transmitted: 4000, monthlyReceived: 1000, monthlyTransmitted: 2000 },
    processes: 80, tcpConnections: 20, udpConnections: 5,
    latency: [{ target: 'ct', label: '电信', latency: 20, packetLoss: 0 }],
    history: {
      latencySeries: { ct: [{ timestamp: 1, value: 20 }, { timestamp: 2, value: 30 }] },
      packetLossSeries: { ct: [{ timestamp: 1, value: 0 }, { timestamp: 2, value: 1 }] },
    },
    gpus: [], connectivity: { ipv4: '1', ipv6: '0' }, operatingSystem: 'Debian', architecture: 'x86_64',
    cpuInfo: 'AMD EPYC', cpuCores: 4, kernelVersion: '6.8', agentVersion: '1.5', bootTime: 1, lastUpdated: 2,
    ...overrides,
  }
}

describe('region-level Earth mapping', () => {
  it('maps only explicit region values and aggregates nodes at a country centre', () => {
    const points = buildEarthPoints([
      server(),
      server({ key: 'two', id: 'two', online: false, region: 'Hong Kong' }),
      server({ key: 'three', id: 'three', name: 'Tokyo in name only', region: null, tags: ['JP'] }),
    ])
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ code: 'HK', total: 2, online: 1 })
    expect(resolveRegionCoordinates('unknown-place')).toBeNull()
    expect(resolveRegionCoordinates(null)).toBeNull()
  })
})

describe('health summary', () => {
  it('uses current resources, probes, expiry and real latency-window samples', () => {
    const unhealthy = server({
      cpu: 98,
      expireDate: '2025-01-01',
      latency: [{ target: 'ct', label: '电信', latency: null, packetLoss: null }],
      history: {
        latencySeries: { ct: [{ timestamp: 1, value: 600 }] },
        packetLossSeries: { ct: [{ timestamp: 1, value: 25 }] },
      },
    })
    const result = evaluateServerHealth(unhealthy, DEFAULT_THEME_SETTINGS, Date.UTC(2026, 0, 1))
    expect(result.tone).toBe('critical')
    expect(result.historySamples).toBe(2)
    expect(result.issues.map((issue) => issue.metric)).toEqual(expect.arrayContaining(['CPU', '到期', '探测', '历史平均 Ping', '历史平均 Loss']))
  })

  it('marks a node with only online state as unknown instead of inventing health', () => {
    const sparse = server({
      cpu: null, load: { one: null, five: null, fifteen: null },
      memory: { used: null, total: null, percentage: null }, swap: { used: null, total: null, percentage: null },
      disk: { used: null, total: null, percentage: null }, trafficLimit: null, expireDate: null,
      latency: [], history: { latencySeries: {}, packetLossSeries: {} }, cpuCores: null,
    })
    expect(evaluateServerHealth(sparse, DEFAULT_THEME_SETTINGS).tone).toBe('unknown')
    // 离线本身就是严重问题，不因其余信号缺失而降为「数据不足」。
    expect(evaluateServerHealth({ ...sparse, online: false }, DEFAULT_THEME_SETTINGS).tone).toBe('critical')
    expect(buildHealthSummary([server(), sparse], DEFAULT_THEME_SETTINGS)).toHaveLength(2)
  })

  it('grades an offline node only as offline, not by its last realtime report', () => {
    const offline = server({
      online: false, cpu: 97, memory: { used: 9, total: 10, percentage: 90 },
      latency: [{ target: 'ct', label: '电信', latency: null, packetLoss: null }],
    })
    const health = evaluateServerHealth(offline, DEFAULT_THEME_SETTINGS, Date.UTC(2026, 9, 2))
    expect(health.tone).toBe('critical')
    expect(health.issues.map((issue) => issue.metric)).toEqual(['在线状态'])
  })
})

describe('value comparison', () => {
  it('normalizes known billing periods and never combines currencies', () => {
    // 与详情页「月均支出」、CFSM 同一口径：价格 ÷ 周期天数 × 30（年付按 365 天）。
    expect(monthlyPrice(server())).toBeCloseTo(120 / 365 * 30)
    expect(monthlyPrice(server({ price: '0' }))).toBeNull()
    expect(monthlyPrice(server({ price: '-1' }))).toBeNull()
    expect(monthlyPrice(server({ billingCycle: 'mystery' }))).toBeNull()

    const groups = buildValueGroups([
      server(),
      server({ key: 'usd', id: 'usd', currency: 'USD', price: '12', billingCycle: 'month' }),
      server({ key: 'free', id: 'free', currency: 'CNY', price: '0' }),
    ])
    expect(groups.map((group) => group.currency)).toEqual(['CNY', 'USD'])
    expect(groups.every((group) => group.rows.length === 1)).toBe(true)

    // `$` 与 `USD` 是同一种币，排在同一张表里比较。
    const merged = buildValueGroups([
      server({ key: 'a', id: 'a', currency: '$', price: '10', billingCycle: 'month' }),
      server({ key: 'b', id: 'b', currency: 'USD', price: '12', billingCycle: 'month' }),
    ])
    expect(merged.map((group) => [group.currency, group.rows.length])).toEqual([['USD', 2]])
  })
})

describe('snapshot and topology', () => {
  it('exports only normalized loaded data and preserves probe tri-state meanings', () => {
    const node = server({
      name: '=formula',
      latency: [
        { target: 'ct', label: '电信', latency: false, packetLoss: null },
        { target: 'cu', label: '联通', latency: 0, packetLoss: 0 },
      ],
    })
    const snapshot = buildSnapshot([node], 'Site', new Date('2026-01-01T00:00:00Z'))
    const serialized = JSON.stringify(snapshot)
    expect(serialized).toContain('unconfigured')
    expect(serialized).toContain('timeout')
    expect(serialized).not.toContain('jwt')
    expect(buildSnapshotCsv([node])).toContain("'=formula")
  })

  it('builds a classification hierarchy from region, group and tags without network claims', () => {
    const topology = buildTopology([
      server(),
      server({ key: 'two', id: 'two', region: null, group: '', tags: [] }),
    ])
    expect(topology.map((item) => item.region)).toEqual(expect.arrayContaining(['HK', '未提供地区']))
    expect(topology.find((item) => item.region === '未提供地区')?.groups[0]?.group).toBe('未分组')
  })
})
