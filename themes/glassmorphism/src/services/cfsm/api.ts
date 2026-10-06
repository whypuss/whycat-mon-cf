import type {
  CfsmServer,
  HistorySeries,
  ServerCollection,
  ServerSourcesResult,
  SiteConfig,
  ThemeOptionsSaveResult,
} from '@/types/cfsm'
import {
  isRecord,
  normalizeHistory,
  normalizeServer,
  normalizeServerCollection,
  normalizeSiteConfig,
  normalizeThemeOptionsSave,
} from './adapters'
import { apiSource, getApiBases, STORAGE_KEYS, writeStorage } from './config'
import { CfsmRequestError, cfsmGet, cfsmPost, type CfsmRequestOptions } from './http'
import { normalizeServerId } from './identifiers'

export const HISTORY_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168] as const
export type HistoryHours = (typeof HISTORY_HOURS)[number]

type SharedRequestOptions = Partial<Pick<
  CfsmRequestOptions,
  'fetcher' | 'storage' | 'signal' | 'timeoutMs' | 'includeAuth' | 'includeTurnstile'
>>

export function isHistoryHours(value: number): value is HistoryHours {
  return HISTORY_HOURS.some((hours) => hours === value)
}

function requiredServerId(id: string, path: string): string {
  const normalized = normalizeServerId(id)
  if (normalized !== null) return normalized
  throw new CfsmRequestError('Invalid CFSM server ID', {
    status: 400,
    path,
    code: 'invalidServerId',
  })
}

export async function fetchSiteConfig(
  base = getApiBases()[0],
  options: SharedRequestOptions = {},
): Promise<SiteConfig> {
  if (!base) throw new Error('No CFSM API base is configured')
  try {
    const payload = await cfsmGet('/api/config', { ...options, base })
    return normalizeSiteConfig(payload)
  } catch (error) {
    /*
     * 与 CFSM 默认前端的 `fetchAllTurnstileConfigs` 一致：本地已存的 Turnstile 凭据过期时，
     * 带着它请求 `/api/config` 会得到 403（请求层已清除失效凭据）。此时不带验证头再取一次公开配置，
     * 据其中的 `turnstile_enabled` / `verified` 决定是否重新验证。
     */
    if (error instanceof CfsmRequestError && error.status === 403 && options.includeTurnstile !== false) {
      const payload = await cfsmGet('/api/config', { ...options, base, includeTurnstile: false })
      return normalizeSiteConfig(payload)
    }
    throw error
  }
}

/**
 * 用 Turnstile 组件返回的一次性令牌换取 CFSM 签发的验证凭据（有效期由 CFSM 决定，当前为 1 小时）。
 * 请求层会把响应里的 `turnstile_verified` 存起来并清除令牌；返回的配置 `verified` 表示服务端是否确认通过。
 */
export async function verifyTurnstileToken(
  base: string,
  token: string,
  options: SharedRequestOptions = {},
): Promise<SiteConfig> {
  writeStorage(STORAGE_KEYS.turnstileToken, token, options.storage)
  const payload = await cfsmGet('/api/config', { ...options, base, includeAuth: false })
  return normalizeSiteConfig(payload)
}

export async function fetchServers(
  base = getApiBases()[0],
  options: SharedRequestOptions = {},
  sourceIndex = 0,
): Promise<ServerCollection> {
  if (!base) throw new Error('No CFSM API base is configured')
  const source = apiSource(base, sourceIndex)
  const payload = await cfsmGet('/api/servers', { ...options, base })
  return normalizeServerCollection(payload, source)
}

export async function fetchAllServerSources(
  bases = getApiBases(),
  options: SharedRequestOptions = {},
): Promise<ServerSourcesResult> {
  const settled = await Promise.allSettled(
    bases.map((base, index) => fetchServers(base, options, index)),
  )
  const collections: ServerCollection[] = []
  const failures: ServerSourcesResult['failures'] = []

  settled.forEach((result, index) => {
    const base = bases[index]
    if (!base) return
    if (result.status === 'fulfilled') {
      collections.push(result.value)
      return
    }

    const reason: unknown = result.reason
    failures.push({
      source: apiSource(base, index),
      message: reason instanceof Error ? reason.message : 'Unknown CFSM server error',
      status: reason instanceof CfsmRequestError ? reason.status : null,
      code: reason instanceof CfsmRequestError ? reason.code : null,
    })
  })

  return { collections, failures }
}

export async function fetchServer(
  id: string,
  base: string,
  options: SharedRequestOptions = {},
) {
  const serverId = requiredServerId(id, '/api/server')
  const source = apiSource(base)
  const query = new URLSearchParams({ id: serverId }).toString()
  const payload = await cfsmGet('/api/server?' + query, { ...options, base })
  return normalizeServer(payload, source)
}

export async function fetchServerFromSources(
  id: string,
  bases: readonly string[],
  options: SharedRequestOptions = {},
  preferredBase?: string,
): Promise<CfsmServer> {
  const serverId = requiredServerId(id, '/api/server')
  const uniqueBases = [...new Set(bases)]
  if (uniqueBases.length === 0) throw new Error('No CFSM API base is configured')

  if (preferredBase && uniqueBases.includes(preferredBase)) {
    return fetchServer(serverId, preferredBase, options)
  }

  const settled = await Promise.allSettled(
    uniqueBases.map((base) => fetchServer(serverId, base, options)),
  )
  for (const result of settled) {
    if (result.status === 'fulfilled') return result.value
  }

  const reasons = settled.flatMap((result) => {
    if (result.status === 'fulfilled') return []
    const reason: unknown = result.reason
    return [reason]
  })
  const meaningful = reasons.find((reason) => (
    !(reason instanceof CfsmRequestError) || reason.status !== 404
  ))
  throw meaningful ?? reasons[0] ?? new Error('CFSM server could not be resolved')
}

export async function fetchHistory(
  id: string,
  hours: HistoryHours,
  base: string,
  options: SharedRequestOptions = {},
): Promise<HistorySeries> {
  const serverId = requiredServerId(id, '/api/history/all')
  const source = apiSource(base)
  const query = new URLSearchParams({ id: serverId, hours: String(hours) }).toString()
  const payload = await cfsmGet('/api/history/all?' + query, { ...options, base })
  return { serverId, source, points: normalizeHistory(payload) }
}

export async function saveThemeOptions(
  themeOptions: Record<string, unknown>,
  base = getApiBases()[0],
  options: SharedRequestOptions = {},
): Promise<ThemeOptionsSaveResult> {
  if (!base) throw new Error('No CFSM API base is configured')
  if (!isRecord(themeOptions)) throw new Error('Theme options must be a non-array object')
  const payload = await cfsmPost('/api/theme_options', { theme_options: themeOptions }, {
    ...options,
    base,
  })
  return normalizeThemeOptionsSave(payload)
}
