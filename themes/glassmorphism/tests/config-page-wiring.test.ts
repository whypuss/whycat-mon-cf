import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeView from '@/views/HomeView.vue'
import ServerDetailView from '@/views/ServerDetailView.vue'
import ThemeSettingsView from '@/views/ThemeSettingsView.vue'
import { normalizeServer } from '@/services/cfsm/adapters'
import { DEFAULT_PROBE_LABELS } from '@/constants/probes'
import { useAppStore } from '@/stores/app'
import { useServerDetailStore } from '@/stores/server-detail'
import { useServersStore } from '@/stores/servers'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import type { SiteConfig } from '@/types/cfsm'

const primary = 'https://primary.example'
const secondary = 'https://secondary.example'

function config(title: string, themeMode: 'light' | 'dark' = 'light'): SiteConfig {
  return {
    version: '2.8.5', latestWorkersVersion: null, latestAgentVersion: null,
    isPublic: true, authorization: false, turnstileEnabled: false,
    turnstileLoginEnabled: false, turnstileSiteKey: null,
    probeLabels: { ...DEFAULT_PROBE_LABELS }, siteTitle: title, preferredTheme: 'auto', defaultLanguage: 'auto',
    // 与上游一致，公告只在正文非空时出现，所以样例同时给出标题与正文。
    themeOptions: { themeMode, alertEnabled: true, alertTitle: '真实公告', alertContent: '公告正文' },
    verified: false, turnstileVerified: null, frontendWebsocketTimeoutMinutes: 5,
    longHistoryPoints: 180, latencyWindow: { points: 20, hours: 2 },
  }
}

async function renderPage(page: typeof HomeView | typeof ServerDetailView | typeof ThemeSettingsView, path: string): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: HomeView }, { path: '/server/:id', name: 'server-detail', component: ServerDetailView }, { path: '/settings', name: 'theme-settings', component: ThemeSettingsView }],
  })
  await router.push(path)
  await router.isReady()
  const pinia = getActivePinia()
  if (!pinia) throw new Error('Missing test Pinia')
  return renderToString(createSSRApp(page).use(pinia).use(router))
}

describe('configuration gates are wired to the three pages', () => {
  afterAll(() => vi.unstubAllGlobals())
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('document', {
      title: '',
      documentElement: {
        dataset: {},
        style: { setProperty: () => {}, removeProperty: () => {}, colorScheme: '' },
      },
    })
  })

  it.each(['idle', 'loading'] as const)('home keeps dependent regions behind skeleton while config is %s', async (state) => {
    const app = useAppStore()
    const servers = useServersStore()
    const theme = useThemeSettingsStore()
    app.apiBases = [primary]
    app.state = state
    servers.state = 'ready'
    theme.runtime.alertEnabled = true
    theme.runtime.alertTitle = '真实公告'
    theme.runtime.alertContent = '公告正文'
    servers.collections = [{
      source: { base: primary, label: '主站' },
      servers: [normalizeServer({ id: 'node', name: '节点' }, { base: primary, label: '主站' })],
      stats: {},
    }]
    const html = await renderPage(HomeView, '/')
    expect(html).toContain('aria-label="正在加载总览"')
    expect(html).toContain('aria-label="正在加载节点"')
    expect(html).not.toContain('general-stage__earth')
    expect(html).not.toContain('class="general-stage')
    expect(html).not.toContain('data-general-card-key')
    expect(html).not.toContain('dashboard-nodes')
    expect(html).not.toContain('真实公告')
    expect(html).not.toContain('admin#admin')
  })

  it.each(['ready', 'error', 'loading'] as const)('home renders with settled or last-good config (%s)', async (state) => {
    const app = useAppStore()
    const servers = useServersStore()
    const theme = useThemeSettingsStore()
    app.apiBases = [primary]
    app.state = state
    app.config = state === 'error' ? null : config('主站')
    app.error = state === 'error' ? 'network failure' : null
    servers.state = 'ready'
    if (state !== 'error') servers.collections = [{
      source: { base: primary, label: '主站' },
      servers: [normalizeServer({ id: 'node', name: '节点' }, { base: primary, label: '主站' })],
      stats: {},
    }]
    theme.runtime.hideEarth = true
    if (app.config) theme.hydrateBackend(app.config.themeOptions)
    const html = await renderPage(HomeView, '/')
    expect(html).not.toContain('aria-label="正在加载总览"')
    expect(html).toContain('overview-grid')
    if (state === 'error') expect(html).toContain('无法读取站点配置')
    else expect(html).toContain('真实公告')
  })

  it.each(['idle', 'loading'] as const)('settings hides form and stats while config is %s', async (state) => {
    const app = useAppStore()
    app.apiBases = [primary]
    app.state = state
    const html = await renderPage(ThemeSettingsView, '/settings')
    expect(html).toContain('aria-label="正在加载主题设置"')
    expect(html).not.toContain('class="settings-layout"')
    expect(html).not.toContain('settings-layer-stats')
  })

  it.each(['ready', 'error', 'loading'] as const)('settings renders form after success, failure or last-good config (%s)', async (state) => {
    const app = useAppStore()
    app.apiBases = [primary]
    app.state = state
    app.config = state === 'error' ? null : config('主站')
    app.error = state === 'error' ? 'network failure' : null
    const html = await renderPage(ThemeSettingsView, '/settings')
    expect(html).not.toContain('aria-label="正在加载主题设置"')
    expect(html).toContain('class="settings-layout"')
    expect(html).toContain('settings-layer-stats')
    if (state === 'error') expect(html).toContain('无法读取站点配置')
  })

  it.each(['idle', 'loading'] as const)('detail keeps metrics behind skeleton while owning config is %s', async (state) => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    app.apiBases = [primary]
    app.state = 'ready'
    app.config = config('主站')
    detail.server = normalizeServer({ id: 'node', name: '节点' }, { base: secondary, label: '副站' })
    detail.state = 'ready'
    detail.sourceConfigState = state
    const html = await renderPage(ServerDetailView, '/server/node?source=https%3A%2F%2Fsecondary.example')
    expect(html).toContain('aria-label="正在加载节点详情"')
    expect(html).not.toContain('detail-topbar__identity')
  })

  it.each(['ready', 'error', 'loading'] as const)('detail uses settled or last-good owning config (%s)', async (state) => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    app.apiBases = [primary, secondary]
    app.state = 'ready'
    app.config = config('主站')
    detail.server = normalizeServer({ id: 'node', name: '节点' }, { base: secondary, label: '副站' })
    detail.state = 'ready'
    detail.sourceConfigState = state
    detail.sourceConfig = state === 'error' ? null : config('副站')
    const html = await renderPage(ServerDetailView, '/server/node?source=https%3A%2F%2Fsecondary.example')
    expect(html).not.toContain('aria-label="正在加载节点详情"')
    expect(html).toContain('detail-topbar__identity')
    expect(html).toContain('副站')
  })

  it('multi-source detail waits for primary theme config after owning source is ready', async () => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    app.apiBases = [primary, secondary]
    app.state = 'loading'
    detail.server = normalizeServer({ id: 'node', name: '节点' }, { base: secondary, label: '副站' })
    detail.state = 'ready'
    detail.sourceConfigState = 'ready'
    detail.sourceConfig = config('副站', 'light')
    const html = await renderPage(ServerDetailView, '/server/node?source=https%3A%2F%2Fsecondary.example')
    expect(html).toContain('aria-label="正在加载节点详情"')
    expect(html).not.toContain('detail-topbar__identity')
  })

  it('multi-source detail uses primary theme settings but keeps the owning title', async () => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    const theme = useThemeSettingsStore()
    app.apiBases = [primary, secondary]
    app.state = 'ready'
    app.config = { ...config('主站', 'dark'), themeOptions: { themeMode: 'dark', detailMetricCardPreset: '状态' } }
    theme.hydrateBackend(app.config.themeOptions, app.config.preferredTheme)
    detail.server = { ...normalizeServer({ id: 'node', name: '节点' }, { base: secondary, label: '副站' }), cpu: 12, price: '10', systemConfig: { showPrice: true } }
    detail.state = 'ready'
    detail.sourceConfigState = 'ready'
    detail.sourceConfig = config('副站', 'light')
    const html = await renderPage(ServerDetailView, '/server/node?source=https%3A%2F%2Fsecondary.example')
    expect(html).not.toContain('aria-label="正在加载节点详情"')
    expect(html).toContain('detail-metric-card--cpuUsage')
    expect(html).not.toContain('detail-metric-card--nodePrice')
    expect(html).toContain('<strong>副站</strong>')
    expect(theme.resolvedTheme).toBe('dark')
  })

  it('primary config failure releases the owning node with default settings', async () => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    const theme = useThemeSettingsStore()
    app.apiBases = [primary, secondary]
    app.state = 'error'
    app.error = 'primary unavailable'
    theme.resolveConfigFailure()
    detail.server = { ...normalizeServer({ id: 'node', name: '节点' }, { base: secondary, label: '副站' }), cpu: 12, price: '10', systemConfig: { showPrice: true } }
    detail.state = 'ready'
    detail.sourceConfigState = 'ready'
    detail.sourceConfig = config('副站', 'dark')
    const html = await renderPage(ServerDetailView, '/server/node?source=https%3A%2F%2Fsecondary.example')
    expect(html).not.toContain('aria-label="正在加载节点详情"')
    expect(html).toContain('detail-metric-card--nodePrice')
    expect(theme.runtime.detailMetricCardPreset).toBe('财务')
  })

  it('single-base detail reuses the primary config without a second source config', async () => {
    const app = useAppStore()
    const detail = useServerDetailStore()
    app.apiBases = [primary]
    app.state = 'ready'
    app.config = config('主站')
    detail.server = normalizeServer({ id: 'node', name: '节点' }, { base: primary, label: '主站' })
    detail.state = 'ready'
    detail.sourceConfigState = 'idle'
    const html = await renderPage(ServerDetailView, '/server/node')
    expect(html).not.toContain('aria-label="正在加载节点详情"')
    expect(html).toContain('<strong>主站</strong>')
    expect(detail.sourceConfig).toBeNull()
  })
})
