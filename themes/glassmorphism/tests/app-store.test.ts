import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSiteConfig } from '@/services/cfsm/adapters'
import { useAppStore } from '@/stores/app'

const BASE = 'https://status.example'

function installLocation(): void {
  vi.stubGlobal('document', {
    querySelector: () => ({ content: BASE }),
  })
  vi.stubGlobal('window', { location: { origin: BASE } })
}

afterEach(() => vi.unstubAllGlobals())

describe('application config initialization', () => {
  it('shares one in-flight /api/config request across concurrent route initializers', async () => {
    installLocation()
    let release: ((response: Response) => void) | undefined
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve
    }))
    vi.stubGlobal('fetch', fetcher)
    setActivePinia(createPinia())
    const app = useAppStore()

    const first = app.initialize()
    const second = app.initialize()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(app.state).toBe('loading')

    release?.(new Response(JSON.stringify({ site_title: '真实站点' }), { status: 200 }))
    await Promise.all([first, second])
    expect(app.config?.siteTitle).toBe('真实站点')
    expect(app.state).toBe('ready')
  })

  it('does not let an older initialization overwrite a newer saved config', async () => {
    installLocation()
    let release: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => {
      release = resolve
    }))
    setActivePinia(createPinia())
    const app = useAppStore()
    const pending = app.initialize()

    app.applyConfig(normalizeSiteConfig({ site_title: '保存后的标题', version: '2.8.5' }))
    release?.(new Response(JSON.stringify({ site_title: '旧标题' }), { status: 200 }))
    await pending

    expect(app.config?.siteTitle).toBe('保存后的标题')
    expect(app.state).toBe('ready')
  })

  it('retains the last real config when a later refresh fails', async () => {
    installLocation()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    setActivePinia(createPinia())
    const app = useAppStore()
    app.applyConfig(normalizeSiteConfig({ site_title: '已加载站点', version: '2.8.5' }))

    await app.initialize()

    expect(app.config?.siteTitle).toBe('已加载站点')
    expect(app.state).toBe('error')
    expect(app.error).toBe('CFSM request could not be completed')
  })
})
