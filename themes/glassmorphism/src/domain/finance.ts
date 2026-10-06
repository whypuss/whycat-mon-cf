import { parseCfsmDate } from '@/utils/format'

/*
 * 财务的共享口径：价格、币种、计费周期、到期、剩余价值、月均与换算。
 *
 * 首页总览、详情与明细弹窗都从这里取数，不各自复制一套金额算法。语义以
 * CFSM 2.8.5 Stable（`1dc0dc4`）为准，逐项依据见 `docs/finance-parity.md`。
 * 与 CFSM / Komari 的有意差异只有几处，全部是为了不把「不知道」算成一个数：
 *
 * - 无法识别的币种（空串、`kr` 这类有歧义的符号、未知文本）不当人民币，标为不可换算；
 * - 没有到期日或到期日无效时，剩余价值是「不可用」，不是「已过期、剩余 0」；
 * - 未知计费周期不按月猜；
 * - 汇率缺失或不是有限正数时不换算，不用 `|| 1` 兜底。
 */

/** CFSM 2.8.5 `FINANCE_CURRENCY_CONFIG` 收录的 43 种币种（ISO 4217）。 */
export const FINANCE_CURRENCY_CODES = [
  'AED', 'AUD', 'BDT', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'GTQ',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'KZT', 'LKR', 'MXN', 'MYR', 'MNT',
  'NGN', 'NOK', 'NZD', 'PHP', 'PKR', 'PLN', 'RON', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY',
  'UAH', 'USD', 'VND', 'ZAR',
] as const
export type CurrencyCode = (typeof FINANCE_CURRENCY_CODES)[number]

const CURRENCY_CODE_SET: ReadonlySet<string> = new Set(FINANCE_CURRENCY_CODES)

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODE_SET.has(value)
}

/** 显示币种：沿用 Komari `SUPPORTED_CURRENCIES` 的 12 种与顺序。 */
export const DISPLAY_CURRENCIES = [
  'CNY', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'RUB', 'CHF', 'INR', 'VND', 'THB', 'CAD',
] as const satisfies readonly CurrencyCode[]
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]

const DISPLAY_CURRENCY_SET: ReadonlySet<string> = new Set(DISPLAY_CURRENCIES)

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return DISPLAY_CURRENCY_SET.has(value)
}

/** Komari `CURRENCY_SYMBOLS`，换算后的金额按这张表显示。 */
export const DISPLAY_CURRENCY_SYMBOLS: Readonly<Record<DisplayCurrency, string>> = {
  CNY: '¥',
  USD: '$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  RUB: '₽',
  CHF: '₣',
  INR: '₹',
  VND: '₫',
  THB: '฿',
  CAD: 'CA$',
}

/**
 * 内置参考汇率（1 CNY 对应的数值），逐字取自 CFSM 2.8.5 Stable（`1dc0dc4`）
 * `src/frontend/utils/finance.js` 的 `FINANCE_CURRENCY_CONFIG`。
 * 只在没有网络也没有缓存、或网络源缺某个币种时使用，并始终标为参考来源。
 */
export const REFERENCE_RATES: Readonly<Record<CurrencyCode, number>> = {
  AED: 0.5435,
  AUD: 0.20941,
  BDT: 18.02,
  BRL: 0.74734,
  CAD: 0.20691,
  CHF: 0.11746,
  CNY: 1,
  CZK: 3.0787,
  DKK: 0.95296,
  EGP: 7.15,
  EUR: 0.1275,
  GBP: 0.11027,
  GTQ: 1.14,
  HKD: 1.1594,
  HUF: 44.688,
  IDR: 2622.37,
  ILS: 0.43085,
  INR: 14.0178,
  ISK: 18.4626,
  JPY: 23.707,
  KRW: 224.11,
  KZT: 64,
  LKR: 44.4,
  MXN: 2.5472,
  MYR: 0.59945,
  MNT: 530,
  NGN: 225.6,
  NOK: 1.4096,
  NZD: 0.2535,
  PHP: 8.9288,
  PKR: 41.5,
  PLN: 0.54138,
  RON: 0.66769,
  RUB: 11.9,
  SAR: 0.555,
  SEK: 1.3895,
  SGD: 0.18975,
  THB: 4.8172,
  TRY: 6.849,
  UAH: 3.6,
  USD: 0.14799,
  VND: 3500,
  ZAR: 2.3995,
}

export const REFERENCE_RATES_ORIGIN = 'CF-Server-Monitor 2.8.5 Stable（1dc0dc4）finance.js'

/*
 * 来源币种：CFSM 后台的 36 个币种选项（`server.js` 的 `CURRENCY_OPTIONS`），
 * 加上 `finance.js` 的 `CURRENCY_ALIASES` 里的别名。ISO 代码另外按代码识别。
 * `kr` 在后台选项里写的是「克朗（SEK/NOK/DKK）」，本身有歧义，这里不替运营者选。
 */
const SOURCE_SYMBOLS: Readonly<Record<string, CurrencyCode>> = {
  '$': 'USD',
  'US$': 'USD',
  '¥': 'CNY',
  '￥': 'CNY',
  'CN¥': 'CNY',
  'RMB': 'CNY',
  '¥JPY': 'JPY',
  'JP¥': 'JPY',
  '€': 'EUR',
  '£': 'GBP',
  'HK$': 'HKD',
  'A$': 'AUD',
  'C$': 'CAD',
  'S$': 'SGD',
  'NZ$': 'NZD',
  '₣': 'CHF',
  '₩': 'KRW',
  '₹': 'INR',
  '฿': 'THB',
  '₫': 'VND',
  '₱': 'PHP',
  'RP': 'IDR',
  'RM': 'MYR',
  '₺': 'TRY',
  '₪': 'ILS',
  '৳': 'BDT',
  '₨': 'PKR',
  '₮': 'MNT',
  '₽': 'RUB',
  'R$': 'BRL',
  'ZŁ': 'PLN',
  '₴': 'UAH',
  '₸': 'KZT',
  'R': 'ZAR',
  '₦': 'NGN',
  'د.إ': 'AED',
  '﷼': 'SAR',
  'Q': 'GTQ',
}

const AMBIGUOUS_SYMBOLS: ReadonlySet<string> = new Set(['KR'])

export type SourceCurrency =
  | { readonly status: 'known', readonly code: CurrencyCode }
  | { readonly status: 'missing' | 'ambiguous' | 'unknown', readonly raw: string | null }

/** 把节点的 `currency` 解析成币种代码；解析不了就明确说是哪一种情况。 */
export function resolveSourceCurrency(raw: string | null): SourceCurrency {
  const value = raw?.trim() ?? ''
  if (!value) return { status: 'missing', raw: null }
  const upper = value.toUpperCase()
  if (AMBIGUOUS_SYMBOLS.has(upper)) return { status: 'ambiguous', raw: value }
  const code = SOURCE_SYMBOLS[value] ?? SOURCE_SYMBOLS[upper] ?? (isCurrencyCode(upper) ? upper : undefined)
  return code ? { status: 'known', code } : { status: 'unknown', raw: value }
}

export type BillingPrice =
  | { readonly status: 'unset' }
  | { readonly status: 'invalid' }
  | { readonly status: 'free' }
  | { readonly status: 'paid', readonly amount: number }

/*
 * CFSM 保存时已把价格规范成 `""` / `"-1"` / 两位小数（`normalizePrice`），
 * 因此这里只接受数字写法。`-1` 与 `0` 是官方的免费值；其它负数、非数字都是无效值，
 * 既不算免费，也不计入任何合计。
 */
const PRICE_PATTERN = /^-?\d+(?:\.\d+)?$/

export function parseBillingPrice(raw: string | null): BillingPrice {
  const value = raw?.trim() ?? ''
  if (!value) return { status: 'unset' }
  if (!PRICE_PATTERN.test(value)) return { status: 'invalid' }
  const amount = Number(value)
  if (!Number.isFinite(amount)) return { status: 'invalid' }
  if (amount === 0 || amount === -1) return { status: 'free' }
  if (amount < 0) return { status: 'invalid' }
  return { status: 'paid', amount }
}

export type BillingCycle =
  | 'month' | 'quarter' | 'half_year' | 'year'
  | 'two_years' | 'three_years' | 'four_years' | 'five_years'

/** CFSM `BILLING_CYCLE_DAYS`，与本主题此前已验收的天数表相同。 */
export const BILLING_CYCLE_DAYS: Readonly<Record<BillingCycle, number>> = {
  month: 30,
  quarter: 90,
  half_year: 180,
  year: 365,
  two_years: 730,
  three_years: 1095,
  four_years: 1460,
  five_years: 1825,
}

function isBillingCycle(value: string): value is BillingCycle {
  return Object.prototype.hasOwnProperty.call(BILLING_CYCLE_DAYS, value)
}

/**
 * 只认 CFSM 的 8 个枚举。CFSM 前端会把未知值当作「月」，但后端保存时总会写入
 * 枚举之一，未知值只可能来自手工改库；这里不猜，交给调用方显示「不适用」。
 */
export function parseBillingCycle(raw: string | null): BillingCycle | null {
  const value = raw?.trim().toLowerCase() ?? ''
  return isBillingCycle(value) ? value : null
}

export type BillingExpiry =
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | { readonly status: 'date', readonly at: number }

export function parseBillingExpiry(raw: string | null): BillingExpiry {
  if (!raw?.trim()) return { status: 'missing' }
  const date = parseCfsmDate(raw)
  return date ? { status: 'date', at: date.getTime() } : { status: 'invalid' }
}

export type UnavailableReason =
  | 'price-unset' | 'price-invalid'
  | 'cycle-unknown'
  | 'expiry-missing' | 'expiry-invalid'

export type OriginalAmount =
  | { readonly status: 'free' }
  | { readonly status: 'ok', readonly amount: number }
  | { readonly status: 'unavailable', readonly reason: UnavailableReason }

const DAY_MS = 86_400_000
const LONG_TERM_YEARS = 100
const MONTH_DAYS = 30

export interface BillingInput {
  price: string | null
  billingCycle: string | null
  expireDate: string | null
}

function priceUnavailable(price: BillingPrice): OriginalAmount | null {
  if (price.status === 'free') return { status: 'free' }
  if (price.status === 'unset') return { status: 'unavailable', reason: 'price-unset' }
  if (price.status === 'invalid') return { status: 'unavailable', reason: 'price-invalid' }
  return null
}

/**
 * 月均支出（原币）：价格 ÷ 周期天数 × 30。Komari、CFSM 与本主题此前的详情卡同一口径。
 */
export function monthlyCost(input: BillingInput): OriginalAmount {
  const price = parseBillingPrice(input.price)
  const early = priceUnavailable(price)
  if (early) return early
  if (price.status !== 'paid') return { status: 'unavailable', reason: 'price-invalid' }
  const cycle = parseBillingCycle(input.billingCycle)
  if (!cycle) return { status: 'unavailable', reason: 'cycle-unknown' }
  return { status: 'ok', amount: price.amount / BILLING_CYCLE_DAYS[cycle] * MONTH_DAYS }
}

/**
 * 剩余价值（原币）：`min(价格, 价格 × 剩余时长 ÷ 周期时长)`。
 * 已过期为 0；到期超过 100 年按全价；与 CFSM `calculateRemainingValueCNY` 同一口径，
 * 到期日沿用本主题的 UTC 正午解析（`parseCfsmDate`）。
 */
export function remainingValueOf(input: BillingInput, now: number): OriginalAmount {
  const price = parseBillingPrice(input.price)
  const early = priceUnavailable(price)
  if (early) return early
  if (price.status !== 'paid') return { status: 'unavailable', reason: 'price-invalid' }

  const expiry = parseBillingExpiry(input.expireDate)
  if (expiry.status === 'missing') return { status: 'unavailable', reason: 'expiry-missing' }
  if (expiry.status === 'invalid') return { status: 'unavailable', reason: 'expiry-invalid' }
  const difference = expiry.at - now
  if (difference <= 0) return { status: 'ok', amount: 0 }
  if (difference / (DAY_MS * 365) > LONG_TERM_YEARS) return { status: 'ok', amount: price.amount }

  const cycle = parseBillingCycle(input.billingCycle)
  if (!cycle) return { status: 'unavailable', reason: 'cycle-unknown' }
  return {
    status: 'ok',
    amount: Math.min(price.amount, price.amount * difference / (BILLING_CYCLE_DAYS[cycle] * DAY_MS)),
  }
}

/* ===== 汇率与换算 ===== */

export type RateSource = 'network' | 'cache' | 'stale-cache' | 'reference' | 'manual'

/** Komari `FinanceDetailsDialog` 的来源文案；手动与参考是本主题补充的两种。 */
export const RATE_SOURCE_LABELS: Readonly<Record<RateSource, string>> = {
  'network': '今日网络汇率',
  'cache': '今日缓存汇率',
  'stale-cache': '历史缓存汇率',
  'reference': '内置参考汇率',
  'manual': '手动汇率',
}

/** 来源说明按固定顺序列出，不随节点排列变化。 */
const RATE_SOURCE_ORDER: readonly RateSource[] = ['network', 'cache', 'stale-cache', 'reference', 'manual']

function orderedSources(sources: ReadonlySet<RateSource>): RateSource[] {
  return RATE_SOURCE_ORDER.filter((source) => sources.has(source))
}

/** 页面实际使用的一份汇率：数值、每个币种的来源，以及是否仍在载入。 */
export interface RateView {
  readonly rates: Readonly<Partial<Record<CurrencyCode, number>>>
  readonly sources: Readonly<Partial<Record<CurrencyCode, RateSource>>>
  readonly pending: boolean
}

export const EMPTY_RATE_VIEW: RateView = Object.freeze({ rates: {}, sources: {}, pending: false })

export function isPositiveRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export interface RateViewInput {
  /** 网络或缓存取得的整份汇率；`origin` 说明它从哪来。 */
  snapshot: { origin: 'network' | 'cache' | 'stale-cache', rates: Readonly<Partial<Record<CurrencyCode, number>>> } | null
  overrides: Readonly<Partial<Record<CurrencyCode, number>>>
  /** 仍在等待网络结果：此时不拿参考表冒充结果。 */
  pending: boolean
}

/**
 * 合成页面使用的汇率。优先级：手动覆盖 → 网络 / 缓存 → 内置参考。
 * 仍在载入且没有可用快照时，只有手动覆盖会生效，其余币种保持缺失。
 */
export function buildRateView(input: RateViewInput): RateView {
  const rates: Partial<Record<CurrencyCode, number>> = { CNY: 1 }
  const sources: Partial<Record<CurrencyCode, RateSource>> = {}
  for (const code of FINANCE_CURRENCY_CODES) {
    if (code === 'CNY') continue
    const manual = input.overrides[code]
    if (isPositiveRate(manual)) {
      rates[code] = manual
      sources[code] = 'manual'
      continue
    }
    const fetched = input.snapshot?.rates[code]
    if (input.snapshot && isPositiveRate(fetched)) {
      rates[code] = fetched
      sources[code] = input.snapshot.origin
      continue
    }
    if (input.pending) continue
    rates[code] = REFERENCE_RATES[code]
    sources[code] = 'reference'
  }
  return { rates, sources, pending: input.pending }
}

export type Conversion =
  | { readonly status: 'ok', readonly amount: number, readonly sources: readonly RateSource[] }
  | { readonly status: 'pending' }
  | { readonly status: 'unconvertible', readonly reason: 'currency-missing' | 'currency-ambiguous' | 'currency-unknown' | 'rate-missing' }

/**
 * `目标金额 = 原金额 ÷ 源币种汇率 × 目标币种汇率`（1 CNY 对应的数值）。
 * 源与目标相同时不需要汇率；任一汇率缺失或不是有限正数时不换算。
 */
export function convertAmount(
  amount: number,
  source: SourceCurrency,
  target: CurrencyCode,
  view: RateView,
): Conversion {
  if (source.status !== 'known') {
    const reason = source.status === 'missing'
      ? 'currency-missing'
      : source.status === 'ambiguous' ? 'currency-ambiguous' : 'currency-unknown'
    return { status: 'unconvertible', reason }
  }
  if (source.code === target) return { status: 'ok', amount, sources: [] }
  const fromRate = source.code === 'CNY' ? 1 : view.rates[source.code]
  const toRate = target === 'CNY' ? 1 : view.rates[target]
  if (!isPositiveRate(fromRate) || !isPositiveRate(toRate)) {
    return view.pending ? { status: 'pending' } : { status: 'unconvertible', reason: 'rate-missing' }
  }
  const used = new Set<RateSource>()
  for (const code of [source.code, target]) {
    const origin = code === 'CNY' ? undefined : view.sources[code]
    if (origin) used.add(origin)
  }
  return { status: 'ok', amount: amount / fromRate * toRate, sources: orderedSources(used) }
}

/** 换算需要网络汇率吗：源币种可识别、且与目标币种不同。 */
export function needsExchangeRate(currency: string | null, target: CurrencyCode): boolean {
  const source = resolveSourceCurrency(currency)
  return source.status === 'known' && source.code !== target
}

/** Komari `formatFinanceAmount`：两位小数，十万以上用紧凑写法，前缀显示币种符号。 */
export function formatFinanceAmount(amount: number, currency: DisplayCurrency): string {
  const magnitude = Math.abs(amount)
  const value = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: magnitude < 100000 ? 2 : 0,
    notation: magnitude >= 100000 ? 'compact' : 'standard',
  }).format(amount)
  return `${DISPLAY_CURRENCY_SYMBOLS[currency]}${value}`
}

/* ===== 汇总与明细 ===== */

export const FREE_NODE_TAG = '白嫖中'

export interface BillableNode extends BillingInput {
  key: string
  name: string
  tags: readonly string[]
  currency: string | null
}

/** 付费节点没能算出金额的原因：先列价格与账期，再列币种与汇率。 */
export const SKIP_REASONS = [
  'price-unset', 'price-invalid', 'cycle-unknown', 'expiry-missing', 'expiry-invalid',
  'currency-missing', 'currency-ambiguous', 'currency-unknown', 'rate-missing',
] as const satisfies ReadonlyArray<UnavailableReason | Extract<Conversion, { status: 'unconvertible' }>['reason']>
export type SkipReason = (typeof SKIP_REASONS)[number]

export type RowAmount =
  | { readonly status: 'free' }
  | { readonly status: 'ok', readonly amount: number, readonly sources: readonly RateSource[] }
  | { readonly status: 'pending' }
  | { readonly status: 'none', readonly reason: SkipReason }

export interface FinanceRow {
  node: BillableNode
  free: boolean
  price: BillingPrice
  currency: SourceCurrency
  expiry: BillingExpiry
  remaining: RowAmount
  monthly: RowAmount
}

export interface FinanceTotal {
  /** 已计入部分的合计（显示币种），始终是数值求和，不经过格式化字符串。 */
  amount: number
  /** 计入合计的付费节点数。 */
  counted: number
  /** 付费但没能计入的节点数，按原因分开。 */
  skipped: Readonly<Partial<Record<SkipReason, number>>>
  /** 还有节点在等待汇率。 */
  pending: boolean
}

export interface FinanceSummary {
  rows: FinanceRow[]
  remaining: FinanceTotal
  monthly: FinanceTotal
  yearly: FinanceTotal
  totalValue: FinanceTotal
  /** 实际参与换算的汇率来源。 */
  sources: readonly RateSource[]
  /** 是否存在跨币种换算（决定要不要请求汇率）。 */
  needsRates: boolean
}

export interface FinanceSummaryOptions {
  target: DisplayCurrency
  view: RateView
  excludeFree: boolean
  now: number
}

function toRowAmount(original: OriginalAmount, source: SourceCurrency, options: FinanceSummaryOptions): RowAmount {
  if (original.status === 'free') return { status: 'free' }
  if (original.status === 'unavailable') return { status: 'none', reason: original.reason }
  const converted = convertAmount(original.amount, source, options.target, options.view)
  if (converted.status === 'ok') return { status: 'ok', amount: converted.amount, sources: converted.sources }
  if (converted.status === 'pending') return { status: 'pending' }
  return { status: 'none', reason: converted.reason }
}

interface MutableTotal {
  amount: number
  counted: number
  skipped: Partial<Record<SkipReason, number>>
  pending: boolean
}

function emptyTotal(): MutableTotal {
  return { amount: 0, counted: 0, skipped: {}, pending: false }
}

function priceAmount(price: BillingPrice): OriginalAmount {
  if (price.status === 'paid') return { status: 'ok', amount: price.amount }
  return priceUnavailable(price) ?? { status: 'unavailable', reason: 'price-invalid' }
}

function addToTotal(
  total: MutableTotal,
  value: RowAmount,
  tallied: boolean,
  factor = 1,
): void {
  if (!tallied) return
  if (value.status === 'ok') {
    total.amount += value.amount * factor
    total.counted += 1
  } else if (value.status === 'pending') {
    total.pending = true
  } else if (value.status === 'none') {
    total.skipped[value.reason] = (total.skipped[value.reason] ?? 0) + 1
  }
}

export function isFreeNode(node: BillableNode): boolean {
  return parseBillingPrice(node.price).status === 'free' || node.tags.includes(FREE_NODE_TAG)
}

/**
 * 固定账单明细与三类合计。调用方只传价格可见的节点。
 * 免费节点（免费价格或 `白嫖中` 标签）在「排除免费节点」开启时整行不出现。
 * 付费节点里算不出来的不按 0 计入，按原因记在 `skipped`，由界面交代；
 * 价格无法识别的节点既不算免费也不按 0 计入，同样记在 `skipped`。
 * 未填写价格是后台的正常状态，只在明细行里显示「未设置」，不进合计说明。
 */
export function summarizeFinance(nodes: readonly BillableNode[], options: FinanceSummaryOptions): FinanceSummary {
  const remaining = emptyTotal()
  const monthly = emptyTotal()
  const yearly = emptyTotal()
  const totalValue = emptyTotal()
  const sources = new Set<RateSource>()
  const rows: FinanceRow[] = []
  let needsRates = false

  for (const node of nodes) {
    const free = isFreeNode(node)
    if (free && options.excludeFree) continue

    const price = parseBillingPrice(node.price)
    const currency = resolveSourceCurrency(node.currency)
    // 带「白嫖中」标签但填了价格的节点：排除免费节点时整行已跳过；不排除时按真实价格计入，与上游一致。
    const tallied = price.status === 'paid' || price.status === 'invalid'
    if (price.status === 'paid' && currency.status === 'known' && currency.code !== options.target) needsRates = true

    const remainingRow = toRowAmount(remainingValueOf(node, options.now), currency, options)
    const monthlyRow = toRowAmount(monthlyCost(node), currency, options)
    const valueRow = toRowAmount(priceAmount(price), currency, options)
    for (const row of [remainingRow, monthlyRow, valueRow]) {
      if (row.status === 'ok') row.sources.forEach((source) => sources.add(source))
    }

    addToTotal(remaining, remainingRow, tallied)
    addToTotal(monthly, monthlyRow, tallied)
    // 上游 `calculatePeriodCostCNY`：月均 ÷ 30 × 天数。
    addToTotal(yearly, monthlyRow, tallied, 365 / MONTH_DAYS)
    addToTotal(totalValue, valueRow, tallied)

    rows.push({
      node,
      free,
      price,
      currency,
      expiry: parseBillingExpiry(node.expireDate),
      remaining: remainingRow,
      monthly: monthlyRow,
    })
  }

  return {
    rows,
    remaining,
    monthly,
    yearly,
    totalValue,
    sources: orderedSources(sources),
    needsRates,
  }
}

/** 合计是否完整：没有被跳过的付费节点，也没有还在等汇率的节点。 */
export function isCompleteTotal(total: FinanceTotal): boolean {
  return !total.pending && Object.values(total.skipped).every((count) => !count)
}

const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  'price-unset': '未设置价格',
  'price-invalid': '价格无法识别',
  'cycle-unknown': '计费周期无法识别',
  'expiry-missing': '未设置到期时间',
  'expiry-invalid': '到期时间无法识别',
  'currency-missing': '未标明币种',
  'currency-ambiguous': '币种有歧义',
  'currency-unknown': '币种无法识别',
  'rate-missing': '缺少汇率',
}

export function skipReasonLabel(reason: SkipReason): string {
  return SKIP_REASON_LABELS[reason]
}

/** 「N 台未设置到期时间，未计入」这类说明行，按原因各一行。 */
export function describeSkipped(total: FinanceTotal): string[] {
  return SKIP_REASONS.flatMap((reason) => {
    const count = total.skipped[reason] ?? 0
    return count > 0 ? [`${count} 台${SKIP_REASON_LABELS[reason]}，未计入`] : []
  })
}

/** 参与换算的来源说明；没有跨币种换算时返回 null。 */
export function describeSources(sources: readonly RateSource[]): string | null {
  if (sources.length === 0) return null
  return sources.map((source) => RATE_SOURCE_LABELS[source]).join(' · ')
}
