import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SiteConfig } from '@/types/cfsm'
import { adminUrl, fetchSiteConfig, getApiBases, onTurnstileRejected, verifyTurnstileToken } from '@/services/cfsm'
import { turnstileChallengeSiteKey } from '@/domain/turnstile'

export type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'error'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown CFSM configuration error'
}

export const useAppStore = defineStore('app', () => {
  const apiBases = ref<string[]>([])
  const config = ref<SiteConfig | null>(null)
  const state = ref<LoadState>('idle')
  const error = ref<string | null>(null)
  let initializeInFlight: Promise<void> | null = null
  let initializeRevision = 0

  const primaryBase = computed(() => apiBases.value[0] ?? null)
  const administrationUrl = computed(() => (
    primaryBase.value ? adminUrl(primaryBase.value) : null
  ))

  /*
   * 全局 Turnstile：请求中途收到 403 时由请求层通知；验证成功后递增 credentialRevision，
   * 各页面据此重新加载自己的数据（加载逻辑仍留在各页面）。
   */
  const turnstileRejected = ref(false)
  const credentialRevision = ref(0)
  const turnstileSiteKey = computed(() => turnstileChallengeSiteKey(config.value, turnstileRejected.value))
  onTurnstileRejected(() => {
    turnstileRejected.value = true
  })

  /**
   * 用组件给出的一次性令牌换取凭据；CFSM 确认后通知各页面重载数据。
   *
   * 换取凭据的 `/api/config` 响应本身就是最新的完整配置，直接采用，不再调用 initialize()：
   * initialize() 会复用验证前发出、可能仍未返回的配置请求，那份结果仍是未验证状态，
   * 会把刚通过的验证误判为失败。applyConfig 同时作废那份旧请求的结果。
   *
   * 顺序：先通知各页面重载，等它们在下一轮更新里把自己的加载状态置为「加载中」，
   * 再撤下验证。冷启动遮罩按页面数据是否就绪退出；若先撤下验证，节点列表仍是验证前的
   * 403 错误状态，遮罩会提前退出、先露出没有数据的页面。
   */
  async function completeTurnstile(token: string): Promise<boolean> {
    const base = primaryBase.value
    if (!base) return false
    const verifiedConfig = await verifyTurnstileToken(base, token)
    if (!verifiedConfig.verified) return false
    credentialRevision.value += 1
    await nextTick()
    applyConfig(verifiedConfig)
    turnstileRejected.value = false
    return true
  }

  async function performInitialize(expectedRevision: number): Promise<void> {
    state.value = 'loading'
    error.value = null

    try {
      apiBases.value = getApiBases()
      const base = apiBases.value[0]
      if (!base) throw new Error('No CFSM API base is configured')
      const nextConfig = await fetchSiteConfig(base)
      if (expectedRevision !== initializeRevision) return
      config.value = nextConfig
      state.value = 'ready'
    } catch (reason) {
      if (expectedRevision !== initializeRevision) return
      // 手动刷新失败时保留上一次真实配置；冷启动本来就是 null，仍按失败态走 fallback。
      state.value = 'error'
      error.value = errorMessage(reason)
    }
  }

  function initialize(): Promise<void> {
    // 首页离开时请求不会被销毁；详情/设置若在它完成前接手，复用同一个配置请求。
    if (initializeInFlight) return initializeInFlight
    const expectedRevision = ++initializeRevision
    const pending = performInitialize(expectedRevision)
    initializeInFlight = pending
    void pending.then(
      () => {
        if (initializeInFlight === pending) initializeInFlight = null
      },
      () => {
        if (initializeInFlight === pending) initializeInFlight = null
      },
    )
    return pending
  }

  function applyConfig(nextConfig: SiteConfig): void {
    // 保存设置后的回读结果比任何更早启动的初始化请求更新。
    initializeRevision += 1
    initializeInFlight = null
    config.value = nextConfig
    state.value = 'ready'
    error.value = null
  }

  return {
    apiBases,
    config,
    state,
    error,
    primaryBase,
    administrationUrl,
    turnstileSiteKey,
    credentialRevision,
    initialize,
    applyConfig,
    completeTurnstile,
  }
})
