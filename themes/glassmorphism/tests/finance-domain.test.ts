import { describe, expect, it } from 'vitest'
import {
  BILLING_CYCLE_DAYS,
  buildRateView,
  convertAmount,
  describeSkipped,
  DISPLAY_CURRENCIES,
  EMPTY_RATE_VIEW,
  formatFinanceAmount,
  isCompleteTotal,
  monthlyCost,
  parseBillingCycle,
  parseBillingExpiry,
  parseBillingPrice,
  REFERENCE_RATES,
  remainingValueOf,
  resolveSourceCurrency,
  summarizeFinance,
  type BillableNode,
  type RateView,
} from '@/domain/finance'

/*
 * 财务共享口径的固定样本。
 *
 * 汇率一律用人工测试值，不依赖当天市场数值：
 *   1 CNY = 0.125 EUR = 0.1 USD，因此 10 EUR = 80 CNY = 8 USD。
 * 这只是测试样本，不代表任何真实汇率。
 */
const TEST_VIEW: RateView = { rates: { CNY: 1, EUR: 0.125, USD: 0.1 }, sources: { EUR: 'network', USD: 'network' }, pending: false }
/** 2026-09-17 12:00 UTC，与 docs/finance-parity.md 第 4 节的样本时刻一致。 */
const NOW = Date.UTC(2026, 8, 17, 12)

function node(overrides: Partial<BillableNode> = {}): BillableNode {
  return {
    key: overrides.key ?? 'n',
    name: overrides.name ?? '节点',
    tags: overrides.tags ?? [],
    price: overrides.price ?? null,
    currency: overrides.currency ?? null,
    billingCycle: overrides.billingCycle ?? null,
    expireDate: overrides.expireDate ?? null,
  }
}

describe('来源币种按 CFSM 后台契约识别', () => {
  it('后台选项里的符号：$ 是 USD，¥ 是 CNY，¥JPY 是 JPY，€ 是 EUR，HK$ 是 HKD', () => {
    expect(resolveSourceCurrency('$')).toEqual({ status: 'known', code: 'USD' })
    expect(resolveSourceCurrency('¥')).toEqual({ status: 'known', code: 'CNY' })
    expect(resolveSourceCurrency('￥')).toEqual({ status: 'known', code: 'CNY' })
    expect(resolveSourceCurrency('¥JPY')).toEqual({ status: 'known', code: 'JPY' })
    expect(resolveSourceCurrency('€')).toEqual({ status: 'known', code: 'EUR' })
    expect(resolveSourceCurrency('HK$')).toEqual({ status: 'known', code: 'HKD' })
    expect(resolveSourceCurrency('R$')).toEqual({ status: 'known', code: 'BRL' })
    expect(resolveSourceCurrency('Rp')).toEqual({ status: 'known', code: 'IDR' })
    expect(resolveSourceCurrency('zł')).toEqual({ status: 'known', code: 'PLN' })
    expect(resolveSourceCurrency('د.إ')).toEqual({ status: 'known', code: 'AED' })
  })

  it('ISO 代码与大小写别名同样识别', () => {
    expect(resolveSourceCurrency('USD')).toEqual({ status: 'known', code: 'USD' })
    expect(resolveSourceCurrency('eur')).toEqual({ status: 'known', code: 'EUR' })
    expect(resolveSourceCurrency('RMB')).toEqual({ status: 'known', code: 'CNY' })
    expect(resolveSourceCurrency('LKR')).toEqual({ status: 'known', code: 'LKR' })
  })

  it('空串、缺失、有歧义与未知值都不当人民币', () => {
    expect(resolveSourceCurrency('')).toEqual({ status: 'missing', raw: null })
    expect(resolveSourceCurrency(null)).toEqual({ status: 'missing', raw: null })
    expect(resolveSourceCurrency('kr')).toEqual({ status: 'ambiguous', raw: 'kr' })
    expect(resolveSourceCurrency('元宝')).toEqual({ status: 'unknown', raw: '元宝' })
    expect(resolveSourceCurrency('XYZ')).toEqual({ status: 'unknown', raw: 'XYZ' })
  })

  it('显示币种沿用上游 12 种，且都有内置参考汇率', () => {
    expect(DISPLAY_CURRENCIES).toEqual(['CNY', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'RUB', 'CHF', 'INR', 'VND', 'THB', 'CAD'])
    for (const code of DISPLAY_CURRENCIES) expect(REFERENCE_RATES[code]).toBeGreaterThan(0)
    expect(REFERENCE_RATES.CNY).toBe(1)
  })
})

describe('价格、周期与到期', () => {
  it('价格：空是未设置，-1 与 0 是免费，其它负数和非数字是无效值', () => {
    expect(parseBillingPrice(null)).toEqual({ status: 'unset' })
    expect(parseBillingPrice('')).toEqual({ status: 'unset' })
    expect(parseBillingPrice('-1')).toEqual({ status: 'free' })
    expect(parseBillingPrice('0')).toEqual({ status: 'free' })
    expect(parseBillingPrice('0.00')).toEqual({ status: 'free' })
    expect(parseBillingPrice('42.50')).toEqual({ status: 'paid', amount: 42.5 })
    expect(parseBillingPrice(' 12 ')).toEqual({ status: 'paid', amount: 12 })
    expect(parseBillingPrice('-5')).toEqual({ status: 'invalid' })
    expect(parseBillingPrice('abc')).toEqual({ status: 'invalid' })
    expect(parseBillingPrice('1e3')).toEqual({ status: 'invalid' })
  })

  it('周期：只认 CFSM 的 8 个枚举，未知与空都不猜', () => {
    expect(Object.keys(BILLING_CYCLE_DAYS)).toEqual(['month', 'quarter', 'half_year', 'year', 'two_years', 'three_years', 'four_years', 'five_years'])
    expect(parseBillingCycle('five_years')).toBe('five_years')
    expect(parseBillingCycle('YEAR')).toBe('year')
    expect(parseBillingCycle('每两周')).toBeNull()
    expect(parseBillingCycle('')).toBeNull()
    expect(parseBillingCycle('5')).toBeNull()
  })

  it('到期：缺失与无效分开，不混成已过期', () => {
    expect(parseBillingExpiry('')).toEqual({ status: 'missing' })
    expect(parseBillingExpiry(null)).toEqual({ status: 'missing' })
    expect(parseBillingExpiry('2026-02-30')).toEqual({ status: 'invalid' })
    expect(parseBillingExpiry('2030-09-17')).toEqual({ status: 'date', at: Date.UTC(2030, 8, 17, 12) })
  })
})

describe('原币月均与剩余价值（固定样本）', () => {
  const sampleFiveYear = { price: '30.00', billingCycle: 'five_years', expireDate: '2030-09-17' }

  it('虚构样本 €30.00 / 五年：月均 0.4932，剩余价值 24.0164', () => {
    const monthly = monthlyCost(sampleFiveYear)
    const remaining = remainingValueOf(sampleFiveYear, NOW)
    expect(monthly.status === 'ok' && monthly.amount).toBeCloseTo(0.49315, 4)
    expect(remaining.status === 'ok' && remaining.amount).toBeCloseTo(24.0164, 4)
  })

  it('月 / 季 / 年 / 五年都按天数折算成 30 天口径', () => {
    // 虚构金额仍保留浮点边界：内部保持精度，只在展示时舍入。
    const month = monthlyCost({ price: '1.93', billingCycle: 'month', expireDate: null })
    expect(month.status === 'ok' && month.amount).toBeCloseTo(1.93, 10)
    expect(monthlyCost({ price: '90', billingCycle: 'quarter', expireDate: null })).toEqual({ status: 'ok', amount: 30 })
    const yearly = monthlyCost({ price: '24.00', billingCycle: 'year', expireDate: null })
    expect(yearly.status === 'ok' && yearly.amount).toBeCloseTo(1.97260, 4)
    const five = monthlyCost({ price: '1825', billingCycle: 'five_years', expireDate: null })
    expect(five).toEqual({ status: 'ok', amount: 30 })
  })

  it('免费、未设置、无效价格与未知周期各自有明确状态', () => {
    expect(monthlyCost({ price: '-1', billingCycle: 'year', expireDate: null })).toEqual({ status: 'free' })
    expect(monthlyCost({ price: '', billingCycle: 'year', expireDate: null })).toEqual({ status: 'unavailable', reason: 'price-unset' })
    expect(monthlyCost({ price: 'abc', billingCycle: 'year', expireDate: null })).toEqual({ status: 'unavailable', reason: 'price-invalid' })
    expect(monthlyCost({ price: '10', billingCycle: 'weekly', expireDate: null })).toEqual({ status: 'unavailable', reason: 'cycle-unknown' })
  })

  it('剩余价值：缺失到期不是 0，过期才是 0，超长期按全价，封顶为原价', () => {
    expect(remainingValueOf({ price: '18.00', billingCycle: 'year', expireDate: '' }, NOW)).toEqual({ status: 'unavailable', reason: 'expiry-missing' })
    expect(remainingValueOf({ price: '18.00', billingCycle: 'year', expireDate: 'soon' }, NOW)).toEqual({ status: 'unavailable', reason: 'expiry-invalid' })
    expect(remainingValueOf({ price: '10', billingCycle: 'year', expireDate: '2026-01-01' }, NOW)).toEqual({ status: 'ok', amount: 0 })
    // 过期判断先于周期：已过期的节点即使周期未知也是 0。
    expect(remainingValueOf({ price: '10', billingCycle: 'weekly', expireDate: '2026-01-01' }, NOW)).toEqual({ status: 'ok', amount: 0 })
    expect(remainingValueOf({ price: '10', billingCycle: 'month', expireDate: '2199-01-01' }, NOW)).toEqual({ status: 'ok', amount: 10 })
    // 提前续了多个周期也不超过原价（CFSM 与本主题同一口径，上游不封顶）。
    expect(remainingValueOf({ price: '10', billingCycle: 'month', expireDate: '2027-09-17' }, NOW)).toEqual({ status: 'ok', amount: 10 })
    expect(remainingValueOf({ price: '10', billingCycle: 'weekly', expireDate: '2027-01-01' }, NOW)).toEqual({ status: 'unavailable', reason: 'cycle-unknown' })
    expect(remainingValueOf({ price: '0', billingCycle: 'year', expireDate: '2027-01-01' }, NOW)).toEqual({ status: 'free' })
  })
})

describe('换算', () => {
  const eur = resolveSourceCurrency('€')
  const usd = resolveSourceCurrency('$')
  const cny = resolveSourceCurrency('¥')

  it('10 EUR = 80 CNY = 8 USD（人工测试汇率）', () => {
    expect(convertAmount(10, eur, 'CNY', TEST_VIEW)).toEqual({ status: 'ok', amount: 80, sources: ['network'] })
    const toUsd = convertAmount(10, eur, 'USD', TEST_VIEW)
    expect(toUsd.status === 'ok' && toUsd.amount).toBeCloseTo(8, 10)
  })

  it('同币种不需要汇率，往返换算回到原值', () => {
    expect(convertAmount(10, cny, 'CNY', EMPTY_RATE_VIEW)).toEqual({ status: 'ok', amount: 10, sources: [] })
    expect(convertAmount(10, eur, 'EUR', EMPTY_RATE_VIEW)).toEqual({ status: 'ok', amount: 10, sources: [] })
    const there = convertAmount(10, eur, 'USD', TEST_VIEW)
    const back = there.status === 'ok' ? convertAmount(there.amount, usd, 'EUR', TEST_VIEW) : there
    expect(back.status === 'ok' && back.amount).toBeCloseTo(10, 10)
  })

  it('缺汇率、零、负数、NaN、Infinity 都不参与除法', () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const view: RateView = { rates: { CNY: 1, EUR: bad, USD: 0.1 }, sources: {}, pending: false }
      expect(convertAmount(10, eur, 'USD', view)).toEqual({ status: 'unconvertible', reason: 'rate-missing' })
    }
    expect(convertAmount(10, eur, 'CNY', EMPTY_RATE_VIEW)).toEqual({ status: 'unconvertible', reason: 'rate-missing' })
    expect(convertAmount(10, eur, 'CNY', { ...EMPTY_RATE_VIEW, pending: true })).toEqual({ status: 'pending' })
  })

  it('未知或有歧义的币种不能换算，不按汇率 1 兜底', () => {
    expect(convertAmount(10, resolveSourceCurrency(''), 'CNY', TEST_VIEW)).toEqual({ status: 'unconvertible', reason: 'currency-missing' })
    expect(convertAmount(10, resolveSourceCurrency('kr'), 'CNY', TEST_VIEW)).toEqual({ status: 'unconvertible', reason: 'currency-ambiguous' })
    expect(convertAmount(10, resolveSourceCurrency('元宝'), 'CNY', TEST_VIEW)).toEqual({ status: 'unconvertible', reason: 'currency-unknown' })
  })

  it('金额按上游格式显示：两位小数，十万以上紧凑写法', () => {
    expect(formatFinanceAmount(80, 'CNY')).toBe('¥80.00')
    expect(formatFinanceAmount(8, 'USD')).toBe('$8.00')
    expect(formatFinanceAmount(1234.5, 'HKD')).toBe('HK$1,234.50')
    expect(formatFinanceAmount(123456, 'CNY')).toBe('¥12.35万')
  })
})

describe('合成汇率：手动 → 网络 / 缓存 → 参考', () => {
  it('手动覆盖优先，网络值其次，缺的币种用参考表并标明', () => {
    const view = buildRateView({
      snapshot: { origin: 'network', rates: { USD: 0.2, EUR: 0.13 } },
      overrides: { EUR: 0.5 },
      pending: false,
    })
    expect(view.rates.CNY).toBe(1)
    expect(view.rates.USD).toBe(0.2)
    expect(view.sources.USD).toBe('network')
    expect(view.rates.EUR).toBe(0.5)
    expect(view.sources.EUR).toBe('manual')
    expect(view.rates.RUB).toBe(REFERENCE_RATES.RUB)
    expect(view.sources.RUB).toBe('reference')
  })

  it('载入中且没有快照时，不拿参考表冒充结果', () => {
    const view = buildRateView({ snapshot: null, overrides: {}, pending: true })
    expect(view.rates.USD).toBeUndefined()
    expect(view.pending).toBe(true)
  })

  it('非有限正数的覆盖值被忽略', () => {
    const view = buildRateView({ snapshot: null, overrides: { USD: -1, EUR: Number.NaN }, pending: false })
    expect(view.sources.USD).toBe('reference')
    expect(view.sources.EUR).toBe('reference')
  })
})

describe('汇总与明细', () => {
  const nodes: BillableNode[] = [
    node({ key: 'vps', name: '节点 B', price: '10', currency: '€', billingCycle: 'year', expireDate: '2027-09-17' }),
    node({ key: 'dmit', name: '节点 A', price: '10', currency: '$', billingCycle: 'month', expireDate: '2026-10-02' }),
    node({ key: 'netcup', name: '节点 D', price: '10', currency: '€', billingCycle: 'year', expireDate: '' }),
    node({ key: 'odd', name: '怪币', price: '10', currency: '元宝', billingCycle: 'month', expireDate: '2026-10-02' }),
    node({ key: 'free', name: '免费', price: '-1', currency: '$', billingCycle: 'month', expireDate: '2026-10-02' }),
    node({ key: 'tag', name: '白嫖', price: '10', currency: '¥', billingCycle: 'month', expireDate: '2026-10-02', tags: ['白嫖中'] }),
    node({ key: 'unset', name: '未设置', price: '', currency: '¥', billingCycle: 'month' }),
  ]
  const options = { target: 'CNY' as const, view: TEST_VIEW, excludeFree: true, now: NOW }

  it('排除免费节点时，免费价格与白嫖中标签整行不出现', () => {
    const summary = summarizeFinance(nodes, options)
    expect(summary.rows.map((row) => row.node.key)).toEqual(['vps', 'dmit', 'netcup', 'odd', 'unset'])
    const all = summarizeFinance(nodes, { ...options, excludeFree: false })
    expect(all.rows.map((row) => row.node.key)).toContain('free')
    expect(all.rows.find((row) => row.node.key === 'free')?.remaining).toEqual({ status: 'free' })
    // 不排除时，填了价格的白嫖中节点按真实价格计入。
    expect(all.monthly.counted).toBe(summary.monthly.counted + 1)
  })

  it('跨币种直接按数值合计，不可换算的节点不按 0 计入并记下原因', () => {
    const summary = summarizeFinance(nodes, options)
    // 月均：节点 B 10€/年 → 80/365*30 CNY；节点 A 10$/月 → 100 CNY；节点 D 同 节点 B；怪币跳过。
    expect(summary.monthly.amount).toBeCloseTo(80 / 365 * 30 * 2 + 100, 10)
    expect(summary.monthly.counted).toBe(3)
    expect(summary.monthly.skipped).toEqual({ 'currency-unknown': 1 })
    expect(isCompleteTotal(summary.monthly)).toBe(false)
    // 年费用 = 月均 ÷ 30 × 365。
    expect(summary.yearly.amount).toBeCloseTo(summary.monthly.amount / 30 * 365, 10)
    // 总价值：10€ ×2 + 10$。
    expect(summary.totalValue.amount).toBeCloseTo(80 * 2 + 100, 10)
  })

  it('缺到期时间的节点不计入剩余价值，也不算已过期', () => {
    const summary = summarizeFinance(nodes, options)
    expect(summary.remaining.skipped).toEqual({ 'expiry-missing': 1, 'currency-unknown': 1 })
    expect(summary.rows.find((row) => row.node.key === 'netcup')?.remaining).toEqual({ status: 'none', reason: 'expiry-missing' })
    expect(describeSkipped(summary.remaining)).toEqual(['1 台未设置到期时间，未计入', '1 台币种无法识别，未计入'])
    // 节点 B 封顶为原价 10€ = 80 CNY；节点 A 还剩 15 天 = 5$ = 50 CNY。
    expect(summary.remaining.amount).toBeCloseTo(80 + 50, 6)
  })

  it('价格无法识别的节点不算免费、不按 0 计入，并在说明里交代；未填写价格不逐条提示', () => {
    const bad = node({ key: 'bad', name: '坏价格', price: '10元', currency: '¥', billingCycle: 'month', expireDate: '2026-10-02' })
    const summary = summarizeFinance([...nodes, bad], options)
    expect(summary.rows.find((row) => row.node.key === 'bad')?.monthly).toEqual({ status: 'none', reason: 'price-invalid' })
    expect(summary.monthly.skipped).toEqual({ 'price-invalid': 1, 'currency-unknown': 1 })
    expect(summary.remaining.skipped).toEqual({ 'price-invalid': 1, 'expiry-missing': 1, 'currency-unknown': 1 })
    expect(summary.totalValue.skipped).toEqual({ 'price-invalid': 1, 'currency-unknown': 1 })
    expect(describeSkipped(summary.monthly)).toEqual(['1 台价格无法识别，未计入', '1 台币种无法识别，未计入'])
    expect(summary.monthly.skipped['price-unset']).toBeUndefined()
    expect(summary.rows.find((row) => row.node.key === 'unset')?.monthly).toEqual({ status: 'none', reason: 'price-unset' })
  })

  it('来源按固定顺序列出，与节点排列无关', () => {
    const view: RateView = { rates: TEST_VIEW.rates, sources: { EUR: 'reference', USD: 'network' }, pending: false }
    const forward = summarizeFinance(nodes, { ...options, view })
    const backward = summarizeFinance([...nodes].reverse(), { ...options, view })
    expect(forward.sources).toEqual(['network', 'reference'])
    expect(backward.sources).toEqual(['network', 'reference'])
  })

  it('记录参与换算的来源，并判断是否需要汇率', () => {
    const summary = summarizeFinance(nodes, options)
    expect(summary.sources).toEqual(['network'])
    expect(summary.needsRates).toBe(true)
    const local = summarizeFinance([node({ price: '10', currency: '¥', billingCycle: 'month' })], options)
    expect(local.needsRates).toBe(false)
    expect(local.sources).toEqual([])
  })

  it('汇率载入中时合计标为未完成，不给出假金额', () => {
    const pending = summarizeFinance(nodes, { ...options, view: { ...EMPTY_RATE_VIEW, pending: true } })
    expect(pending.monthly.pending).toBe(true)
    expect(pending.rows.find((row) => row.node.key === 'vps')?.monthly).toEqual({ status: 'pending' })
  })

  it('不修改传入的节点对象', () => {
    const snapshot = structuredClone(nodes)
    summarizeFinance(nodes, options)
    expect(nodes).toEqual(snapshot)
  })
})
