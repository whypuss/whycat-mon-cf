import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDetailRealtime,
  type DetailRealtimeOptions,
} from '@/services/cfsm/detail-realtime'
import type { VisibilitySource } from '@/services/cfsm/dashboard-realtime'
import type {
  CfsmSocketConnection,
  CfsmSocketOptions,
} from '@/services/cfsm/websocket'

class FakeVisibility implements VisibilitySource {
  hidden = false
  private readonly listeners = new Set<() => void>()

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener)
  }

  emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function connectionFactory() {
  const options: CfsmSocketOptions[] = []
  const connections: Array<CfsmSocketConnection & {
    close: ReturnType<typeof vi.fn>
    updateIds: ReturnType<typeof vi.fn>
  }> = []
  const createSocket = (socketOptions: CfsmSocketOptions): CfsmSocketConnection => {
    options.push(socketOptions)
    const connection = { close: vi.fn(), updateIds: vi.fn() }
    connections.push(connection)
    return connection
  }
  return { options, connections, createSocket }
}

function options(
  factory: ReturnType<typeof connectionFactory>,
  overrides: Partial<DetailRealtimeOptions> = {},
): DetailRealtimeOptions {
  return {
    base: 'https://b.example',
    serverId: 'node-b',
    timeoutMinutes: 12,
    refreshRest: async () => undefined,
    onSamples: vi.fn(),
    onState: vi.fn(),
    onFallbackChange: vi.fn(),
    onTimeoutChange: vi.fn(),
    onPausedChange: vi.fn(),
    createSocket: factory.createSocket,
    ...overrides,
  }
}

afterEach(() => vi.useRealTimers())

describe('detail realtime coordination', () => {
  it.each([false, true])('shares the pending REST refresh across rapid visibility changes (dispose=%s)', async (dispose) => {
    const visibility = new FakeVisibility()
    const factory = connectionFactory()
    let finish: (() => void) | undefined
    const refreshRest = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const controller = createDetailRealtime(options(factory, { documentRef: visibility, refreshRest }))
    controller.start()
    for (let i = 0; i < 2; i += 1) {
      visibility.hidden = true
      visibility.emit()
      visibility.hidden = false
      visibility.emit()
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(factory.connections).toHaveLength(1)
    expect(refreshRest).toHaveBeenCalledOnce()
    if (dispose) controller.dispose()
    finish?.()
    await vi.waitFor(() => expect(factory.connections).toHaveLength(dispose ? 1 : 2))
    controller.dispose()
  })

  it('opens exactly one owning-base socket subscribed only to the current server', () => {
    const factory = connectionFactory()
    const onSamples = vi.fn()
    const controller = createDetailRealtime(options(factory, { onSamples }))

    controller.start()

    expect(factory.options).toHaveLength(1)
    expect(factory.options[0]).toMatchObject({
      base: 'https://b.example',
      ids: ['node-b'],
      subscribe: 'node-b',
      timeoutMinutes: 12,
    })
    factory.options[0]?.onSamples([{
      serverId: 'node-b',
      timestamp: 1,
      data: { cpu: 0 },
    }])
    expect(onSamples).toHaveBeenCalledWith([{
      serverId: 'node-b',
      timestamp: 1,
      data: { cpu: 0 },
    }])
    controller.dispose()
  })

  it('closes while hidden and refreshes REST before creating a new detail socket', async () => {
    const visibility = new FakeVisibility()
    const factory = connectionFactory()
    let finishRefresh: (() => void) | undefined
    const refreshRest = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))
    const controller = createDetailRealtime(options(factory, {
      documentRef: visibility,
      refreshRest,
    }))

    controller.start()
    visibility.hidden = true
    visibility.emit()
    expect(factory.connections[0]?.close).toHaveBeenCalledOnce()

    visibility.hidden = false
    visibility.emit()
    expect(refreshRest).toHaveBeenCalledOnce()
    expect(factory.connections).toHaveLength(1)
    finishRefresh?.()
    await vi.waitFor(() => expect(factory.connections).toHaveLength(2))
    controller.dispose()
  })

  it('uses one low-frequency REST fallback and requires an explicit timeout decision', async () => {
    vi.useFakeTimers()
    const factory = connectionFactory()
    const refreshRest = vi.fn(async () => undefined)
    const onFallbackChange = vi.fn()
    const onTimeoutChange = vi.fn()
    const onPausedChange = vi.fn()
    const controller = createDetailRealtime(options(factory, {
      refreshRest,
      onFallbackChange,
      onTimeoutChange,
      onPausedChange,
      fallbackIntervalMs: 30_000,
    }))

    controller.start()
    factory.options[0]?.onState('unavailable')
    factory.options[0]?.onState('backoff')
    expect(onFallbackChange.mock.calls).toEqual([[true]])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshRest).toHaveBeenCalledOnce()

    factory.options[0]?.onTimeout()
    expect(onTimeoutChange).toHaveBeenLastCalledWith(true)
    expect(onFallbackChange).toHaveBeenLastCalledWith(false)
    controller.continueAfterTimeout()
    expect(factory.connections).toHaveLength(2)
    expect(onTimeoutChange).toHaveBeenLastCalledWith(false)

    factory.options[1]?.onTimeout()
    controller.pauseAfterTimeout()
    expect(onPausedChange).toHaveBeenLastCalledWith(true)
    controller.dispose()
  })
})
