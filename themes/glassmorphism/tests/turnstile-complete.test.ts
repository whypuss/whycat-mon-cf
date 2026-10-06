import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'

/*
 * 验证通过后的配置来源：换取凭据的 /api/config 响应本身就是最新配置，直接采用。
 * 不能复用验证前发出、尚未返回的配置请求——那份结果仍是未验证状态，会把刚通过的验证误判为失败。
 */

const services = vi.hoisted(() => ({
  config: vi.fn<() => Promise<unknown>>(),
  verify: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/services/cfsm', () => ({
  adminUrl: (base: string) => `${base}/admin#admin`,
  getApiBases: () => ['https://monitor.example'],
  fetchSiteConfig: services.config,
  onTurnstileRejected: () => () => {},
  verifyTurnstileToken: services.verify,
}))

function siteConfig(verified: boolean) {
  return {
    siteTitle: 'Monitor',
    turnstileEnabled: true,
    turnstileSiteKey: 'site-key',
    verified,
    themeOptions: {},
  }
}

describe('completeTurnstile', () => {
  it('采用换取凭据的响应，不被验证前仍在进行的配置请求误判为失败', async () => {
    setActivePinia(createPinia())
    const app = useAppStore()
    let resolveStale: (value: unknown) => void = () => {}
    services.config.mockReturnValueOnce(new Promise((resolve) => {
      resolveStale = resolve
    }))
    services.verify.mockResolvedValueOnce(siteConfig(true))

    // 验证前发出、仍未返回的配置请求（例如带着过期凭据被拒后重取的公开配置）。
    const stale = app.initialize()
    await expect(app.completeTurnstile('token')).resolves.toBe(true)
    expect(app.config?.verified).toBe(true)
    expect(app.state).toBe('ready')
    expect(app.credentialRevision).toBe(1)

    // 旧请求随后带着未验证的结果返回，也不能覆盖已经采用的最新配置。
    resolveStale(siteConfig(false))
    await stale
    expect(app.config?.verified).toBe(true)
  })

  it('先通知页面重载，等页面进入加载中后才撤下验证', async () => {
    // 冷启动遮罩按页面数据是否就绪退出：若先撤下验证，节点列表仍是验证前的 403 错误状态，
    // 遮罩会提前退出、先露出没有数据的页面。
    setActivePinia(createPinia())
    const app = useAppStore()
    services.config.mockResolvedValueOnce(siteConfig(false))
    await app.initialize()
    const seenWhenNotified: Array<boolean | undefined> = []
    watch(() => app.credentialRevision, () => {
      seenWhenNotified.push(app.config?.verified)
    })
    services.verify.mockResolvedValueOnce(siteConfig(true))
    await expect(app.completeTurnstile('token')).resolves.toBe(true)
    expect(seenWhenNotified).toEqual([false])
    expect(app.config?.verified).toBe(true)
  })

  it('CFSM 未确认时不通知页面重载', async () => {
    setActivePinia(createPinia())
    const app = useAppStore()
    services.config.mockResolvedValueOnce(siteConfig(false))
    await app.initialize()
    services.verify.mockResolvedValueOnce(siteConfig(false))
    await expect(app.completeTurnstile('token')).resolves.toBe(false)
    expect(app.credentialRevision).toBe(0)
  })
})
