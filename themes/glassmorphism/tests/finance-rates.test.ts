import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { REFERENCE_RATES } from '@/domain/finance'
import {
  EXCHANGE_RATE_CACHE_KEY,
  fetchRateSnapshot,
  localDateKey,
  parseErApiRates,
  parseFrankfurterRates,
  readRateCache,
  RATE_PROVIDERS,
  type RateFetch,
  type RateSnapshot,
} from '@/services/exchange-rates'
import { FINANCE_PREFERENCES_KEY, readFinancePreferences, useFinanceStore } from '@/stores/finance'

/*
 * 汇率的请求、缓存与状态。数值都是人工测试值，不代表真实汇率。
 */

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, value) }
}

/** 读写都抛错：隐私模式、禁用存储或配额已满。 */
class BrokenStorage implements Storage {
  get length(): number { return 0 }
  clear(): void { throw new Error('denied') }
  getItem(): string | null { throw new Error('denied') }
  key(): string | null { throw new Error('denied') }
  removeItem(): void { throw new Error('denied') }
  setItem(): void { throw new Error('QuotaExceededError') }
}

const NOW = new Date(2026, 8, 17, 9, 30).getTime()
const TODAY = localDateKey(new Date(NOW))

const ER_API_BODY = {
  result: 'success',
  base_code: 'CNY',
  time_last_update_unix: 1789603351,
  rates: { CNY: 1, USD: 0.1, EUR: 0.125, JPY: 20, RUB: 12, XAU: 0.00003 },
}
const FRANKFURTER_BODY = { amount: 1, base: 'CNY', date: '2026-09-16', rates: { USD: 0.11, EUR: 0.13 } }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function recordingFetch(responses: Array<Response | Error>): RateFetch & { calls: Array<{ url: string, init: RequestInit }> } {
  const calls: Array<{ url: string, init: RequestInit }> = []
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  }
  return Object.assign(fetcher, { calls })
}

function cachedSnapshot(overrides: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    version: 1,
    base: 'CNY',
    dateKey: TODAY,
    fetchedAt: NOW - 3_600_000,
    provider: 'open.er-api.com',
    sourceDate: '2026-09-17T00:02:31.000Z',
    rates: { USD: 0.1, EUR: 0.125 },
    ...overrides,
  }
}

describe('数据源解析', () => {
  it('er-api：只收 43 种里的有限正数，并保留数据源时间', () => {
    const parsed = parseErApiRates(ER_API_BODY)
    expect(parsed?.rates).toEqual({ USD: 0.1, EUR: 0.125, JPY: 20, RUB: 12 })
    expect(parsed?.sourceDate).toBe('2026-09-17T00:02:31.000Z')
  })

  it('frankfurter：交易日作为数据源日期，缺的币种不补', () => {
    const parsed = parseFrankfurterRates(FRANKFURTER_BODY)
    expect(parsed).toEqual({ rates: { USD: 0.11, EUR: 0.13 }, sourceDate: '2026-09-16' })
  })

  it('结构不对、基准不是 CNY、没有有效值时拒绝', () => {
    expect(parseErApiRates({ ...ER_API_BODY, result: 'error' })).toBeNull()
    expect(parseErApiRates({ ...ER_API_BODY, base_code: 'USD' })).toBeNull()
    expect(parseErApiRates({ ...ER_API_BODY, rates: { USD: 0, EUR: -1, JPY: 'x' } })).toBeNull()
    expect(parseFrankfurterRates({ base: 'EUR', rates: { USD: 1 } })).toBeNull()
    expect(parseFrankfurterRates(null)).toBeNull()
    expect(parseErApiRates([])).toBeNull()
  })

  it('数据源地址只有公开的币种参数，都在 CFSM 的 CSP 白名单里', () => {
    expect(RATE_PROVIDERS.map((source) => source.url)).toEqual([
      'https://open.er-api.com/v6/latest/CNY',
      'https://api.frankfurter.dev/v1/latest?base=CNY',
    ])
  })
})

describe('请求', () => {
  it('第一个源成功就只请求一次，不带 cookie 与 Referer', async () => {
    const fetcher = recordingFetch([json(ER_API_BODY)])
    const snapshot = await fetchRateSnapshot(fetcher, () => NOW)
    expect(fetcher.calls).toHaveLength(1)
    expect(fetcher.calls[0]?.init.credentials).toBe('omit')
    expect(fetcher.calls[0]?.init.referrerPolicy).toBe('no-referrer')
    expect(snapshot).toMatchObject({ provider: 'open.er-api.com', dateKey: TODAY, fetchedAt: NOW })
  })

  it('第一个源失败、非 200 或内容无效时换第二个源', async () => {
    for (const first of [new TypeError('Failed to fetch'), json({}, 503), json({ result: 'error' })]) {
      const fetcher = recordingFetch([first, json(FRANKFURTER_BODY)])
      const snapshot = await fetchRateSnapshot(fetcher, () => NOW)
      expect(fetcher.calls.map((call) => call.url)).toEqual(RATE_PROVIDERS.map((source) => source.url))
      expect(snapshot?.provider).toBe('api.frankfurter.dev')
    }
  })

  it('全部失败返回 null', async () => {
    const fetcher = recordingFetch([new TypeError('offline'), new TypeError('offline')])
    expect(await fetchRateSnapshot(fetcher, () => NOW)).toBeNull()
  })

  it('超时会中止请求并换下一个源', async () => {
    const aborted: string[] = []
    const fetcher: RateFetch = (url, init) => new Promise((resolve, reject) => {
      if (url.includes('frankfurter')) {
        resolve(json(FRANKFURTER_BODY))
        return
      }
      init.signal?.addEventListener('abort', () => {
        aborted.push(url)
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
    const snapshot = await fetchRateSnapshot(fetcher, () => NOW, 20)
    expect(aborted).toEqual(['https://open.er-api.com/v6/latest/CNY'])
    expect(snapshot?.provider).toBe('api.frankfurter.dev')
  })
})

describe('缓存', () => {
  it('损坏的 JSON、错误版本、未知来源与不可用的存储都当作没有缓存', () => {
    const storage = new MemoryStorage()
    expect(readRateCache(storage)).toBeNull()
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, '{broken')
    expect(readRateCache(storage)).toBeNull()
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify({ ...cachedSnapshot(), version: 2 }))
    expect(readRateCache(storage)).toBeNull()
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify({ ...cachedSnapshot(), provider: 'evil.example' }))
    expect(readRateCache(storage)).toBeNull()
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(cachedSnapshot()))
    expect(readRateCache(storage)).toEqual(cachedSnapshot())
    expect(readRateCache(new BrokenStorage())).toBeNull()
  })
})

describe('store：一次会话一份汇率', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('有当日缓存时不发请求', async () => {
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(cachedSnapshot()))
    const store = useFinanceStore()
    const fetcher = recordingFetch([])
    await store.ensureRates(fetcher, () => NOW)
    expect(fetcher.calls).toHaveLength(0)
    expect(store.tableOrigin).toBe('cache')
    expect(store.view.sources.USD).toBe('cache')
    expect(store.hasTodayTable).toBe(true)
  })

  it('多个消费者同时要汇率，只发一组请求，并写入缓存', async () => {
    const store = useFinanceStore()
    const fetcher = recordingFetch([json(ER_API_BODY)])
    expect(store.view.pending).toBe(true)
    await Promise.all([store.ensureRates(fetcher, () => NOW), store.ensureRates(fetcher, () => NOW), store.ensureRates(fetcher, () => NOW)])
    expect(fetcher.calls).toHaveLength(1)
    expect(store.tableOrigin).toBe('network')
    expect(store.view.pending).toBe(false)
    expect(readRateCache(storage)?.rates.USD).toBe(0.1)
    await store.ensureRates(fetcher, () => NOW)
    expect(fetcher.calls).toHaveLength(1)
  })

  it('网络失败时退回旧缓存并标为历史缓存，之后不再重试', async () => {
    storage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify(cachedSnapshot({ dateKey: '2026-09-10' })))
    const store = useFinanceStore()
    const fetcher = recordingFetch([new TypeError('offline'), new TypeError('offline')])
    await store.ensureRates(fetcher, () => NOW)
    expect(store.tableOrigin).toBe('stale-cache')
    expect(store.view.sources.EUR).toBe('stale-cache')
    expect(store.hasTodayTable).toBe(false)
    await store.ensureRates(fetcher, () => NOW)
    expect(fetcher.calls).toHaveLength(2)
  })

  it('没有网络也没有缓存时只剩参考表，并如实标明', async () => {
    const store = useFinanceStore()
    const fetcher = recordingFetch([new TypeError('offline'), new TypeError('offline')])
    await store.ensureRates(fetcher, () => NOW)
    expect(store.tableOrigin).toBe('reference')
    expect(store.view.rates.USD).toBe(REFERENCE_RATES.USD)
    expect(store.view.sources.USD).toBe('reference')
  })

  it('备用源缺的币种按参考值单独标明，不冒充网络汇率', async () => {
    const store = useFinanceStore()
    const fetcher = recordingFetch([new TypeError('offline'), json(FRANKFURTER_BODY)])
    await store.ensureRates(fetcher, () => NOW)
    expect(store.view.sources.USD).toBe('network')
    expect(store.view.sources.RUB).toBe('reference')
  })

  it('手动汇率：有限正数才生效，CNY 不可改，清除时不动其它偏好', () => {
    const store = useFinanceStore()
    store.setDisplayCurrency('USD')
    store.setExcludeFree(false)
    expect(store.setOverride('EUR', 0.2)).toBe(true)
    expect(store.setOverride('USD', -1)).toBe(false)
    expect(store.setOverride('USD', Number.NaN)).toBe(false)
    expect(store.setOverride('CNY', 2)).toBe(false)
    expect(store.view.rates.EUR).toBe(0.2)
    expect(store.view.sources.EUR).toBe('manual')
    store.clearOverrides()
    expect(store.hasOverrides).toBe(false)
    expect(readFinancePreferences(storage)).toEqual({ displayCurrency: 'USD', excludeFree: false, overrides: {} })
  })

  it('偏好只写主题自己的键；非法显示币种被忽略', () => {
    const store = useFinanceStore()
    store.setDisplayCurrency('BTC')
    store.setDisplayCurrency('EUR')
    expect(JSON.parse(storage.getItem(FINANCE_PREFERENCES_KEY) ?? '{}')).toEqual({ displayCurrency: 'EUR', excludeFree: true, overrides: {} })
    expect(storage.length).toBe(1)
  })

  it('损坏的偏好回到默认值：CNY、排除免费节点、无手动汇率', () => {
    storage.setItem(FINANCE_PREFERENCES_KEY, '{"displayCurrency":"BTC","excludeFree":"yes","overrides":{"CNY":2,"USD":0,"EUR":0.2}}')
    expect(readFinancePreferences(storage)).toEqual({ displayCurrency: 'CNY', excludeFree: true, overrides: { EUR: 0.2 } })
    storage.setItem(FINANCE_PREFERENCES_KEY, 'not json')
    expect(readFinancePreferences(storage)).toEqual({ displayCurrency: 'CNY', excludeFree: true, overrides: {} })
  })

  it('存储不可用时照常工作，只是不持久', async () => {
    vi.stubGlobal('localStorage', new BrokenStorage())
    setActivePinia(createPinia())
    const store = useFinanceStore()
    store.setDisplayCurrency('USD')
    expect(store.preferences.displayCurrency).toBe('USD')
    const fetcher = recordingFetch([json(ER_API_BODY)])
    await store.ensureRates(fetcher, () => NOW)
    expect(store.tableOrigin).toBe('network')
  })
})
