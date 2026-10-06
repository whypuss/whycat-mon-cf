import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EMPTY_RATE_VIEW, type RateView } from '@/domain/finance'
import {
  buildGeneralCards,
  financeNodesOf,
  generalFinanceContext,
  type GeneralFinanceInput,
} from '@/domain/theme-presentation'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

/*
 * 首页总览的剩余价值 / 月费用估算 / 年费用估算，以及三处入口的接线约束。
 * 汇率是人工测试值：1 CNY = 0.125 EUR = 0.1 USD，不代表真实汇率。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const overviewCards = read('../src/components/dashboard/OverviewCards.vue')
const homeView = read('../src/views/HomeView.vue')
const detailView = read('../src/views/ServerDetailView.vue')
// 注释里会解释为什么没有移植按量估算，断言只看实际代码与模板。
const dialog = read('../src/components/finance/FinanceDetailsDialog.vue')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')

const NOW = Date.UTC(2026, 8, 17, 12)
const NETWORK: RateView = { rates: { CNY: 1, EUR: 0.125, USD: 0.1 }, sources: { EUR: 'network', USD: 'network' }, pending: false }

function glass(overrides: Partial<GlassServer>): GlassServer {
  return {
    key: overrides.key ?? 'n', id: 'n', sourceBase: 'https://status.example', sourceLabel: 'status.example',
    name: overrides.name ?? 'Node', group: '', tags: [], providerTags: { asn: null, org: null }, region: null,
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

const servers: GlassServer[] = [
  glass({ key: 'vps', name: '节点 B', price: '10', currency: '€', billingCycle: 'year', expireDate: '2027-09-17' }),
  glass({ key: 'dmit', name: '节点 A', price: '10', currency: '$', billingCycle: 'month', expireDate: '2026-10-02' }),
]

function financeSettings(preset: (typeof DEFAULT_THEME_SETTINGS)['generalCardPreset'] = '财务') {
  const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
  settings.generalCardPreset = preset
  return settings
}

function input(overrides: Partial<GeneralFinanceInput> = {}): GeneralFinanceInput {
  return { priceVisible: true, target: 'CNY', view: NETWORK, excludeFree: true, now: NOW, ...overrides }
}

function financeCards(list: GlassServer[], overrides: Partial<GeneralFinanceInput> = {}) {
  const settings = financeSettings()
  const context = generalFinanceContext(list, settings, input(overrides))
  return Object.fromEntries(buildGeneralCards(list, settings, NOW, context).map((card) => [card.key, card]))
}

describe('总览财务上下文', () => {
  it('没有选用财务卡时不算合计，也就不会去请求汇率', () => {
    const settings = financeSettings('官方')
    expect(generalFinanceContext(servers, settings, input())).toBeUndefined()
  })

  it('站点关闭 show_price 的节点不参与；一台都没有时财务卡整张不出现', () => {
    expect(financeNodesOf([glass({ key: 'a', showPrice: false }), glass({ key: 'b' })]).map((node) => node.key)).toEqual(['b'])
    const hidden = servers.map((server) => ({ ...server, showPrice: false }))
    expect(generalFinanceContext(hidden, financeSettings(), input())).toEqual({ state: 'hidden' })
    const cards = buildGeneralCards(hidden, financeSettings(), NOW, { state: 'hidden' })
    // 三张金额卡整张不出现；即将到期与流量配额和价格无关，照常显示。
    expect(cards.map((card) => card.key)).toEqual(['expiringNodes', 'trafficQuota'])
  })

  it('未登录隐藏价格：显示 ***，不能点开明细，tooltip 也不泄露金额', () => {
    const context = generalFinanceContext(servers, financeSettings(), input({ priceVisible: false }))
    expect(context).toEqual({ state: 'masked' })
    const cards = Object.fromEntries(buildGeneralCards(servers, financeSettings(), NOW, context).map((card) => [card.key, card]))
    expect(cards.remainingValue).toMatchObject({ value: '***', hint: '总价值\n***' })
    expect(cards.remainingValue?.action).toBeUndefined()
    expect(cards.monthlyCost).toMatchObject({ value: '***', hint: '' })
    expect(cards.yearlyCost).toMatchObject({ value: '***', hint: '' })
    expect(JSON.stringify(cards)).not.toMatch(/¥|\$|€/)
  })
})

describe('总览财务卡', () => {
  it('按显示币种合计：上游的 label、icon 与点开明细的动作', () => {
    const cards = financeCards(servers)
    // 月均：10€/年 → 80/365×30 CNY；10$/月 → 100 CNY。年费用 = 月均 ÷ 30 × 365 = 80 + 1216.67。
    expect(cards.monthlyCost).toMatchObject({ label: '月费用估算', icon: 'tabler:calendar-dollar', value: '¥106.58', hint: '' })
    expect(cards.monthlyCost?.unit).toBeUndefined()
    expect(cards.yearlyCost).toMatchObject({ label: '年费用估算', icon: 'tabler:receipt-2', value: '¥1,296.67' })
    expect(cards.remainingValue).toMatchObject({ label: '剩余价值', icon: 'tabler:cash', action: 'financeDetails' })
    // 10€ 封顶 80 CNY；10$ 还剩 15 天 50 CNY；总价值 80 + 100。
    expect(cards.remainingValue?.value).toBe('¥130.00')
    expect(cards.remainingValue?.hint).toBe('总价值\n¥180.00\n汇率：今日网络汇率')
  })

  it('换成美元显示时同一组节点重新换算', () => {
    const cards = financeCards(servers, { target: 'USD' })
    expect(cards.remainingValue?.value).toBe('$13.00')
  })

  it('汇率载入中：显示「-」与「载入中」，不拿参考表凑数', () => {
    const cards = financeCards(servers, { view: { ...EMPTY_RATE_VIEW, pending: true } })
    expect(cards.remainingValue).toMatchObject({ value: '-', unit: '载入中' })
    expect(cards.monthlyCost?.hint).toContain('汇率载入中')
  })

  it('参考、旧缓存、手动汇率在卡片上可辨识，细节进 tooltip，来源按固定顺序列出', () => {
    for (const [source, marker, label] of [
      ['reference', '参考', '内置参考汇率'],
      ['stale-cache', '旧汇率', '历史缓存汇率'],
      ['manual', '手动', '手动汇率'],
    ] as const) {
      const view: RateView = { rates: NETWORK.rates, sources: { EUR: source, USD: 'network' }, pending: false }
      const cards = financeCards(servers, { view })
      expect(cards.monthlyCost?.unit).toBe(marker)
      expect(cards.monthlyCost?.hint).toContain(`汇率：今日网络汇率 · ${label}`)
    }
  })

  it('部分节点无法换算时标「部分」，与汇率标记同时出现，并逐条交代', () => {
    const odd = [...servers, glass({ key: 'kr', price: '10', currency: 'kr', billingCycle: 'month', expireDate: '2026-10-02' })]
    const view: RateView = { rates: NETWORK.rates, sources: { EUR: 'reference', USD: 'network' }, pending: false }
    const cards = financeCards(odd, { view })
    expect(cards.monthlyCost).toMatchObject({ value: '¥106.58', unit: '部分 · 参考' })
    expect(cards.monthlyCost?.hint).toContain('1 台币种有歧义，未计入')
  })

  it('没有到期日的节点不计入剩余价值，只在 tooltip 交代，不标「部分」', () => {
    const cards = financeCards([...servers, glass({ key: 'netcup', price: '10', currency: '€', billingCycle: 'year', expireDate: '' })])
    expect(cards.remainingValue?.value).toBe('¥130.00')
    expect(cards.remainingValue?.unit).toBeUndefined()
    expect(cards.remainingValue?.hint).toContain('1 台未设置到期时间，未计入')
  })

  it('全部节点都算不出来时显示「-」与「不可用」，不写成 0', () => {
    const cards = financeCards([glass({ key: 'kr', price: '10', currency: 'kr', billingCycle: 'month', expireDate: '2026-10-02' })])
    expect(cards.monthlyCost).toMatchObject({ value: '-', unit: '不可用' })
  })

  it('一个付费节点都没有时与上游一样显示 0', () => {
    const cards = financeCards([glass({ key: 'free', price: '-1', currency: '$', billingCycle: 'month' })])
    expect(cards.monthlyCost).toMatchObject({ value: '¥0.00' })
  })
})

describe('入口接线', () => {
  it('剩余价值卡是可键盘操作的按钮，弹窗按需加载，class 透传到栅格', () => {
    expect(overviewCards).toContain(':role="card.action ? \'button\' : undefined"')
    expect(overviewCards).toContain(':tabindex="card.action ? 0 : undefined"')
    expect(overviewCards).toContain('`查看${card.label}明细`')
    expect(overviewCards).toContain("event.key !== 'Enter' && event.key !== ' '")
    expect(overviewCards).toContain("defineAsyncComponent(() => import('@/components/finance/FinanceDetailsDialog.vue'))")
    expect(overviewCards).toContain('defineOptions({ inheritAttrs: false })')
    expect(overviewCards).toContain('v-bind="$attrs"')
  })

  it('首页只在财务卡可见且确有跨币种换算时请求汇率', () => {
    expect(homeView).toContain("generalFinance.value?.state === 'visible' && generalFinance.value.summary.needsRates")
    expect(homeView).toContain('financeNodesOf(glassServers.value)')
  })

  it('详情页只在价格可见、选用了剩余价值卡、且币种不同时请求汇率', () => {
    expect(detailView).toContain('&& showPrice.value')
    expect(detailView).toContain("resolveDetailCardKeys(theme.runtime).includes('remainingValue')")
    expect(detailView).toContain('needsExchangeRate(server.value.currency, finance.preferences.displayCurrency)')
    // 价格隐藏时三张财务卡仍整张过滤掉。
    expect(detailView).toContain("(card.key === 'nodePrice' || card.key === 'monthlyCost' || card.key === 'remainingValue') && !showPrice.value")
  })

  it('明细弹窗没有移植按量估算，不留空壳；恢复按钮按真实状态命名', () => {
    expect(dialog).not.toContain('按量估算')
    expect(dialog).not.toContain('当前节点估算')
    expect(dialog).toContain('固定账单')
    expect(dialog).toContain('汇率设置')
    expect(dialog).toContain('排除免费节点')
    expect(dialog).toContain("finance.hasTodayTable ? '恢复今日汇率' : '清除手动汇率'")
    // 没有手动汇率时点了什么都不会变，按钮就不该看起来可点。
    expect(dialog).toContain(':disabled="!finance.hasOverrides"')
    expect(dialog).toContain("finance.hasOverrides ? undefined : '当前没有手动汇率'")
  })
})
