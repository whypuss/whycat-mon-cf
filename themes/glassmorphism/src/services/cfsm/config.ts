import type { ApiSource } from '@/types/cfsm'

export const STORAGE_KEYS = Object.freeze({
  jwt: 'jwt_token',
  turnstileToken: 'turnstile_token',
  turnstileVerified: 'turnstile_verified',
})

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function parseApiBaseContent(content: string | null | undefined, fallbackOrigin: string): string[] {
  const fallback = normalizeHttpOrigin(fallbackOrigin)
  const parsed = (content ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeHttpOrigin)
    .filter((item): item is string => item !== null)

  const bases = [...new Set(parsed)]
  if (bases.length > 0) return bases
  if (fallback) return [fallback]
  throw new Error('A valid HTTP(S) API base is required')
}

export function getApiBases(documentRef: Document = document, locationRef: Location = window.location): string[] {
  const content = documentRef.querySelector<HTMLMetaElement>('meta[name="apiBase"]')?.content
  return parseApiBaseContent(content, locationRef.origin)
}

export function apiSource(base: string, index = 0): ApiSource {
  const url = new URL(base)
  return { base: url.origin, label: index === 0 ? url.host : url.host + ' #' + (index + 1) }
}

export function apiUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : '/' + path
  return new URL(normalizedPath, base).toString()
}

export function adminUrl(base: string): string {
  return apiUrl(base, '/admin') + '#admin'
}

export function webSocketBase(base: string): string {
  const url = new URL(base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}

export function readStorage(key: string, storage?: Storage): string | null {
  try {
    const target = storage ?? globalThis.localStorage
    return target?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null, storage?: Storage): void {
  try {
    const target = storage ?? globalThis.localStorage
    if (value === null) target?.removeItem(key)
    else target?.setItem(key, value)
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
}
