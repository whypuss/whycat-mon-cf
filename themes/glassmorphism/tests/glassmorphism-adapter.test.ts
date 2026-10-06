import { describe, expect, it } from 'vitest'
import {
  createGlassServerMapper,
  mergeRealtimeSample,
  normalizeServer,
  normalizeSiteConfig,
  toGlassServer,
} from '@/services/cfsm'
import { apiSource } from '@/services/cfsm/config'

const source = apiSource('https://status.example')

describe('Server to Glassmorphism adapter', () => {
  it('maps real CFSM metrics and custom latency labels into the view model', () => {
    const config = normalizeSiteConfig({
      site_title: 'Production',
      custom_ct_name: '电信',
      custom_cu_name: '联通',
      custom_cm_name: '移动',
      custom_bd_name: 'BGP',
    })
    const server = normalizeServer({
      id: 'node-1',
      name: 'HK Edge',
      server_group: 'Edge',
      tags: 'prod,cn',
      region: 'HK',
      cpu: 23.4,
      load_avg: '0.2 0.3 0.4',
      ram_used: 2048,
      ram_total: 8192,
      swap_used: 0,
      swap_total: 1024,
      disk_used: 40,
      disk_total: 100,
      net_in_speed: 1024,
      net_out_speed: 2048,
      net_rx: 10_000,
      net_tx: 20_000,
      net_rx_monthly: 30_000,
      net_tx_monthly: 40_000,
      processes: 92,
      tcp_conn: 12,
      udp_conn: 3,
      ping_ct: 21,
      loss_ct: 0,
      ping_cu: false,
      loss_cu: null,
      ping: [{ ts: 1_700_000_000_000, ct: 18, cu: null, cm: false, bd: 0 }],
      loss: [{ ts: 1_700_000_000_000, ct: 1, cu: null, cm: false, bd: 0 }],
      gpu_info: [{ id: '0', name: 'GPU 0', info: 45 }],
      ip_v4: '1',
      ip_v6: '0',
      cpu_cores: 4,
      kernel_version: '6.8.0',
      agent_version: '1.3.3',
      boot_time: 1_700_000_000_000,
      is_online: '1',
    }, source)

    const view = toGlassServer(server, config)

    expect(view).toMatchObject({
      id: 'node-1',
      name: 'HK Edge',
      group: 'Edge',
      region: 'HK',
      online: true,
      cpu: 23.4,
      memory: { used: 2048, total: 8192, percentage: 25 },
      swap: { used: 0, total: 1024, percentage: 0 },
      disk: { used: 40, total: 100, percentage: 40 },
      network: {
        inSpeed: 1024,
        outSpeed: 2048,
        received: 10_000,
        transmitted: 20_000,
        monthlyReceived: 30_000,
        monthlyTransmitted: 40_000,
      },
      connectivity: { ipv4: '1', ipv6: '0' },
      cpuCores: 4,
      kernelVersion: '6.8.0',
      agentVersion: '1.3.3',
      bootTime: 1_700_000_000_000,
    })
    expect(view.latency).toEqual([
      {
        target: 'ct',
        label: '电信',
        latency: 21,
        packetLoss: 0,
      },
      {
        target: 'cu',
        label: '联通',
        latency: false,
        packetLoss: null,
      },
    ])
    // 窗口按探测目标分组，时间桶原样保留；cm 整段未配置因此不产出序列。
    expect(view.history).toEqual({
      latencySeries: {
        ct: [{ timestamp: 1_700_000_000_000, value: 18 }],
        cu: [{ timestamp: 1_700_000_000_000, value: null }],
        bd: [{ timestamp: 1_700_000_000_000, value: 0 }],
      },
      packetLossSeries: {
        ct: [{ timestamp: 1_700_000_000_000, value: 1 }],
        cu: [{ timestamp: 1_700_000_000_000, value: null }],
        bd: [{ timestamp: 1_700_000_000_000, value: 0 }],
      },
    })
    expect(view.gpus).toEqual([{ id: '0', name: 'GPU 0', utilization: 45 }])
  })

  it('keeps reachability as state and never creates IP address fields', () => {
    const view = toGlassServer(normalizeServer({
      id: 'node-2',
      ip_v4: '1',
      ip_v6: '0',
    }, source), null)

    expect(view.connectivity).toEqual({ ipv4: '1', ipv6: '0' })
    expect(Object.keys(view)).not.toContain('ipv4')
    expect(Object.keys(view)).not.toContain('ipv6')
    expect(JSON.stringify(view)).not.toContain('127.0.0.1')
  })

  it('turns invalid and missing old-agent metrics into unavailable values', () => {
    const view = toGlassServer(normalizeServer({
      id: 'old-node',
      cpu: 'NaN',
      ram_used: -1,
      ram_total: null,
      load_avg: '',
      net_in_speed: 'invalid',
      gpu_info: 'not-json',
      is_online: '0',
    }, source), null)

    expect(view.online).toBe(false)
    expect(view.cpu).toBeNull()
    expect(view.memory).toEqual({ used: null, total: null, percentage: null })
    expect(view.load).toEqual({ one: null, five: null, fifteen: null })
    expect(view.network.inSpeed).toBeNull()
    expect(view.gpus).toEqual([])
    expect(view.latency).toEqual([])
  })

  it('keeps every optional empty-field scenario truthful and hidden-capable', () => {
    const normalized = normalizeServer({ id: 'sparse-node' }, source)
    const view = toGlassServer(normalized, null)

    expect(normalized).toMatchObject({
      group: '',
      tags: [],
      price: null,
      expireDate: null,
      trafficLimit: null,
      diskIo: undefined,
      gpus: [],
      latencyWindow: [],
      packetLossWindow: [],
    })
    expect(view).toMatchObject({
      group: '',
      tags: [],
      price: null,
      expireDate: null,
      trafficLimit: null,
      latency: [],
      history: { latencySeries: {}, packetLossSeries: {} },
      gpus: [],
    })
  })

  it('uses the same centralized legacy labels when config is unavailable', () => {
    const view = toGlassServer(normalizeServer({
      id: 'fallback-label-node',
      ping_ct: 0,
      loss_ct: 0,
    }, source), null)

    expect(view.latency).toEqual([{
      target: 'ct',
      label: '电信',
      latency: 0,
      packetLoss: 0,
    }])
  })

  it('reuses unchanged view models across a 50+ node realtime update', () => {
    const config = normalizeSiteConfig({ site_title: 'Scale test' })
    const servers = Array.from({ length: 64 }, (_, index) => normalizeServer({
      id: `node-${index}`,
      name: `Node ${index}`,
      cpu: index,
      is_online: true,
    }, source))
    const mapper = createGlassServerMapper()
    const initial = mapper.map(servers, config)
    const changed = servers.map((server, index) => index === 31
      ? mergeRealtimeSample(server, {
          serverId: server.id,
          timestamp: 2,
          data: { cpu: 99 },
        }, 2)
      : server)
    const updated = mapper.map(changed, config)

    expect(updated).toHaveLength(64)
    expect(updated.filter((server, index) => server === initial[index])).toHaveLength(63)
    expect(updated[31]).not.toBe(initial[31])
    expect(updated[31]?.cpu).toBe(99)
  })
})
