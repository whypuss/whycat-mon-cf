import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  mergeRealtimeSample,
  normalizeServer,
  normalizeServerCollection,
} from '@/services/cfsm/adapters'
import { toGlassServer as toGlassServerView } from '@/services/cfsm/glassmorphism-adapter'
import { numericWindowSamples, probeSeriesFor, seriesTargets } from '@/domain/probe-window'
import { PROBE_TARGETS } from '@/constants/probes'

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const serverCard = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')
const detailView = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')

const source = { base: 'https://status.example', label: 'status.example' }

/*
 * 第 14 轮的数据契约回归。
 *
 * 契约取自 CF-Server-Monitor 2.8.5 Beta5 源码：
 * - `src/database/schema.js` `getDashboardLatencyHistory` / `buildLatencyHistoryPoint`
 *   每台节点固定输出 20 个时间桶、覆盖 2 小时，每个点含全部 8 个探测目标，
 *   取值为 number | null（无采样）| false（未配置），`ts` 是毫秒且升序。
 * - `src/handlers/dashboard.js` `handleServersAPI` 把 `show_price` / `show_expire` /
 *   `show_tf` 放在响应**顶层** `sysConfig`，而不是每台节点上。
 * - `src/utils/metrics.js` `mergeMetricsIntoServer` 把全部 8 个探测目标写进 server。
 */

function windowPoint(ts: number, overrides: Record<string, unknown> = {}) {
  return {
    ts,
    ct: 20,
    cu: 30,
    cm: null,
    bd: false,
    node_1: 40,
    node_2: null,
    node_3: false,
    node_4: false,
    ...overrides,
  }
}

function serversResponse(overrides: Record<string, unknown> = {}) {
  return {
    servers: [{
      id: 'node-1',
      name: 'Node 1',
      is_online: 1,
      ping_ct: 20,
      loss_ct: 0,
      ping_node_1: 40,
      loss_node_1: 2,
      ping: [windowPoint(3000), windowPoint(1000, { ct: 21 }), windowPoint(2000, { ct: null })],
      loss: [windowPoint(1000, { ct: 0 }), windowPoint(2000, { ct: null }), windowPoint(3000, { ct: 5 })],
    }],
    stats: {},
    ...overrides,
  }
}

describe('/api/servers 延迟窗口契约', () => {
  it('每个点解析全部 8 个探测目标，缺席的 key 等同未配置', () => {
    const server = normalizeServer({
      id: 'node',
      ping: [{ ts: 1000, ct: 20 }],
    }, source)

    expect(server.latencyWindow).toHaveLength(1)
    expect(Object.keys(server.latencyWindow[0]!).sort()).toEqual(
      ['timestamp', ...PROBE_TARGETS].sort(),
    )
    expect(server.latencyWindow[0]).toMatchObject({ ct: 20, cu: false, node_4: false })
  })

  it('保留 number / null / false 三态，并按时间戳升序', () => {
    const collection = normalizeServerCollection(serversResponse(), source)
    const window = collection.servers[0]!.latencyWindow

    expect(window.map((point) => point.timestamp)).toEqual([1000, 2000, 3000])
    expect(window.map((point) => point.ct)).toEqual([21, null, 20])
    expect(window[0]).toMatchObject({ cm: null, bd: false, node_1: 40 })
  })

  it('WebSocket 增量不会清掉只有列表接口才提供的窗口', () => {
    const collection = normalizeServerCollection(serversResponse(), source)
    const before = collection.servers[0]!
    const after = mergeRealtimeSample(before, {
      serverId: 'node-1',
      timestamp: 9_999,
      data: { cpu: 42, ping_ct: 25 },
    })

    expect(after.latencyWindow).toEqual(before.latencyWindow)
    expect(after.packetLossWindow).toEqual(before.packetLossWindow)
    expect(after.latency.ct).toBe(25)
    // 增量里没出现的探测目标保持原值，不被覆盖成 false 或 0。
    expect(after.latency.node_1).toBe(before.latency.node_1)
  })
})

describe('首页窗口按探测目标分组（BUG-001 回归）', () => {
  const collection = normalizeServerCollection(serversResponse(), source)
  const view = toGlassServerView(collection.servers[0]!, null)

  it('每个目标是一条与时间桶等长的序列，空洞留在原位', () => {
    const ct = probeSeriesFor(view.history.latencySeries, 'ct')
    expect(ct.map((point) => point.timestamp)).toEqual([1000, 2000, 3000])
    expect(ct.map((point) => point.value)).toEqual([21, null, 20])
  })

  it('整段未配置的目标不产出序列，配置过的 node 目标会产出', () => {
    expect(seriesTargets(view.history.latencySeries, PROBE_TARGETS)).toEqual(['ct', 'cu', 'cm', 'node_1', 'node_2'])
    expect(view.history.latencySeries.bd).toBeUndefined()
    expect(view.history.latencySeries.node_3).toBeUndefined()
  })

  it('聚合统计才丢弃空洞，且不会把 null 当成 0', () => {
    expect(numericWindowSamples({ ct: probeSeriesFor(view.history.latencySeries, 'ct') })).toEqual([21, 20])
  })

  it('柱状图按时间桶渲染，null 用独立的空洞样式而不是被过滤掉', () => {
    expect(serverCard).toContain('points.map((point, index)')
    expect(serverCard).toContain("className: typeof point.value === 'number' ? tone(point.value) : 'is-gap'")
    expect(serverCard).toContain('probeSeriesFor(series, target)')
    expect(stylesheet).toContain('.node-probe__bars .is-gap')
    expect(stylesheet).toContain('.node-probe__bars .is-empty')
  })
})

describe('首页保留 node_1～node_4 探测目标（BUG-002 回归）', () => {
  it('八个目标都会进入首页视图模型', () => {
    const collection = normalizeServerCollection(serversResponse(), source)
    const view = toGlassServerView(collection.servers[0]!, null)

    expect(view.latency.map((probe) => probe.target)).toEqual(['ct', 'node_1'])
    expect(view.latency.find((probe) => probe.target === 'node_1')).toMatchObject({
      label: 'Node 1',
      latency: 40,
      packetLoss: 2,
    })
  })

  it('只配置了 node 目标的节点在首页也有探测数据', () => {
    const server = normalizeServer({
      id: 'node-only',
      ping_node_2: 88,
      loss_node_2: 0,
    }, source)
    const view = toGlassServerView(server, null)

    expect(view.latency).toHaveLength(1)
    expect(view.latency[0]).toMatchObject({ target: 'node_2', latency: 88, packetLoss: 0 })
  })
})

describe('站点级展示开关下发到每台节点（BUG-003 回归）', () => {
  it('顶层 sysConfig 会应用到列表里的每台节点', () => {
    const collection = normalizeServerCollection(
      serversResponse({ sysConfig: { show_price: false, show_expire: false, show_tf: false } }),
      source,
    )

    expect(collection.systemConfig).toMatchObject({ showPrice: false, showExpire: false, showTraffic: false })
    expect(collection.servers[0]!.systemConfig).toMatchObject({ showPrice: false, showExpire: false, showTraffic: false })

    const view = toGlassServerView(collection.servers[0]!, null)
    expect(view).toMatchObject({ showPrice: false, showExpire: false, showTraffic: false })
  })

  it('没有 sysConfig 时保持默认可见，不擅自隐藏', () => {
    const collection = normalizeServerCollection(serversResponse(), source)
    const view = toGlassServerView(collection.servers[0]!, null)
    expect(view).toMatchObject({ showPrice: true, showExpire: true, showTraffic: true })
  })

  it('详情页按 owning source 回取站点开关，并让剩余价值跟随价格开关', () => {
    expect(detailView).toContain('serverStore.siteVisibility(server.value.source.base)')
    expect(detailView).toContain("visibilityFlag('showPrice')")
    expect(detailView).toContain("visibilityFlag('showExpire')")
    expect(detailView).toContain("visibilityFlag('showTraffic')")
    expect(detailView).toContain("card.key === 'remainingValue'")
  })

  /*
   * 第 15 轮补上冷启动那一半（原 U-05）：直接粘贴详情链接时 store 是空的，
   * 站点开关拿不到，运营方关掉的价格 / 到期 / 流量照常显示。
   * 浏览器实测（`showPrice=0&showExpire=0&showTf=0` 直达详情）：
   * 修复前 8 张指标卡全在，修复后只剩「累计流量 / 运行时间 / 连接数」，
   * `/api/servers` 恰好 1 次，节点选择器也随之补齐到 10 项。
   */
  it('详情冷启动复用预取的列表请求，之后进入详情时仍按 store 是否为空补取', () => {
    expect(detailView).toContain('serverStore.collections.length === 0')
    expect(detailView).toContain("serverStore.state === 'idle' || serverStore.state === 'loading'")
    expect(detailView).toContain("app.state === 'idle' || (initialPage && app.state === 'loading')")
    expect(detailView).toContain('await Promise.all([configPromise, loadCurrent(), listPromise])')
    // 不允许出现轮询或定时重取站点开关。
    expect(detailView).not.toMatch(/setInterval\([^)]*serverStore\.load/)
  })

  it('站点开关未知时先隐藏，拿到之后再决定，避免把已关闭的价格闪出来', () => {
    expect(detailView).toContain('const siteVisibilityKnown = computed(')
    expect(detailView).toContain('if (!siteVisibilityKnown.value) return false')
    expect(detailView).toContain('serverStore.hasLoadedSource(server.value.source.base)')
    expect(detailView).not.toContain('serverStore.loadedAt !== null')
  })
})

describe('总览卡片单位不再抢占主数值的宽度（BUG-004 回归）', () => {
  it('总览单位可收缩且没有宽度上限，与上游 truncate 一致', () => {
    const unit = stylesheet.slice(
      stylesheet.indexOf('.overview-card__unit {'),
      stylesheet.indexOf('@media (min-width: 768px)', stylesheet.indexOf('.overview-card__unit {')),
    )
    expect(unit).not.toContain('max-width: 60%')
    expect(unit).not.toContain('flex: none')
    expect(unit).toContain('min-width: 0')
  })

  it('详情指标卡的单位仍然固定，对应上游的 shrink-0', () => {
    const em = stylesheet.slice(
      stylesheet.indexOf('.detail-metric-card__value > em {'),
      stylesheet.indexOf('}', stylesheet.indexOf('.detail-metric-card__value > em {')),
    )
    expect(em).toContain('flex: none')
  })
})
