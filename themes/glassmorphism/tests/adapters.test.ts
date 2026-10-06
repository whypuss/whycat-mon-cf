import { describe, expect, it } from 'vitest'
import {
  mergeRealtimeSample,
  normalizeHistory,
  normalizeServer,
  normalizeServerCollection,
  normalizeSiteConfig,
  normalizeSocketBatch,
} from '@/services/cfsm/adapters'
import { apiSource } from '@/services/cfsm/config'
import { PROBE_TARGETS } from '@/constants/probes'
import type { CfsmServer, ProbeValue } from '@/types/cfsm'

const source = apiSource('https://status.example')

describe('CFSM wire adapters', () => {
  it('normalizes the public config contract without trusting unknown fields', () => {
    const config = normalizeSiteConfig({
      version: '2.8.5 Beta3',
      is_public: 1,
      authorization: true,
      turnstile_enabled: '1',
      custom_ct_name: 'Telecom',
      custom_cu_name: 'Unicom',
      custom_cm_name: 'Mobile',
      custom_bd_name: 'Backbone',
      node_1_name: 'Tokyo',
      node_2_name: 'Singapore',
      node_3_name: 'Frankfurt',
      node_4_name: 'Virginia',
      site_title: 'Status',
      preferred_theme: 'dark',
      default_language: 'zh',
      theme_options: { glass: true },
      frontend_ws_timeout_minutes: '20',
      long_history_points: 180,
      latency_window: { points: 20, hours: 2 },
    })

    expect(config).toMatchObject({
      version: '2.8.5 Beta3',
      isPublic: true,
      turnstileEnabled: true,
      siteTitle: 'Status',
      preferredTheme: 'dark',
      defaultLanguage: 'zh',
      frontendWebsocketTimeoutMinutes: 20,
      longHistoryPoints: 180,
    })
    expect(config.probeLabels).toEqual({
      ct: 'Telecom',
      cu: 'Unicom',
      cm: 'Mobile',
      bd: 'Backbone',
      node_1: 'Tokyo',
      node_2: 'Singapore',
      node_3: 'Frankfurt',
      node_4: 'Virginia',
    })
    expect(config.themeOptions).toEqual({ glass: true })
  })

  it('uses centralized legacy and Node label defaults for missing or blank config fields', () => {
    const expected = {
      ct: '电信',
      cu: '联通',
      cm: '移动',
      bd: 'BGP',
      node_1: 'Node 1',
      node_2: 'Node 2',
      node_3: 'Node 3',
      node_4: 'Node 4',
    }

    expect(normalizeSiteConfig({}).probeLabels).toEqual(expected)
    expect(normalizeSiteConfig({
      custom_ct_name: ' ',
      custom_cu_name: '',
      custom_cm_name: '\t',
      custom_bd_name: '\n',
      node_1_name: '',
      node_2_name: ' ',
      node_3_name: '\t',
      node_4_name: '\n',
    }).probeLabels).toEqual(expected)
  })

  it('accepts only valid whole-minute WebSocket lifetime settings', () => {
    expect(normalizeSiteConfig({ frontend_ws_timeout_minutes: 0 })
      .frontendWebsocketTimeoutMinutes).toBe(0)
    expect(normalizeSiteConfig({ frontend_ws_timeout_minutes: 1440 })
      .frontendWebsocketTimeoutMinutes).toBe(1440)
    expect(normalizeSiteConfig({ frontend_ws_timeout_minutes: 1.5 })
      .frontendWebsocketTimeoutMinutes).toBe(0)
    expect(normalizeSiteConfig({ frontend_ws_timeout_minutes: 1441 })
      .frontendWebsocketTimeoutMinutes).toBe(0)
  })

  it('maps official server fields, reachability flags and optional metrics', () => {
    const server = normalizeServer({
      id: 'node-1',
      name: 'Hong Kong',
      server_group: 'edge',
      tags: 'prod, edge,prod',
      price: '30.00',
      cpu: '12.5',
      load_avg: '0.10 0.20 0.30',
      ram_total: 8192,
      ram_used: 4096,
      ip_v4: '1',
      ip_v6: '0',
      last_updated: 1_000_000,
      gpu_info: '[{"id":"0","name":"RTX","info":13}]',
      disk: {
        read_bps: 4096,
        write_bps: 2048,
        read_iops: 12,
        write_iops: 8,
        await_ms: 1.5,
        util: 3.2,
      },
      ping: [{ ts: 999_000, ct: 20, cu: false, cm: null, bd: 30 }],
      loss: [],
    }, source, 1_120_000)

    expect(server.online).toBe(true)
    expect(server.tags).toEqual(['prod', 'edge'])
    expect(server.load5).toBe(0.2)
    expect(server.ipV4Reachable).toBe('1')
    expect(server.ipV6Reachable).toBe('0')
    expect(server.gpus).toEqual([{ id: '0', name: 'RTX', utilization: 13 }])
    expect(server.diskIo?.readBps).toBe(4096)
    // 服务端每个窗口点都写入全部 8 个探测目标；缺席的 key 与未配置同义，归一化为 false。
    expect(server.latencyWindow[0]).toEqual({
      timestamp: 999_000,
      ct: 20,
      cu: false,
      cm: null,
      bd: 30,
      node_1: false,
      node_2: false,
      node_3: false,
      node_4: false,
    })
  })

  it('preserves every legacy and Node probe state on server responses', () => {
    const cases: Array<{ input?: ProbeValue; expected: ProbeValue }> = [
      { input: 17.5, expected: 17.5 },
      { input: 0, expected: 0 },
      { input: null, expected: null },
      { input: false, expected: false },
      { expected: false },
    ]

    for (const target of PROBE_TARGETS) {
      for (const probeCase of cases) {
        const fields: Record<string, unknown> = { id: 'probe-node' }
        if ('input' in probeCase) {
          fields[`ping_${target}`] = probeCase.input
          fields[`loss_${target}`] = probeCase.input
        }
        const server = normalizeServer(fields, source)
        expect(server.latency[target]).toBe(probeCase.expected)
        expect(server.packetLoss[target]).toBe(probeCase.expected)
      }
    }
  })

  it('does not expose absent all-zero disk IO or stale online state', () => {
    const server = normalizeServer({
      id: 'node-2',
      last_updated: 1_000,
      disk: {
        read_bps: 0,
        write_bps: 0,
        read_iops: 0,
        write_iops: 0,
        await_ms: 0,
        util: 0,
      },
    }, source, 400_001)

    expect(server.online).toBe(false)
    expect(server.diskIo).toBeUndefined()
    expect(server.gpus).toEqual([])
    expect(server.ipV4Reachable).toBeNull()
  })

  it('keeps source ownership on list responses', () => {
    const result = normalizeServerCollection({
      servers: [{ id: 'node-1' }, null, {}, { id: '   ' }],
      stats: { online: 1 },
      sysConfig: { show_price: true, long_history_points: 180 },
    }, source)

    expect(result.servers[0]?.source.base).toBe('https://status.example')
    expect(result.servers).toHaveLength(1)
    expect(result.stats).toEqual({ online: 1 })
    expect(result.systemConfig).toEqual({ showPrice: true, longHistoryPoints: 180 })
  })

  it('normalizes history and legacy flat disk IO without inventing rows', () => {
    const history = normalizeHistory([
      {
        timestamp: 123,
        cpu: 4,
        gpu_info: '[{"id":"0","name":"History GPU","info":44}]',
        disk_read_bps: 100,
        disk_write_bps: 20,
      },
      null,
      { cpu: 9 },
    ])

    expect(history).toHaveLength(1)
    expect(history[0]?.timestamp).toBe(123)
    expect(history[0]?.diskIo?.readBps).toBe(100)
    expect(history[0]?.gpus).toEqual([{ id: '0', name: 'History GPU', utilization: 44 }])
  })

  it('normalizes GPU arrays and rejects malformed history GPU payloads', () => {
    const history = normalizeHistory([
      {
        timestamp: 1,
        gpu_info: [{ id: '0', name: 'Array GPU', info: 0 }],
      },
      {
        timestamp: 2,
        gpu_info: 'not-json',
      },
    ])

    expect(history[0]?.gpus).toEqual([{ id: '0', name: 'Array GPU', utilization: 0 }])
    expect(history[1]?.gpus).toEqual([])
  })

  it('keeps all legacy and Node probe states in history without filling missing data', () => {
    const [point] = normalizeHistory([{
      timestamp: 123,
      ping_ct: 12,
      ping_cu: 0,
      ping_cm: null,
      ping_bd: false,
      ping_node_2: 22,
      ping_node_3: 0,
      ping_node_4: null,
      loss_ct: false,
      loss_cm: 0,
      loss_bd: null,
      loss_node_1: 1,
      loss_node_2: false,
      loss_node_4: 0,
    }])

    expect(point?.latency).toEqual({
      ct: 12,
      cu: 0,
      cm: null,
      bd: false,
      node_1: false,
      node_2: 22,
      node_3: 0,
      node_4: null,
    })
    expect(point?.packetLoss).toEqual({
      ct: false,
      cu: false,
      cm: 0,
      bd: null,
      node_1: 1,
      node_2: false,
      node_3: false,
      node_4: 0,
    })
  })

  it('merges tri-state probe fields from every WebSocket sample envelope', () => {
    const initial = normalizeServer({
      id: 'node-1',
      name: 'Preserved server',
      ram_total: 8192,
      ping_ct: 18,
      loss_ct: 2,
      ping_node_1: 20,
      ping_node_2: 21,
      ping_node_3: 22,
    }, source)
    const samples = normalizeSocketBatch({
      type: 'batchUpdate',
      updates: [{
        serverId: 'node-1',
        samples: [
          { ts: 1, data: { ping_node_1: null, loss_node_1: 0 } },
          { ts: 2, payload: { ping_node_2: false, loss_node_2: 4 } },
          { ts: 3, metrics: { ping_ct: 0, loss_ct: null, ping_node_3: 42 } },
        ],
      }],
    })
    const merged = samples.reduce<CfsmServer>(
      (server, sample) => mergeRealtimeSample(server, sample, 10),
      initial,
    )

    expect(merged.latency).toMatchObject({
      ct: 0,
      node_1: null,
      node_2: false,
      node_3: 42,
      node_4: false,
    })
    expect(merged.packetLoss).toMatchObject({
      ct: null,
      node_1: 0,
      node_2: 4,
      node_3: false,
    })
    expect(merged).toMatchObject({ name: 'Preserved server', memoryTotal: 8192 })
  })

  it('normalizes ordered batch updates across data, payload and metrics envelopes', () => {
    const updates = normalizeSocketBatch({
      type: 'batchUpdate',
      ts: 50,
      updates: [
        {
          serverId: 'node-1',
          samples: [
            { ts: 30, metrics: { cpu: 30 } },
            { ts: 10, data: { cpu: 10 } },
            { timestamp: 20, payload: { cpu: 20 } },
            { ts: 40, data: null },
            { data: { cpu: 50 } },
          ],
        },
        { serverId: '', samples: [{ data: { cpu: 99 } }] },
      ],
    })

    expect(updates.map((sample) => [sample.timestamp, sample.data.cpu])).toEqual([
      [10, 10],
      [20, 20],
      [30, 30],
      [50, 50],
    ])
  })

  it('merges partial realtime samples without erasing the REST snapshot', () => {
    const server = normalizeServer({
      id: 'node-1',
      name: 'Tokyo edge',
      server_group: 'production',
      tags: ['edge'],
      cpu: 10,
      ram_total: 8192,
      ram_used: 2048,
      disk_total: 100_000,
      disk_used: 50_000,
      net_rx: 1234,
      gpu_info: [{ id: '0', name: 'GPU', info: 25 }],
      last_updated: 1_000,
    }, source, 1_000)

    const merged = mergeRealtimeSample(server, {
      serverId: 'node-1',
      timestamp: 2_000,
      data: { cpu: 22, ram_used: 4096, net_in_speed: 512 },
    }, 2_100)

    expect(merged).toMatchObject({
      name: 'Tokyo edge',
      group: 'production',
      tags: ['edge'],
      online: true,
      cpu: 22,
      memoryTotal: 8192,
      memoryUsed: 4096,
      diskTotal: 100_000,
      diskUsed: 50_000,
      networkReceived: 1234,
      networkInSpeed: 512,
      timestamp: 2_000,
      lastUpdated: 2_100,
    })
    expect(merged.gpus).toEqual([{ id: '0', name: 'GPU', utilization: 25 }])
  })

  it('removes Disk IO only when a realtime payload explicitly clears disk', () => {
    const server = normalizeServer({
      id: 'node-1',
      disk: { read_bps: 128 },
    }, source)

    const unchanged = mergeRealtimeSample(server, {
      serverId: 'node-1',
      timestamp: 1,
      data: { cpu: 0 },
    })
    const cleared = mergeRealtimeSample(unchanged, {
      serverId: 'node-1',
      timestamp: 2,
      data: { disk: null },
    })

    expect(unchanged.diskIo?.readBps).toBe(128)
    expect(cleared.diskIo).toBeUndefined()
  })

  it('rejects malformed required response shapes', () => {
    expect(() => normalizeSiteConfig([])).toThrow('Config response must be an object')
    expect(() => normalizeServer({ name: 'missing id' }, source)).toThrow(
      'Server response is missing a valid id',
    )
    expect(() => normalizeServerCollection({ servers: null }, source)).toThrow(
      'Servers response is missing the servers array',
    )
  })
})
