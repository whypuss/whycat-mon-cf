import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildGeneralCards,
  resolveGeneralCardKeys,
  resolveQuickControlKeys,
} from '@/domain/theme-presentation'
import {
  formatDisplayBillingCycle,
  formatDisplayBytes,
  formatDisplayBytesSplit,
  formatDisplayMebibytes,
  formatDisplayPrice,
  formatDisplaySpeed,
  formatHomeUptimeDays,
  formatPrice,
} from '@/utils/format'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const overviewCards = readFileSync(new URL('../src/components/dashboard/OverviewCards.vue', import.meta.url), 'utf8')
const serverCard = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')
const serverList = readFileSync(new URL('../src/components/dashboard/ServerList.vue', import.meta.url), 'utf8')
const background = readFileSync(new URL('../src/components/dashboard/DynamicBackground.vue', import.meta.url), 'utf8')
const detailView = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')

const source = { base: 'https://status.example', label: 'status.example' }

function glass(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'source:node', id: 'node', sourceBase: source.base, sourceLabel: source.label,
    name: 'Node', group: '', tags: [], providerTags: { asn: null, org: null }, region: 'HK',
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

function customGeneral(keys: string): ReturnType<typeof cloneThemeSettings> {
  const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
  settings.generalCardPreset = '自定义'
  settings.generalCardKeys = keys
  return settings
}

describe('首页字节格式（Komari utils/helper.ts 规则）', () => {
  it('使用 KB / MB / GB / TB 而不是 KiB / MiB / GiB，换算基数仍是 1024', () => {
    expect(formatDisplayBytes(1024)).toBe('1 KB')
    expect(formatDisplayBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatDisplayBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatDisplayBytes(1024 ** 4)).toBe('1.00 TB')
    expect(formatDisplayBytes(1024 ** 5)).toBe('1.00 PB')
  })

  it('按 B 0 / KB 0 / MB 1 / GB 1 / TB 2 的精度输出', () => {
    expect(formatDisplayBytesSplit(512)).toEqual({ value: '512', unit: 'B' })
    expect(formatDisplayBytesSplit(1536)).toEqual({ value: '2', unit: 'KB' })
    expect(formatDisplayBytesSplit(1.5 * 1024 ** 2)).toEqual({ value: '1.5', unit: 'MB' })
    expect(formatDisplayBytesSplit(62.25 * 1024 ** 3)).toEqual({ value: '62.3', unit: 'GB' })
    expect(formatDisplayBytesSplit(2.125 * 1024 ** 4)).toEqual({ value: '2.13', unit: 'TB' })
  })

  it('速度在单位后加 /s，缺失值保持占位符而不是 0', () => {
    expect(formatDisplaySpeed(1024 ** 2)).toBe('1.0 MB/s')
    expect(formatDisplaySpeed(0)).toBe('0 B/s')
    expect(formatDisplaySpeed(null)).toBe('-')
    expect(formatDisplayBytes(null)).toBe('-')
    expect(formatDisplayMebibytes(1024)).toBe('1.0 GB')
  })
})

describe('首页运行天数与计费周期', () => {
  it('节点卡片的运行芯片只显示整天数', () => {
    const now = Date.UTC(2026, 8, 10, 6)
    expect(formatHomeUptimeDays(Date.UTC(2026, 8, 8, 6) / 1000, now)).toBe('在线 2 天')
    expect(formatHomeUptimeDays(Date.UTC(2026, 8, 10, 5) / 1000, now)).toBe('在线 0 天')
    expect(formatHomeUptimeDays(null, now)).toBe('-')
  })

  it('本地化 CFSM 官方计费周期，未知自由文本原样保留', () => {
    expect(formatDisplayBillingCycle('month')).toBe('月')
    expect(formatDisplayBillingCycle('quarter')).toBe('季')
    expect(formatDisplayBillingCycle('half_year')).toBe('半年')
    expect(formatDisplayBillingCycle('year')).toBe('年')
    expect(formatDisplayBillingCycle('two_years')).toBe('两年')
    expect(formatDisplayBillingCycle('three_years')).toBe('三年')
    expect(formatDisplayBillingCycle('four_years')).toBe('四年')
    expect(formatDisplayBillingCycle('five_years')).toBe('五年')
    expect(formatDisplayBillingCycle('每两周')).toBe('每两周')
    expect(formatDisplayBillingCycle(null)).toBe('')
  })

  it('首页价格使用中文周期，详情页的 formatPrice 保持原样', () => {
    expect(formatDisplayPrice('18', 'USD', 'year')).toBe('USD18 / 年')
    expect(formatDisplayPrice('24', 'USD', 'month')).toBe('USD24 / 月')
    expect(formatDisplayPrice('0', 'CNY', 'year')).toBe('免费')
    expect(formatDisplayPrice(null, 'CNY', 'year')).toBe('-')
    expect(formatPrice('18', 'USD', 'year')).toBe('USD18 / year')
  })
})

describe('总览卡片对齐 Komari NodeGeneralCards', () => {
  it('内存与硬盘是「已用数值 + 已用单位 / 总量」，不是百分比主值', () => {
    const cards = buildGeneralCards(
      [glass({
        memory: { used: 4096, total: 8192, percentage: 50 },
        disk: { used: 20 * 1024, total: 60 * 1024, percentage: 33 },
      })],
      customGeneral('memory\ndisk'),
    )

    expect(cards[0]).toMatchObject({ key: 'memory', label: '内存用量', value: '4.0', unit: 'GB / 8.0 GB' })
    expect(cards[1]).toMatchObject({ key: 'disk', label: '硬盘用量', value: '20.0', unit: 'GB / 60.0 GB' })
  })

  it('流量与速率把单位单独放在 unit，说明文字改由 tooltip 承担', () => {
    const cards = buildGeneralCards(
      [glass({
        network: {
          inSpeed: 1024 ** 2, outSpeed: 2 * 1024 ** 2,
          received: 3 * 1024 ** 3, transmitted: 1024 ** 3,
          monthlyReceived: null, monthlyTransmitted: null,
        },
      })],
      customGeneral('totalTraffic\nuploadSpeed\ndownloadSpeed'),
    )

    expect(cards[0]).toMatchObject({ key: 'totalTraffic', label: '累计流量', value: '4.0', unit: 'GB' })
    expect(cards[0]?.hint).toBe('↑ 1.0 GB\n↓ 3.0 GB')
    expect(cards[1]).toMatchObject({ key: 'uploadSpeed', label: '实时上行', value: '2.0', unit: 'MB/s' })
    expect(cards[2]).toMatchObject({ key: 'downloadSpeed', label: '实时下行', value: '1.0', unit: 'MB/s' })
  })

  it('任一节点累计流量缺一向时不显示伪完整总量', () => {
    const cards = buildGeneralCards(
      [glass({
        network: {
          inSpeed: 1,
          outSpeed: 1,
          received: 1024,
          transmitted: null,
          monthlyReceived: null,
          monthlyTransmitted: null,
        },
      })],
      customGeneral('totalTraffic'),
    )
    expect(cards).toEqual([])
  })

  it('多节点仅合计双向完整的流量，并明确标出未计入的节点', () => {
    const complete = glass({
      network: { inSpeed: null, outSpeed: null, received: 3 * 1024 ** 3, transmitted: 1024 ** 3, monthlyReceived: null, monthlyTransmitted: null },
    })
    const incomplete = glass({
      key: 'source:incomplete', id: 'incomplete',
      network: { inSpeed: null, outSpeed: null, received: 9 * 1024 ** 3, transmitted: null, monthlyReceived: null, monthlyTransmitted: null },
    })
    const cards = buildGeneralCards([complete, incomplete], customGeneral('totalTraffic'))

    // 用户决定卡面依照上游：部分合计的单位仍是 GB，缺失数量只在提示里如实说明。
    expect(cards[0]).toMatchObject({ key: 'totalTraffic', value: '4.0', unit: 'GB' })
    expect(cards[0]).not.toHaveProperty('partial')
    expect(cards[0]?.hint).toBe('↑ 1.0 GB\n↓ 3.0 GB\n部分 · 1 台缺少流量数据，未计入')
  })

  it('全部节点缺少双向流量时隐藏累计卡，不把未知渲染成零', () => {
    const nodes = [
      glass(),
      glass({ key: 'source:incomplete', id: 'incomplete', network: {
        inSpeed: null, outSpeed: null, received: 1024, transmitted: null,
        monthlyReceived: null, monthlyTransmitted: null,
      } }),
    ]
    expect(buildGeneralCards(nodes, customGeneral('totalTraffic'))).toEqual([])
  })

  it('计数类卡片用 `/ 总数`、`台`、`个` 作单位', () => {
    const servers = [glass(), glass({ key: 'source:b', id: 'b', online: false })]
    const cards = buildGeneralCards(servers, customGeneral('onlineNodes\nofflineNodes\nexpiringNodes\nregionDistribution'))

    expect(cards[0]).toMatchObject({ key: 'onlineNodes', value: '1', unit: '/ 2' })
    expect(cards[1]).toMatchObject({ key: 'offlineNodes', value: '1', unit: '/ 2' })
    expect(cards[2]).toMatchObject({ key: 'expiringNodes', value: '0', unit: '台' })
    expect(cards[3]).toMatchObject({ key: 'regionDistribution', value: '1', unit: '个' })
  })

  it('系统分布的主值是占比最高的系统名，而不是系统种类数', () => {
    const servers = [
      glass({ operatingSystem: 'debian 12' }),
      glass({ key: 'source:b', id: 'b', operatingSystem: 'debian 12' }),
      glass({ key: 'source:c', id: 'c', operatingSystem: 'alpine' }),
    ]
    expect(buildGeneralCards(servers, customGeneral('systemDistribution'))[0])
      .toMatchObject({ key: 'systemDistribution', value: 'debian 12', unit: '2 台' })
  })

  it('使用上游图标名', () => {
    const cards = buildGeneralCards(
      [glass({
        memory: { used: 1, total: 2, percentage: 50 },
        network: { inSpeed: 1, outSpeed: 1, received: 1, transmitted: 1, monthlyReceived: null, monthlyTransmitted: null },
      })],
      customGeneral('memory\ntotalTraffic\nuploadSpeed\ndownloadSpeed\nonlineNodes\ntrafficWarnings'),
    )
    expect(cards.map((card) => card.icon)).toEqual([
      'icon-park-outline:memory',
      'tabler:download',
      'tabler:chevrons-up',
      'tabler:chevrons-down',
      'tabler:activity-heartbeat',
      'tabler:traffic-cone',
    ])
  })

  // 剩余价值 / 月费用 / 年费用按显示币种换算；流量配额由各节点的流量上限与月度流量真实合计。
  // 只有虚拟化分布没有数据来源（CFSM 不提供虚拟化类型），写进模板也会被忽略。
  it('财务三卡与流量配额都可以选用，虚拟化分布不以估算值补位', () => {
    const settings = customGeneral('remainingValue\nmonthlyCost\nyearlyCost\ntrafficQuota\nvirtualizationDistribution\nonlineNodes')
    expect(resolveGeneralCardKeys(settings)).toEqual(['remainingValue', 'monthlyCost', 'yearlyCost', 'trafficQuota', 'onlineNodes'])
  })

  it('模板渲染 unit，并把 hint 交给 tooltip', () => {
    expect(overviewCards).toContain('card.unit')
    expect(overviewCards).toContain('AppTooltip')
    expect(overviewCards).not.toContain('class="overview-card__unit">{{ card.hint }}')
  })
})

describe('General Card 预设顺序对齐 Komari GENERAL_CARD_PRESETS', () => {
  function keysFor(preset: (typeof DEFAULT_THEME_SETTINGS)['generalCardPreset']): string[] {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.generalCardPreset = preset
    return resolveGeneralCardKeys(settings)
  }

  it('保持上游顺序与张数，只删掉 CFSM 没有数据的虚拟化分布', () => {
    expect(keysFor('官方')).toEqual(['currentTime', 'onlineNodes', 'regionDistribution', 'totalTraffic', 'uploadSpeed', 'downloadSpeed'])
    // 「基础」与上游一样是 6 张，第三张是剩余价值（v1.1.7 起可换算）。
    expect(keysFor('基础')).toEqual(['memory', 'disk', 'remainingValue', 'totalTraffic', 'uploadSpeed', 'downloadSpeed'])
    expect(keysFor('运维')).toEqual(['onlineNodes', 'offlineNodes', 'highLoadNodes', 'trafficWarnings', 'avgCpu', 'avgLoad'])
    expect(keysFor('资源')).toEqual(['avgCpu', 'avgLoad', 'memory', 'disk', 'swap', 'cpuCores'])
    expect(keysFor('财务')).toEqual(['remainingValue', 'monthlyCost', 'yearlyCost', 'expiringNodes', 'totalTraffic', 'trafficQuota'])
    expect(keysFor('流量')).toEqual(['totalTraffic', 'trafficQuota', 'uploadSpeed', 'downloadSpeed', 'trafficPeak', 'trafficWarnings'])
    expect(keysFor('GPU')).toEqual(['gpuNodes', 'avgGpu', 'gpuPeakNode', 'avgCpu', 'memory', 'trafficPeak'])
    // 上游「资产」的第 4 张是虚拟化分布，CFSM 没有虚拟化类型，因此是 5 张。
    expect(keysFor('资产')).toEqual(['onlineNodes', 'regionDistribution', 'systemDistribution', 'cpuCores', 'gpuNodes'])
  })

  it('「完整」按上游 ALL_GENERAL_CARD_KEYS 的顺序排列', () => {
    expect(keysFor('完整')).toEqual([
      'currentTime', 'memory', 'disk', 'remainingValue', 'monthlyCost',
      'totalTraffic', 'uploadSpeed', 'downloadSpeed',
      'onlineNodes', 'offlineNodes', 'avgCpu', 'avgGpu', 'avgLoad', 'swap',
      'processes', 'connections', 'cpuCores', 'gpuNodes', 'gpuPeakNode', 'trafficQuota', 'trafficPeak',
      'uploadPeakNode', 'downloadPeakNode', 'highLoadNodes', 'expiringNodes', 'trafficWarnings', 'connectionPeakNode',
      'regionDistribution', 'systemDistribution', 'yearlyCost',
    ])
  })
})

describe('快捷控制预设对齐 Komari HOME_QUICK_CONTROL_PRESETS', () => {
  function keysFor(preset: (typeof DEFAULT_THEME_SETTINGS)['homeQuickControlPreset']): string[] {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.homeQuickControlPreset = preset
    return resolveQuickControlKeys(settings)
  }

  it('默认预设不含上行 / 下行，「完整」是六项而不是八项', () => {
    expect(keysFor('基础')).toEqual(['favorite', 'peak', 'offline'])
    expect(keysFor('流量')).toEqual(['favorite', 'totalTraffic', 'peak'])
    expect(keysFor('运维')).toEqual(['favorite', 'offline', 'highLoad', 'expiring'])
    expect(keysFor('完整')).toEqual(['favorite', 'totalTraffic', 'peak', 'offline', 'highLoad', 'expiring'])
  })

  it('自定义模式仍可选中 upload / download', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    settings.homeQuickControlPreset = '自定义'
    settings.homeQuickControlKeys = 'upload\ndownload\nfavorite\nmonthlyCost'
    expect(resolveQuickControlKeys(settings)).toEqual(['upload', 'download', 'favorite'])
  })

  it('计数在当前分组与搜索范围内统计，排序类控制显示范围内的节点数（上游 getQuickControlCount）', () => {
    const home = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(home).toContain('const quickCountBase = computed(() => filterServers(glassServers.value, query.value, selectedGroup.value))')
    for (const key of ['totalTraffic', 'upload', 'download', 'peak']) expect(home).toContain(`    ${key}: base.length,`)
    expect(home).toContain('favorite: base.filter((server) => preferences.isFavorite(server.key)).length')
  })
})

describe('默认背景使用 Komari 正式资产', () => {
  const asset = new URL('../src/assets/background/default-background-v2.webp', import.meta.url)

  it('资产字节与上游一致，并放在 src/assets 以便进入 dist/assets', () => {
    expect(statSync(asset).size).toBe(32436)
    expect(createHash('sha256').update(readFileSync(asset)).digest('hex'))
      .toBe('42377961822666817def3d3b51b2c236a0f5f631dd1475535d9438a6b7ac551b')
    expect(background).toContain("import defaultBackground from '@/assets/background/default-background-v2.webp'")
  })

  it('样式逐条对齐上游 Background.vue，自创的 orb / grid / grain 层已移除', () => {
    expect(stylesheet).toContain('.dynamic-background__default')
    expect(stylesheet).toContain('background-position: center bottom')
    expect(stylesheet).toContain('filter: saturate(1.12) contrast(1.02)')
    expect(stylesheet).toContain('transform: scale(1.01)')
    expect(stylesheet).toContain('filter: brightness(0.38) saturate(0.82) contrast(1.08)')
    expect(stylesheet).toContain('background-position: 50% 78%')
    expect(stylesheet).toContain('transform: scale(1.02)')
    expect(stylesheet).not.toContain('dynamic-background__orb')
    expect(stylesheet).not.toContain('dynamic-background__grain')
    expect(stylesheet).not.toContain('dynamic-background__wash')
  })

  it('保留自定义图片 / 视频、blur 与 overlay 能力', () => {
    expect(background).toContain('backgroundBlur')
    expect(background).toContain('backgroundOverlay')
    expect(background).toContain('dynamic-background__media')
    expect(background).toContain('<video')
  })
})

describe('浏览器实测得到的卡片表面契约', () => {
  it('总览卡片是 --background 的 50%，无边框、10px 圆角、无阴影', () => {
    expect(stylesheet).toContain('--background: oklch(0.935 0.015 252)')
    expect(stylesheet).toContain('--background: oklch(0.141 0.005 285.823)')
    expect(stylesheet).toContain('background: color-mix(in oklab, var(--background) 50%, transparent)')
    const overview = stylesheet.slice(stylesheet.indexOf('.overview-card {'), stylesheet.indexOf('.overview-card:hover'))
    expect(overview).toContain('border: none')
    expect(overview).toContain('border-radius: var(--radius)')
    expect(overview).toContain('box-shadow: none')
    expect(overview).toContain('backdrop-filter: blur(8px)')
  })

  it('节点卡片沿用上游 glassTheme 默认预设的真实运行值与 14px 圆角', () => {
    expect(stylesheet).toContain('--card-surface: rgb(241 245 249 / 74%)')
    expect(stylesheet).toContain('--card-surface-border: rgb(203 213 225 / 60%)')
    expect(stylesheet).toContain('--card-surface-hover: rgb(248 250 252 / 80%)')
    expect(stylesheet).toContain('--card-surface: rgb(13 17 26 / 85%)')
    expect(stylesheet).toContain('--card-surface-hover: rgb(17 24 39 / 91%)')
    const card = stylesheet.slice(stylesheet.indexOf('.node-card {'), stylesheet.indexOf('.node-card:hover'))
    expect(card).toContain('border-radius: 14px')
    expect(card).toContain('backdrop-filter: blur(14px) saturate(145%)')
    expect(card).toContain('box-shadow: var(--node-card-shadow, var(--card-surface-shadow))')
  })

  it('hover 阴影与常态一致（上游 fallback 永远不生效）', () => {
    expect(stylesheet).toContain('--card-surface-shadow-hover: 0 8px 28px rgb(15 23 42 / 18%)')
    expect(stylesheet).toContain('--card-surface-shadow-hover: 0 8px 30px rgb(0 0 0 / 48%)')
  })
})

describe('v1.1.0-test.2 的成果不回退', () => {
  it('节点卡底部保持三列，文本有独立截断层，剩余天数是短文本', () => {
    expect(stylesheet).toContain('.node-boxes')
    expect(serverCard).toContain('node-box__text')
    expect(serverCard).toContain('node-box__fixed-text')
    expect(serverCard).toContain("prefix: '剩余'")
    expect(serverCard).not.toContain('formatCfsmDate')
  })

  it('Ping / Loss 仍是满高柱与五级 signal 色阶，0% 丢包不会变空', () => {
    expect(serverCard).toContain('EMPTY_PING_BAR_COUNT = 20')
    expect(serverCard).toContain("if (loss <= 1) return 'is-signal-1'")
    expect(serverCard).toContain("return 'is-signal-5 ping-signal-pattern-4'")
    expect(stylesheet).toContain('--signal-1')
    expect(stylesheet).toContain('--signal-5')
  })

  it('卡片与列表主点击直达详情，独立控件 stopPropagation', () => {
    expect(serverCard).toContain("@click=\"emit('open')\"")
    expect(serverCard).toContain('@click.stop="emit(\'toggleFavorite\')"')
    expect(serverList).toContain('@click.stop=')
    expect(serverCard).not.toContain('quick-view')
  })

  it('列表运行时间列保持天+小时，与上游 NodeList 的 hour 精度一致', () => {
    expect(serverList).toContain('formatUptime(server.bootTime)')
    expect(serverList).not.toContain('formatHomeUptimeDays')
  })
})

describe('详情页结构冻结', () => {
  it('详情页继续使用既有格式化器，不被首页显示格式影响', () => {
    expect(detailView).not.toContain('formatHome')
  })
})
