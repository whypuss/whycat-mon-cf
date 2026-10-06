import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSiteConfig } from '@/services/cfsm/adapters'
import { useAppStore } from '@/stores/app'
import { useServerDetailStore } from '@/stores/server-detail'

/*
 * 详情页的请求预算。
 *
 * CFSM 作者反馈冷启动打开详情页会发两次 `/api/config`。实测属实：一次来自应用引导，
 * 一次来自详情页按「节点归属的后端」再取一次。单后端站点上两次 URL 完全相同，
 * 第二次没有任何新信息，而 `/api/config` 在 CFSM 那边是要花 D1 查询的。
 *
 * 这里锁住两件事：单后端下不再重复请求，且多 apiBase 下仍然按来源单独取——
 * 后者是第二次请求存在的唯一理由，去重不能把它一起去掉。
 */

const BASE = 'https://status.example'
const OTHER = 'https://second.example'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 受控放行的网络桩：历史请求挂起，由测试按任意顺序放行或让它失败。
 * 不用随机延迟碰运气，响应顺序完全由用例决定。
 */
interface Gate {
  calls: string[]
  pending: { url: string, hours: number, resolve: (body: unknown) => void, reject: (error: Error) => void }[]
  release: (hours: number, body?: unknown, which?: 'oldest' | 'newest') => Promise<void>
  fail: (hours: number, which?: 'oldest' | 'newest') => Promise<void>
}

function gateNetwork(): Gate {
  const calls: string[] = []
  const pending: Gate['pending'] = []
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/api/config')) return jsonResponse({ site_title: 'demo', version: '2.8.5' })
    if (url.includes('/api/server?')) return jsonResponse({ id: 'node-1', name: 'Node 1' })
    if (url.includes('/api/history/all')) {
      return new Promise((resolve, reject) => {
        pending.push({
          url,
          hours: Number(new URL(url).searchParams.get('hours')),
          resolve: (body) => resolve(jsonResponse(body)),
          reject: (error) => reject(error),
        })
      })
    }
    return jsonResponse({})
  })
  vi.stubGlobal('WebSocket', class {
    static readonly OPEN = 1
    readyState = 0
    close(): void {}
    send(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  })

  // 请求可能还没发出（open 要先等 /api/server），所以按窗口精确匹配并等它出现。
  // `which` 决定放行同一窗口的哪一次在途请求，用来精确制造「先发的后到」。
  const take = async (hours: number, which: 'oldest' | 'newest' = 'oldest') => {
    for (let tick = 0; tick < 200; tick++) {
      const matches = pending.map((item, index) => ({ item, index })).filter((entry) => entry.item.hours === hours)
      if (matches.length > 0) {
        const chosen = which === 'newest' ? matches.at(-1) : matches.at(0)
        if (chosen) {
          pending.splice(chosen.index, 1)
          return chosen.item
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw new Error('no pending history request for hours=' + hours)
  }

  const settle = async () => {
    for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return {
    calls,
    pending,
    async release(hours, body, which) {
      const entry = await take(hours, which)
      entry.resolve(body ?? [{ timestamp: 1_700_000_000_000, cpu: hours }])
      await settle()
    },
    async fail(hours, which) {
      ;(await take(hours, which)).reject(new Error('network down'))
      await settle()
    },
  }
}

/**
 * 记录请求 URL 并返回各端点的最小合法载荷。
 * `delays` 按 URL 子串设定响应延迟，用来制造乱序返回。
 */
function stubNetwork(delays: Record<string, number> = {}): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    const wait = Object.entries(delays).find(([fragment]) => url.includes(fragment))?.[1]
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    if (url.includes('/api/config')) return jsonResponse({ site_title: 'demo', version: '2.8.5' })
    if (url.includes('/api/server?')) return jsonResponse({ id: 'node-1', name: 'Node 1' })
    if (url.includes('/api/history/all')) {
      const hours = Number(new URL(url).searchParams.get('hours'))
      // 把窗口值编进 cpu，用来断言最终留在 store 里的是哪一次响应。
      return jsonResponse([{ timestamp: Date.now() - 5_000, cpu: hours }])
    }
    return jsonResponse({})
  })
  // 详情页打开后会建立 WebSocket；node 环境下不连真实服务。
  vi.stubGlobal('WebSocket', class {
    static readonly OPEN = 1
    readyState = 0
    close(): void {}
    send(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  })
  return calls
}

function configCalls(calls: readonly string[]): string[] {
  return calls.filter((url) => url.includes('/api/config'))
}

function historyCalls(calls: readonly string[]): string[] {
  return calls.filter((url) => url.includes('/api/history/all'))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detail page request budget', () => {
  it('reuses a still-pending primary config request instead of duplicating it', async () => {
    const calls: string[] = []
    let releaseConfig: ((response: Response) => void) | undefined
    vi.stubGlobal('document', { querySelector: () => ({ content: BASE }) })
    vi.stubGlobal('window', { location: { origin: BASE } })
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/api/config')) {
        return new Promise<Response>((resolve) => {
          releaseConfig = resolve
        })
      }
      if (url.includes('/api/server?')) return jsonResponse({ id: 'node-1', name: 'Node 1' })
      if (url.includes('/api/history/all')) return jsonResponse([])
      return jsonResponse({})
    })
    vi.stubGlobal('WebSocket', class {
      static readonly OPEN = 1
      readyState = 0
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    })
    setActivePinia(createPinia())

    const app = useAppStore()
    const initializing = app.initialize()
    const detail = useServerDetailStore()
    const opening = detail.open('node-1', [BASE])
    await Promise.resolve()
    await Promise.resolve()

    expect(configCalls(calls)).toHaveLength(1)
    releaseConfig?.(jsonResponse({ site_title: '真实站点', version: '2.8.5' }))
    await Promise.all([initializing, opening])
    expect(detail.sourceConfig?.siteTitle).toBe('真实站点')
    expect(configCalls(calls)).toHaveLength(1)
  })

  it('reuses the loaded site config instead of asking /api/config a second time', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])

    expect(configCalls(calls)).toHaveLength(0)
    // 复用而不是跳过：详情页仍然拿得到站点配置。
    expect(detail.sourceConfig).toBe(app.config)
  })

  it('still fetches per source when the node belongs to another API base', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE, OTHER], OTHER)

    expect(configCalls(calls)).toHaveLength(1)
    expect(configCalls(calls)[0]).toContain(OTHER)
    expect(detail.sourceConfig).not.toBe(app.config)
  })

  it('asks for history once, because both charts open on the same window', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])

    expect(historyCalls(calls)).toHaveLength(1)
    expect(historyCalls(calls)[0]).toContain('hours=1')
    expect(detail.history?.points.at(0)?.cpu).toBe(1)
    // 延迟区跟随负载图的窗口，读的是同一份历史。
    expect(detail.historyHours).toBe(1)
    expect(detail.pingHistoryHours).toBe(1)
    expect(detail.pingHistory).toBe(detail.history)
  })

  it('does not let a slower REST refresh roll a newer detail WebSocket sample back', async () => {
    const calls: string[] = []
    let releaseRefresh: ((response: Response) => void) | undefined
    let detailRequests = 0
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/api/server?')) {
        detailRequests += 1
        if (detailRequests === 1) return jsonResponse({ id: 'node-1', name: 'Node 1', cpu: 10 })
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve
        })
      }
      if (url.includes('/api/history/all')) return jsonResponse([])
      return jsonResponse({ site_title: 'demo', version: '2.8.5' })
    })
    class Socket {
      static readonly OPEN = 1
      readyState = 1
      onopen: (() => void) | null = null
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      onclose: ((event: { code: number }) => void) | null = null
      constructor() {
        queueMicrotask(() => this.onopen?.())
      }
      send(): void {}
      close(): void {}
    }
    const sockets: Socket[] = []
    vi.stubGlobal('WebSocket', class extends Socket {
      constructor() {
        super()
        sockets.push(this)
      }
    })
    setActivePinia(createPinia())
    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))
    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])

    const refreshing = detail.refresh()
    await Promise.resolve()
    sockets.at(-1)?.onmessage?.({
      data: JSON.stringify({
        type: 'batchUpdate',
        updates: [{ serverId: 'node-1', samples: [{ ts: 1_700_000_010, data: { cpu: 88 } }] }],
      }),
    })
    releaseRefresh?.(jsonResponse({ id: 'node-1', name: 'Node 1', cpu: 20 }))
    await refreshing

    expect(detail.server?.cpu).toBe(88)
    expect(calls.filter((url) => url.includes('/api/server?'))).toHaveLength(2)
  })

  it('moves both charts together when the load window changes, with one request', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])
    expect(historyCalls(calls)).toHaveLength(1)

    await detail.loadHistory(24)
    expect(historyCalls(calls)).toHaveLength(2)
    expect(historyCalls(calls)[1]).toContain('hours=24')
    expect(detail.historyHours).toBe(24)
    expect(detail.pingHistoryHours).toBe(24)
    expect(detail.pingHistory).toBe(detail.history)
  })

  it('enters live mode immediately from the already loaded real history', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])
    expect(historyCalls(calls)).toHaveLength(1)

    await detail.setLiveMode(true)
    expect(detail.liveMode).toBe(true)
    expect(detail.livePoints).toHaveLength(1)
    expect(detail.livePoints[0]?.cpu).toBe(1)
    // 已有历史足以垫底时，不再额外请求同一份 10 分钟历史。
    expect(historyCalls(calls)).toHaveLength(1)
  })

  it('re-seeds live mode when navigating to another node', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])
    await detail.setLiveMode(true)
    expect(detail.livePoints).toHaveLength(1)

    await detail.open('node-2', [BASE])
    expect(detail.liveMode).toBe(true)
    expect(detail.livePoints).toHaveLength(1)
    expect(historyCalls(calls)).toHaveLength(2)
  })

  it('keeps the newest window when ranges are switched faster than the responses arrive', async () => {
    // 24 小时那次故意慢，6 小时那次立即返回：先发的后到。
    const calls = stubNetwork({ 'hours=24': 60 })
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])

    const slow = detail.loadHistory(24)
    const fast = detail.loadHistory(6)
    await Promise.all([slow, fast])

    // 后发的窗口必须胜出，迟到的 24 小时响应不能覆盖它。
    expect(detail.historyHours).toBe(6)
    expect(detail.historyState).toBe('ready')
    expect(detail.history?.points.at(0)?.cpu).toBe(6)
    expect(historyCalls(calls).filter((url) => url.includes('hours=6'))).toHaveLength(1)
  })

  it('fetches a second window only when the ping chart is moved off the load window', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])
    expect(historyCalls(calls)).toHaveLength(1)

    await detail.loadPingHistory(24)
    expect(historyCalls(calls)).toHaveLength(2)
    expect(historyCalls(calls)[1]).toContain('hours=24')
    expect(detail.pingHistoryHours).toBe(24)
    expect(detail.historyHours).toBe(1)
    expect(detail.pingHistory).not.toBe(detail.history)

    // 调回负载图的窗口：重新复用，不再产生请求。
    await detail.loadPingHistory(1)
    expect(historyCalls(calls)).toHaveLength(2)
    expect(detail.pingHistory).toBe(detail.history)
  })

  /*
   * 指令 4.2 的五个乱序场景。不变量：最后一次有效操作决定显示结果；
   * 旧响应不得覆盖新数据、不得清空新的成功结果、不得把状态翻成错误。
   */
  describe('out-of-order responses', () => {
    async function openGated(gate: Gate) {
      const app = useAppStore()
      app.apiBases = [BASE]
      app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))
      const detail = useServerDetailStore()
      const opening = detail.open('node-1', [BASE])
      await gate.release(1)
      await opening
      return detail
    }

    it('1h to 24h to 1h: the first 1h response lands last and is discarded', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const first = detail.loadHistory(1)
      const middle = detail.loadHistory(24)
      const last = detail.loadHistory(1)

      // 最后那次先回，最早那次最后回。
      await gate.release(1, [{ timestamp: 1_700_000_000_000, cpu: 111 }], 'newest')
      await gate.release(24)
      await gate.release(1, [{ timestamp: 1_700_000_000_000, cpu: 999 }], 'oldest')
      await Promise.all([first, middle, last])

      expect(detail.historyHours).toBe(1)
      expect(detail.history?.points.at(0)?.cpu).toBe(111)
      expect(detail.historyState).toBe('ready')
    })

    it('same window refreshed twice: a late failure cannot wipe the newer success', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const older = detail.loadHistory(1)
      const newer = detail.loadHistory(1)

      await gate.release(1, [{ timestamp: 1_700_000_000_000, cpu: 42 }], 'newest')
      await gate.fail(1, 'oldest')
      await Promise.all([older, newer])

      expect(detail.historyState).toBe('ready')
      expect(detail.history?.points.at(0)?.cpu).toBe(42)
      expect(detail.historyIssue).toBeNull()
    })

    it('retains the last real snapshot when a same-window refresh fails', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)
      expect(detail.history?.points.at(0)?.cpu).toBe(1)

      const refresh = detail.loadHistory(1)
      await gate.fail(1)
      await refresh

      expect(detail.historyState).toBe('error')
      expect(detail.history?.points.at(0)?.cpu).toBe(1)
      expect(detail.historyIssue).not.toBeNull()
    })

    it('clears the old range while a different history window is pending', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const pending = detail.loadHistory(24)
      expect(detail.historyHours).toBe(24)
      expect(detail.history).toBeNull()
      await gate.release(24)
      await pending
      expect(detail.history?.points.at(0)?.cpu).toBe(24)
    })

    it('opening another node discards the response still in flight for the old one', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const abandoned = detail.loadHistory(1)
      const reopening = detail.open('node-2', [BASE])
      // 被弃置那次先回：它的 controller 已被 open 取消，必须丢弃。
      await gate.release(1, [{ timestamp: 1_700_000_000_000, cpu: 777 }], 'oldest')
      await gate.release(1, [{ timestamp: 1_700_000_000_000, cpu: 222 }], 'newest')
      await reopening
      await abandoned

      expect(detail.server?.id).toBe('node-1')
      expect(detail.history?.points.at(0)?.cpu).toBe(222)
      expect(detail.historyState).toBe('ready')
    })

    it('shared to independent and back: the stale independent response is dropped', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const independent = detail.loadPingHistory(24)
      await detail.loadPingHistory(1)
      await gate.release(24, [{ timestamp: 1_700_000_000_000, cpu: 888 }])
      await independent

      expect(detail.pingHistoryHours).toBe(1)
      expect(detail.pingHistory).toBe(detail.history)
      expect(detail.pingHistory?.points.at(0)?.cpu).toBe(1)
    })

    it('independent A to B to A keeps the newest request', async () => {
      const gate = gateNetwork()
      setActivePinia(createPinia())
      const detail = await openGated(gate)

      const a1 = detail.loadPingHistory(6)
      const b = detail.loadPingHistory(12)
      const a2 = detail.loadPingHistory(6)

      await gate.release(6, [{ timestamp: 1_700_000_000_000, cpu: 11 }], 'newest')
      await gate.release(12)
      await gate.release(6, [{ timestamp: 1_700_000_000_000, cpu: 66 }], 'oldest')
      await Promise.all([a1, b, a2])

      expect(detail.pingHistoryHours).toBe(6)
      expect(detail.pingHistory?.points.at(0)?.cpu).toBe(11)
      expect(detail.pingHistoryState).toBe('ready')
    })
  })

  it('asks /api/server once and does not walk the server list', async () => {
    const calls = stubNetwork()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])

    expect(calls.filter((url) => url.includes('/api/server?'))).toHaveLength(1)
    // `/api/servers` 由详情页视图在冷启动时单独取，store 自己不碰它。
    expect(calls.filter((url) => /\/api\/servers(\?|$)/.test(url))).toHaveLength(0)
  })
})

/*
 * 实时连接的累积检查。
 *
 * 本地 mock 服务端没有 `/api/ws`，浏览器实测无法证明「切换节点时旧连接确实关掉了」。
 * 这里换一条证据：把 WebSocket 换成可追踪的桩，驱动真实 store 连开三台节点再关闭，
 * 断言任何时刻最多只有一条未关闭的连接，且离开详情页后一条不剩。
 */
interface TrackedSocket {
  url: string
  closed: boolean
}

function trackSockets(): TrackedSocket[] {
  const sockets: TrackedSocket[] = []
  vi.stubGlobal('WebSocket', class {
    static readonly OPEN = 1
    readyState = 0
    private readonly record: TrackedSocket
    constructor(url: string) {
      this.record = { url, closed: false }
      sockets.push(this.record)
    }

    close(): void {
      this.record.closed = true
    }

    send(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  })
  return sockets
}

const open = (sockets: readonly TrackedSocket[]): TrackedSocket[] => sockets.filter((item) => !item.closed)

describe('realtime connections', () => {
  it('keeps at most one live socket while switching nodes and none after leaving', async () => {
    stubNetwork()
    const sockets = trackSockets()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    for (const id of ['node-1', 'node-2', 'node-3']) {
      await detail.open(id, [BASE])
      expect(open(sockets)).toHaveLength(1)
    }

    expect(sockets).toHaveLength(3)
    expect(sockets.every((item) => item.url.includes('/api/ws'))).toBe(true)

    detail.close()
    expect(open(sockets)).toHaveLength(0)
  })

  it('does not stack a second socket when the same node is opened again', async () => {
    stubNetwork()
    const sockets = trackSockets()
    setActivePinia(createPinia())

    const app = useAppStore()
    app.apiBases = [BASE]
    app.applyConfig(normalizeSiteConfig({ site_title: 'demo', version: '2.8.5' }))

    const detail = useServerDetailStore()
    await detail.open('node-1', [BASE])
    await detail.open('node-1', [BASE])

    expect(sockets).toHaveLength(2)
    expect(open(sockets)).toHaveLength(1)

    detail.close()
    expect(open(sockets)).toHaveLength(0)
  })
})
