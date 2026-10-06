import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  normalizeDashboardPreferences,
  useDashboardPreferencesStore,
} from '@/stores/dashboard-preferences'

describe('dashboard local preferences', () => {
  it('deduplicates stable favorites and ignores former appearance fields', () => {
    expect(normalizeDashboardPreferences({
      themeMode: 'dark',
      viewMode: 'mini',
      offlineLast: true,
      favoriteKeys: ['https%3A%2F%2Fa.example:one', 'https%3A%2F%2Fa.example:one', '', 42],
    })).toEqual({
      favoriteKeys: ['https%3A%2F%2Fa.example:one'],
    })
  })

  it('falls back safely for malformed values', () => {
    expect(normalizeDashboardPreferences({ favoriteKeys: null })).toEqual({ favoriteKeys: [] })
    expect(normalizeDashboardPreferences('invalid')).toEqual({ favoriteKeys: [] })
  })

  it('keeps favorites in their dedicated store', () => {
    setActivePinia(createPinia())
    const preferences = useDashboardPreferencesStore()

    preferences.initialize()
    preferences.toggleFavorite('https://a.example::one')
    expect(preferences.isFavorite('https://a.example::one')).toBe(true)
    preferences.toggleFavorite('https://a.example::one')
    expect(preferences.isFavorite('https://a.example::one')).toBe(false)
  })
})
