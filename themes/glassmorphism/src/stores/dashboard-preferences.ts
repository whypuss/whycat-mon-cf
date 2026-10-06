import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { LEGACY_DASHBOARD_STORAGE_KEY } from '@/theme/settings'

export const DASHBOARD_PREFERENCES_KEY = LEGACY_DASHBOARD_STORAGE_KEY

export interface DashboardPreferencesSnapshot {
  favoriteKeys: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeDashboardPreferences(value: unknown): DashboardPreferencesSnapshot {
  const input = isRecord(value) ? value : {}
  const favorites = Array.isArray(input.favoriteKeys)
    ? input.favoriteKeys.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []

  return { favoriteKeys: [...new Set(favorites)] }
}

function readPreferences(): DashboardPreferencesSnapshot {
  if (typeof window === 'undefined') return normalizeDashboardPreferences(null)
  try {
    const stored = window.localStorage.getItem(DASHBOARD_PREFERENCES_KEY)
    return normalizeDashboardPreferences(stored ? JSON.parse(stored) as unknown : null)
  } catch {
    return normalizeDashboardPreferences(null)
  }
}

export const useDashboardPreferencesStore = defineStore('dashboard-preferences', () => {
  const snapshot = readPreferences()
  const favoriteKeys = ref<string[]>(snapshot.favoriteKeys)
  const initialized = ref(false)
  const favorites = computed<ReadonlySet<string>>(() => new Set(favoriteKeys.value))

  function persist(): void {
    if (!initialized.value || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify({
        favoriteKeys: favoriteKeys.value,
      }))
    } catch {
      // Storage can be unavailable in private/restricted browsing; runtime state remains usable.
    }
  }

  function initialize(): void {
    if (initialized.value) return
    initialized.value = true
    persist()
  }

  function isFavorite(key: string): boolean {
    return favorites.value.has(key)
  }

  function toggleFavorite(key: string): void {
    favoriteKeys.value = isFavorite(key)
      ? favoriteKeys.value.filter((item) => item !== key)
      : [...favoriteKeys.value, key]
  }

  watch(favoriteKeys, persist, { deep: true })

  return {
    favoriteKeys,
    favorites,
    initialize,
    isFavorite,
    toggleFavorite,
  }
})
