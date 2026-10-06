import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  buildRateView,
  FINANCE_CURRENCY_CODES,
  isDisplayCurrency,
  isPositiveRate,
  type CurrencyCode,
  type DisplayCurrency,
  type RateSource,
  type RateView,
} from '@/domain/finance'
import { readStorage, writeStorage } from '@/services/cfsm/config'
import {
  fetchRateSnapshot,
  localDateKey,
  readRateCache,
  writeRateCache,
  type RateFetch,
  type RateSnapshot,
} from '@/services/exchange-rates'

/*
 * 财务显示偏好与当日汇率。
 *
 * 偏好（显示币种、排除免费节点、手动汇率）只存在当前浏览器，使用主题自己的命名空间，
 * 不进入 theme_options，也不与 CFSM 内置主题或 Komari 的键混用。
 * 汇率在整个页面里只有一份：多个卡片、详情页与明细弹窗共用同一个进行中的请求，
 * 一次会话里失败过就不再请求，不轮询。
 */

export const FINANCE_PREFERENCES_KEY = 'cfsm-glassmorphism.finance.v1'

export interface FinancePreferences {
  displayCurrency: DisplayCurrency
  excludeFree: boolean
  overrides: Partial<Record<CurrencyCode, number>>
}

const DEFAULT_PREFERENCES: FinancePreferences = { displayCurrency: 'CNY', excludeFree: true, overrides: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeOverrides(value: unknown): Partial<Record<CurrencyCode, number>> {
  const overrides: Partial<Record<CurrencyCode, number>> = {}
  if (!isRecord(value)) return overrides
  for (const code of FINANCE_CURRENCY_CODES) {
    if (code === 'CNY') continue
    const rate = value[code]
    if (isPositiveRate(rate)) overrides[code] = rate
  }
  return overrides
}

export function readFinancePreferences(storage?: Storage): FinancePreferences {
  const raw = readStorage(FINANCE_PREFERENCES_KEY, storage)
  if (!raw) return { ...DEFAULT_PREFERENCES, overrides: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_PREFERENCES, overrides: {} }
  }
  if (!isRecord(parsed)) return { ...DEFAULT_PREFERENCES, overrides: {} }
  const currency = parsed.displayCurrency
  return {
    displayCurrency: typeof currency === 'string' && isDisplayCurrency(currency) ? currency : DEFAULT_PREFERENCES.displayCurrency,
    excludeFree: typeof parsed.excludeFree === 'boolean' ? parsed.excludeFree : DEFAULT_PREFERENCES.excludeFree,
    overrides: sanitizeOverrides(parsed.overrides),
  }
}

export type RateStatus = 'idle' | 'loading' | 'ready'

/** 当前这份汇率从哪来：网络、今日缓存、历史缓存，或者只有内置参考表。 */
export type RateOrigin = Extract<RateSource, 'network' | 'cache' | 'stale-cache' | 'reference'>

export const useFinanceStore = defineStore('finance', () => {
  const preferences = ref<FinancePreferences>(readFinancePreferences())
  const snapshot = ref<RateSnapshot | null>(null)
  const origin = ref<Exclude<RateOrigin, 'reference'> | null>(null)
  const status = ref<RateStatus>('idle')
  let staleSnapshot: RateSnapshot | null = null
  let inflight: Promise<void> | null = null
  let hydrated = false

  function persist(): void {
    writeStorage(FINANCE_PREFERENCES_KEY, JSON.stringify(preferences.value))
  }

  /** 同步读取缓存：当日缓存立即可用，不必等网络；旧缓存留作失败时的退路。 */
  function hydrate(now: number): void {
    if (hydrated) return
    hydrated = true
    const cached = readRateCache()
    if (!cached) return
    if (cached.dateKey === localDateKey(new Date(now))) {
      snapshot.value = cached
      origin.value = 'cache'
      status.value = 'ready'
    } else {
      staleSnapshot = cached
    }
  }

  /**
   * 需要换算的界面调用它。已有当日汇率、正在请求或本次会话已经尝试过时都不会再发请求。
   * `fetcher` 只为测试注入；默认用浏览器的 fetch。
   */
  function ensureRates(fetcher?: RateFetch, now: () => number = Date.now): Promise<void> {
    hydrate(now())
    if (status.value === 'ready') return Promise.resolve()
    if (inflight) return inflight
    const request: RateFetch = fetcher ?? ((url, init) => globalThis.fetch(url, init))
    status.value = 'loading'
    inflight = (async () => {
      const fetched = await fetchRateSnapshot(request, now)
      if (fetched) {
        snapshot.value = fetched
        origin.value = 'network'
        writeRateCache(fetched)
      } else if (staleSnapshot) {
        snapshot.value = staleSnapshot
        origin.value = 'stale-cache'
      } else {
        snapshot.value = null
        origin.value = null
      }
      status.value = 'ready'
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  const view = computed<RateView>(() => buildRateView({
    snapshot: snapshot.value && origin.value ? { origin: origin.value, rates: snapshot.value.rates } : null,
    overrides: preferences.value.overrides,
    pending: status.value !== 'ready',
  }))

  /** 整份汇率的来源；只有参考表时是 reference，尚未取得时是 null。 */
  const tableOrigin = computed<RateOrigin | null>(() => {
    if (status.value !== 'ready') return null
    return origin.value ?? 'reference'
  })

  /** 当前表是不是今日取得的（网络或今日缓存）；决定「恢复今日汇率」按钮能不能这样称呼。 */
  const hasTodayTable = computed(() => origin.value === 'network' || origin.value === 'cache')
  const hasOverrides = computed(() => Object.keys(preferences.value.overrides).length > 0)

  function setDisplayCurrency(currency: string): void {
    if (!isDisplayCurrency(currency) || currency === preferences.value.displayCurrency) return
    preferences.value = { ...preferences.value, displayCurrency: currency }
    persist()
  }

  function setExcludeFree(exclude: boolean): void {
    if (exclude === preferences.value.excludeFree) return
    preferences.value = { ...preferences.value, excludeFree: exclude }
    persist()
  }

  /** 手动汇率：只接受有限正数，CNY 固定为 1 不可改。 */
  function setOverride(currency: CurrencyCode, value: number): boolean {
    if (currency === 'CNY' || !isPositiveRate(value)) return false
    preferences.value = {
      ...preferences.value,
      overrides: { ...preferences.value.overrides, [currency]: value },
    }
    persist()
    return true
  }

  /** 只清除手动汇率，显示币种与其它偏好不动。 */
  function clearOverrides(): void {
    if (!hasOverrides.value) return
    preferences.value = { ...preferences.value, overrides: {} }
    persist()
  }

  return {
    preferences,
    snapshot,
    status,
    view,
    tableOrigin,
    hasTodayTable,
    hasOverrides,
    ensureRates,
    setDisplayCurrency,
    setExcludeFree,
    setOverride,
    clearOverrides,
  }
})
