import { apiUrl, readStorage, STORAGE_KEYS, writeStorage } from './config'
import { isRecord } from './adapters'

export interface CfsmRequestOptions {
  base: string
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  fetcher?: typeof fetch
  storage?: Storage
  includeAuth?: boolean
  includeTurnstile?: boolean
}

export class CfsmRequestError extends Error {
  readonly status: number | null
  readonly path: string
  readonly code: string | null
  readonly details: unknown

  constructor(
    message: string,
    options: { status?: number; path: string; code?: string; details?: unknown },
  ) {
    super(message)
    this.name = 'CfsmRequestError'
    this.status = options.status ?? null
    this.path = options.path
    this.code = options.code ?? null
    this.details = options.details
  }
}

function requestHeaders(options: CfsmRequestOptions): Headers {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.method === 'POST') headers.set('Content-Type', 'application/json')

  if (options.includeAuth !== false) {
    const token = readStorage(STORAGE_KEYS.jwt, options.storage)
    if (token) headers.set('Authorization', 'Bearer ' + token)
  }

  /*
   * 与 CFSM 默认前端 `createHeaders` 一致：两者都有就都带。CFSM 先校验 Verified，失效时再校验 Token；
   * 只带其一时，残留的过期凭据会挡住刚拿到的新令牌。
   */
  if (options.includeTurnstile !== false) {
    const verified = readStorage(STORAGE_KEYS.turnstileVerified, options.storage)
    const token = readStorage(STORAGE_KEYS.turnstileToken, options.storage)
    if (verified) headers.set('X-Turnstile-Verified', verified)
    if (token) headers.set('X-Turnstile-Token', token)
  }

  return headers
}

type TurnstileRejectionListener = () => void
const turnstileRejectionListeners = new Set<TurnstileRejectionListener>()

/**
 * CFSM 开启全局 Turnstile 后，凭据缺失或过期的 API 请求返回 403。
 * 请求层清除失效凭据后通知订阅方，由上层决定是否重新发起人机验证；返回取消订阅函数。
 */
export function onTurnstileRejected(listener: TurnstileRejectionListener): () => void {
  turnstileRejectionListeners.add(listener)
  return () => {
    turnstileRejectionListeners.delete(listener)
  }
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return text
  }
}

function errorDetails(payload: unknown): { message: string; code: string | null } {
  if (!isRecord(payload)) {
    return {
      message: typeof payload === 'string' && payload.trim() ? payload : 'CFSM request failed',
      code: null,
    }
  }
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.error === 'string'
      ? payload.error
      : 'CFSM request failed'
  const code = typeof payload.code === 'string'
    ? payload.code
    : typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : null
  return { message, code }
}

export async function cfsmRequest(
  path: string,
  options: CfsmRequestOptions,
): Promise<unknown> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const fetcher = options.fetcher ?? fetch
  const abortFromCaller = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  let response: Response
  let payload: unknown
  try {
    response = await fetcher(apiUrl(options.base, path), {
      method: options.method ?? 'GET',
      headers: requestHeaders(options),
      body: options.method === 'POST' ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    })
    // Receiving headers is not completion: the body can still stall or be cancelled.
    payload = await responseBody(response)
  } catch (cause) {
    const timedOut = controller.signal.aborted && controller.signal.reason === 'timeout'
    throw new CfsmRequestError(
      timedOut ? 'CFSM request timed out' : 'CFSM request could not be completed',
      { path, code: timedOut ? 'timeout' : 'networkError', details: cause },
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }

  if (response.status === 401) writeStorage(STORAGE_KEYS.jwt, null, options.storage)
  if (response.status === 403) {
    writeStorage(STORAGE_KEYS.turnstileToken, null, options.storage)
    writeStorage(STORAGE_KEYS.turnstileVerified, null, options.storage)
    for (const listener of turnstileRejectionListeners) listener()
  }

  if (!response.ok) {
    const details = errorDetails(payload)
    throw new CfsmRequestError(details.message, {
      status: response.status,
      path,
      code: details.code ?? undefined,
      details: payload,
    })
  }

  if (isRecord(payload) && typeof payload.turnstile_verified === 'string') {
    writeStorage(STORAGE_KEYS.turnstileVerified, payload.turnstile_verified, options.storage)
    writeStorage(STORAGE_KEYS.turnstileToken, null, options.storage)
  }

  return payload
}

export function cfsmGet(
  path: string,
  options: Omit<CfsmRequestOptions, 'method' | 'body'>,
): Promise<unknown> {
  return cfsmRequest(path, { ...options, method: 'GET' })
}

export function cfsmPost(
  path: string,
  body: unknown,
  options: Omit<CfsmRequestOptions, 'method' | 'body'>,
): Promise<unknown> {
  return cfsmRequest(path, { ...options, method: 'POST', body })
}
