import { FINANCE_CURRENCY_CODES, isPositiveRate, type CurrencyCode } from '@/domain/finance'
import { readStorage, writeStorage } from '@/services/cfsm/config'

/*
 * 每日汇率：请求、校验与浏览器缓存。沿用 Komari `financeHelper` 的模式——
 * 页面需要换算时取一次当日汇率，按本地日期缓存在浏览器里；不经过 CFSM 后端，
 * 不需要节点上报，也不增加 Worker / D1 的负担。
 *
 * 与上游不同的地方（依据见 docs/finance-parity.md 第 2、5 节）：
 * - 备用源换成 `api.frankfurter.dev`。上游的 `api.frankfurter.app` 现在 301 跳转且不带
 *   跨域头，浏览器里请求失败；新地址与 CFSM 2.8.5 前端一致，也在 CFSM 的 CSP 白名单里。
 * - 网络源缺的币种不再让整张表作废，也不悄悄用参考值补齐：快照只存网络真实给出的值，
 *   缺的币种交给 `buildRateView` 按「内置参考汇率」单独标明。
 * - 请求不带 cookie 与 Referer，只包含公开的币种参数。
 */

export const EXCHANGE_RATE_CACHE_KEY = 'cfsm-glassmorphism.finance-rates.v1'
export const EXCHANGE_RATE_TIMEOUT_MS = 5000

export type RateProvider = 'open.er-api.com' | 'api.frankfurter.dev'

export interface RateSnapshot {
  readonly version: 1
  readonly base: 'CNY'
  /** 取得时的本地日期（YYYY-MM-DD），用来判断是不是「今日」汇率。 */
  readonly dateKey: string
  readonly fetchedAt: number
  readonly provider: RateProvider
  /** 数据源自己声明的更新时间或交易日；数据源没给就是 null。 */
  readonly sourceDate: string | null
  /** 只含网络真实返回的币种（1 CNY 对应的数值）。 */
  readonly rates: Readonly<Partial<Record<CurrencyCode, number>>>
}

interface ParsedRates {
  rates: Partial<Record<CurrencyCode, number>>
  sourceDate: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRates(raw: unknown): Partial<Record<CurrencyCode, number>> | null {
  if (!isRecord(raw)) return null
  const rates: Partial<Record<CurrencyCode, number>> = {}
  let count = 0
  for (const code of FINANCE_CURRENCY_CODES) {
    if (code === 'CNY') continue
    const value = raw[code]
    if (isPositiveRate(value)) {
      rates[code] = value
      count += 1
    }
  }
  return count > 0 ? rates : null
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `open.er-api.com/v6/latest/CNY`：`result` 为 success，基准为 CNY，带更新时间戳。 */
export function parseErApiRates(body: unknown): ParsedRates | null {
  if (!isRecord(body) || body.result !== 'success' || body.base_code !== 'CNY') return null
  const rates = pickRates(body.rates)
  if (!rates) return null
  const unix = body.time_last_update_unix
  const sourceDate = typeof unix === 'number' && Number.isFinite(unix) && unix > 0
    ? new Date(unix * 1000).toISOString()
    : null
  return { rates, sourceDate }
}

/** `api.frankfurter.dev/v1/latest?base=CNY`：欧洲央行数据，`date` 是交易日。 */
export function parseFrankfurterRates(body: unknown): ParsedRates | null {
  if (!isRecord(body) || body.base !== 'CNY') return null
  const rates = pickRates(body.rates)
  if (!rates) return null
  const sourceDate = typeof body.date === 'string' && DATE_KEY_PATTERN.test(body.date) ? body.date : null
  return { rates, sourceDate }
}

export const RATE_PROVIDERS: ReadonlyArray<{
  provider: RateProvider
  url: string
  parse: (body: unknown) => ParsedRates | null
}> = [
  { provider: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/CNY', parse: parseErApiRates },
  { provider: 'api.frankfurter.dev', url: 'https://api.frankfurter.dev/v1/latest?base=CNY', parse: parseFrankfurterRates },
]

/** 本地日期键，与上游 `getTodayDateKey` 相同：按浏览器所在时区的日历日。 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type RateFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * 按顺序尝试数据源，每个源最多等 `timeoutMs`。都失败时返回 null，由调用方决定退回缓存或参考表。
 * 这里不重试：一次页面会话里失败过就不再请求（见 `stores/finance.ts`）。
 */
export async function fetchRateSnapshot(
  fetcher: RateFetch,
  now: () => number = Date.now,
  timeoutMs = EXCHANGE_RATE_TIMEOUT_MS,
): Promise<RateSnapshot | null> {
  for (const source of RATE_PROVIDERS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(source.url, {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!response.ok) continue
      const body: unknown = await response.json()
      const parsed = source.parse(body)
      if (!parsed) continue
      const fetchedAt = now()
      return {
        version: 1,
        base: 'CNY',
        dateKey: localDateKey(new Date(fetchedAt)),
        fetchedAt,
        provider: source.provider,
        sourceDate: parsed.sourceDate,
        rates: parsed.rates,
      }
    } catch {
      // 超时、断网、跨域失败或响应不是 JSON：换下一个源。
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

function isRateProvider(value: unknown): value is RateProvider {
  return RATE_PROVIDERS.some((source) => source.provider === value)
}

/** 读缓存并逐项校验；结构不对、JSON 损坏或存储不可用时一律当作没有缓存。 */
export function readRateCache(storage?: Storage): RateSnapshot | null {
  const raw = readStorage(EXCHANGE_RATE_CACHE_KEY, storage)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.base !== 'CNY') return null
  const { dateKey, fetchedAt, provider, sourceDate } = parsed
  if (typeof dateKey !== 'string' || !DATE_KEY_PATTERN.test(dateKey)) return null
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
  if (!isRateProvider(provider)) return null
  if (sourceDate !== null && typeof sourceDate !== 'string') return null
  const rates = pickRates(parsed.rates)
  if (!rates) return null
  return { version: 1, base: 'CNY', dateKey, fetchedAt, provider, sourceDate, rates }
}

export function writeRateCache(snapshot: RateSnapshot, storage?: Storage): void {
  writeStorage(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(snapshot), storage)
}
