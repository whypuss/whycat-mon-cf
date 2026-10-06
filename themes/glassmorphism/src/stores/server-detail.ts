import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type {
  CfsmRequestIssue,
  CfsmRealtimeSample,
  CfsmServer,
  CfsmSocketState,
  HistoryPoint,
  HistorySeries,
  SiteConfig,
} from '@/types/cfsm'
import {
  classifyCfsmRequestError,
  createDetailRealtime,
  fetchHistory,
  fetchServer,
  fetchServerFromSources,
  fetchSiteConfig,
  mergeRealtimeSample,
  type DetailRealtimeController,
  type HistoryHours,
} from '@/services/cfsm'
import {
  appendLivePoint,
  buildLiveChartRows,
  liveHistoryPoint,
  LIVE_SEED_HOURS,
  seedLivePoints,
} from '@/domain/server-detail'
import { normalizeTimestampMilliseconds } from '@/utils/format'
import { useAppStore } from './app'
import { useThemeSettingsStore } from './theme-settings'

export type DetailLoadState = 'idle' | 'loading' | 'ready' | 'error'
export type HistoryLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/**
 * 按 CFSM `batchUpdate.samples[]` 的顺序逐条回放详情实时数据。
 *
 * 一个 WebSocket 消息可能装着多条由 Agent 按 `wss_report_interval` 采集的样本；这些样本
 * 既要逐条 partial merge，也要逐条进入实时图，不能把整个批次压成最后一个点。时间戳
 * 使用样本自己的采集时间（秒或毫秒均兼容），只有缺失时才退到消息到达时间。
 */
export function mergeDetailLiveSamples(
  server: CfsmServer,
  points: readonly HistoryPoint[],
  samples: readonly CfsmRealtimeSample[],
  receivedAt: number,
): { server: CfsmServer, points: HistoryPoint[], matched: number } {
  let current = server
  let nextPoints = [...points]
  let matched = 0
  for (const sample of samples) {
    if (sample.serverId !== current.id) continue
    current = mergeRealtimeSample(current, sample, receivedAt)
    const timestamp = normalizeTimestampMilliseconds(sample.timestamp) ?? receivedAt
    nextPoints = appendLivePoint(nextPoints, liveHistoryPoint(current, timestamp))
    matched += 1
  }
  return { server: current, points: nextPoints, matched }
}

export const useServerDetailStore = defineStore('server-detail', () => {
  const app = useAppStore()
  const theme = useThemeSettingsStore()
  const server = shallowRef<CfsmServer | null>(null)
  const sourceConfig = shallowRef<SiteConfig | null>(null)
  const sourceConfigState = ref<DetailLoadState>('idle')
  const history = shallowRef<HistorySeries | null>(null)
  /*
   * 默认 1 小时。CFSM 对两类窗口都分桶取样，只是上限不同：大于 1 小时用站点配置的
   * `long_history_points`，不大于 1 小时用服务端常量 160，桶宽都是
   * `max(10 秒, 窗口 / 上限)`，每桶只返回一条记录。1 小时窗口约 23 秒一个桶，
   * 通常宽于节点自己的上报间隔，所以看起来接近全量，但那是数据密度的结果而非接口保证。
   * 两张图共用这一个窗口，冷启动只发一次历史请求。
   */
  const historyHours = ref<HistoryHours>(1)
  /*
   * 「实时」档位：先复用已加载历史的最近 10 分钟，必要时再取一次 10 分钟历史，
   * 随后逐条接续 WebSocket 样本。缓冲随节点切换清空并重新垫底；窗口与条数上限在
   * `domain/server-detail.ts`。
   */
  const liveMode = ref(false)
  const livePoints = ref<HistoryPoint[]>([])
  /*
   * 上游负载图与延迟图各有一条时间范围选择，因为那边是两个独立端点
   * （`/records/load` 与 `/records/ping`）。CFSM 只有一个 `/api/history/all`，
   * 而且同一次响应里负载与 ping 两类序列都在，所以默认没有必要请求两次。
   *
   * 延迟区默认「跟随负载图的时间范围」，直接复用那一份历史，冷启动因此只发一个请求；
   * 只有用户在延迟图上主动选了别的窗口，才单独取一份。窗口重新一致时自动回到跟随。
   */
  const pingFollowsHistory = ref(true)
  const ownPingHistory = shallowRef<HistorySeries | null>(null)
  const ownPingHistoryHours = ref<HistoryHours>(1)
  const state = ref<DetailLoadState>('idle')
  const historyState = ref<HistoryLoadState>('idle')
  const ownPingHistoryState = ref<HistoryLoadState>('idle')
  const issue = ref<CfsmRequestIssue | null>(null)
  const historyIssue = ref<CfsmRequestIssue | null>(null)
  const ownPingHistoryIssue = ref<CfsmRequestIssue | null>(null)
  const refreshIssue = ref<CfsmRequestIssue | null>(null)
  const socketState = ref<CfsmSocketState>('idle')
  const fallbackActive = ref(false)
  const timedOut = ref(false)
  const paused = ref(false)
  const lastRealtimeAt = ref<number | null>(null)
  let realtime: DetailRealtimeController | null = null
  let requestController: AbortController | null = null
  let revision = 0
  /*
   * 每次历史请求单独编号。只比较「窗口是否仍相同」挡不住同窗口的更早一次请求：
   * 1 小时 → 24 小时 → 1 小时时，第一份 1 小时响应最后到达，窗口比较仍然成立，
   * 于是它会盖掉更新的那份；同窗口连续刷新时，一次晚到的失败还会把已经成功的
   * 数据清空并翻成错误态。序号只认「最后一次发起的请求」，成功与失败两条路径同样适用。
   */
  let historySeq = 0
  let pingHistorySeq = 0

  const sourceBase = computed(() => server.value?.source.base ?? null)
  const historyPoints = computed(() => history.value?.points ?? [])
  const pingHistory = computed(() => (pingFollowsHistory.value ? history.value : ownPingHistory.value))
  const pingHistoryHours = computed(() => (pingFollowsHistory.value ? historyHours.value : ownPingHistoryHours.value))
  const pingHistoryState = computed(() => (pingFollowsHistory.value ? historyState.value : ownPingHistoryState.value))
  const pingHistoryIssue = computed(() => (pingFollowsHistory.value ? historyIssue.value : ownPingHistoryIssue.value))
  const pingHistoryPoints = computed(() => pingHistory.value?.points ?? [])
  /** 「实时」缓冲的绘图行：缺口按绝对时间判断，密度差异不算断线。 */
  const liveRows = computed(() => buildLiveChartRows(livePoints.value))
  /*
   * 切换「实时」档位。历史窗口保持不变，回到历史档位时不重新请求；延迟区不跟随，
   * 它仍然画自己的历史窗口。
   *
   * 缓冲是空的时候（刚打开页面就切过来）先取一次最近 10 分钟的历史垫底，否则要等
   * 第一条推送才有东西，看起来像坏了。这份历史与推送样本同源，只是服务端按约 10 秒
   * 一桶聚合过；垫底之后由推送接着往右画。取不到就空着等推送，不编数据。
   */
  async function setLiveMode(enabled: boolean): Promise<void> {
    liveMode.value = enabled
    if (!enabled || livePoints.value.length > 0) return
    const current = server.value
    const controller = requestController
    if (!current || !controller) return
    /*
     * 详情页通常已经有当前历史窗口。先复用其中最近 10 分钟的真实点，切换后立即可见，
     * 避免额外请求尚未返回时把正常页面误显示成“仍在采集”。如果当前历史没有近点，
     * 再读取最密的 10 分钟窗口；WSS 到达的真实样本仍会按时间合并并覆盖同一时刻。
     */
    livePoints.value = seedLivePoints(history.value?.points ?? [], livePoints.value, Date.now())
    if (livePoints.value.length > 0) return
    try {
      const seed = await fetchHistory(current.id, LIVE_SEED_HOURS, current.source.base, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || !liveMode.value) return
      livePoints.value = seedLivePoints(seed.points, livePoints.value, Date.now())
    } catch {
      // 垫底失败不影响实时本身：继续等推送。
    }
  }

  function stopRealtime(): void {
    realtime?.dispose()
    realtime = null
    socketState.value = 'idle'
    fallbackActive.value = false
    timedOut.value = false
    paused.value = false
  }

  function applySamples(samples: readonly CfsmRealtimeSample[]): void {
    const current = server.value
    if (!current) return
    const receivedAt = Date.now()
    const merged = mergeDetailLiveSamples(current, livePoints.value, samples, receivedAt)
    if (merged.matched === 0) return
    server.value = merged.server
    lastRealtimeAt.value = receivedAt
    livePoints.value = merged.points
  }

  function startRealtime(): void {
    stopRealtime()
    const current = server.value
    if (!current) return
    realtime = createDetailRealtime({
      base: current.source.base,
      serverId: current.id,
      timeoutMinutes: sourceConfig.value?.frontendWebsocketTimeoutMinutes ?? 0,
      /* 与首页同一个设置项：只影响 WebSocket 不可用时的 REST 回退刷新间隔。 */
      fallbackIntervalMs: () => theme.runtime.dataUpdateInterval * 1000,
      refreshRest: refreshServer,
      onSamples: applySamples,
      onState: (nextState) => {
        socketState.value = nextState
      },
      onFallbackChange: (active) => {
        fallbackActive.value = active
      },
      onTimeoutChange: (active) => {
        timedOut.value = active
      },
      onPausedChange: (active) => {
        paused.value = active
      },
    })
    realtime.start()
  }

  async function refreshServer(): Promise<void> {
    const current = server.value
    const controller = requestController
    if (!current || !controller) return
    const expectedRevision = revision
    try {
      const refreshed = await fetchServer(current.id, current.source.base, {
        signal: controller.signal,
      })
      if (!controller.signal.aborted && expectedRevision === revision) {
        refreshIssue.value = null
        // WSS 在 REST 请求期间已经推进过快照时，不允许较早的 REST 值回跳覆盖。
        if (server.value !== current) return
        server.value = refreshed
        /*
         * WebSocket 不可用时会退化成 REST 轮询，这条路径同样要往实时缓冲补点，
         * 否则「实时」档位在降级期间会停住不动。间隔随轮询间隔变宽，点仍是真实采样。
         */
        livePoints.value = appendLivePoint(livePoints.value, liveHistoryPoint(refreshed, Date.now()))
      }
    } catch (error) {
      if (controller.signal.aborted || expectedRevision !== revision) return
      const nextIssue = classifyCfsmRequestError(error)
      refreshIssue.value = nextIssue
      if (nextIssue.kind === 'not-found') {
        server.value = null
        issue.value = nextIssue
        state.value = 'error'
        stopRealtime()
      }
      throw error
    }
  }

  async function loadHistory(hours = historyHours.value): Promise<void> {
    const current = server.value
    const controller = requestController
    if (!current || !controller) return
    const rangeChanged = hours !== historyHours.value
    historyHours.value = hours
    // 用户把负载图调回延迟图正在用的窗口时，重新跟随，避免两份相同的历史。
    if (!pingFollowsHistory.value && ownPingHistoryHours.value === hours) {
      pingHistorySeq += 1
      pingFollowsHistory.value = true
      ownPingHistory.value = null
      ownPingHistoryState.value = 'idle'
      ownPingHistoryIssue.value = null
    }
    historyState.value = 'loading'
    historyIssue.value = null
    if (rangeChanged) history.value = null
    const expectedRevision = revision
    const seq = ++historySeq
    const stale = (): boolean => (
      controller.signal.aborted || expectedRevision !== revision || seq !== historySeq
    )
    try {
      const result = await fetchHistory(current.id, hours, current.source.base, {
        signal: controller.signal,
      })
      if (stale()) return
      history.value = result
      historyState.value = result.points.length > 0 ? 'ready' : 'empty'
      if (liveMode.value && livePoints.value.length === 0) {
        livePoints.value = seedLivePoints(result.points, livePoints.value, Date.now())
      }
    } catch (error) {
      if (stale()) return
      historyState.value = 'error'
      historyIssue.value = classifyCfsmRequestError(error)
    }
  }

  async function loadPingHistory(hours: HistoryHours = pingHistoryHours.value): Promise<void> {
    // 与负载图同窗口：复用那一份历史，不再单独请求。
    if (hours === historyHours.value) {
      pingHistorySeq += 1
      pingFollowsHistory.value = true
      ownPingHistory.value = null
      ownPingHistoryState.value = 'idle'
      ownPingHistoryIssue.value = null
      return
    }

    const current = server.value
    const controller = requestController
    if (!current || !controller) return
    const rangeChanged = pingFollowsHistory.value || hours !== ownPingHistoryHours.value
    pingFollowsHistory.value = false
    ownPingHistoryHours.value = hours
    ownPingHistoryState.value = 'loading'
    ownPingHistoryIssue.value = null
    if (rangeChanged) ownPingHistory.value = null
    const expectedRevision = revision
    const seq = ++pingHistorySeq
    // 回到共享窗口也要作废在途的独立请求，否则它晚到时会把图切回独立那份数据。
    const stale = (): boolean => (
      controller.signal.aborted
      || expectedRevision !== revision
      || seq !== pingHistorySeq
      || pingFollowsHistory.value
    )
    try {
      const result = await fetchHistory(current.id, hours, current.source.base, {
        signal: controller.signal,
      })
      if (stale()) return
      ownPingHistory.value = result
      ownPingHistoryState.value = result.points.length > 0 ? 'ready' : 'empty'
    } catch (error) {
      if (stale()) return
      ownPingHistoryState.value = 'error'
      ownPingHistoryIssue.value = classifyCfsmRequestError(error)
    }
  }

  /*
   * 节点归属的后端可能不是应用启动时那一个，所以详情页需要知道「这台节点所在站点」
   * 的配置（WebSocket 超时、站点名、版本、是否已授权）。
   *
   * 但单后端站点上二者就是同一个来源，再请求一次 `/api/config` 拿回的是同一份内容——
   * 冷启动进详情页因此白白多发一个请求。这里在 base 相同时直接复用 app store 已有的配置，
   * 只有多 apiBase 部署、节点来自另一个后端时才真正发请求。
   */
  async function loadSourceConfig(expectedRevision: number): Promise<void> {
    const current = server.value
    const controller = requestController
    if (!current || !controller) return
    sourceConfigState.value = 'loading'

    if (app.primaryBase === current.source.base) {
      // 从首页快速进入详情时，主配置可能仍在途中；复用 app store 的同一请求，
      // 不能为同一个 base 再发一次 `/api/config`。
      if (!app.config && (app.state === 'idle' || app.state === 'loading' || app.state === 'error')) {
        await app.initialize()
      }
      if (controller.signal.aborted || expectedRevision !== revision) return
      if (app.config) {
        sourceConfig.value = app.config
        sourceConfigState.value = 'ready'
        return
      }
      if (app.state === 'error') {
        sourceConfig.value = null
        sourceConfigState.value = 'error'
        return
      }
    }

    try {
      const config = await fetchSiteConfig(current.source.base, { signal: controller.signal })
      if (!controller.signal.aborted && expectedRevision === revision) {
        sourceConfig.value = config
        sourceConfigState.value = 'ready'
      }
    } catch {
      if (!controller.signal.aborted && expectedRevision === revision) {
        sourceConfig.value = null
        sourceConfigState.value = 'error'
      }
    }
  }

  async function open(
    id: string,
    bases: readonly string[],
    preferredBase?: string,
  ): Promise<void> {
    revision += 1
    const expectedRevision = revision
    requestController?.abort('detail changed')
    stopRealtime()
    const controller = new AbortController()
    requestController = controller
    server.value = null
    sourceConfig.value = null
    sourceConfigState.value = 'idle'
    history.value = null
    livePoints.value = []
    ownPingHistory.value = null
    issue.value = null
    historyIssue.value = null
    ownPingHistoryIssue.value = null
    refreshIssue.value = null
    historyState.value = 'idle'
    ownPingHistoryState.value = 'idle'
    lastRealtimeAt.value = null
    state.value = 'loading'

    try {
      const result = await fetchServerFromSources(id, bases, {
        signal: controller.signal,
      }, preferredBase)
      if (controller.signal.aborted || expectedRevision !== revision) return
      server.value = result
      state.value = 'ready'
      const configPromise = loadSourceConfig(expectedRevision)
      const historyPromise = loadHistory(historyHours.value)
      // 跟随负载图时这一份历史已经够用，不再单独请求。
      const pingHistoryPromise = pingFollowsHistory.value
        ? Promise.resolve()
        : loadPingHistory(ownPingHistoryHours.value)
      await configPromise
      if (controller.signal.aborted || expectedRevision !== revision) return
      startRealtime()
      await Promise.all([historyPromise, pingHistoryPromise])
    } catch (error) {
      if (controller.signal.aborted || expectedRevision !== revision) return
      issue.value = classifyCfsmRequestError(error)
      state.value = 'error'
    }
  }

  async function refresh(): Promise<void> {
    await Promise.allSettled([
      refreshServer(),
      loadHistory(historyHours.value),
      pingFollowsHistory.value ? Promise.resolve() : loadPingHistory(ownPingHistoryHours.value),
    ])
  }

  function continueAfterTimeout(): void {
    realtime?.continueAfterTimeout()
  }

  function pauseAfterTimeout(): void {
    realtime?.pauseAfterTimeout()
  }

  function resume(): void {
    realtime?.resume()
  }

  function close(): void {
    revision += 1
    requestController?.abort('detail closed')
    requestController = null
    stopRealtime()
  }

  return {
    server,
    sourceConfig,
    sourceConfigState,
    history,
    historyHours,
    liveMode,
    livePoints,
    liveRows,
    setLiveMode,
    historyPoints,
    pingHistory,
    pingHistoryHours,
    pingHistoryPoints,
    sourceBase,
    state,
    historyState,
    pingHistoryState,
    issue,
    historyIssue,
    pingHistoryIssue,
    refreshIssue,
    socketState,
    fallbackActive,
    timedOut,
    paused,
    lastRealtimeAt,
    open,
    refresh,
    loadHistory,
    loadPingHistory,
    continueAfterTimeout,
    pauseAfterTimeout,
    resume,
    close,
  }
})
