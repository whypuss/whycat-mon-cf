import { describe, expect, it, vi } from 'vitest'
import {
  fetchAllServerSources,
  fetchHistory,
  fetchServer,
  fetchServerFromSources,
  fetchServers,
  fetchSiteConfig,
  isHistoryHours,
} from '@/services/cfsm/api'

describe('CFSM REST services', () => {
  it('loads and normalizes /api/config from the selected base', async () => {
    let requested = ''
    const fetcher: typeof fetch = async (input) => {
      requested = String(input)
      return new Response(JSON.stringify({
        site_title: 'Real status',
        version: '2.8.5',
        preferred_theme: 'light',
      }), { status: 200 })
    }

    const config = await fetchSiteConfig('https://status.example', { fetcher })

    expect(requested).toBe('https://status.example/api/config')
    expect(config.siteTitle).toBe('Real status')
    expect(config.version).toBe('2.8.5')
  })

  it('loads /api/servers and preserves source ownership', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      servers: [{ id: 'real-node', name: 'Real node', cpu: 0 }],
      stats: { total: 1 },
    }), { status: 200 })

    const result = await fetchServers('https://a.example', { fetcher }, 1)

    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]?.cpu).toBe(0)
    expect(result.servers[0]?.source).toEqual({
      base: 'https://a.example',
      label: 'a.example #2',
    })
  })

  it('keeps successful API bases when another source returns 503', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      if (url.startsWith('https://b.example')) {
        return new Response('{"message":"temporarilyUnavailable"}', { status: 503 })
      }
      return new Response('{"servers":[{"id":"a-node"}],"stats":{}}', { status: 200 })
    }

    const result = await fetchAllServerSources(
      ['https://a.example', 'https://b.example'],
      { fetcher },
    )

    expect(result.collections).toHaveLength(1)
    expect(result.collections[0]?.servers[0]?.id).toBe('a-node')
    expect(result.failures).toEqual([{
      source: { base: 'https://b.example', label: 'b.example #2' },
      message: 'temporarilyUnavailable',
      status: 503,
      code: 'temporarilyUnavailable',
    }])
  })

  it('accepts a truthful zero-node response', async () => {
    const fetcher: typeof fetch = async () => new Response(
      '{"servers":[],"stats":{"total":0}}',
      { status: 200 },
    )

    const result = await fetchServers('https://status.example', { fetcher })

    expect(result.servers).toEqual([])
    expect(result.stats).toEqual({ total: 0 })
  })

  it('loads 50+ home nodes with one list request and no per-node detail or history calls', async () => {
    const requests: string[] = []
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        servers: Array.from({ length: 64 }, (_, index) => ({ id: `node-${index}` })),
        stats: { total: 64 },
      }), { status: 200 })
    }

    const result = await fetchAllServerSources(['https://status.example'], { fetcher })

    expect(result.collections[0]?.servers).toHaveLength(64)
    expect(requests).toEqual(['https://status.example/api/servers'])
  })

  it('loads detail and history from the owning API base without a list request', async () => {
    const requests: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/api/server?')) {
        return new Response('{"id":"node-a","ping_node_1":0}', { status: 200 })
      }
      return new Response('[{"timestamp":1700000000000,"loss_node_1":null}]', { status: 200 })
    }

    const server = await fetchServer('node-a', 'https://b.example', { fetcher })
    const history = await fetchHistory('node-a', 0.167, 'https://b.example', { fetcher })

    expect(requests).toEqual([
      'https://b.example/api/server?id=node-a',
      'https://b.example/api/history/all?id=node-a&hours=0.167',
    ])
    expect(server.source.base).toBe('https://b.example')
    expect(server.latency.node_1).toBe(0)
    expect(history.source.base).toBe('https://b.example')
    expect(history.points[0]?.packetLoss.node_1).toBeNull()
  })

  it('resolves a direct detail link across configured bases and prefers an explicit owner', async () => {
    const requests: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('https://a.example')) {
        return new Response('{"error":"Server not found"}', { status: 404 })
      }
      return new Response('{"id":"shared-id","name":"B"}', { status: 200 })
    }

    const resolved = await fetchServerFromSources(
      'shared-id',
      ['https://a.example', 'https://b.example'],
      { fetcher },
    )
    expect(resolved.source.base).toBe('https://b.example')
    expect(requests).toHaveLength(2)

    requests.length = 0
    const preferred = await fetchServerFromSources(
      'shared-id',
      ['https://a.example', 'https://b.example'],
      { fetcher },
      'https://b.example',
    )
    expect(preferred.source.base).toBe('https://b.example')
    expect(requests).toEqual(['https://b.example/api/server?id=shared-id'])
  })

  it('only accepts the official CFSM history ranges', () => {
    expect([0.167, 0.5, 1, 6, 12, 24, 48, 96, 168].every(isHistoryHours)).toBe(true)
    expect(isHistoryHours(2)).toBe(false)
    expect(isHistoryHours(720)).toBe(false)
  })

  it('preserves an empty history response as a real empty series', async () => {
    const fetcher: typeof fetch = async () => new Response('[]', { status: 200 })

    const history = await fetchHistory('node-a', 24, 'https://status.example', { fetcher })

    expect(history).toEqual({
      serverId: 'node-a',
      source: { base: 'https://status.example', label: 'status.example' },
      points: [],
    })
  })

  it('rejects invalid server IDs before issuing detail or history requests', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(fetchServer('../invalid id', 'https://status.example', { fetcher }))
      .rejects.toMatchObject({ status: 400, code: 'invalidServerId' })
    await expect(fetchHistory('../invalid id', 24, 'https://status.example', { fetcher }))
      .rejects.toMatchObject({ status: 400, code: 'invalidServerId' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
