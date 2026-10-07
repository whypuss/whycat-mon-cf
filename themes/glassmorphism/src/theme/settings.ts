import type { DashboardThemeMode, DashboardViewMode } from '@/types/glassmorphism'

export const THEME_SETTINGS_STORAGE_KEY = 'cfsm-glassmorphism.theme-options.v1'
export const LEGACY_DASHBOARD_STORAGE_KEY = 'cfsm-glassmorphism.dashboard.v1'
export const THEME_SETTINGS_STORAGE_VERSION = 1

export type ThemeMode = 'beijing' | DashboardThemeMode
export type NodeCardSize = 'mini' | 'compact' | 'comfortable' | 'large'
export type GlassColorPreset = '翡翠' | '柔和' | '高对比' | '午夜' | '自定义'
export type ColorVisionMode = '标准' | '色觉友好'
export type EarthRenderer = 'realistic' | 'cobe' | 'tiled'
export type BackgroundType = 'image' | 'video'

export interface ThemeSettings {
  themeMode: ThemeMode
  dataUpdateInterval: number
  rpcTransportMode: 'http'
  defaultViewMode: 'card' | 'list' | 'ring'
  nodeCardSize: NodeCardSize
  alertEnabled: boolean
  alertTitle: string
  alertContent: string
  stopEarth: boolean
  earthRenderer: EarthRenderer
  hideEarth: boolean
  hideGeneralCard: boolean
  visitorInfoEnabled: false
  glassColorPreset: GlassColorPreset
  colorVisionMode: ColorVisionMode
  glassCustomColors: string
  generalCardPreset: '官方' | '基础' | '运维' | '资源' | '财务' | '流量' | 'GPU' | '资产' | '完整' | '自定义'
  generalCardKeys: string
  homeToolsEnabled: boolean
  hideAdminEntryWhenLoggedOut: boolean
  hidePriceWhenLoggedOut: boolean
  providerAliases: string
  exportSecondaryPassword: string
  disablePageAnimation: boolean
  homeQuickControlsEnabled: boolean
  homeQuickControlPreset: '基础' | '流量' | '运维' | '完整' | '自定义'
  homeQuickControlKeys: string
  nodeListMetadataEnabled: boolean
  nodeListMetadataFields: string
  nodeListCustomTagsVisible: boolean
  offlineNodesLast: boolean
  homeHighLoadThreshold: number
  homeTrafficWarningThreshold: number
  homeExpiringDays: number
  diskPredictionEnabled: boolean
  diskPredictionThresholdDays: number
  nodeDetailSectionTabsEnabled: boolean
  detailMetricCardPreset: '财务' | '状态' | '资源' | '网络' | 'GPU' | '综合' | '自定义'
  detailMetricCardKeys: string
  gpuChartEnabled: boolean
  chartDashboardPreset: '默认' | '精简' | '资源' | '网络' | 'GPU' | '延迟' | '运维' | '完整' | '自定义'
  chartDashboardTemplate: string
  backgroundEnabled: boolean
  backgroundType: BackgroundType
  lightBackgroundUrl: string
  darkBackgroundUrl: string
  backgroundBlur: number
  backgroundOverlay: number
}

export const THEME_SETTING_KEYS = [
  'themeMode',
  'dataUpdateInterval',
  'rpcTransportMode',
  'defaultViewMode',
  'nodeCardSize',
  'alertEnabled',
  'alertTitle',
  'alertContent',
  'stopEarth',
  'earthRenderer',
  'hideEarth',
  'hideGeneralCard',
  'visitorInfoEnabled',
  'glassColorPreset',
  'colorVisionMode',
  'glassCustomColors',
  'generalCardPreset',
  'generalCardKeys',
  'homeToolsEnabled',
  'hideAdminEntryWhenLoggedOut',
  'hidePriceWhenLoggedOut',
  'providerAliases',
  'exportSecondaryPassword',
  'disablePageAnimation',
  'homeQuickControlsEnabled',
  'homeQuickControlPreset',
  'homeQuickControlKeys',
  'nodeListMetadataEnabled',
  'nodeListMetadataFields',
  'nodeListCustomTagsVisible',
  'offlineNodesLast',
  'homeHighLoadThreshold',
  'homeTrafficWarningThreshold',
  'homeExpiringDays',
  'diskPredictionEnabled',
  'diskPredictionThresholdDays',
  'nodeDetailSectionTabsEnabled',
  'detailMetricCardPreset',
  'detailMetricCardKeys',
  'gpuChartEnabled',
  'chartDashboardPreset',
  'chartDashboardTemplate',
  'backgroundEnabled',
  'backgroundType',
  'lightBackgroundUrl',
  'darkBackgroundUrl',
  'backgroundBlur',
  'backgroundOverlay',
] as const satisfies readonly (keyof ThemeSettings)[]

const CUSTOM_COLOR_KEYS = [
  'lightCard',
  'lightControl',
  'lightText',
  'lightMutedText',
  'lightBorder',
  'darkCard',
  'darkControl',
  'darkText',
  'darkMutedText',
  'darkBorder',
] as const

export type GlassCustomColorKey = (typeof CUSTOM_COLOR_KEYS)[number]
export type GlassCustomColors = Record<GlassCustomColorKey, string>

const DEFAULT_CUSTOM_COLORS: GlassCustomColors = {
  lightCard: '#f1f5f9bd',
  lightControl: '#e2e8f0c2',
  lightText: '#14151a',
  lightMutedText: '#3f4552',
  lightBorder: '#cbd5e199',
  darkCard: '#0d111ad9',
  darkControl: '#101624cc',
  darkText: '#f7f8fb',
  darkMutedText: '#d6dae4',
  darkBorder: '#ffffff2e',
}

export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = Object.freeze({
  themeMode: 'beijing',
  dataUpdateInterval: 5,
  rpcTransportMode: 'http',
  defaultViewMode: 'card',
  nodeCardSize: 'compact',
  alertEnabled: false,
  alertTitle: '',
  alertContent: '',
  stopEarth: false,
  earthRenderer: 'realistic',
  hideEarth: false,
  hideGeneralCard: false,
  visitorInfoEnabled: false,
  glassColorPreset: '翡翠',
  colorVisionMode: '标准',
  glassCustomColors: JSON.stringify(DEFAULT_CUSTOM_COLORS),
  generalCardPreset: '基础',
  generalCardKeys: 'memory\ndisk\nremainingValue\ntotalTraffic\nuploadSpeed\ndownloadSpeed',
  homeToolsEnabled: true,
  hideAdminEntryWhenLoggedOut: false,
  hidePriceWhenLoggedOut: false,
  providerAliases: '',
  exportSecondaryPassword: '',
  disablePageAnimation: false,
  homeQuickControlsEnabled: true,
  homeQuickControlPreset: '完整',
  homeQuickControlKeys: 'favorite\ntotalTraffic\npeak\noffline',
  nodeListMetadataEnabled: true,
  nodeListMetadataFields: 'provider\nregion\nasn',
  nodeListCustomTagsVisible: true,
  offlineNodesLast: false,
  homeHighLoadThreshold: 80,
  homeTrafficWarningThreshold: 80,
  homeExpiringDays: 30,
  diskPredictionEnabled: false,
  diskPredictionThresholdDays: 30,
  nodeDetailSectionTabsEnabled: false,
  detailMetricCardPreset: '财务',
  detailMetricCardKeys: 'nodePrice\nmonthlyCost\nremainingTime\nremainingValue\ntotalTraffic\ntrafficQuota\nuptime\nconnections',
  gpuChartEnabled: false,
  chartDashboardPreset: '默认',
  chartDashboardTemplate: 'cpu\nmemory\ndisk\nnetwork\ngpu\nconnections\nprocess',
  backgroundEnabled: false,
  backgroundType: 'image',
  lightBackgroundUrl: '',
  darkBackgroundUrl: '',
  backgroundBlur: 0,
  backgroundOverlay: 0,
})

const KNOWN_THEME_KEYS = new Set<string>(THEME_SETTING_KEYS)
const LOCAL_ONLY_KEYS = new Set([
  'jwt_token',
  'turnstile_token',
  'turnstile_verified',
  'jwtToken',
  'turnstileToken',
  'turnstileVerified',
  'favoriteKeys',
])
const CUSTOM_COLOR_KEY_SET = new Set<string>(CUSTOM_COLOR_KEYS)
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

export interface ThemeDraftIssue {
  key: keyof ThemeSettings
  message: string
}

export interface ThemeSettingsStorageSnapshot {
  version: number
  overrides: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  fallback: Values[number],
): Values[number] {
  return typeof value === 'string' && values.includes(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < minimum || value > maximum || (integer && !Number.isInteger(value))) return fallback
  return value
}

function listEntries(value: unknown): string[] | null {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (trimmed === '') return []
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        candidate = JSON.parse(trimmed) as unknown
      } catch {
        return null
      }
    } else {
      candidate = trimmed.split(/[\s,]+/)
    }
  }

  if (Array.isArray(candidate)) {
    return [...new Set(candidate.filter((entry): entry is string => (
      typeof entry === 'string' && entry.trim().length > 0
    )).map((entry) => entry.trim()))]
  }

  if (isRecord(candidate)) {
    return Object.entries(candidate)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key.trim())
      .filter(Boolean)
  }

  return null
}

function listText(value: unknown, fallback: string): string {
  const entries = listEntries(value)
  return entries === null ? fallback : entries.join('\n')
}

export function parseSettingKeys(value: string): string[] {
  return listEntries(value) ?? []
}

export function parseGlassCustomColors(value: unknown): GlassCustomColors | null {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }
  if (!isRecord(candidate)) return null
  if (Object.keys(candidate).some((key) => !CUSTOM_COLOR_KEY_SET.has(key))) return null

  const lightCard = candidate.lightCard
  const lightControl = candidate.lightControl
  const lightText = candidate.lightText
  const lightMutedText = candidate.lightMutedText
  const lightBorder = candidate.lightBorder
  const darkCard = candidate.darkCard
  const darkControl = candidate.darkControl
  const darkText = candidate.darkText
  const darkMutedText = candidate.darkMutedText
  const darkBorder = candidate.darkBorder
  if (
    typeof lightCard !== 'string' || !HEX_COLOR.test(lightCard)
    || typeof lightControl !== 'string' || !HEX_COLOR.test(lightControl)
    || typeof lightText !== 'string' || !HEX_COLOR.test(lightText)
    || typeof lightMutedText !== 'string' || !HEX_COLOR.test(lightMutedText)
    || typeof lightBorder !== 'string' || !HEX_COLOR.test(lightBorder)
    || typeof darkCard !== 'string' || !HEX_COLOR.test(darkCard)
    || typeof darkControl !== 'string' || !HEX_COLOR.test(darkControl)
    || typeof darkText !== 'string' || !HEX_COLOR.test(darkText)
    || typeof darkMutedText !== 'string' || !HEX_COLOR.test(darkMutedText)
    || typeof darkBorder !== 'string' || !HEX_COLOR.test(darkBorder)
  ) {
    return null
  }

  return {
    lightCard,
    lightControl,
    lightText,
    lightMutedText,
    lightBorder,
    darkCard,
    darkControl,
    darkText,
    darkMutedText,
    darkBorder,
  }
}

function customColorsText(value: unknown, fallback: string): string {
  const colors = parseGlassCustomColors(value)
  return colors ? JSON.stringify(colors) : fallback
}

export function isSafeBackgroundSource(value: string): boolean {
  const source = value.trim()
  if (source === '') return true
  if (source.startsWith('/') && !source.startsWith('//')) return true
  if (source.toLowerCase().startsWith('local:')) {
    const segments = source.slice('local:'.length).split('/').map((segment) => segment.trim())
    return segments.length > 0 && segments.every((segment) => (
      segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\')
    ))
  }
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function backgroundSourceValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return isSafeBackgroundSource(trimmed) ? trimmed : fallback
}

export function resolveBackgroundSource(value: string): string {
  const source = value.trim()
  if (!isSafeBackgroundSource(source)) return ''
  if (!source.toLowerCase().startsWith('local:')) return source
  const segments = source.slice('local:'.length).split('/').map((segment) => segment.trim())
  return `/themes/user-assets/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}

export function cloneThemeSettings(settings: ThemeSettings): ThemeSettings {
  return { ...settings }
}

export function normalizeThemeSettingsLayer(
  value: unknown,
  fallback: ThemeSettings = cloneThemeSettings(DEFAULT_THEME_SETTINGS),
): ThemeSettings {
  const input = isRecord(value) ? value : {}
  const normalizedThemeMode = input.themeMode === 'auto' ? 'system' : input.themeMode

  return {
    themeMode: oneOf(normalizedThemeMode, ['beijing', 'system', 'light', 'dark'], fallback.themeMode),
    dataUpdateInterval: numberValue(input.dataUpdateInterval, fallback.dataUpdateInterval, 5, 60, true),
    rpcTransportMode: 'http',
    defaultViewMode: oneOf(input.defaultViewMode, ['card', 'list', 'ring'], fallback.defaultViewMode),
    nodeCardSize: oneOf(input.nodeCardSize, ['mini', 'compact', 'comfortable', 'large'], fallback.nodeCardSize),
    alertEnabled: booleanValue(input.alertEnabled, fallback.alertEnabled),
    alertTitle: textValue(input.alertTitle, fallback.alertTitle),
    alertContent: textValue(input.alertContent, fallback.alertContent),
    stopEarth: booleanValue(input.stopEarth, fallback.stopEarth),
    earthRenderer: oneOf(input.earthRenderer, ['realistic', 'cobe', 'tiled'], fallback.earthRenderer),
    hideEarth: booleanValue(input.hideEarth, fallback.hideEarth),
    hideGeneralCard: booleanValue(input.hideGeneralCard, fallback.hideGeneralCard),
    visitorInfoEnabled: false,
    glassColorPreset: oneOf(input.glassColorPreset, ['翡翠', '柔和', '高对比', '午夜', '自定义'], fallback.glassColorPreset),
    colorVisionMode: oneOf(input.colorVisionMode, ['标准', '色觉友好'], fallback.colorVisionMode),
    glassCustomColors: customColorsText(input.glassCustomColors, fallback.glassCustomColors),
    generalCardPreset: oneOf(input.generalCardPreset, ['官方', '基础', '运维', '资源', '财务', '流量', 'GPU', '资产', '完整', '自定义'], fallback.generalCardPreset),
    generalCardKeys: listText(input.generalCardKeys, fallback.generalCardKeys),
    homeToolsEnabled: booleanValue(input.homeToolsEnabled, fallback.homeToolsEnabled),
    hideAdminEntryWhenLoggedOut: booleanValue(input.hideAdminEntryWhenLoggedOut, fallback.hideAdminEntryWhenLoggedOut),
    hidePriceWhenLoggedOut: booleanValue(input.hidePriceWhenLoggedOut, fallback.hidePriceWhenLoggedOut),
    providerAliases: textValue(input.providerAliases, fallback.providerAliases),
    exportSecondaryPassword: textValue(input.exportSecondaryPassword, fallback.exportSecondaryPassword),
    disablePageAnimation: booleanValue(input.disablePageAnimation, fallback.disablePageAnimation),
    homeQuickControlsEnabled: booleanValue(input.homeQuickControlsEnabled, fallback.homeQuickControlsEnabled),
    homeQuickControlPreset: oneOf(input.homeQuickControlPreset, ['基础', '流量', '运维', '完整', '自定义'], fallback.homeQuickControlPreset),
    homeQuickControlKeys: listText(input.homeQuickControlKeys, fallback.homeQuickControlKeys),
    nodeListMetadataEnabled: booleanValue(input.nodeListMetadataEnabled, fallback.nodeListMetadataEnabled),
    nodeListMetadataFields: listText(input.nodeListMetadataFields, fallback.nodeListMetadataFields),
    nodeListCustomTagsVisible: booleanValue(input.nodeListCustomTagsVisible, fallback.nodeListCustomTagsVisible),
    offlineNodesLast: booleanValue(input.offlineNodesLast, fallback.offlineNodesLast),
    homeHighLoadThreshold: numberValue(input.homeHighLoadThreshold, fallback.homeHighLoadThreshold, 1, 100),
    homeTrafficWarningThreshold: numberValue(input.homeTrafficWarningThreshold, fallback.homeTrafficWarningThreshold, 1, 100),
    homeExpiringDays: numberValue(input.homeExpiringDays, fallback.homeExpiringDays, 1, 3650, true),
    diskPredictionEnabled: booleanValue(input.diskPredictionEnabled, fallback.diskPredictionEnabled),
    diskPredictionThresholdDays: numberValue(input.diskPredictionThresholdDays, fallback.diskPredictionThresholdDays, 1, 3650, true),
    nodeDetailSectionTabsEnabled: booleanValue(input.nodeDetailSectionTabsEnabled, fallback.nodeDetailSectionTabsEnabled),
    detailMetricCardPreset: oneOf(input.detailMetricCardPreset, ['财务', '状态', '资源', '网络', 'GPU', '综合', '自定义'], fallback.detailMetricCardPreset),
    detailMetricCardKeys: listText(input.detailMetricCardKeys, fallback.detailMetricCardKeys),
    gpuChartEnabled: booleanValue(input.gpuChartEnabled, fallback.gpuChartEnabled),
    chartDashboardPreset: oneOf(input.chartDashboardPreset, ['默认', '精简', '资源', '网络', 'GPU', '延迟', '运维', '完整', '自定义'], fallback.chartDashboardPreset),
    chartDashboardTemplate: listText(input.chartDashboardTemplate, fallback.chartDashboardTemplate),
    backgroundEnabled: booleanValue(input.backgroundEnabled, fallback.backgroundEnabled),
    backgroundType: oneOf(input.backgroundType, ['image', 'video'], fallback.backgroundType),
    lightBackgroundUrl: backgroundSourceValue(input.lightBackgroundUrl, fallback.lightBackgroundUrl),
    darkBackgroundUrl: backgroundSourceValue(input.darkBackgroundUrl, fallback.darkBackgroundUrl),
    backgroundBlur: numberValue(input.backgroundBlur, fallback.backgroundBlur, 0, 80),
    backgroundOverlay: numberValue(input.backgroundOverlay, fallback.backgroundOverlay, -100, 100),
  }
}

export function resolveThemeSettings(
  backend: unknown,
  local: unknown,
  preferredTheme?: 'auto' | 'light' | 'dark',
): ThemeSettings {
  const backendInput = isRecord(backend) ? backend : {}
  const mappedBackend = !hasOwn(backendInput, 'themeMode') && preferredTheme
    ? { ...backendInput, themeMode: preferredTheme === 'auto' ? 'system' : preferredTheme }
    : backendInput
  const backendSettings = normalizeThemeSettingsLayer(mappedBackend)
  return normalizeThemeSettingsLayer(local, backendSettings)
}

export function serializeThemeSettings(settings: ThemeSettings): Record<string, unknown> {
  return {
    themeMode: settings.themeMode,
    dataUpdateInterval: settings.dataUpdateInterval,
    rpcTransportMode: 'http',
    defaultViewMode: settings.defaultViewMode,
    nodeCardSize: settings.nodeCardSize,
    alertEnabled: settings.alertEnabled,
    alertTitle: settings.alertTitle,
    alertContent: settings.alertContent,
    stopEarth: settings.stopEarth,
    earthRenderer: settings.earthRenderer,
    hideEarth: settings.hideEarth,
    hideGeneralCard: settings.hideGeneralCard,
    visitorInfoEnabled: false,
    glassColorPreset: settings.glassColorPreset,
    colorVisionMode: settings.colorVisionMode,
    glassCustomColors: settings.glassCustomColors,
    generalCardPreset: settings.generalCardPreset,
    generalCardKeys: settings.generalCardKeys,
    homeToolsEnabled: settings.homeToolsEnabled,
    hideAdminEntryWhenLoggedOut: settings.hideAdminEntryWhenLoggedOut,
    hidePriceWhenLoggedOut: settings.hidePriceWhenLoggedOut,
    providerAliases: settings.providerAliases,
    exportSecondaryPassword: settings.exportSecondaryPassword,
    disablePageAnimation: settings.disablePageAnimation,
    homeQuickControlsEnabled: settings.homeQuickControlsEnabled,
    homeQuickControlPreset: settings.homeQuickControlPreset,
    homeQuickControlKeys: settings.homeQuickControlKeys,
    nodeListMetadataEnabled: settings.nodeListMetadataEnabled,
    nodeListMetadataFields: settings.nodeListMetadataFields,
    nodeListCustomTagsVisible: settings.nodeListCustomTagsVisible,
    offlineNodesLast: settings.offlineNodesLast,
    homeHighLoadThreshold: settings.homeHighLoadThreshold,
    homeTrafficWarningThreshold: settings.homeTrafficWarningThreshold,
    homeExpiringDays: settings.homeExpiringDays,
    diskPredictionEnabled: settings.diskPredictionEnabled,
    diskPredictionThresholdDays: settings.diskPredictionThresholdDays,
    nodeDetailSectionTabsEnabled: settings.nodeDetailSectionTabsEnabled,
    detailMetricCardPreset: settings.detailMetricCardPreset,
    detailMetricCardKeys: settings.detailMetricCardKeys,
    gpuChartEnabled: settings.gpuChartEnabled,
    chartDashboardPreset: settings.chartDashboardPreset,
    chartDashboardTemplate: settings.chartDashboardTemplate,
    backgroundEnabled: settings.backgroundEnabled,
    backgroundType: settings.backgroundType,
    lightBackgroundUrl: settings.lightBackgroundUrl,
    darkBackgroundUrl: settings.darkBackgroundUrl,
    backgroundBlur: settings.backgroundBlur,
    backgroundOverlay: settings.backgroundOverlay,
  }
}

export function createThemeOptionsSnapshot(
  settings: ThemeSettings,
  backend: unknown = {},
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {}
  if (isRecord(backend)) {
    for (const [key, value] of Object.entries(backend)) {
      if (!KNOWN_THEME_KEYS.has(key) && !LOCAL_ONLY_KEYS.has(key)) preserved[key] = value
    }
  }
  return { ...preserved, ...serializeThemeSettings(settings) }
}

export function validateThemeSettingsDraft(value: ThemeSettings): ThemeDraftIssue[] {
  const issues: ThemeDraftIssue[] = []
  if (value.glassColorPreset === '自定义' && parseGlassCustomColors(value.glassCustomColors) === null) {
    issues.push({
      key: 'glassCustomColors',
      message: '自定义配色必须是包含 10 个指定颜色键的 JSON，颜色使用 #RRGGBB 或 #RRGGBBAA。',
    })
  }
  if (!isSafeBackgroundSource(value.lightBackgroundUrl)) {
    issues.push({ key: 'lightBackgroundUrl', message: '亮色背景只允许 http(s)、站内 / 路径或安全的 local: 路径。' })
  }
  if (!isSafeBackgroundSource(value.darkBackgroundUrl)) {
    issues.push({ key: 'darkBackgroundUrl', message: '暗色背景只允许 http(s)、站内 / 路径或安全的 local: 路径。' })
  }
  if (!Number.isInteger(value.dataUpdateInterval) || value.dataUpdateInterval < 5 || value.dataUpdateInterval > 60) {
    issues.push({ key: 'dataUpdateInterval', message: '数据更新间隔必须是 5–60 秒的整数。' })
  }
  if (!Number.isFinite(value.homeHighLoadThreshold) || value.homeHighLoadThreshold < 1 || value.homeHighLoadThreshold > 100) {
    issues.push({ key: 'homeHighLoadThreshold', message: '高负载阈值必须在 1–100 之间。' })
  }
  if (!Number.isFinite(value.homeTrafficWarningThreshold) || value.homeTrafficWarningThreshold < 1 || value.homeTrafficWarningThreshold > 100) {
    issues.push({ key: 'homeTrafficWarningThreshold', message: '流量预警阈值必须在 1–100 之间。' })
  }
  if (!Number.isInteger(value.homeExpiringDays) || value.homeExpiringDays < 1 || value.homeExpiringDays > 3650) {
    issues.push({ key: 'homeExpiringDays', message: '即将到期天数必须是 1–3650 的整数。' })
  }
  if (!Number.isInteger(value.diskPredictionThresholdDays) || value.diskPredictionThresholdDays < 1 || value.diskPredictionThresholdDays > 3650) {
    issues.push({ key: 'diskPredictionThresholdDays', message: '磁盘预测预警天数必须是 1–3650 的整数。' })
  }
  if (!Number.isFinite(value.backgroundBlur) || value.backgroundBlur < 0 || value.backgroundBlur > 80) {
    issues.push({ key: 'backgroundBlur', message: '背景模糊必须在 0–80 px 之间。' })
  }
  if (!Number.isFinite(value.backgroundOverlay) || value.backgroundOverlay < -100 || value.backgroundOverlay > 100) {
    issues.push({ key: 'backgroundOverlay', message: '背景遮罩必须在 -100–100 之间。' })
  }
  return issues
}

/** 视图模式与卡片密度互相独立：切换 card/list/ring 不应改写用户选择的 `nodeCardSize`。 */
export function dashboardViewMode(settings: ThemeSettings): DashboardViewMode {
  if (settings.defaultViewMode === 'list') return 'list'
  if (settings.defaultViewMode === 'ring') return 'ring'
  return 'card'
}

export function dashboardViewPatch(viewMode: DashboardViewMode): Pick<ThemeSettings, 'defaultViewMode'> {
  if (viewMode === 'list') return { defaultViewMode: 'list' }
  if (viewMode === 'ring') return { defaultViewMode: 'ring' }
  return { defaultViewMode: 'card' }
}

export function resolveThemeMode(
  mode: ThemeMode,
  systemDark: boolean,
  now = new Date(),
): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  const beijingHour = (now.getUTCHours() + 8) % 24
  return beijingHour >= 7 && beijingHour < 19 ? 'light' : 'dark'
}

export function legacyDashboardOverrides(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const overrides: Record<string, unknown> = {}
  if (value.themeMode === 'system' || value.themeMode === 'light' || value.themeMode === 'dark') {
    overrides.themeMode = value.themeMode
  }
  if (value.viewMode === 'list') {
    overrides.defaultViewMode = 'list'
  } else if (value.viewMode === 'mini' || value.viewMode === 'compact' || value.viewMode === 'card') {
    overrides.defaultViewMode = 'card'
    overrides.nodeCardSize = value.viewMode === 'card' ? 'comfortable' : value.viewMode
  }
  if (typeof value.offlineLast === 'boolean') overrides.offlineNodesLast = value.offlineLast
  return overrides
}

export function parseThemeStorageSnapshot(value: string | null): ThemeSettingsStorageSnapshot | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.version !== THEME_SETTINGS_STORAGE_VERSION || !isRecord(parsed.overrides)) {
      return { version: THEME_SETTINGS_STORAGE_VERSION, overrides: {} }
    }
    return { version: THEME_SETTINGS_STORAGE_VERSION, overrides: { ...parsed.overrides } }
  } catch {
    return { version: THEME_SETTINGS_STORAGE_VERSION, overrides: {} }
  }
}

export function themeStorageSnapshot(overrides: Record<string, unknown>): ThemeSettingsStorageSnapshot {
  return { version: THEME_SETTINGS_STORAGE_VERSION, overrides: { ...overrides } }
}

export function themeSettingsEqual(left: ThemeSettings, right: ThemeSettings): boolean {
  return JSON.stringify(serializeThemeSettings(left)) === JSON.stringify(serializeThemeSettings(right))
}
