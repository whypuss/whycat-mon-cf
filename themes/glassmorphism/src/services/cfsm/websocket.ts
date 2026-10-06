import type {
  CfsmRealtimeSample,
  CfsmSocketState,
  CfsmSocketSubscription,
} from '@/types/cfsm'
import { normalizeSocketBatch } from './adapters'
import { readStorage, STORAGE_KEYS, webSocketBase } from './config'
import { normalizeServerId } from './identifiers'

const MAX_SUBSCRIPTION_IDS = 500
const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
const STABLE_CONNECTION_MS = 10_000
const KEEPALIVE_INTERVAL_MS = 30_000
const POLICY_VIOLATION_CLOSE_CODE = 1008
const SOCKET_OPEN_STATE = 1

type TimerHandle = ReturnType<typeof setTimeout>

export interface CfsmSocketLike {
  readonly readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number; reason?: string }) => void) | null
  send(payload: string): void
  close(code?: number, reason?: string): void
}

export type CfsmSocketFactory = (url: string) => CfsmSocketLike

export interface CfsmSocketScheduler {
  setTimeout(callback: () => void, delay: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
  setInterval(callback: () => void, delay: number): TimerHandle
  clearInterval(handle: TimerHandle): void
}

export interface CfsmSocketConnection {
  updateIds(ids: readonly string[]): void
  close(): void
}

export interface CfsmSocketOptions {
  base: string
  ids: readonly string[]
  subscribe?: string
  timeoutMinutes: number
  onSamples(samples: CfsmRealtimeSample[]): void
  onState(state: CfsmSocketState): void
  onTimeout(): void
  socketFactory?: CfsmSocketFactory
  scheduler?: CfsmSocketScheduler
  storage?: Storage
  locationHost?: string
}

const defaultScheduler: CfsmSocketScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (handle) => globalThis.clearInterval(handle),
}

function defaultSocketFactory(url: string): CfsmSocketLike {
  const socket = new WebSocket(url)
  const wrapped: CfsmSocketLike = {
    get readyState() {
      return socket.readyState
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (payload) => socket.send(payload),
    close: (code, reason) => socket.close(code, reason),
  }
  socket.onopen = () => wrapped.onopen?.()
  socket.onmessage = (event) => wrapped.onmessage?.({ data: event.data })
  socket.onerror = () => wrapped.onerror?.()
  socket.onclose = (event) => wrapped.onclose?.({ code: event.code, reason: event.reason })
  return wrapped
}

function normalizedTimeoutMinutes(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 1440 ? value : 0
}

function currentLocationHost(): string {
  return typeof location === 'undefined' ? '' : location.host
}

export function sanitizeSubscriptionIds(ids: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const id of ids) {
    const value = normalizeServerId(id)
    if (value === null) continue
    unique.add(value)
    if (unique.size >= MAX_SUBSCRIPTION_IDS) break
  }
  return [...unique]
}

export function createCfsmSocketUrl(
  base: string,
  options: { storage?: Storage; locationHost?: string; subscribe?: string } = {},
): string {
  const url = new URL('/api/ws', webSocketBase(base))
  url.searchParams.set('subscribe', normalizeSubscribe(options.subscribe))
  const token = readStorage(STORAGE_KEYS.jwt, options.storage)
  const locationHost = options.locationHost ?? currentLocationHost()
  if (token && url.host !== locationHost) url.searchParams.set('token', token)
  return url.toString()
}

function normalizeSubscribe(value: string | undefined): string {
  if (value === undefined || value === 'all') return 'all'
  const [serverId] = sanitizeSubscriptionIds([value])
  if (!serverId || serverId !== value.trim()) {
    throw new Error('A valid CFSM WebSocket subscription target is required')
  }
  return serverId
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function createCfsmSocket(options: CfsmSocketOptions): CfsmSocketConnection {
  const scheduler = options.scheduler ?? defaultScheduler
  const socketFactory = options.socketFactory ?? defaultSocketFactory
  const timeoutMs = normalizedTimeoutMinutes(options.timeoutMinutes) * 60_000
  const subscribe = normalizeSubscribe(options.subscribe)
  let ids = sanitizeSubscriptionIds(options.ids)
  let socket: CfsmSocketLike | null = null
  let state: CfsmSocketState = 'idle'
  let reconnectAttempt = 0
  let reconnectTimer: TimerHandle | null = null
  let stabilityTimer: TimerHandle | null = null
  let keepaliveTimer: TimerHandle | null = null
  let lifetimeTimer: TimerHandle | null = null
  let closed = false

  function setState(next: CfsmSocketState): void {
    if (state === next) return
    state = next
    options.onState(next)
  }

  function clearConnectionTimers(): void {
    if (stabilityTimer !== null) scheduler.clearTimeout(stabilityTimer)
    if (keepaliveTimer !== null) scheduler.clearInterval(keepaliveTimer)
    if (lifetimeTimer !== null) scheduler.clearTimeout(lifetimeTimer)
    stabilityTimer = null
    keepaliveTimer = null
    lifetimeTimer = null
  }

  function clearAllTimers(): void {
    clearConnectionTimers()
    if (reconnectTimer !== null) scheduler.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer !== null || (subscribe === 'all' && ids.length === 0)) return
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempt, 5),
    )
    reconnectAttempt += 1
    setState('backoff')
    reconnectTimer = scheduler.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function disconnectCurrent(current: CfsmSocketLike): void {
    if (socket !== current) return
    socket = null
    clearConnectionTimers()
    scheduleReconnect()
    try {
      current.close()
    } catch {
      // The reconnect timer already owns recovery, even if closing the old socket fails.
    }
  }

  function sendSubscription(current: CfsmSocketLike): boolean {
    /*
     * CFSM 在收到订阅帧后才会通知 Agent 进入实时上报。即使 URL 已经是
     * `subscribe=<serverId>`，也必须像官方前端一样再发送一次同 scope 的订阅帧；
     * 否则连接只收到 hello，在没有其它活跃订阅者时不会收到 batchUpdate。
     */
    const subscription: CfsmSocketSubscription = {
      type: 'subscribe',
      scope: subscribe,
      ids: subscribe === 'all' ? ids : [],
    }
    try {
      current.send(JSON.stringify(subscription))
      return true
    } catch {
      disconnectCurrent(current)
      return false
    }
  }

  function connect(): void {
    if (closed || ids.length === 0) return
    setState('connecting')
    let current: CfsmSocketLike
    try {
      current = socketFactory(createCfsmSocketUrl(options.base, { ...options, subscribe }))
    } catch {
      setState('unavailable')
      scheduleReconnect()
      return
    }
    socket = current

    current.onopen = () => {
      if (socket !== current || closed) return
      if (!sendSubscription(current)) return
      setState('open')
      stabilityTimer = scheduler.setTimeout(() => {
        if (socket === current && current.readyState === SOCKET_OPEN_STATE) reconnectAttempt = 0
        stabilityTimer = null
      }, STABLE_CONNECTION_MS)
      keepaliveTimer = scheduler.setInterval(() => {
        if (socket !== current || current.readyState !== SOCKET_OPEN_STATE) return
        try {
          current.send(JSON.stringify({ type: 'ping' }))
        } catch {
          disconnectCurrent(current)
        }
      }, KEEPALIVE_INTERVAL_MS)
      if (timeoutMs > 0) {
        lifetimeTimer = scheduler.setTimeout(() => {
          if (socket !== current || closed) return
          closed = true
          socket = null
          clearAllTimers()
          setState('timed-out')
          try {
            current.close(1000, 'connection lifetime exceeded')
          } finally {
            options.onTimeout()
          }
        }, timeoutMs)
      }
    }

    current.onmessage = (event) => {
      if (socket !== current || typeof event.data !== 'string') return
      let message: unknown
      try {
        message = JSON.parse(event.data) as unknown
      } catch {
        return
      }
      const samples = normalizeSocketBatch(message)
      if (samples.length > 0) options.onSamples(samples)
    }

    current.onerror = () => {
      if (socket !== current) return
      disconnectCurrent(current)
    }

    current.onclose = (event) => {
      if (socket !== current) return
      socket = null
      clearConnectionTimers()
      if (closed) return
      if (event.code === POLICY_VIOLATION_CLOSE_CODE) {
        setState('unavailable')
        return
      }
      scheduleReconnect()
    }
  }

  if (subscribe !== 'all' || ids.length > 0) connect()
  else setState('unavailable')

  return {
    updateIds(nextIds) {
      if (subscribe !== 'all') return
      const next = sanitizeSubscriptionIds(nextIds)
      if (sameIds(ids, next)) return
      ids = next
      const current = socket
      if (ids.length === 0) {
        clearAllTimers()
        socket = null
        setState('unavailable')
        if (current) {
          try {
            current.close(1000, 'no valid subscription ids')
          } catch {
            // A future valid ID update can reconnect this logical connection.
          }
        }
        return
      }
      if (current?.readyState === SOCKET_OPEN_STATE) sendSubscription(current)
      else if (current === null && reconnectTimer === null) connect()
    },
    close() {
      if (closed && state === 'closed') return
      closed = true
      clearAllTimers()
      const current = socket
      socket = null
      setState('closed')
      if (!current) return
      try {
        current.close(1000, 'client closed')
      } catch {
        // Closing is best-effort during page lifecycle cleanup.
      }
    },
  }
}
