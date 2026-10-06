import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDashboardRealtime,
  type DashboardRealtimeSource,
  type VisibilitySource,
} from '@/services/cfsm/dashboard-realtime'
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
    const connection = {
      close: vi.fn(),
      updateIds: vi.fn(),
    }
    connections.push(connection)
    return connection
  }
  return { options, connections, createSocket }
}

afterEach(() => vi.useRealTimers())

describe('dashboard realtime coordination', () => {
  it.each([false, true])('recovers after two visibility cycles during one REST refresh (dispose=%s)', async (dispose) => {
    const visibility = new FakeVisibility()
    const factory = connectionFactory()
    let finish: (() => void) | undefined
    const refreshRest = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 0,
      refreshRest,
      onSampleBatches: vi.fn(), onSourceState: vi.fn(), onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(), onPausedChange: vi.fn(),
      createSocket: factory.createSocket, documentRef: visibility,
    })
    controller.start()
    for (let i = 0; i < 2; i += 1) {
      visibility.hidden = true
      visibility.emit()
      visibility.hidden = false
      visibility.emit()
    }
    expect(refreshRest).toHaveBeenCalledOnce()
    expect(factory.connections).toHaveLength(1)
    if (dispose) controller.dispose()
    finish?.()
    await vi.waitFor(() => expect(factory.connections).toHaveLength(dispose ? 1 : 2))
    controller.dispose()
  })

  it('creates exactly one connection per API base with only source-owned IDs', () => {
    let sources: DashboardRealtimeSource[] = [
      { base: 'https://a.example', ids: ['a-1', 'same-id'] },
      { base: 'https://b.example', ids: ['b-1', 'same-id'] },
    ]
    const factory = connectionFactory()
    const controller = createDashboardRealtime({
      getSources: () => sources,
      getTimeoutMinutes: () => 20,
      refreshRest: async () => undefined,
      onSampleBatches: vi.fn(),
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
    })

    controller.start()
    expect(factory.options.map(({ base, ids }) => ({ base, ids }))).toEqual([
      { base: 'https://a.example', ids: ['a-1', 'same-id'] },
      { base: 'https://b.example', ids: ['b-1', 'same-id'] },
    ])
    expect(factory.options.every((option) => option.timeoutMinutes === 20)).toBe(true)

    sources = [{ base: 'https://a.example', ids: ['a-2'] }]
    controller.sync()
    expect(factory.connections[0]?.updateIds).toHaveBeenCalledWith(['a-2'])
    expect(factory.connections[1]?.close).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('closes while hidden and waits for REST refresh before reconnecting', async () => {
    const visibility = new FakeVisibility()
    const factory = connectionFactory()
    let finishRefresh: (() => void) | undefined
    const refreshRest = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 0,
      refreshRest,
      onSampleBatches: vi.fn(),
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
      documentRef: visibility,
    })

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

  it('requires an explicit decision after the configured connection lifetime', () => {
    const factory = connectionFactory()
    const onTimeoutChange = vi.fn()
    const onPausedChange = vi.fn()
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 5,
      refreshRest: async () => undefined,
      onSampleBatches: vi.fn(),
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange,
      onPausedChange,
      createSocket: factory.createSocket,
    })

    controller.start()
    factory.options[0]?.onTimeout()
    expect(factory.connections[0]?.close).toHaveBeenCalledOnce()
    expect(onTimeoutChange).toHaveBeenLastCalledWith(true)

    controller.continueAfterTimeout()
    expect(factory.connections).toHaveLength(2)
    expect(onTimeoutChange).toHaveBeenLastCalledWith(false)

    factory.options[1]?.onTimeout()
    controller.pauseAfterTimeout()
    expect(onPausedChange).toHaveBeenLastCalledWith(true)
    expect(factory.connections).toHaveLength(2)
    controller.dispose()
  })

  it('keeps one low-frequency REST fallback after a 503 while WebSocket recovery backs off', async () => {
    vi.useFakeTimers()
    const factory = connectionFactory()
    const unavailable = Object.assign(new Error('temporarilyUnavailable'), { status: 503 })
    const refreshRest = vi.fn(async () => {
      throw unavailable
    })
    const onFallbackChange = vi.fn()
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 0,
      refreshRest,
      onSampleBatches: vi.fn(),
      onSourceState: vi.fn(),
      onFallbackChange,
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
      fallbackIntervalMs: 30_000,
    })

    controller.start()
    factory.options[0]?.onState('unavailable')
    factory.options[0]?.onState('backoff')
    expect(onFallbackChange.mock.calls).toEqual([[true]])

    await vi.advanceTimersByTimeAsync(29_999)
    expect(refreshRest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshRest).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshRest).toHaveBeenCalledTimes(2)
    controller.dispose()
    expect(onFallbackChange).toHaveBeenLastCalledWith(false)
  })

  it('reads the interval when the fallback starts and never polls faster than the push cadence', async () => {
    vi.useFakeTimers()
    const factory = connectionFactory()
    const refreshRest = vi.fn(async () => undefined)
    // 主题设置「数据更新间隔」以秒为单位；1 秒会被压到与服务端推送批次相同的 5 秒下限。
    let seconds = 1
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 0,
      refreshRest,
      onSampleBatches: vi.fn(),
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
      fallbackIntervalMs: () => seconds * 1000,
    })

    controller.start()
    factory.options[0]?.onState('backoff')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(refreshRest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshRest).toHaveBeenCalledOnce()

    // 改设置后不必重建连接：下一次回退启动时读到新值。
    seconds = 20
    factory.options[0]?.onState('open')
    factory.options[0]?.onState('backoff')
    await vi.advanceTimersByTimeAsync(19_999)
    expect(refreshRest).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshRest).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('commits staggered per-node messages once per Agent reporting interval', async () => {
    vi.useFakeTimers()
    const factory = connectionFactory()
    const onSampleBatches = vi.fn()
    const controller = createDashboardRealtime({
      getSources: () => [
        { base: 'https://a.example', ids: ['a-1', 'a-2'] },
        { base: 'https://b.example', ids: ['b-1'] },
      ],
      getTimeoutMinutes: () => 0,
      getSampleSettleDelayMs: () => 1_000,
      refreshRest: async () => undefined,
      onSampleBatches,
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
    })

    controller.start()
    factory.options[0]?.onSamples([{ serverId: 'a-1', timestamp: 1, data: { net_out_speed: 1 } }])
    await vi.advanceTimersByTimeAsync(350)
    factory.options[1]?.onSamples([{ serverId: 'b-1', timestamp: 1, data: { net_out_speed: 2 } }])
    await vi.advanceTimersByTimeAsync(350)
    factory.options[0]?.onSamples([{ serverId: 'a-2', timestamp: 1, data: { net_out_speed: 3 } }])

    await vi.advanceTimersByTimeAsync(299)
    expect(onSampleBatches).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onSampleBatches).toHaveBeenCalledOnce()
    expect(onSampleBatches).toHaveBeenCalledWith([
      {
        base: 'https://a.example',
        samples: [
          { serverId: 'a-1', timestamp: 1, data: { net_out_speed: 1 } },
          { serverId: 'a-2', timestamp: 1, data: { net_out_speed: 3 } },
        ],
      },
      {
        base: 'https://b.example',
        samples: [{ serverId: 'b-1', timestamp: 1, data: { net_out_speed: 2 } }],
      },
    ])

    factory.options[0]?.onSamples([{ serverId: 'a-1', timestamp: 2, data: { net_out_speed: 4 } }])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onSampleBatches).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('drops an unfinished aggregate cycle when the page becomes hidden', async () => {
    vi.useFakeTimers()
    const visibility = new FakeVisibility()
    const factory = connectionFactory()
    const onSampleBatches = vi.fn()
    const controller = createDashboardRealtime({
      getSources: () => [{ base: 'https://a.example', ids: ['a-1'] }],
      getTimeoutMinutes: () => 0,
      getSampleSettleDelayMs: () => 1_000,
      refreshRest: async () => undefined,
      onSampleBatches,
      onSourceState: vi.fn(),
      onFallbackChange: vi.fn(),
      onTimeoutChange: vi.fn(),
      onPausedChange: vi.fn(),
      createSocket: factory.createSocket,
      documentRef: visibility,
    })

    controller.start()
    factory.options[0]?.onSamples([{ serverId: 'a-1', timestamp: 1, data: { cpu: 1 } }])
    visibility.hidden = true
    visibility.emit()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onSampleBatches).not.toHaveBeenCalled()
    controller.dispose()
  })
})
