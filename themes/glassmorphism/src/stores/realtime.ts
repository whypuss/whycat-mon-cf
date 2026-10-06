import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createDashboardRealtime,
  type DashboardRealtimeController,
} from '@/services/cfsm'
import type { CfsmServer, CfsmSocketState } from '@/types/cfsm'
import { useAppStore } from './app'
import { useServersStore } from './servers'
import { useThemeSettingsStore } from './theme-settings'

export type DashboardRealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'fallback'
  | 'timed-out'
  | 'paused'

const DEFAULT_SAMPLE_SETTLE_DELAY_MS = 1_000

/** 取最快上报周期的一半收集同轮消息，并限制在 250～1000ms，避免跨入下一轮。 */
export function dashboardSampleSettleDelayMs(
  items: readonly Pick<CfsmServer, 'websocketReportInterval'>[],
): number {
  const seconds = items.flatMap((server) => (
    typeof server.websocketReportInterval === 'number'
      && Number.isFinite(server.websocketReportInterval)
      && server.websocketReportInterval > 0
      ? [server.websocketReportInterval]
      : []
  ))
  if (seconds.length === 0) return DEFAULT_SAMPLE_SETTLE_DELAY_MS
  return Math.min(1_000, Math.max(250, Math.min(...seconds) * 500))
}

export const useRealtimeStore = defineStore('realtime', () => {
  const app = useAppStore()
  const servers = useServersStore()
  const theme = useThemeSettingsStore()
  const sourceStates = ref<Record<string, CfsmSocketState>>({})
  const fallbackActive = ref(false)
  const timedOut = ref(false)
  const paused = ref(false)
  /*
   * 首页由 KeepAlive 保留，离开首页后连接照常运行，上面这些状态仍是当前值；
   * 只有首页真正卸载时 stop() 才会清空它们。这一对快照不参与连接逻辑，只记录
   * 「最近一次观察到的结果」，供设置页如实说明「数据更新间隔」当下有没有在用——
   * 没有观察过（例如直接打开设置页、首页从未挂载）就什么都不说。
   */
  const lastObservedStatus = ref<DashboardRealtimeStatus | null>(null)
  const lastObservedAt = ref<number | null>(null)
  let controller: DashboardRealtimeController | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null

  const sourceCount = computed(() => Object.keys(sourceStates.value).length)
  const openSourceCount = computed(() => Object.values(sourceStates.value).filter(
    (state) => state === 'open',
  ).length)
  const status = computed<DashboardRealtimeStatus>(() => {
    if (timedOut.value) return 'timed-out'
    if (paused.value) return 'paused'
    if (fallbackActive.value) return 'fallback'
    if (openSourceCount.value > 0) return 'live'
    if (Object.values(sourceStates.value).some(
      (state) => state === 'connecting' || state === 'backoff',
    )) return 'connecting'
    return 'idle'
  })

  /** 记录当前状态；'idle' 不算观察结果，避免把「还没连」写成一次观察。 */
  function observe(): void {
    if (status.value === 'idle') return
    lastObservedStatus.value = status.value
    lastObservedAt.value = Date.now()
  }

  function stop(): void {
    observe()
    controller?.dispose()
    controller = null
    if (staleTimer !== null) globalThis.clearInterval(staleTimer)
    staleTimer = null
    sourceStates.value = {}
    fallbackActive.value = false
    timedOut.value = false
    paused.value = false
  }

  function start(refreshRest: () => Promise<void>): void {
    stop()
    controller = createDashboardRealtime({
      getSources: () => servers.collections.map((collection) => ({
        base: collection.source.base,
        ids: collection.servers.map((server) => server.id),
      })),
      getTimeoutMinutes: () => app.config?.frontendWebsocketTimeoutMinutes ?? 0,
      /*
       * 主题设置「数据更新间隔」以秒为单位，只作用于 WebSocket 不可用时的 REST 回退
       * 轮询；服务端的推送批次由 CFSM 自己决定，主题改不了。取值函数保证设置改动
       * 下一次回退启动时即生效，不必重建 WebSocket 连接。
       */
      fallbackIntervalMs: () => theme.runtime.dataUpdateInterval * 1000,
      getSampleSettleDelayMs: () => dashboardSampleSettleDelayMs(servers.servers),
      refreshRest,
      onSampleBatches: (batches) => servers.applyRealtimeBatches(batches),
      onSourceState: (base, state) => {
        sourceStates.value = { ...sourceStates.value, [base]: state }
        observe()
      },
      onFallbackChange: (active) => {
        fallbackActive.value = active
        observe()
      },
      onTimeoutChange: (active) => {
        timedOut.value = active
        observe()
      },
      onPausedChange: (active) => {
        paused.value = active
        observe()
      },
    })
    controller.start()
    staleTimer = globalThis.setInterval(() => servers.expireStaleServers(), 30_000)
  }

  function sync(): void {
    controller?.sync()
  }

  function continueAfterTimeout(): void {
    controller?.continueAfterTimeout()
  }

  function pauseAfterTimeout(): void {
    controller?.pauseAfterTimeout()
  }

  function resume(): void {
    controller?.resume()
  }

  return {
    sourceStates,
    sourceCount,
    openSourceCount,
    fallbackActive,
    timedOut,
    paused,
    status,
    lastObservedStatus,
    lastObservedAt,
    start,
    sync,
    continueAfterTimeout,
    pauseAfterTimeout,
    resume,
    stop,
  }
})
