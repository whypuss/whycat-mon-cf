import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeServer } from '@/services/cfsm/adapters'
import { apiSource } from '@/services/cfsm/config'
import { useServersStore } from '@/stores/servers'
import type { ServerCollection } from '@/types/cfsm'

function collection(base: string, cpu: number): ServerCollection {
  const source = apiSource(base)
  return {
    source,
    servers: [normalizeServer({
      id: 'same-id',
      name: source.label,
      cpu,
      ram_total: 8192,
      ram_used: 1024,
      disk_total: 100_000,
      disk_used: 50_000,
      is_online: true,
      last_updated: 1_700_000_000,
    }, source, 1_700_000_000_000)],
    stats: {},
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('realtime server store', () => {
  it('merges samples only into the owning API base and preserves missing fields', () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    store.collections = [
      collection('https://a.example', 10),
      collection('https://b.example', 20),
    ]
    expect(store.hasLoadedSource('https://a.example')).toBe(true)
    expect(store.hasLoadedSource('https://missing.example')).toBe(false)

    store.applyRealtimeSamples('https://a.example', [{
      serverId: 'same-id',
      timestamp: 1_700_000_010,
      data: { cpu: 33, ram_used: 2048, ping_node_1: null, loss_node_1: 0 },
    }], 1_700_000_010_000)

    expect(store.findServer('https://a.example', 'same-id')).toMatchObject({
      cpu: 33,
      memoryUsed: 2048,
      memoryTotal: 8192,
      diskTotal: 100_000,
      latency: { node_1: null },
      packetLoss: { node_1: 0 },
    })
    expect(store.findServer('https://b.example', 'same-id')).toMatchObject({
      cpu: 20,
      memoryUsed: 1024,
      latency: { node_1: false },
      packetLoss: { node_1: false },
    })
    expect(store.lastRealtimeAt).toBe(1_700_000_010_000)
  })

  it('applies all API-base batches in one reactive commit', () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    store.collections = [
      collection('https://a.example', 10),
      collection('https://b.example', 20),
    ]
    const commits: unknown[] = []
    const stop = watch(() => store.collections, (value) => commits.push(value), { flush: 'sync' })

    store.applyRealtimeBatches([
      {
        base: 'https://a.example',
        samples: [{ serverId: 'same-id', timestamp: 1, data: { cpu: 11, net_out_speed: 0 } }],
      },
      {
        base: 'https://b.example',
        samples: [{ serverId: 'same-id', timestamp: 1, data: { cpu: 22, ping_node_1: null } }],
      },
    ], 1_700_000_010_000)
    stop()

    expect(commits).toHaveLength(1)
    expect(store.findServer('https://a.example', 'same-id')).toMatchObject({
      cpu: 11,
      networkOutSpeed: 0,
    })
    expect(store.findServer('https://b.example', 'same-id')).toMatchObject({
      cpu: 22,
      latency: { node_1: null },
    })
  })

  it('marks online nodes stale after five minutes without inventing new metrics', () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    store.collections = [collection('https://a.example', 10)]

    store.expireStaleServers(1_700_000_299_000)
    expect(store.servers[0]?.online).toBe(true)
    store.expireStaleServers(1_700_000_301_000)
    expect(store.servers[0]).toMatchObject({ online: false, cpu: 10 })
  })

  it('does not let an older REST list overwrite a WebSocket sample received in flight', async () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    store.collections = [collection('https://a.example', 10)]
    let release: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => {
      release = resolve
    }))

    const loading = store.load(['https://a.example'])
    store.applyRealtimeSamples('https://a.example', [{
      serverId: 'same-id',
      timestamp: 1_700_000_010,
      data: { cpu: 77 },
    }], 1_700_000_010_000)
    release?.(new Response(JSON.stringify({
      servers: [{ id: 'same-id', name: 'Updated REST name', tags: ['new-tag'], cpu: 20, is_online: true }],
      stats: {},
    }), { status: 200 }))
    await loading

    expect(store.servers[0]?.cpu).toBe(77)
    expect(store.servers[0]).toMatchObject({ name: 'Updated REST name', tags: ['new-tag'] })
    expect(store.state).toBe('ready')
  })

  it('shares one in-flight server list request across route consumers', async () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    let release: ((response: Response) => void) | undefined
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve
    }))
    vi.stubGlobal('fetch', fetcher)

    const first = store.load(['https://a.example'])
    const second = store.load(['https://a.example'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    release?.(new Response('{"servers":[],"stats":{}}', { status: 200 }))
    await Promise.all([first, second])

    expect(store.state).toBe('ready')
    expect(store.collections).toHaveLength(1)
  })

  it('does not let an in-flight server list repopulate the store after clear', async () => {
    setActivePinia(createPinia())
    const store = useServersStore()
    let release: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => {
      release = resolve
    }))

    const loading = store.load(['https://a.example'])
    store.clear()
    release?.(new Response(JSON.stringify({
      servers: [{ id: 'stale-id', name: 'stale node', is_online: true }],
      stats: {},
    }), { status: 200 }))
    await loading

    expect(store.state).toBe('idle')
    expect(store.collections).toEqual([])
    expect(store.servers).toEqual([])
  })
})
