import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import HomeView from '@/views/HomeView.vue'
import { DEFAULT_PROBE_LABELS } from '@/constants/probes'
import { useAppStore } from '@/stores/app'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import type { SiteConfig } from '@/types/cfsm'

const hintKey = 'cfsm-glassmorphism.site-theme-hint.v1'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

async function renderApp(): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/settings', name: 'theme-settings', component: HomeView },
    ],
  })
  await router.push('/')
  await router.isReady()
  const pinia = getActivePinia()
  if (!pinia) throw new Error('Missing test Pinia')
  return renderToString(createSSRApp(App).use(pinia).use(router))
}

function config(mode: 'light' | 'dark'): SiteConfig {
  return {
    version: '2.8.5', latestWorkersVersion: null, latestAgentVersion: null,
    isPublic: true, authorization: false, turnstileEnabled: false,
    turnstileLoginEnabled: false, turnstileSiteKey: null,
    probeLabels: { ...DEFAULT_PROBE_LABELS }, siteTitle: '站点',
    preferredTheme: 'auto', defaultLanguage: 'auto', themeOptions: { themeMode: mode },
    verified: false, turnstileVerified: null, frontendWebsocketTimeoutMinutes: 5,
    longHistoryPoints: 180, latencyWindow: { points: 20, hours: 2 },
  }
}

describe('App wires confirmed config and cold-start failure to the theme hint', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T02:00:00Z'))
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('document', {
      title: '',
      documentElement: {
        dataset: {}, style: { setProperty: () => {}, removeProperty: () => {}, colorScheme: '' },
      },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a failed config request does not keep using or erase the old dark hint', async () => {
    storage.setItem(hintKey, JSON.stringify({ version: 1, themeMode: 'dark' }))
    const app = useAppStore()
    app.state = 'error'
    app.error = 'offline'
    await renderApp()
    expect(useThemeSettingsStore().resolvedTheme).toBe('light')
    expect(JSON.parse(storage.getItem(hintKey) ?? 'null')).toEqual({ version: 1, themeMode: 'dark' })
  })

  it('confirmed config hydrates backend mode and writes only that mode', async () => {
    storage.setItem(hintKey, JSON.stringify({ version: 1, themeMode: 'dark' }))
    const app = useAppStore()
    app.config = config('light')
    app.state = 'ready'
    await renderApp()
    expect(useThemeSettingsStore().resolvedTheme).toBe('light')
    expect(JSON.parse(storage.getItem(hintKey) ?? 'null')).toEqual({ version: 1, themeMode: 'light', backgroundEnabled: false })
  })
})
