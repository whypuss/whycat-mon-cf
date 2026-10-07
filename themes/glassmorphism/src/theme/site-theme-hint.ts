import { resolveThemeSettings, type ThemeMode } from './settings'

/** 非权威的冷启动显示暂存值；它不属于默认 / 后端 / 本地覆盖三层设置。 */
export const SITE_THEME_HINT_STORAGE_KEY = 'cfsm-glassmorphism.site-theme-hint.v1'

export interface SiteThemeHint {
  themeMode: ThemeMode
  backgroundEnabled: boolean
}

export function parseSiteThemeHint(raw: string | null): SiteThemeHint | null {
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  if (!('version' in value) || value.version !== 1) return null
  if (!('themeMode' in value)) return null
  const mode = value.themeMode
  if (mode !== 'beijing' && mode !== 'system' && mode !== 'light' && mode !== 'dark') return null
  // 兼容第二轮写入的 v1 暂存：旧格式没有背景字段，等同于未启用。
  const backgroundEnabled = 'backgroundEnabled' in value ? value.backgroundEnabled : false
  if (typeof backgroundEnabled !== 'boolean') return null
  return { themeMode: mode, backgroundEnabled }
}

/** 只取后端 theme_options / preferred_theme，永不混入访客本地覆盖或背景地址。 */
export function backendSiteHint(
  options: unknown,
  preferredTheme: 'auto' | 'light' | 'dark',
): SiteThemeHint {
  const settings = resolveThemeSettings(options, {}, preferredTheme)
  return { themeMode: settings.themeMode, backgroundEnabled: settings.backgroundEnabled }
}
