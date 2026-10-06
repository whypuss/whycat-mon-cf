import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { startBootstrapRequests } from '@/domain/bootstrap'
import { useAppStore } from '@/stores/app'
import { useServersStore } from '@/stores/servers'

const services = vi.hoisted(() => ({
  config: vi.fn<() => Promise<unknown>>(),
  servers: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/services/cfsm', () => ({
  adminUrl: (base: string) => `${base}/admin#admin`,
  getApiBases: () => ['https://monitor.example'],
  fetchSiteConfig: services.config,
  fetchAllServerSources: services.servers,
  // app store 订阅 Turnstile 403 通知（issue #3）；本测试不涉及验证流程。
  onTurnstileRejected: () => () => {},
  verifyTurnstileToken: vi.fn(),
}))

describe('bootstrap request ownership', () => {
  it('shares each in-flight store request with the mounting page', async () => {
    setActivePinia(createPinia())
    const app = useAppStore()
    const servers = useServersStore()
    let resolveConfig = () => {}
    let resolveServers = () => {}
    services.config.mockReturnValue(new Promise((resolve) => {
      resolveConfig = () => resolve({})
    }))
    services.servers.mockReturnValue(new Promise((resolve) => {
      resolveServers = () => resolve({ collections: [], failures: [] })
    }))

    startBootstrapRequests('#/', app.initialize, servers.load)
    const pageConsumers = Promise.all([app.initialize(), servers.load()])
    expect(app.state).toBe('loading')
    expect(servers.state).toBe('loading')
    expect(services.config).toHaveBeenCalledOnce()
    expect(services.servers).toHaveBeenCalledOnce()

    resolveConfig()
    resolveServers()
    await pageConsumers
    expect(app.state).toBe('ready')
    expect(servers.state).toBe('ready')
  })
})
