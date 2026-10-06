import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ServerList from '@/components/dashboard/ServerList.vue'
import type { GlassServer } from '@/types/glassmorphism'

/*
 * 列表视图「信息」栏的厂商与上游 NodeList 一样取识别结果的 `displayName`，
 * 和详情页同一个识别函数：内置厂商库、自定义别名（分号或换行分组）、约定的 asn / org 标签。
 * 此前列表只认自定义别名、只按分号分组，同一台节点在列表与详情页可能显示不同的厂商。
 */
function server(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'example:node', id: 'node', sourceBase: 'https://example.invalid', sourceLabel: 'Example',
    name: 'Edge', group: '', tags: [], providerTags: { asn: null, org: null }, region: 'HK',
    price: null, billingCycle: null, currency: null, expireDate: null, trafficLimit: null,
    trafficCalculationType: null, showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: null, cpu: null, load: { one: null, five: null, fifteen: null },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: { inSpeed: null, outSpeed: null, received: null, transmitted: null, monthlyReceived: null, monthlyTransmitted: null },
    processes: null, tcpConnections: null, udpConnections: null, latency: [],
    history: { latencySeries: {}, packetLossSeries: {} }, gpus: [],
    connectivity: { ipv4: null, ipv6: null }, operatingSystem: null, architecture: null,
    cpuInfo: null, cpuCores: null, kernelVersion: null, agentVersion: null, bootTime: null, lastUpdated: null,
    ...overrides,
  }
}

async function providerBadges(overrides: Partial<GlassServer>, providerAliases = ''): Promise<string[]> {
  const html = await renderToString(createSSRApp(ServerList, {
    servers: [server(overrides)], showSource: false, favoriteKeys: new Set<string>(),
    metadataEnabled: true, metadataFields: ['provider'], customTagsVisible: false, providerAliases, priceVisible: true,
    transitionKey: '__all__', motion: false,
  }))
  return [...html.matchAll(/class="node-list__badge"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)].map((match) => match[1] ?? '')
}

describe('列表视图的厂商与详情页同一套识别', () => {
  it('按内置厂商库识别节点名称', async () => {
    expect(await providerBadges({ name: 'DMIT LAX' })).toEqual(['DMIT'])
  })

  it('识别约定的 asn 标签', async () => {
    expect(await providerBadges({ providerTags: { asn: 'AS20473', org: null } })).toEqual(['Vultr (Choopa)'])
  })

  it('自定义别名可以按换行分组', async () => {
    expect(await providerBadges({ name: 'Edge hk-premium' }, 'Acme: hk-premium\nOther: missing')).toEqual(['Acme'])
  })

  it('识别不到时不显示厂商', async () => {
    expect(await providerBadges({})).toEqual([])
  })
})
