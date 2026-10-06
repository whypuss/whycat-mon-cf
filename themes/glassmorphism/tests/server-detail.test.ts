import { describe, expect, it } from 'vitest'
import { DEFAULT_PROBE_LABELS } from '@/constants/probes'
import { probeSeries } from '@/domain/detail-chart-options'
import {
  activeProbeTargets,
  appendLivePoint,
  buildChartRows,
  labeledProbeTargets,
  liveHistoryPoint,
  LIVE_MAX_POINTS,
  LIVE_WINDOW_MS,
  buildLiveChartRows,
  probeStats,
  seedLivePoints,
} from '@/domain/server-detail'
import { normalizeHistory, normalizeServer } from '@/services/cfsm/adapters'
import { mergeDetailLiveSamples } from '@/stores/server-detail'

const source = { base: 'https://status.example', label: 'status.example' }
const START = 1_700_000_000_000
const MINUTE = 60_000

function cpuHistory(offsets: number[]) {
  return normalizeHistory(offsets.map((offset, index) => ({ timestamp: START + offset, cpu: index })))
}

describe('history normalization', () => {
  it('maps processes and TCP / UDP connections from /api/history/all', () => {
    const [point] = normalizeHistory([{ timestamp: START, processes: 88, tcp_conn: 12, udp_conn: 0 }])
    expect(point).toMatchObject({ processes: 88, tcpConnections: 12, udpConnections: 0 })
  })

  it('keeps absent columns as null instead of 0', () => {
    const [point] = normalizeHistory([{ timestamp: START }])
    expect(point).toMatchObject({ processes: null, tcpConnections: null, udpConnections: null })
  })
})

describe('chart rows', () => {
  it('sorts real samples and adds nothing when the spacing is regular', () => {
    const rows = buildChartRows(cpuHistory([2 * MINUTE, 0, MINUTE, 3 * MINUTE]))
    expect(rows.map((row) => row.timestamp)).toEqual([0, 1, 2, 3].map((step) => START + step * MINUTE))
    expect(rows.map((row) => row.point?.cpu)).toEqual([1, 2, 0, 3])
  })

  it('breaks the line across an offline gap with value-less markers only', () => {
    const rows = buildChartRows(cpuHistory([0, MINUTE, 2 * MINUTE, 3 * MINUTE, 13 * MINUTE, 14 * MINUTE]))
    const markers = rows.filter((row) => row.point === null)
    expect(markers).toHaveLength(9)
    for (const marker of markers) {
      expect(marker.timestamp).toBeGreaterThan(START + 3 * MINUTE)
      expect(marker.timestamp).toBeLessThan(START + 13 * MINUTE)
    }
    expect(rows.filter((row) => row.point !== null).map((row) => row.point?.cpu)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('does not treat jitter below twice the sampling interval as a gap', () => {
    const rows = buildChartRows(cpuHistory([0, MINUTE, 2 * MINUTE, 3 * MINUTE + 50_000]))
    expect(rows.every((row) => row.point !== null)).toBe(true)
  })

  it('caps the markers for an extremely long gap but still breaks the line', () => {
    const rows = buildChartRows(cpuHistory([0, MINUTE, 2 * MINUTE, 2 * MINUTE + 30 * 24 * 60 * MINUTE]))
    expect(rows.filter((row) => row.point === null)).toHaveLength(1500)
  })

  it('leaves fewer than three samples untouched', () => {
    expect(buildChartRows(cpuHistory([0, 90 * MINUTE]))).toHaveLength(2)
  })
})

describe('probe statistics', () => {
  it('computes latency statistics from numeric samples only', () => {
    const points = normalizeHistory([
      { timestamp: START, ping_ct: 10, loss_ct: 0 },
      { timestamp: START + MINUTE, ping_ct: null, loss_ct: null },
      { timestamp: START + 2 * MINUTE, ping_ct: 30, loss_ct: 4 },
      { timestamp: START + 3 * MINUTE, ping_ct: false, loss_ct: false },
      { timestamp: START + 4 * MINUTE, ping_ct: 20, loss_ct: 2 },
    ])
    const stats = probeStats(points, 'ct')
    // 超时计入总数但不参与数值统计，未配置两者都不计；丢包 0 是有效值。
    expect(stats).toMatchObject({ total: 4, valid: 3, avg: 20, min: 10, max: 30, latest: 20, p50: 20, p99: 30, loss: 2 })
    expect(stats.ratio).toBeCloseTo(1.5)
    expect(stats.stddev).toBeCloseTo(Math.sqrt(200 / 3))
  })

  it('reports no loss rather than 0 when the loss column has no numeric sample', () => {
    const points = normalizeHistory([{ timestamp: START, ping_cu: 12, loss_cu: null }])
    expect(probeStats(points, 'cu')).toMatchObject({ avg: 12, loss: null })
  })
})

describe('probe targets', () => {
  it('preserves false, null, zero and numbers for legacy and Node probe history', () => {
    const points = normalizeHistory([
      { timestamp: 1, ping_ct: false, loss_ct: null, ping_node_1: null, loss_node_1: 0 },
      { timestamp: 2, ping_ct: 18, loss_ct: 0, ping_node_1: 0, loss_node_1: 2 },
    ])
    expect(points.map((point) => point.latency.ct)).toEqual([false, 18])
    expect(points.map((point) => point.latency.node_1)).toEqual([null, 0])
    expect(points.map((point) => point.packetLoss.ct)).toEqual([null, 0])

    const rows = buildChartRows(points)
    const [telecom] = probeSeries(rows, [{ target: 'ct', label: 'Telecom' }], 'latency', ['#FF6B6B'], false)
    expect(telecom?.data.map(([, value]) => value)).toEqual([null, 18])
    const [tokyo] = probeSeries(rows, [{ target: 'node_1', label: 'Tokyo probe' }], 'latency', ['#FF6B6B'], false)
    expect(tokyo?.name).toBe('Tokyo probe')
    expect(tokyo?.data.map(([, value]) => value)).toEqual([null, 0])
  })

  it('hides non-numeric trends while retaining timeout-only probes in current detail state', () => {
    const points = normalizeHistory([{ timestamp: 1, ping_node_2: null, loss_node_2: false }])
    const server = normalizeServer({ id: 'node-a' }, source)

    expect(probeSeries(buildChartRows(points), [{ target: 'node_2', label: 'Node 2' }], 'latency', ['#FF6B6B'], false)).toEqual([])
    expect(activeProbeTargets(server, points)).toContain('node_2')
  })

  it('disambiguates duplicate probe labels so legend toggles stay independent', () => {
    const labels = { ...DEFAULT_PROBE_LABELS, node_1: 'Tokyo', node_2: 'Tokyo' }
    expect(labeledProbeTargets(['ct', 'node_1', 'node_2'], labels)).toEqual([
      { target: 'ct', label: DEFAULT_PROBE_LABELS.ct },
      { target: 'node_1', label: 'Tokyo (node_1)' },
      { target: 'node_2', label: 'Tokyo (node_2)' },
    ])
  })
})

/*
 * 「实时」档位的样本缓冲。
 *
 * CFSM 的历史接口只有 9 个固定时段，取回来就是静止的；页面上持续到达的只有详情页那条
 * WebSocket 推送。缓冲把每次推送后的节点快照转成历史点，因此必须做到：字段一一对应、
 * 缺失仍是缺失、按真实时间裁剪，并且不改动传入的数组。
 */
describe('实时样本缓冲', () => {
  const server = normalizeServer({
    id: 'node',
    name: 'Node',
    cpu: 12.5,
    load: 0.25,
    ram: 400,
    ram_total: 1024,
    swap: 0,
    swap_total: 512,
    disk: 2048,
    disk_total: 20480,
    net_in_speed: 1500,
    net_out_speed: 2500,
    net_in_transfer: 10,
    net_out_transfer: 20,
    process: 99,
    tcp_conn: 5,
    udp_conn: 1,
    ping_ct: 30,
    loss_ct: 0,
  }, source)

  it('快照逐字段映射成历史点，缺失不补 0', () => {
    const point = liveHistoryPoint(server, START)
    expect(point.timestamp).toBe(START)
    expect(point.cpu).toBe(server.cpu)
    expect(point.load1).toBe(server.load1)
    expect(point.memoryUsed).toBe(server.memoryUsed)
    expect(point.networkInSpeed).toBe(server.networkInSpeed)
    expect(point.processes).toBe(server.processes)
    expect(point.latency.ct).toBe(server.latency.ct)
    // 历史里有、推送里没有的字段保持缺失，不写成 0。
    expect(point.temperature).toBeNull()
  })

  it('按真实时间窗口裁剪，并且不修改传入的数组', () => {
    const base = [
      liveHistoryPoint(server, START),
      liveHistoryPoint(server, START + LIVE_WINDOW_MS - 20_000),
    ]
    const snapshot = structuredClone(base)
    const next = appendLivePoint(base, liveHistoryPoint(server, START + LIVE_WINDOW_MS + 1_000))
    expect(base).toEqual(snapshot)
    // 第一个点已经超出窗口，被裁掉。
    expect(next.map((point) => point.timestamp)).toEqual([
      START + LIVE_WINDOW_MS - 20_000,
      START + LIVE_WINDOW_MS + 1_000,
    ])
  })

  it('条数也有上限，长时间停留不会无限增长', () => {
    // 放宽时间窗口，专门验证条数上限；1 秒是 Agent 允许的最短 WSS 上报间隔。
    const step = 1_000
    const window = step * (LIVE_MAX_POINTS + 100)
    let points = [] as ReturnType<typeof appendLivePoint>
    for (let index = 0; index < LIVE_MAX_POINTS + 50; index += 1) {
      points = appendLivePoint(points, liveHistoryPoint(server, START + index * step), window)
    }
    expect(points).toHaveLength(LIVE_MAX_POINTS)
    // 保留的是最近的那些点。
    expect(points[points.length - 1]?.timestamp).toBe(START + (LIVE_MAX_POINTS + 49) * step)
  })

  it('逐条保留 Agent 配置间隔到达的 WSS 样本，不在前端强制降成 10 秒', () => {
    for (const interval of [1_000, 2_000, 5_000]) {
      const timestamps = [0, 1, 2, 3].map((index) => START + index * interval)
      const points = timestamps.reduce<ReturnType<typeof appendLivePoint>>(
        (buffer, timestamp) => appendLivePoint(buffer, liveHistoryPoint(server, timestamp)),
        [],
      )
      expect(points.map((point) => point.timestamp)).toEqual(timestamps)
    }
  })

  it('逐条回放同一个 batchUpdate 内按 Agent 间隔采集的多条样本', () => {
    const merged = mergeDetailLiveSamples(server, [], [
      { serverId: server.id, timestamp: START / 1000, data: { cpu: 10 } },
      { serverId: server.id, timestamp: (START + 2_000) / 1000, data: { cpu: 20 } },
      { serverId: server.id, timestamp: (START + 4_000) / 1000, data: { cpu: 30 } },
    ], START + 5_000)

    expect(merged.matched).toBe(3)
    expect(merged.points.map((point) => [point.timestamp, point.cpu])).toEqual([
      [START, 10],
      [START + 2_000, 20],
      [START + 4_000, 30],
    ])
    expect(merged.server.cpu).toBe(30)
  })

  it('实时缺口按绝对时间判断：密度不一致不算断线，真断了才留占位', () => {
    // 垫底历史约 10 秒一点、推送约 2 秒一点，这种密度差异以前会被判成缺口，图上出现空白。
    const mixed = [
      liveHistoryPoint(server, START),
      liveHistoryPoint(server, START + 10_000),
      liveHistoryPoint(server, START + 20_000),
      liveHistoryPoint(server, START + 22_000),
      liveHistoryPoint(server, START + 24_000),
    ]
    expect(buildLiveChartRows(mixed).every((row) => row.point !== null)).toBe(true)
    // 真的断了一分钟以上才插占位行。
    const broken = [...mixed, liveHistoryPoint(server, START + 24_000 + 120_000)]
    const rows = buildLiveChartRows(broken)
    expect(rows.filter((row) => row.point === null)).toHaveLength(1)
  })
})

describe('实时缓冲的历史垫底', () => {
  const point = (timestamp: number, cpu: number) => ({
    ...liveHistoryPoint(normalizeServer({ id: 'node', name: 'Node', cpu }, source), timestamp),
  })

  it('只取还在窗口内的历史点，按时间升序', () => {
    const now = START + LIVE_WINDOW_MS
    const seeded = seedLivePoints(
      [point(START - 60_000, 1), point(START + 1_000, 2), point(START + 2_000, 3)],
      [],
      now,
    )
    expect(seeded.map((item) => item.timestamp)).toEqual([START + 1_000, START + 2_000])
  })

  it('与已收到的推送样本合并，同一时刻以推送为准', () => {
    const now = START + 10_000
    const seeded = seedLivePoints([point(START, 1), point(START + 5_000, 1)], [point(START + 5_000, 9)], now)
    expect(seeded).toHaveLength(2)
    expect(seeded[1]?.cpu).toBe(9)
  })

  it('垫底同样受条数上限约束', () => {
    const history = Array.from({ length: LIVE_MAX_POINTS + 20 }, (_, index) => point(START + index * 1_000, 1))
    const seeded = seedLivePoints(history, [], START + (LIVE_MAX_POINTS + 20) * 1_000, LIVE_WINDOW_MS * 10)
    expect(seeded).toHaveLength(LIVE_MAX_POINTS)
  })
})
