import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import LoadingCover from '@/components/dashboard/LoadingCover.vue'
import HomeView from '@/views/HomeView.vue'
import ServerDetailView from '@/views/ServerDetailView.vue'
import ThemeSettingsView from '@/views/ThemeSettingsView.vue'
import { useAppStore } from '@/stores/app'
import { useServersStore } from '@/stores/servers'
import { useServerDetailStore } from '@/stores/server-detail'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import type { LoadState } from '@/stores/app'
import type { DetailLoadState } from '@/stores/server-detail'
import { coldStartSettled } from '@/domain/bootstrap'

async function render(path: string, configState: LoadState, listState: LoadState = 'idle', detailState: DetailLoadState = 'idle') {
  vi.stubGlobal('document', {
    title: '',
    querySelector: () => null,
    documentElement: {
      dataset: {},
      style: { setProperty: () => {}, removeProperty: () => {}, colorScheme: '' },
    },
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const appStore = useAppStore()
  const servers = useServersStore()
  const detail = useServerDetailStore()
  appStore.state = configState
  servers.state = listState
  detail.state = detailState
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/server/:id', name: 'server-detail', component: ServerDetailView },
      { path: '/settings', name: 'theme-settings', component: ThemeSettingsView },
    ],
  })
  await router.push(path)
  await router.isReady()
  return renderToString(createSSRApp(App).use(pinia).use(router))
}

describe('one-shot cold-start cover', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the header but not the home body while config or the first list is pending', async () => {
    for (const [config, list] of [['loading', 'loading'], ['ready', 'loading']] as const) {
      const html = await render('/', config, list)
      expect(html).toContain('class="loading-cover')
      expect(html).toContain('class="app-header')
      expect(html).not.toContain('class="dashboard"')
      expect(html).not.toContain('正在加载总览')
    }
  })

  it('removes the cover when config and first list have both settled, including errors', async () => {
    const ready = await render('/', 'ready', 'ready')
    expect(ready).not.toContain('class="loading-cover')
    expect(ready).toContain('class="dashboard"')
    const error = await render('/', 'error', 'error')
    expect(error).not.toContain('class="loading-cover')
    expect(error).toContain('无法加载节点')
  })

  it('waits for the first detail response, then reveals the existing error state on failure', async () => {
    const pending = await render('/server/node', 'ready', 'ready', 'loading')
    expect(pending).toContain('class="loading-cover')
    expect(pending).not.toContain('class="detail-page"')
    const failed = await render('/server/node', 'ready', 'ready', 'error')
    // SSR renders the parent's cover before the child's immediate state report.
    // The client schedules the parent update; the pure gate verifies its release.
    expect(coldStartSettled('server-detail', 'ready', 'ready', 'error')).toBe(true)
    expect(failed).toContain('class="detail-page"')
  })

  it('settings only waits for config, not a node-list request', async () => {
    expect(await render('/settings', 'loading')).toContain('class="loading-cover')
    const ready = await render('/settings', 'ready')
    expect(ready).not.toContain('class="loading-cover')
    expect(ready).toContain('class="settings-page"')
  })

  it('uses the compact, textless variant from a cold-start background hint', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const theme = useThemeSettingsStore()
    theme.localOverrides = { backgroundEnabled: true }
    const html = await renderToString(createSSRApp(LoadingCover).use(pinia))
    expect(html).toContain('loading-cover--custom-background')
    expect(html).toContain('loading-cover__spinner--custom')
    expect(html).not.toContain('Loading...')
  })

  it('switches the variant to the resolved site setting after config returns', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const theme = useThemeSettingsStore()
    theme.localOverrides = { backgroundEnabled: true }
    theme.configResolved = true
    theme.runtime = { ...theme.runtime, backgroundEnabled: false }
    const html = await renderToString(createSSRApp(LoadingCover).use(pinia))
    expect(html).not.toContain('loading-cover--custom-background')
    expect(html).toContain('Loading...')
  })

  it('shows only the Turnstile challenge, without spinner or Loading text, while it occupies the cover', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const challenge = await renderToString(createSSRApp({
      render: () => h(LoadingCover, { challenge: true }, () => h('div', { class: 'turnstile-challenge' })),
    }).use(pinia))
    expect(challenge).toContain('class="turnstile-challenge"')
    expect(challenge).not.toContain('loading-cover__spinner')
    expect(challenge).not.toContain('Loading...')

    const loading = await renderToString(createSSRApp(LoadingCover).use(pinia))
    expect(loading).toContain('loading-cover__spinner')
    expect(loading).toContain('Loading...')
  })

  it('uses the dialog overlay only when a mid-session re-verification covers a loaded page', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const midSession = await renderToString(createSSRApp({
      render: () => h(LoadingCover, { challenge: true, modal: true }),
    }).use(pinia))
    expect(midSession).toContain('loading-cover--modal')

    const coldStart = await renderToString(createSSRApp({
      render: () => h(LoadingCover, { challenge: true }),
    }).use(pinia))
    expect(coldStart).not.toContain('loading-cover--modal')
  })
})
