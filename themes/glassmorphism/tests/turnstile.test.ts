import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnstileChallengeSiteKey } from '@/domain/turnstile'
import {
  fetchSiteConfig,
  isTurnstileApi,
  onTurnstileRejected,
  removeTurnstileWidget,
  requestTurnstileToken,
  STORAGE_KEYS,
  TURNSTILE_SCRIPT_SRC,
  verifyTurnstileToken,
  cfsmGet,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from '@/services/cfsm'

/*
 * issue #3：CFSM 开启全局 Turnstile 后主题无法加载数据（403）。
 * 主题此前从不渲染人机验证组件，访客没有凭据时所有数据请求都被拒绝且无法恢复。
 * 修复按 CFSM 默认前端的流程：公开的 /api/config 告知 site key → 渲染官方组件取得令牌 →
 * 经 /api/config 换取凭据 → 之后的请求带凭据；凭据过期（403）时重新验证。
 */

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const BASE = 'https://status.example'
const PUBLIC_CONFIG = { turnstile_enabled: true, turnstile_site_key: 'site-key', verified: false, site_title: 'Example' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('是否需要人机验证', () => {
  const config = { turnstileEnabled: true, turnstileSiteKey: 'site-key', verified: false }

  it('开启全局 Turnstile 且本次配置未确认验证时返回 site key', () => {
    expect(turnstileChallengeSiteKey(config, false)).toBe('site-key')
  })

  it('已验证时不需要；请求中途收到 403 时重新需要', () => {
    expect(turnstileChallengeSiteKey({ ...config, verified: true }, false)).toBeNull()
    expect(turnstileChallengeSiteKey({ ...config, verified: true }, true)).toBe('site-key')
  })

  it('未开启、缺少 site key 或还没有配置时不渲染', () => {
    expect(turnstileChallengeSiteKey({ ...config, turnstileEnabled: false }, true)).toBeNull()
    expect(turnstileChallengeSiteKey({ ...config, turnstileSiteKey: '  ' }, false)).toBeNull()
    expect(turnstileChallengeSiteKey(null, true)).toBeNull()
  })
})

describe('Turnstile 官方组件', () => {
  it('只认带 render 函数的全局对象', () => {
    expect(isTurnstileApi({ render: () => 'id' })).toBe(true)
    expect(isTurnstileApi({ render: 'nope' })).toBe(false)
    expect(isTurnstileApi(null)).toBe(false)
  })

  it('只注入一次官方脚本，加载后得到全局 API；失败后允许重试', async () => {
    const { loadTurnstileScript } = await import('@/services/cfsm/turnstile')
    const appended: Array<{ src: string, async: boolean, onload: (() => void) | null, onerror: (() => void) | null }> = []
    const doc = {
      createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      head: { appendChild: (node: (typeof appended)[number]) => { appended.push(node) } },
    } as unknown as Document

    const failing = loadTurnstileScript(doc)
    expect(appended).toHaveLength(1)
    expect(appended[0]?.src).toBe(TURNSTILE_SCRIPT_SRC)
    expect(appended[0]?.async).toBe(true)
    appended[0]?.onerror?.()
    await expect(failing).rejects.toThrow('failed to load')

    const first = loadTurnstileScript(doc)
    const second = loadTurnstileScript(doc)
    expect(second).toBe(first)
    expect(appended).toHaveLength(2)
    const api: TurnstileApi = { render: () => 'widget' }
    vi.stubGlobal('turnstile', api)
    appended[1]?.onload?.()
    await expect(first).resolves.toBe(api)
    await expect(loadTurnstileScript(doc)).resolves.toBe(api)
    expect(appended).toHaveLength(2)
  })

  it('完成验证时得到令牌，出错或过期时拒绝', async () => {
    let options: TurnstileRenderOptions | undefined
    const api: TurnstileApi = { render: (_container, renderOptions) => { options = renderOptions } }
    const container = {} as unknown as HTMLElement

    const token = requestTurnstileToken(api, container, 'site-key', 'dark')
    expect(options?.sitekey).toBe('site-key')
    // 配色跟随主题解析出的明暗，站点强制深色而系统是浅色时组件也是深色。
    expect(options?.theme).toBe('dark')
    options?.callback('token-value')
    await expect(token).resolves.toBe('token-value')

    const failed = requestTurnstileToken(api, container, 'site-key', 'light')
    expect(options?.theme).toBe('light')
    options?.['error-callback']()
    await expect(failed).rejects.toThrow('challenge failed')

    const expired = requestTurnstileToken(api, container, 'site-key', 'light')
    options?.['expired-callback']()
    await expect(expired).rejects.toThrow('expired')
  })

  it('把组件 ID 交给调用方，清理时调用官方 remove 并忽略失效 ID', () => {
    const removed: string[] = []
    const api: TurnstileApi = {
      render: () => 'cf-chl-widget-1',
      remove: (widgetId) => {
        removed.push(widgetId)
        if (widgetId === 'stale') throw new Error('Nothing to remove found for stale')
      },
    }
    const rendered: string[] = []
    void requestTurnstileToken(api, {} as unknown as HTMLElement, 'site-key', 'light', (id) => rendered.push(id))
    expect(rendered).toEqual(['cf-chl-widget-1'])

    removeTurnstileWidget(api, 'cf-chl-widget-1')
    expect(() => removeTurnstileWidget(api, 'stale')).not.toThrow()
    expect(removed).toEqual(['cf-chl-widget-1', 'stale'])
    // 没有 remove 的替身（或渲染失败没拿到 ID）时什么也不做。
    expect(() => removeTurnstileWidget({ render: () => undefined }, 'any')).not.toThrow()
  })
})

describe('凭据与 /api/config', () => {
  it('本地凭据过期导致 403 时，不带验证头重取公开配置', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.turnstileVerified, 'stale')
    const seen: Array<string | null> = []
    const fetcher: typeof fetch = async (_input, init) => {
      const verified = new Headers(init?.headers).get('X-Turnstile-Verified')
      seen.push(verified)
      return verified ? json({ error: 'Turnstile verification failed' }, 403) : json(PUBLIC_CONFIG)
    }

    const config = await fetchSiteConfig(BASE, { storage, fetcher })
    expect(seen).toEqual(['stale', null])
    expect(config).toMatchObject({ turnstileEnabled: true, turnstileSiteKey: 'site-key', verified: false })
    expect(storage.getItem(STORAGE_KEYS.turnstileVerified)).toBeNull()
  })

  it('其它错误不重试', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return json({ error: 'boom' }, 500)
    }
    await expect(fetchSiteConfig(BASE, { storage: new MemoryStorage(), fetcher })).rejects.toMatchObject({ status: 500 })
    expect(calls).toBe(1)
  })

  it('用令牌换取凭据：请求带令牌，保存返回的凭据并清除一次性令牌', async () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.jwt, 'jwt-value')
    let headers = new Headers()
    const fetcher: typeof fetch = async (_input, init) => {
      headers = new Headers(init?.headers)
      return json({ ...PUBLIC_CONFIG, verified: true, turnstile_verified: 'issued' })
    }

    const config = await verifyTurnstileToken(BASE, 'token-value', { storage, fetcher })
    expect(headers.get('X-Turnstile-Token')).toBe('token-value')
    expect(headers.has('Authorization')).toBe(false)
    expect(config.verified).toBe(true)
    expect(storage.getItem(STORAGE_KEYS.turnstileVerified)).toBe('issued')
    expect(storage.getItem(STORAGE_KEYS.turnstileToken)).toBeNull()
  })

  it('403 会通知订阅方，取消订阅后不再通知', async () => {
    const listener = vi.fn()
    const unsubscribe = onTurnstileRejected(listener)
    const fetcher: typeof fetch = async () => json({ error: 'Turnstile verification failed' }, 403)
    await expect(cfsmGet('/api/servers', { base: BASE, storage: new MemoryStorage(), fetcher })).rejects.toMatchObject({ status: 403 })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    await expect(cfsmGet('/api/servers', { base: BASE, storage: new MemoryStorage(), fetcher })).rejects.toMatchObject({ status: 403 })
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('页面接线', () => {
  const appView = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const homeView = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')
  const detailView = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')
  const challengeView = readFileSync(new URL('../src/components/dashboard/TurnstileChallenge.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start))
  }

  it('需要验证时遮罩不退出，并在遮罩里渲染验证组件', () => {
    expect(appView).toContain('app.turnstileSiteKey === null')
    expect(appView).toContain('<LoadingCover v-if="coverVisible || app.turnstileSiteKey !== null" :challenge="app.turnstileSiteKey !== null" :modal="!coverVisible">')
    expect(appView).toContain(':site-key="app.turnstileSiteKey"')
    expect(challengeView).toContain('requestTurnstileToken(api, target, props.siteKey, theme.resolvedTheme, (id) => {')
  })

  it('重试和卸载前先移除官方组件，卸载后不再渲染', () => {
    // Turnstile 找不到被直接移除的容器时会警告「consider using turnstile.remove()」。
    expect(challengeView).toMatch(/removeWidget\(\)\n\s+target\.replaceChildren\(\)/)
    expect(challengeView).toMatch(/onBeforeUnmount\(\(\) => \{\n\s+active = false\n\s+removeWidget\(\)/)
    expect(challengeView).toMatch(/await loadTurnstileScript\(\)\n(?:\s+\/\/.*\n)*\s+if \(!active\) return/)
  })

  it('浏览中途重新验证时换用 AppDialog 的遮罩，验证内容放在弹窗面板里', () => {
    const overlay = rule('.app-dialog__overlay')
    const modal = rule(".loading-cover.loading-cover--modal,\n:root:not([data-theme='dark']) .loading-cover.loading-cover--modal")
    for (const declaration of ['background: oklab(0 0 0 / 45%);', 'backdrop-filter: blur(2px);']) {
      expect(overlay).toContain(declaration)
      expect(modal).toContain(declaration)
    }
    // 同等优先级下后写的生效：必须排在自定义背景变体之后。
    expect(css.indexOf('.loading-cover.loading-cover--modal')).toBeGreaterThan(
      css.indexOf(":root:not([data-theme='dark']) .loading-cover.loading-cover--custom-background"),
    )

    const panel = rule('.turnstile-challenge')
    for (const token of ['var(--dialog-surface)', 'var(--dialog-border)', 'var(--radius)', 'var(--ink)']) {
      expect(panel).toContain(token)
    }
    const widget = rule('.turnstile-challenge__widget')
    expect(widget).toContain('min-width: 300px;')
    expect(widget).toContain('min-height: 65px;')
    expect(css).toContain('.turnstile-challenge--failed .turnstile-challenge__widget:empty {')
  })

  it('验证通过后首页与详情页重新拉取数据', () => {
    // 首页必须走手动刷新的同一路径（REST + realtime.sync()）：验证前列表为空，
    // 只拉 REST 不同步的话实时连接一直不会建立。
    expect(homeView.replace(/\r\n/g, '\n')).toMatch(/watch\(\(\) => app\.credentialRevision, \(\) => \{\n\s+void refresh\(\)\n\}\)/)
    expect(homeView.replace(/\r\n/g, '\n')).toMatch(/async function refresh\(\): Promise<void> \{\n\s+await refreshRest\(\)\n\s+realtime\.sync\(\)/)
    expect(detailView).toContain('watch(() => app.credentialRevision')
    expect(detailView).toContain('server.value ? refresh() : loadCurrent()')
    expect(detailView).toContain('if (serverStore.collections.length === 0) void serverStore.load()')
  })
})
