import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import DynamicBackground from '@/components/dashboard/DynamicBackground.vue'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { SITE_THEME_HINT_STORAGE_KEY } from '@/theme/site-theme-hint'
import { THEME_SETTINGS_STORAGE_KEY, themeStorageSnapshot } from '@/theme/settings'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

async function renderBackground(): Promise<string> {
  const pinia = getActivePinia()
  if (!pinia) throw new Error('Missing test Pinia')
  return renderToString(createSSRApp(DynamicBackground).use(pinia))
}

describe('cold-start background request gate', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('mounts the default image immediately without a cached custom background', async () => {
    const html = await renderBackground()
    expect(html).toContain('class="dynamic-background"')
    expect(html).toContain('dynamic-background__default')
    expect(html).toContain('default-background-v2')
    expect(html).not.toContain('dynamic-background__media')
  })

  it('mounts the default image immediately when the cached backend switch is false', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'system', backgroundEnabled: false }))
    useThemeSettingsStore().initialize(storage)
    expect(await renderBackground()).toContain('dynamic-background__default')
  })

  it('keeps the background empty with a custom hint before config and while its image loads', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'system', backgroundEnabled: true }))
    const theme = useThemeSettingsStore()
    theme.initialize(storage)
    expect(await renderBackground()).not.toContain('default-background-v2')
    expect(await renderBackground()).not.toContain('dynamic-background__media')
    theme.hydrateBackend({ backgroundEnabled: true, backgroundType: 'image', lightBackgroundUrl: '/custom.jpg' }, 'auto', true)
    const html = await renderBackground()
    expect(html).not.toContain('dynamic-background__media')
    expect(html).not.toContain('default-background-v2')
  })

  it('lets a local background switch override the cached backend switch before config', async () => {
    const disabled = new MemoryStorage()
    disabled.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'system', backgroundEnabled: true }))
    disabled.setItem(THEME_SETTINGS_STORAGE_KEY, JSON.stringify(themeStorageSnapshot({ backgroundEnabled: false })))
    useThemeSettingsStore().initialize(disabled)
    expect(await renderBackground()).toContain('dynamic-background__default')

    setActivePinia(createPinia())
    const enabled = new MemoryStorage()
    enabled.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'system', backgroundEnabled: false }))
    enabled.setItem(THEME_SETTINGS_STORAGE_KEY, JSON.stringify(themeStorageSnapshot({ backgroundEnabled: true, lightBackgroundUrl: '/local.jpg' })))
    useThemeSettingsStore().initialize(enabled)
    const html = await renderBackground()
    expect(html).not.toContain('default-background-v2')
    expect(html).not.toContain('src="/local.jpg"')
  })

  it('treats old theme-only hints as a disabled custom background', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'dark' }))
    useThemeSettingsStore().initialize(storage)
    expect(await renderBackground()).toContain('dynamic-background__default')
  })

  it('keeps the default visible on a first visit while a custom image loads', async () => {
    const theme = useThemeSettingsStore()
    theme.hydrateBackend({ backgroundEnabled: true, backgroundType: 'image', lightBackgroundUrl: '/custom.jpg' }, 'auto', true)
    const html = await renderBackground()
    expect(html).toContain('default-background-v2')
    expect(html).not.toContain('dynamic-background__media')
  })

  it('keeps the default after a confirmed config without custom background', async () => {
    const theme = useThemeSettingsStore()
    theme.hydrateBackend({ backgroundEnabled: false }, 'auto', true)
    const html = await renderBackground()
    expect(html).toContain('dynamic-background__default')
  })

  it('falls back to default after a definite config failure', async () => {
    const theme = useThemeSettingsStore()
    const storage = new MemoryStorage()
    storage.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({ version: 1, themeMode: 'system', backgroundEnabled: true }))
    theme.initialize(storage)
    expect(await renderBackground()).not.toContain('default-background-v2')
    theme.resolveConfigFailure()
    const html = await renderBackground()
    expect(html).toContain('dynamic-background__default')
  })

  it('renders a transparent loading video and the loading layer before video data arrives', async () => {
    useThemeSettingsStore().hydrateBackend({
      backgroundEnabled: true, backgroundType: 'video', lightBackgroundUrl: '/custom.webm',
    }, 'auto', true)
    const html = await renderBackground()
    expect(html).toContain('dynamic-background__loading')
    expect(html).toContain('dynamic-background__media')
    expect(html).toContain('opacity:0')
    expect(html).toContain('preload="auto"')
    expect(html).not.toContain('preload="metadata"')
  })

  it('places a positive overlay outside the default/custom branch and dims the container for negative values', async () => {
    const theme = useThemeSettingsStore()
    theme.hydrateBackend({ backgroundEnabled: false, backgroundOverlay: 50 }, 'auto', true)
    const positive = await renderBackground()
    expect(positive).toContain('dynamic-background__default')
    expect(positive).toContain('dynamic-background__overlay')
    expect(positive).toContain('rgba(0, 0, 0, 0.5)')

    theme.hydrateBackend({ backgroundEnabled: false, backgroundOverlay: -50 }, 'auto', true)
    const negative = await renderBackground()
    expect(negative).toContain('opacity:0.5')
    expect(negative).not.toContain('dynamic-background__overlay')
  })
})
