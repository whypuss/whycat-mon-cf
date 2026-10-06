import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CfsmRequestError,
  cfsmGet,
  cfsmPost,
} from '@/services/cfsm/http'
import { STORAGE_KEYS } from '@/services/cfsm/config'
import { saveThemeOptions } from '@/services/cfsm/api'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

afterEach(() => vi.useRealTimers())

describe('CFSM HTTP transport', () => {
  it.each(['timeout', 'caller'] as const)('keeps %s cancellation active while reading the body', async (reason) => {
    vi.useFakeTimers()
    const caller = new AbortController()
    let signal: AbortSignal | null | undefined
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const fetcher: typeof fetch = async (_input, init) => {
      signal = init?.signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller
          signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
        },
      })
      return new Response(body)
    }
    const request = cfsmGet('/api/config', {
      base: 'https://status.example', fetcher, signal: caller.signal, timeoutMs: 50,
    })
    const rejected = expect(request).rejects.toMatchObject({
      code: reason === 'timeout' ? 'timeout' : 'networkError',
    })
    // Response headers have already arrived; the body is deliberately still pending.
    await Promise.resolve()
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(50)
    else caller.abort('page closed')
    const wasAborted = signal?.aborted
    // Also settle the pre-fix implementation, so a regression fails instead of hanging.
    if (!wasAborted) bodyController?.error(new Error('body never aborted'))
    await rejected
    expect(wasAborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('wraps a broken response stream as a network error', async () => {
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError('connection lost during body')) },
    }))
    await expect(cfsmGet('/api/config', { base: 'https://status.example', fetcher }))
      .rejects.toMatchObject({ code: 'networkError', path: '/api/config' })
  })

  it('sends JWT and the reusable Turnstile credential', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.jwt, 'jwt-value')
    storage.setItem(STORAGE_KEYS.turnstileToken, 'one-use-value')
    storage.setItem(STORAGE_KEYS.turnstileVerified, 'verified-value')

    let receivedUrl = ''
    let receivedInit: RequestInit | undefined
    const fetcher: typeof fetch = async (input, init) => {
      receivedUrl = String(input)
      receivedInit = init
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await cfsmGet('/api/config', {
      base: 'https://status.example',
      storage,
      fetcher,
    })

    const headers = new Headers(receivedInit?.headers)
    expect(receivedUrl).toBe('https://status.example/api/config')
    expect(receivedInit?.credentials).toBe('include')
    expect(headers.get('Authorization')).toBe('Bearer jwt-value')
    expect(headers.get('X-Turnstile-Verified')).toBe('verified-value')
    /*
     * 与 CFSM 默认前端 `createHeaders` 一致，两者都有就都带（issue #3）：CFSM 先校验 Verified，
     * 失效时再校验 Token。此前只带 Verified，残留的过期凭据会挡住刚拿到的新令牌。
     */
    expect(headers.get('X-Turnstile-Token')).toBe('one-use-value')
  })

  it('stores a returned verification credential and consumes the one-use token', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.turnstileToken, 'one-use-value')
    const fetcher: typeof fetch = async () => new Response(
      '{"verified":true,"turnstile_verified":"cached-value"}',
      { status: 200 },
    )

    await cfsmGet('/api/config', {
      base: 'https://status.example',
      storage,
      fetcher,
    })

    expect(storage.getItem(STORAGE_KEYS.turnstileVerified)).toBe('cached-value')
    expect(storage.getItem(STORAGE_KEYS.turnstileToken)).toBeNull()
  })

  it('clears invalid credentials and surfaces API status and code', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.jwt, 'expired')
    const fetcher: typeof fetch = async () => new Response(
      '{"message":"databaseUpgradeRequired"}',
      { status: 401 },
    )

    await expect(cfsmGet('/api/history/all?id=x&hours=48', {
      base: 'https://status.example',
      storage,
      fetcher,
    })).rejects.toMatchObject({
      status: 401,
      code: 'databaseUpgradeRequired',
    })
    expect(storage.getItem(STORAGE_KEYS.jwt)).toBeNull()
  })

  it('clears Turnstile credentials on 403 without clearing the JWT', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.jwt, 'still-valid')
    storage.setItem(STORAGE_KEYS.turnstileToken, 'expired-token')
    storage.setItem(STORAGE_KEYS.turnstileVerified, 'expired-proof')
    const fetcher: typeof fetch = async () => new Response(
      '{"message":"turnstileRequired"}',
      { status: 403 },
    )

    await expect(cfsmGet('/api/config', {
      base: 'https://status.example',
      storage,
      fetcher,
    })).rejects.toMatchObject({ status: 403, code: 'turnstileRequired' })
    expect(storage.getItem(STORAGE_KEYS.jwt)).toBe('still-valid')
    expect(storage.getItem(STORAGE_KEYS.turnstileToken)).toBeNull()
    expect(storage.getItem(STORAGE_KEYS.turnstileVerified)).toBeNull()
  })

  it.each([404, 409, 500, 503])('surfaces HTTP %i without replacing the response', async (status) => {
    const fetcher: typeof fetch = async () => new Response(
      JSON.stringify({ message: `status-${status}` }),
      { status },
    )

    await expect(cfsmGet('/api/server?id=node-a', {
      base: 'https://status.example',
      fetcher,
    })).rejects.toMatchObject({ status, code: `status-${status}` })
  })

  it('classifies an unreachable API as a network transport error', async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError('connection refused')
    }

    await expect(cfsmGet('/api/servers', {
      base: 'https://status.example',
      fetcher,
    })).rejects.toMatchObject({ status: null, code: 'networkError' })
  })

  it('posts the complete theme-options object to the only public theme write API', async () => {
    let receivedBody: string | undefined
    const fetcher: typeof fetch = async (_input, init) => {
      receivedBody = typeof init?.body === 'string' ? init.body : undefined
      return new Response(
        '{"success":true,"theme_options":{"themeMode":"dark","backgroundEnabled":true},"message":"updateSuccess"}',
        { status: 200 },
      )
    }

    const result = await saveThemeOptions({
      themeMode: 'dark',
      backgroundEnabled: true,
    }, 'https://status.example', { fetcher })

    expect(JSON.parse(receivedBody ?? '{}')).toEqual({
      theme_options: {
        themeMode: 'dark',
        backgroundEnabled: true,
      },
    })
    expect(result.success).toBe(true)
    expect(result.themeOptions).toEqual({
      themeMode: 'dark',
      backgroundEnabled: true,
    })
  })

  it('wraps structured failure responses without redirecting', async () => {
    const fetcher: typeof fetch = async () => new Response(
      '{"error":"invalidThemeOptionsFormat"}',
      { status: 400 },
    )

    try {
      await cfsmPost('/api/theme_options', { theme_options: null }, {
        base: 'https://status.example',
        fetcher,
      })
      throw new Error('Expected request failure')
    } catch (error) {
      expect(error).toBeInstanceOf(CfsmRequestError)
      expect(error).toMatchObject({
        status: 400,
        code: 'invalidThemeOptionsFormat',
        path: '/api/theme_options',
      })
    }
  })
})
