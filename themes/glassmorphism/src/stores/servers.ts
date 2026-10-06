import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type {
  CfsmRealtimeBatch,
  CfsmRealtimeSample,
  CfsmServer,
  ServerCollection,
  ServerSourceFailure,
  ServerSystemConfig,
} from '@/types/cfsm'
import { fetchAllServerSources, getApiBases, mergeRealtimeSample } from '@/services/cfsm'
import type { LoadState } from './app'

const FIVE_MINUTES_MS = 5 * 60 * 1000

function serverKey(base: string, id: string): string {
  return base + '::' + id
}

function timestampMilliseconds(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export const useServersStore = defineStore('servers', () => {
  const collections = shallowRef<ServerCollection[]>([])
  const state = ref<LoadState>('idle')
  const error = ref<string | null>(null)
  const sourceFailures = ref<ServerSourceFailure[]>([])
  const loadedAt = ref<number | null>(null)
  const lastRealtimeAt = ref<number | null>(null)
  let loadInFlight: Promise<void> | null = null
  let loadRevision = 0
  let pendingRealtimeSamples: Array<{ key: string, sample: CfsmRealtimeSample, receivedAt: number }> | null = null

  const servers = computed<CfsmServer[]>(() => collections.value.flatMap((item) => item.servers))
  const bySourceAndId = computed(() => new Map(
    servers.value.map((server) => [serverKey(server.source.base, server.id), server]),
  ))

  function findServer(base: string, id: string): CfsmServer | undefined {
    return bySourceAndId.value.get(serverKey(base, id))
  }

  /*
   * 站点级展示开关（show_price / show_expire / show_tf）只出现在 `/api/servers`
   * 响应的顶层 `sysConfig` 里，`/api/config` 与 `/api/server` 都不返回它们。
   * 详情页因此需要按 owning source 回来取，否则运营方隐藏这些字段的设置在详情页失效。
   */
  function siteVisibility(base: string): ServerSystemConfig | undefined {
    return collections.value.find((item) => item.source.base === base)?.systemConfig
  }

  function hasLoadedSource(base: string): boolean {
    return collections.value.some((item) => item.source.base === base)
  }

  async function performLoad(bases: string[], expectedRevision: number): Promise<void> {
    // 只重放请求期间实际应用的推送字段；静态字段仍取最新 REST 快照。
    // 字段归属以 mergeRealtimeSample 为唯一准则，不在 store 维护第二份清单。
    const replay: Array<{ key: string, sample: CfsmRealtimeSample, receivedAt: number }> = []
    pendingRealtimeSamples = replay
    state.value = 'loading'
    error.value = null
    sourceFailures.value = []
    try {
      const result = await fetchAllServerSources(bases)
      if (expectedRevision !== loadRevision) return
      const previousByBase = new Map(
        collections.value.map((collection) => [collection.source.base, collection]),
      )
      const replayByKey = new Map<string, typeof replay>()
      for (const entry of replay) {
        const samples = replayByKey.get(entry.key)
        if (samples) samples.push(entry)
        else replayByKey.set(entry.key, [entry])
      }
      const refreshedByBase = new Map(
        result.collections.map((collection) => [collection.source.base, {
          ...collection,
          servers: collection.servers.map((refreshed) => {
            const key = serverKey(collection.source.base, refreshed.id)
            return (replayByKey.get(key) ?? []).reduce(
              (current, entry) => mergeRealtimeSample(current, entry.sample, entry.receivedAt),
              refreshed,
            )
          }),
        }]),
      )
      for (const failure of result.failures) {
        const previous = previousByBase.get(failure.source.base)
        if (previous) refreshedByBase.set(failure.source.base, previous)
      }
      collections.value = bases.flatMap((base) => {
        const collection = refreshedByBase.get(base)
        return collection ? [collection] : []
      })
      sourceFailures.value = result.failures
      if (result.collections.length > 0) loadedAt.value = Date.now()

      if (result.failures.length === 0) {
        state.value = 'ready'
      } else if (collections.value.length > 0) {
        state.value = 'partial'
      } else {
        state.value = 'error'
        error.value = result.failures.map((failure) => failure.message).join('; ')
      }
    } catch (reason) {
      if (expectedRevision !== loadRevision) return
      state.value = collections.value.length > 0 ? 'partial' : 'error'
      error.value = reason instanceof Error ? reason.message : 'Unknown CFSM server error'
    } finally {
      if (pendingRealtimeSamples === replay) pendingRealtimeSamples = null
    }
  }

  function load(bases = getApiBases()): Promise<void> {
    if (loadInFlight) return loadInFlight
    const expectedRevision = ++loadRevision
    const pending = performLoad([...bases], expectedRevision)
    loadInFlight = pending
    void pending.then(
      () => {
        if (loadInFlight === pending) loadInFlight = null
      },
      () => {
        if (loadInFlight === pending) loadInFlight = null
      },
    )
    return pending
  }

  function applyRealtimeBatches(
    batches: readonly CfsmRealtimeBatch[],
    receivedAt = Date.now(),
  ): void {
    const samplesByBase = new Map<string, CfsmRealtimeSample[]>()
    for (const batch of batches) {
      if (batch.samples.length === 0) continue
      const pending = samplesByBase.get(batch.base)
      if (pending) pending.push(...batch.samples)
      else samplesByBase.set(batch.base, [...batch.samples])
    }
    if (samplesByBase.size === 0) return

    let changed = false
    const nextCollections = collections.value.map((collection) => {
      const samples = samplesByBase.get(collection.source.base)
      if (!samples) return collection
      const updated = new Map(collection.servers.map((server) => [server.id, server]))
      let collectionChanged = false
      for (const sample of samples) {
        const current = updated.get(sample.serverId)
        if (!current) continue
        pendingRealtimeSamples?.push({ key: serverKey(collection.source.base, sample.serverId), sample, receivedAt })
        updated.set(sample.serverId, mergeRealtimeSample(current, sample, receivedAt))
        collectionChanged = true
      }
      if (!collectionChanged) return collection
      changed = true
      return {
        ...collection,
        servers: collection.servers.map((server) => updated.get(server.id) ?? server),
      }
    })
    if (!changed) return
    collections.value = nextCollections
    lastRealtimeAt.value = receivedAt
  }

  function applyRealtimeSamples(
    base: string,
    samples: readonly CfsmRealtimeSample[],
    receivedAt = Date.now(),
  ): void {
    applyRealtimeBatches([{ base, samples }], receivedAt)
  }

  function expireStaleServers(now = Date.now()): void {
    let changed = false
    const nextCollections = collections.value.map((collection) => ({
      ...collection,
      servers: collection.servers.map((server) => {
        if (!server.online) return server
        const updatedAt = timestampMilliseconds(server.lastUpdated ?? server.timestamp)
        if (updatedAt === null || (updatedAt <= now + FIVE_MINUTES_MS && now - updatedAt <= FIVE_MINUTES_MS)) {
          return server
        }
        changed = true
        return { ...server, online: false }
      }),
    }))
    if (changed) collections.value = nextCollections
  }

  function clear(): void {
    loadRevision += 1
    loadInFlight = null
    pendingRealtimeSamples = null
    collections.value = []
    state.value = 'idle'
    error.value = null
    sourceFailures.value = []
    loadedAt.value = null
    lastRealtimeAt.value = null
  }

  return {
    collections,
    servers,
    state,
    error,
    sourceFailures,
    loadedAt,
    lastRealtimeAt,
    findServer,
    siteVisibility,
    hasLoadedSource,
    load,
    applyRealtimeBatches,
    applyRealtimeSamples,
    expireStaleServers,
    clear,
  }
})
