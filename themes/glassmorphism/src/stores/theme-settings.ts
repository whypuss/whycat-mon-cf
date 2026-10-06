import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SiteConfig } from '@/types/cfsm'
import type { DashboardViewMode } from '@/types/glassmorphism'
import {
  CfsmRequestError,
  fetchSiteConfig,
  saveThemeOptions,
  STORAGE_KEYS,
} from '@/services/cfsm'
import {
  cloneThemeSettings,
  createThemeOptionsSnapshot,
  dashboardViewMode,
  dashboardViewPatch,
  DEFAULT_THEME_SETTINGS,
  LEGACY_DASHBOARD_STORAGE_KEY,
  legacyDashboardOverrides,
  normalizeThemeSettingsLayer,
  parseThemeStorageSnapshot,
  resolveThemeMode,
  resolveThemeSettings,
  serializeThemeSettings,
  THEME_SETTINGS_STORAGE_KEY,
  themeSettingsEqual,
  themeStorageSnapshot,
  validateThemeSettingsDraft,
  type ThemeDraftIssue,
  type ThemeMode,
  type ThemeSettings,
} from '@/theme/settings'
import {
  glassSurfaceTokens,
  resolveGlassSurfaces,
  type GlassSurfaces,
} from '@/domain/glass-surfaces'
import {
  backendSiteHint,
  parseSiteThemeHint,
  SITE_THEME_HINT_STORAGE_KEY,
  type SiteThemeHint,
} from '@/theme/site-theme-hint'

export type ThemeSaveState = 'idle' | 'saving' | 'success' | 'error'
export type ThemeSaveErrorKind = 'invalid-format' | 'unauthorized' | 'forbidden' | 'network' | 'unknown'

export interface ThemeSaveFailure {
  kind: ThemeSaveErrorKind
  status: number | null
  code: string | null
  message: string
}

export interface ThemeSaveOptions {
  fetcher?: typeof fetch
  storage?: Storage
  timeoutMs?: number
}

export interface ThemeSaveOutcome {
  saved: boolean
  config: SiteConfig | null
  refetchWarning: string | null
}


/** 去掉记录里的某一个键，返回新对象；原对象不变。 */
function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value }
    : {}
}

function storageTarget(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readStoredValue(key: string, storage?: Storage): string | null {
  try {
    return storageTarget(storage)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function hasStoredJwt(storage?: Storage): boolean {
  const value = readStoredValue(STORAGE_KEYS.jwt, storage)
  return value !== null && value.trim().length > 0
}

function writeStoredOverrides(overrides: Record<string, unknown>, storage?: Storage): boolean {
  try {
    const target = storageTarget(storage)
    if (!target) return false
    target.setItem(THEME_SETTINGS_STORAGE_KEY, JSON.stringify(themeStorageSnapshot(overrides)))
    return true
  } catch {
    return false
  }
}

function readInitialOverrides(storage?: Storage): Record<string, unknown> {
  const stored = parseThemeStorageSnapshot(readStoredValue(THEME_SETTINGS_STORAGE_KEY, storage))
  if (stored) return stored.overrides

  const legacyRaw = readStoredValue(LEGACY_DASHBOARD_STORAGE_KEY, storage)
  let legacy: unknown = null
  if (legacyRaw) {
    try {
      legacy = JSON.parse(legacyRaw) as unknown
    } catch {
      legacy = null
    }
  }
  const migrated = legacyDashboardOverrides(legacy)
  writeStoredOverrides(migrated, storage)
  return migrated
}

function saveFailure(error: unknown): ThemeSaveFailure {
  if (error instanceof CfsmRequestError) {
    const kind: ThemeSaveErrorKind = error.status === 400
      ? 'invalid-format'
      : error.status === 401
        ? 'unauthorized'
        : error.status === 403
          ? 'forbidden'
          : error.status === null && (error.code === 'networkError' || error.code === 'timeout')
            ? 'network'
            : 'unknown'
    return {
      kind,
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }
  return {
    kind: 'unknown',
    status: null,
    code: null,
    message: error instanceof Error ? error.message : 'Unknown theme settings error',
  }
}

function activeSurfaces(settings: ThemeSettings, dark: boolean): GlassSurfaces {
  return resolveGlassSurfaces(
    glassSurfaceTokens(settings.glassColorPreset, settings.glassCustomColors),
    dark,
  )
}

export const useThemeSettingsStore = defineStore('theme-settings', () => {
  const initialized = ref(false)
  const backendRaw = ref<Record<string, unknown>>({})
  const localOverrides = ref<Record<string, unknown>>({})
  // 未配置站点的 preferred_theme 默认为 auto；配置返回前也按系统明暗解析。
  const preferredTheme = ref<'auto' | 'light' | 'dark'>('auto')
  const persisted = ref<ThemeSettings>(cloneThemeSettings(DEFAULT_THEME_SETTINGS))
  const runtime = ref<ThemeSettings>(cloneThemeSettings(DEFAULT_THEME_SETTINGS))
  const draft = ref<ThemeSettings>(cloneThemeSettings(DEFAULT_THEME_SETTINGS))
  const previewing = ref(false)
  const draftIssues = ref<ThemeDraftIssue[]>([])
  const saveState = ref<ThemeSaveState>('idle')
  const saveError = ref<ThemeSaveFailure | null>(null)
  const message = ref<string | null>(null)
  const refetchWarning = ref<string | null>(null)
  const systemDark = ref(false)
  const hasBackendCredential = ref(false)
  const clock = ref(Date.now())
  const siteThemeHint = ref<SiteThemeHint | null>(null)
  const configResolved = ref(false)
  let activeStorage: Storage | undefined
  let mediaQuery: MediaQueryList | null = null
  let storageListenerInstalled = false
  let saveInFlight: Promise<ThemeSaveOutcome> | null = null
  let saveInFlightDraft: ThemeSettings | null = null
  let saveInFlightBase: string | null = null

  const resolvedTheme = computed(() => {
    // 暂存值只影响首次 /api/config 仍未确定时的显示，不修改草稿或三层设置。
    const localMode = localOverrides.value.themeMode
    const pendingMode = localMode === 'auto' ? 'system'
      : localMode === 'beijing' || localMode === 'system' || localMode === 'light' || localMode === 'dark'
        ? localMode
        : siteThemeHint.value?.themeMode ?? runtime.value.themeMode
    return resolveThemeMode(
      configResolved.value ? runtime.value.themeMode : pendingMode,
      systemDark.value,
      new Date(clock.value),
    )
  })
  const viewMode = computed(() => dashboardViewMode(runtime.value))
  const coldStartBackgroundEnabled = computed(() => {
    const local = localOverrides.value.backgroundEnabled
    return typeof local === 'boolean' ? local : siteThemeHint.value?.backgroundEnabled ?? false
  })
  const localOverrideCount = computed(() => Object.keys(localOverrides.value).length)
  const hasLocalOverrides = computed(() => localOverrideCount.value > 0)
  const hasDraftChanges = computed(() => !themeSettingsEqual(draft.value, persisted.value))
  const canSaveDraft = computed(() => draftIssues.value.length === 0 && saveState.value !== 'saving')
  const draftSnapshot = computed(() => createThemeOptionsSnapshot(
    normalizeThemeSettingsLayer(draft.value, persisted.value),
    backendRaw.value,
  ))

  function applyRuntime(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const dark = resolvedTheme.value === 'dark'
    const surfaces = activeSurfaces(runtime.value, dark)

    root.dataset.theme = resolvedTheme.value
    root.dataset.colorVision = runtime.value.colorVisionMode === '色觉友好' ? 'friendly' : 'standard'
    root.dataset.motion = runtime.value.disablePageAnimation ? 'reduced' : 'full'
    root.style.colorScheme = resolvedTheme.value
    /*
     * 预设的表面色驱动两组变量：节点卡（对应上游 `.node-card, .bg-card,
     * [data-slot='card']`），以及控制色与方案文字色（对应上游 `.bg-background`）。
     * 后者在本主题里只有两处消费：激活态的快捷筛选胶囊，和节点数据加载失败时的
     * 「重新加载」（对应上游连接失败提示里的描边「重试」）。文字色只在这几处接管。
     */
    root.style.setProperty('--node-card-surface', surfaces.card)
    root.style.setProperty('--node-card-surface-hover', surfaces.cardHover)
    root.style.setProperty('--node-card-border', surfaces.border)
    root.style.setProperty('--node-card-shadow', surfaces.shadow)
    root.style.setProperty('--control-surface', surfaces.control)
    root.style.setProperty('--glass-text', surfaces.text)
    root.style.setProperty('--glass-muted-text', surfaces.mutedText)
    /*
     * 顶栏、面板、提示框与弹层保持本主题在 `:root` 里已验证的表面色；由 JS 整表覆盖
     * 全局 `--glass*` 会把预设差异扩散到上游没有对应项的界面上。
     *
     * 第 16 轮在同机 Komari 上实测了"上游到底有哪些预设消费者"，纠正了此前按选择器
     * 推断的结论：上游样式表写了 card / header / control 三组规则，但
     * `header { … --glass-*-header … }` 匹配不到任何元素（上游 src/ 内没有 <header>，
     * 运行时实测 0 个），`.bg-background { … --glass-*-control … }` 也匹配不到顶部统计卡
     * ——那些卡片的类是 `bg-background/50` 与 `hover:bg-background`，类名不同，
     * 且 CardX 的 tailwind-merge 会把默认的 `bg-card` 合并掉。真正消费 control 令牌的是
     * 选中态的控制胶囊、对话框输入框与 outline 按钮，首页默认状态下一个都不渲染。
     * 因此预设只驱动上面两组变量；上游其余消费者（财务对话框、自定义时间范围、
     * 健康 / 拓扑 / 对比工具里的选中态等）在本主题里没有对应元素，清单见
     * docs/todo.md TODO-03。
     */
    for (const name of ['--glass', '--glass-strong', '--glass-soft', '--glass-hover', '--glass-border', '--ink', '--muted']) {
      root.style.removeProperty(name)
    }
  }

  function rebuildFromLayers(reseedDraft = false): void {
    persisted.value = resolveThemeSettings(
      backendRaw.value,
      localOverrides.value,
      preferredTheme.value,
    )
    if (reseedDraft || !previewing.value) {
      runtime.value = cloneThemeSettings(persisted.value)
      draft.value = cloneThemeSettings(persisted.value)
      draftIssues.value = []
      previewing.value = false
    }
  }

  function onMediaChange(event: MediaQueryListEvent): void {
    systemDark.value = event.matches
  }

  function initialize(storage?: Storage): void {
    if (initialized.value) return
    activeStorage = storage
    hasBackendCredential.value = hasStoredJwt(storage)
    localOverrides.value = readInitialOverrides(storage)
    siteThemeHint.value = parseSiteThemeHint(readStoredValue(SITE_THEME_HINT_STORAGE_KEY, storage))
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemDark.value = mediaQuery.matches
      mediaQuery.addEventListener('change', onMediaChange)
    }
    if (typeof window !== 'undefined') {
      setInterval(() => {
        clock.value = Date.now()
      }, 60_000)
      if (!storageListenerInstalled) {
        window.addEventListener('storage', (event) => {
          if (event.key === STORAGE_KEYS.jwt) {
            hasBackendCredential.value = typeof event.newValue === 'string' && event.newValue.trim().length > 0
            return
          }
          if (event.key !== THEME_SETTINGS_STORAGE_KEY) return
          localOverrides.value = parseThemeStorageSnapshot(event.newValue)?.overrides ?? {}
          rebuildFromLayers(true)
        })
        storageListenerInstalled = true
      }
    }
    initialized.value = true
    rebuildFromLayers(true)
    applyRuntime()
  }

  function hydrateBackend(
    options: unknown,
    sitePreferredTheme: 'auto' | 'light' | 'dark' = 'auto',
    forceReseed = false,
  ): void {
    backendRaw.value = recordValue(options)
    preferredTheme.value = sitePreferredTheme
    hasBackendCredential.value = hasStoredJwt(activeStorage)
    rebuildFromLayers(forceReseed)
    configResolved.value = true
    try {
      storageTarget(activeStorage)?.setItem(SITE_THEME_HINT_STORAGE_KEY, JSON.stringify({
        version: 1,
        ...backendSiteHint(options, sitePreferredTheme),
      }))
    } catch {
      // 禁用的 localStorage 不妨碍使用刚确认的后端配置。
    }
  }

  /** 冷启动配置明确失败：本次显示恢复默认/本地覆盖，保留磁盘上的旧暂存供下次访问。 */
  function resolveConfigFailure(): void {
    configResolved.value = true
  }

  function previewDraft(): void {
    const changed = !themeSettingsEqual(draft.value, persisted.value)
    draftIssues.value = validateThemeSettingsDraft(draft.value)
    runtime.value = normalizeThemeSettingsLayer(draft.value, persisted.value)
    previewing.value = changed
    if (changed) {
      message.value = null
      saveError.value = null
    }
  }

  function resetDraft(): void {
    draft.value = cloneThemeSettings(persisted.value)
    runtime.value = cloneThemeSettings(persisted.value)
    draftIssues.value = []
    previewing.value = false
    message.value = '已放弃未保存的修改。'
    saveError.value = null
  }

  function persistOverrides(): boolean {
    return writeStoredOverrides(localOverrides.value, activeStorage)
  }

  function setLocalSetting<Key extends keyof ThemeSettings>(
    key: Key,
    value: ThemeSettings[Key],
  ): void {
    localOverrides.value = { ...localOverrides.value, [key]: value }
    persistOverrides()
    previewing.value = false
    rebuildFromLayers(true)
  }

  function setDashboardViewMode(nextViewMode: DashboardViewMode): void {
    localOverrides.value = {
      ...localOverrides.value,
      ...dashboardViewPatch(nextViewMode),
    }
    persistOverrides()
    previewing.value = false
    rebuildFromLayers(true)
  }

  /** 移除某一项的本地覆盖，让它回到后端 / 默认值。 */
  function clearLocalSetting<Key extends keyof ThemeSettings>(key: Key): void {
    if (!(key in localOverrides.value)) return
    localOverrides.value = withoutKey(localOverrides.value, key)
    persistOverrides()
    previewing.value = false
    rebuildFromLayers(true)
  }

  /** 站点自己配置的主题模式：忽略本地覆盖后剩下的那一层。 */
  const siteThemeMode = computed<ThemeMode>(() => (
    configResolved.value
      ? resolveThemeSettings(backendRaw.value, withoutKey(localOverrides.value, 'themeMode'), preferredTheme.value).themeMode
      : siteThemeHint.value?.themeMode ?? backendSiteHint({}, preferredTheme.value).themeMode
  ))

  /** 顶栏按钮写入的本地覆盖；没有覆盖时跟随站点设置。 */
  const themeOverride = computed<'light' | 'dark' | null>(() => {
    const value = localOverrides.value.themeMode
    return value === 'light' || value === 'dark' ? value : null
  })

  /*
   * 顶栏的明暗按钮：跟随站点设置 → 浅色 / 深色 → 另一种 → 回到跟随，共三态。
   *
   * 关键是第一下必须切到**与当前显示相反**的模式。此前按 `beijing → system →
   * light → dark` 轮换，白天点前两三下画面完全不变（两种自动模式与浅色都是浅色），
   * 手机上看起来就像按钮失灵。`beijing` / `system` 属于站点配置，不该由访客在顶栏里逐个翻。
   */
  function cycleTheme(): void {
    const autoDark = resolveThemeMode(siteThemeMode.value, systemDark.value, new Date(clock.value)) === 'dark'
    const opposite: ThemeMode = autoDark ? 'light' : 'dark'
    const sameAsSite: ThemeMode = autoDark ? 'dark' : 'light'
    const current = themeOverride.value
    if (current === null) setLocalSetting('themeMode', opposite)
    else if (current === opposite) setLocalSetting('themeMode', sameAsSite)
    else clearLocalSetting('themeMode')
  }

  function saveLocal(): boolean {
    previewDraft()
    if (draftIssues.value.length > 0) {
      saveState.value = 'error'
      message.value = null
      return false
    }
    const normalized = normalizeThemeSettingsLayer(draft.value, persisted.value)
    localOverrides.value = serializeThemeSettings(normalized)
    const stored = persistOverrides()
    previewing.value = false
    rebuildFromLayers(true)
    saveState.value = 'success'
    saveError.value = null
    refetchWarning.value = null
    message.value = stored
      ? '设置已保存为此浏览器的本地覆盖。'
      : '浏览器不允许保存，这些设置只在当前页面有效。'
    return stored
  }

  function useBackend(): void {
    localOverrides.value = {}
    const stored = persistOverrides()
    previewing.value = false
    rebuildFromLayers(true)
    saveState.value = 'success'
    saveError.value = null
    refetchWarning.value = null
    message.value = stored
      ? '已清除本地覆盖，改用 CFSM 后端配置。'
      : '已改用后端配置，但浏览器不允许清除本地覆盖，刷新后旧设置可能恢复。'
  }

  async function performBackendSave(base: string, options: ThemeSaveOptions = {}): Promise<ThemeSaveOutcome> {
    previewDraft()
    if (draftIssues.value.length > 0) {
      saveState.value = 'error'
      return { saved: false, config: null, refetchWarning: null }
    }

    const normalized = normalizeThemeSettingsLayer(draft.value, persisted.value)
    const submittedDraft = cloneThemeSettings(draft.value)
    const snapshot = createThemeOptionsSnapshot(normalized, backendRaw.value)
    const requestStorage = options.storage ?? activeStorage
    hasBackendCredential.value = hasStoredJwt(requestStorage)
    if (!hasBackendCredential.value) {
      saveState.value = 'error'
      saveError.value = {
        kind: 'unauthorized',
        status: 401,
        code: 'missingJwt',
        message: 'A Bearer JWT is required to save CFSM theme options',
      }
      return { saved: false, config: null, refetchWarning: null }
    }
    saveState.value = 'saving'
    saveError.value = null
    message.value = null
    refetchWarning.value = null

    let result
    try {
      result = await saveThemeOptions(snapshot, base, {
        fetcher: options.fetcher,
        storage: requestStorage,
        timeoutMs: options.timeoutMs,
      })
      if (!result.success) throw new Error(result.message ?? 'CFSM did not confirm the theme settings update')
    } catch (error) {
      saveState.value = 'error'
      saveError.value = saveFailure(error)
      hasBackendCredential.value = hasStoredJwt(requestStorage)
      return { saved: false, config: null, refetchWarning: null }
    }

    backendRaw.value = recordValue(result.themeOptions)
    localOverrides.value = {}
    const localLayerStored = persistOverrides()
    // 后端只确认这次提交的快照；请求途中产生的新编辑不能被成功回包抹掉。
    const draftChangedDuringSave = () => !themeSettingsEqual(draft.value, submittedDraft)
    previewing.value = draftChangedDuringSave()
    rebuildFromLayers(!previewing.value)
    if (previewing.value) previewDraft()
    saveState.value = 'success'
    saveError.value = null
    message.value = localLayerStored
      ? '设置已保存到 CFSM 后端。'
      : '设置已保存到 CFSM 后端，但浏览器不允许清除本地覆盖，刷新后旧设置可能恢复。'

    try {
      const config = await fetchSiteConfig(base, {
        fetcher: options.fetcher,
        storage: requestStorage,
        timeoutMs: options.timeoutMs,
      })
      hydrateBackend(config.themeOptions, config.preferredTheme, !draftChangedDuringSave())
      if (draftChangedDuringSave()) previewDraft()
      message.value = localLayerStored
        ? '已保存到后端，所有设备与访客都会以这套设置为默认。'
        : '已保存到后端，但浏览器不允许清除本地覆盖，刷新后此浏览器的旧设置可能恢复。'
      return { saved: true, config, refetchWarning: null }
    } catch (error) {
      const warning = error instanceof Error ? error.message : 'Unknown config re-fetch error'
      refetchWarning.value = warning
      message.value = localLayerStored
        ? '设置已保存到后端，但重新读取站点配置失败，刷新页面后可以确认最新设置。'
        : '设置已保存到后端，但重新读取配置和清除本地覆盖都没有成功，刷新页面后可以确认最新设置。'
      return { saved: true, config: null, refetchWarning: warning }
    }
  }

  function saveBackend(base: string, options: ThemeSaveOptions = {}): Promise<ThemeSaveOutcome> {
    // 同一草稿的同步双击共用结果；新草稿或新来源必须明确拒绝，保留编辑待重试。
    if (saveInFlight) {
      if (saveInFlightBase === base && saveInFlightDraft && themeSettingsEqual(draft.value, saveInFlightDraft)) {
        return saveInFlight
      }
      previewDraft()
      saveError.value = {
        kind: 'unknown', status: null, code: 'saveInProgress',
        message: '上一次保存还没完成，请稍候再保存。修改仍保留在页面上。',
      }
      return Promise.resolve({ saved: false, config: null, refetchWarning: null })
    }
    saveInFlightDraft = cloneThemeSettings(draft.value)
    saveInFlightBase = base
    const pending = performBackendSave(base, options)
    saveInFlight = pending
    void pending.then(
      () => {
        if (saveInFlight === pending) {
          saveInFlight = null
          saveInFlightDraft = null
          saveInFlightBase = null
        }
      },
      () => {
        if (saveInFlight === pending) {
          saveInFlight = null
          saveInFlightDraft = null
          saveInFlightBase = null
        }
      },
    )
    return pending
  }

  function clearStatus(): void {
    if (saveState.value !== 'saving') saveState.value = 'idle'
    saveError.value = null
    message.value = null
    refetchWarning.value = null
  }

  watch([runtime, resolvedTheme], applyRuntime, { deep: true })

  return {
    initialized,
    configResolved,
    coldStartBackgroundEnabled,
    backendRaw,
    localOverrides,
    persisted,
    runtime,
    draft,
    previewing,
    draftIssues,
    saveState,
    saveError,
    message,
    refetchWarning,
    resolvedTheme,
    viewMode,
    localOverrideCount,
    hasLocalOverrides,
    hasDraftChanges,
    canSaveDraft,
    draftSnapshot,
    hasBackendCredential,
    initialize,
    hydrateBackend,
    resolveConfigFailure,
    previewDraft,
    resetDraft,
    setLocalSetting,
    setDashboardViewMode,
    cycleTheme,
    clearLocalSetting,
    siteThemeMode,
    themeOverride,
    saveLocal,
    useBackend,
    saveBackend,
    clearStatus,
  }
})
