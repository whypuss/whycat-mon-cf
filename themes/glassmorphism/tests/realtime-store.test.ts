import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeServer } from '@/services/cfsm/adapters'
import { apiSource } from '@/services/cfsm/config'
import { dashboardSampleSettleDelayMs, useRealtimeStore } from '@/stores/realtime'
import { useServersStore } from '@/stores/servers'
import type { ServerCollection } from '@/types/cfsm'

/*
 * 「数据更新间隔」只在 WebSocket 不可用时才被读到，设置页需要如实说明此刻算哪种。
 *
 * 但设置页自己不建实时连接，而离开首页时 `stop()` 会把连接状态清空，于是设置页
 * 什么都读不到。store 因此保留一份「最近一次观察」的快照：它不参与连接逻辑，
 * `stop()` 之后必须还在，否则设置页只能在「未知」和「谎称正常」之间二选一。
 */

const BASE = 'https://status.example'

function collection(): ServerCollection {
  const source = apiSource(BASE)
  return {
    source,
    servers: [normalizeServer({
      id: 'node-1', name: 'Node 1', cpu: 10, is_online: true, last_updated: 1_700_000_000,
    }, source, 1_700_000_000_000)],
    stats: {},
  }
}

/** 惰性的连接桩：建得起来、不会真的连上，足以让 store 跑完一次状态回调。 */
function stubSocket(): void {
  vi.stubGlobal('WebSocket', class {
    static readonly OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((event: { code: number, reason: string }) => void) | null = null
    close(): void {}
    send(): void {}
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard sample settle delay', () => {
  it('uses half the fastest Agent interval without crossing the next report wave', () => {
    expect(dashboardSampleSettleDelayMs([
      { websocketReportInterval: 5 },
      { websocketReportInterval: 2 },
      { websocketReportInterval: null },
    ])).toBe(1_000)
    expect(dashboardSampleSettleDelayMs([{ websocketReportInterval: 1 }])).toBe(500)
    expect(dashboardSampleSettleDelayMs([{ websocketReportInterval: 5 }])).toBe(1_000)
    expect(dashboardSampleSettleDelayMs([{ websocketReportInterval: null }])).toBe(1_000)
    expect(dashboardSampleSettleDelayMs([])).toBe(1_000)
  })
})

describe('realtime status snapshot', () => {
  it('starts with nothing observed rather than claiming a state', () => {
    setActivePinia(createPinia())
    const realtime = useRealtimeStore()
    expect(realtime.lastObservedStatus).toBeNull()
    expect(realtime.lastObservedAt).toBeNull()
  })

  it('keeps the last observed status after leaving the page', () => {
    stubSocket()
    setActivePinia(createPinia())
    const servers = useServersStore()
    servers.collections = [collection()]

    const realtime = useRealtimeStore()
    realtime.start(async () => {})

    // 建连即产生一次状态回调，状态不再是 idle。
    expect(realtime.status).not.toBe('idle')
    const observed = realtime.lastObservedStatus
    expect(observed).not.toBeNull()
    expect(realtime.lastObservedAt).toBeTypeOf('number')

    realtime.stop()

    // 实时状态归零，快照留存——设置页读的正是这一份。
    expect(realtime.status).toBe('idle')
    expect(realtime.lastObservedStatus).toBe(observed)
  })

  it('never records idle as an observation', () => {
    setActivePinia(createPinia())
    const realtime = useRealtimeStore()
    realtime.stop()
    expect(realtime.lastObservedStatus).toBeNull()
  })
})
