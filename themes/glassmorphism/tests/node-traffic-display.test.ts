import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ServerCard from '@/components/dashboard/ServerCard.vue'
import ServerList from '@/components/dashboard/ServerList.vue'
import { trafficDisplay, trafficHeadText, trafficRatioText } from '@/domain/theme-presentation'
import type { GlassServer } from '@/types/glassmorphism'
import { MISSING_TEXT } from '@/utils/format'

/*
 * 节点流量显示口径（v1.1.15）。
 *
 * Komari NodeCard 没有上限时显示 `∞` 与真实的 `已用 / ∞`；此前本主题在没有上限时把已用量
 * 整个当成未知，显示 `— / ∞`。另外两种情况此前都显示「∞」，等于宣称不限流量：
 * 站点关闭流量展示（CFSM `show_tf`，上游没有这个开关）、有上限但月度计数缺失
 * （上游把缺失按 0 计）。现在前者不呈现任何数值，后者保留上限、已用量如实为未知。
 */

const GiB = 1024 ** 3

function server(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'example:node', id: 'node', sourceBase: 'https://example.invalid', sourceLabel: 'Example',
    name: 'Example Node', group: '', tags: [], providerTags: { asn: null, org: null }, region: 'HK',
    price: null, billingCycle: null, currency: null, expireDate: null, trafficLimit: null,
    trafficCalculationType: 'total', showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: null, cpu: 5, load: { one: 1.11, five: 2.22, fifteen: 3.33 },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: {
      inSpeed: null, outSpeed: null, received: null, transmitted: null,
      monthlyReceived: 3 * GiB, monthlyTransmitted: GiB,
    },
    processes: null, tcpConnections: null, udpConnections: null, latency: [],
    history: { latencySeries: {}, packetLossSeries: {} }, gpus: [],
    connectivity: { ipv4: null, ipv6: null }, operatingSystem: null, architecture: null,
    cpuInfo: null, cpuCores: null, kernelVersion: null, agentVersion: null, bootTime: null, lastUpdated: null,
    ...overrides,
  }
}

function withMonthly(received: number | null, transmitted: number | null): Partial<GlassServer> {
  return {
    network: {
      inSpeed: null, outSpeed: null, received: null, transmitted: null,
      monthlyReceived: received, monthlyTransmitted: transmitted,
    },
  }
}

describe('节点流量显示口径', () => {
  it('不限流量时显示真实已用量 / ∞，不再把已用量当成未知', () => {
    // CFSM 自己按 `parseFloat(traffic_limit) || 0` 判断：空、0 都是不限流量。
    for (const trafficLimit of [null, '', '0', '0.0']) {
      const view = trafficDisplay(server({ trafficLimit }))
      expect(view).toEqual({ kind: 'unlimited', used: 4 * GiB })
      expect(trafficHeadText(view)).toBe('∞')
      expect(trafficRatioText(view)).toBe('4.0 GB / ∞')
    }
  })

  it('已用量沿用 CFSM 的计费方式', () => {
    expect(trafficDisplay(server({ trafficCalculationType: 'dl' }))).toMatchObject({ used: 3 * GiB })
    expect(trafficDisplay(server({ trafficCalculationType: 'ul' }))).toMatchObject({ used: GiB })
    expect(trafficDisplay(server({ trafficCalculationType: 'max' }))).toMatchObject({ used: 3 * GiB })
    expect(trafficDisplay(server({ trafficCalculationType: 'total' }))).toMatchObject({ used: 4 * GiB })
  })

  it('有上限时显示百分比与「已用 / 上限」', () => {
    const view = trafficDisplay(server({ trafficLimit: '550.0' }))
    expect(view).toMatchObject({ kind: 'limited', used: 4 * GiB, limit: 550 * GiB })
    expect(trafficHeadText(view)).toBe('0.7%')
    expect(trafficRatioText(view)).toBe('4.0 GB / 550.0 GB')
  })

  it('有上限但月度计数缺失时保留上限，已用量如实为未知，不写成 0 也不冒充不限流量', () => {
    const view = trafficDisplay(server({ trafficLimit: '550.0', ...withMonthly(null, GiB) }))
    expect(view).toEqual({ kind: 'limited', used: null, limit: 550 * GiB, percent: null })
    expect(trafficHeadText(view)).toBe('-')
    expect(trafficRatioText(view)).toBe('- / 550.0 GB')
  })

  it('不限流量但月度计数缺失时只有已用量未知', () => {
    const view = trafficDisplay(server(withMonthly(3 * GiB, null)))
    expect(view).toEqual({ kind: 'unlimited', used: null })
    expect(trafficHeadText(view)).toBe('∞')
    expect(trafficRatioText(view)).toBe('- / ∞')
  })

  it('站点关闭流量展示时不透露任何数值，也不写成「∞」', () => {
    const view = trafficDisplay(server({ showTraffic: false, trafficLimit: '550.0' }))
    expect(view).toEqual({ kind: 'hidden' })
    expect(trafficHeadText(view)).toBe('-')
    expect(trafficRatioText(view)).toBe('- / -')
  })

  it('占位符与 Komari 一致是 ASCII 短横', () => {
    expect(MISSING_TEXT).toBe('-')
  })
})

async function cardTraffic(overrides: Partial<GlassServer>, density: 'comfortable' | 'mini') {
  const html = await renderToString(createSSRApp(ServerCard, {
    server: server(overrides), showSource: false, density, favorite: false, priceVisible: true,
  }))
  const match = /node-metric__label--traffic[\s\S]*?<span class="node-metric__value[^"]*">([^<]*)<\/span>[\s\S]*?<div class="node-metric__hint[^"]*">([^<]*)<\/div>/.exec(html)
  expect(match).not.toBeNull()
  return { head: match?.[1]?.trim() ?? '', hint: match?.[2]?.trim() ?? '' }
}

async function listTraffic(overrides: Partial<GlassServer>): Promise<string> {
  const html = await renderToString(createSSRApp(ServerList, {
    servers: [server(overrides)], showSource: false, favoriteKeys: new Set<string>(),
    metadataEnabled: false, metadataFields: [], customTagsVisible: false, providerAliases: '', priceVisible: true,
    transitionKey: '__all__', motion: false,
  }))
  const values = [...html.matchAll(/<span class="node-list__metric-value">([^<]*)<\/span>/g)].map((item) => item[1]?.trim() ?? '')
  // CPU / 内存 / 硬盘 / 流量
  expect(values).toHaveLength(4)
  return values[3] ?? ''
}

describe('节点卡片与节点列表的流量格', () => {
  it.each(['comfortable', 'mini'] as const)('卡片（%s）：不限流量显示已用量 / ∞', async (density) => {
    expect(await cardTraffic({}, density)).toEqual({ head: '∞', hint: '4.0 GB / ∞' })
  })

  it.each(['comfortable', 'mini'] as const)('卡片（%s）：有上限但已用量未知时不出现「∞」', async (density) => {
    const traffic = await cardTraffic({ trafficLimit: '550.0', ...withMonthly(null, null) }, density)
    expect(traffic).toEqual({ head: '-', hint: '- / 550.0 GB' })
  })

  it.each(['comfortable', 'mini'] as const)('卡片（%s）：站点关闭流量展示时不呈现数值', async (density) => {
    const traffic = await cardTraffic({ showTraffic: false, trafficLimit: '550.0' }, density)
    expect(traffic).toEqual({ head: '-', hint: '- / -' })
  })

  it('列表：与卡片同一口径', async () => {
    expect(await listTraffic({})).toBe('∞')
    expect(await listTraffic({ trafficLimit: '550.0' })).toBe('0.7%')
    expect(await listTraffic({ trafficLimit: '550.0', ...withMonthly(null, null) })).toBe('-')
    expect(await listTraffic({ showTraffic: false, trafficLimit: '550.0' })).toBe('-')
  })
})
