import { describe, expect, it, vi } from 'vitest'
import { coldStartSettled, entryPageFromHash, startBootstrapRequests } from '@/domain/bootstrap'

describe('startup requests and cover gate', () => {
  it.each(['#/', '#/server/node', '#/server/node?source=https%3A%2F%2Fa.example'])(
    'starts config and list synchronously before a lazy route mounts at %s', (hash) => {
      const initialize = vi.fn(() => Promise.resolve())
      const loadServers = vi.fn(() => Promise.resolve())
      startBootstrapRequests(hash, initialize, loadServers)
      expect(initialize).toHaveBeenCalledOnce()
      expect(loadServers).toHaveBeenCalledOnce()
    },
  )

  it('starts config but not list for settings deep links', () => {
    const initialize = vi.fn(() => Promise.resolve())
    const loadServers = vi.fn(() => Promise.resolve())
    startBootstrapRequests('#/settings?tab=theme', initialize, loadServers)
    expect(initialize).toHaveBeenCalledOnce()
    expect(loadServers).not.toHaveBeenCalled()
    expect(entryPageFromHash('#/settings?tab=theme')).toBe('theme-settings')
    expect(entryPageFromHash('#/settings-extra')).toBe('home')
  })

  it('waits for both first results, but treats explicit failures as settled', () => {
    expect(coldStartSettled('home', 'loading', 'ready', 'idle')).toBe(false)
    expect(coldStartSettled('home', 'ready', 'loading', 'idle')).toBe(false)
    expect(coldStartSettled('home', 'error', 'error', 'idle')).toBe(true)
    expect(coldStartSettled('server-detail', 'ready', 'ready', 'loading')).toBe(false)
    expect(coldStartSettled('server-detail', 'error', 'error', 'error')).toBe(true)
    expect(coldStartSettled('theme-settings', 'error', 'idle', 'idle')).toBe(true)
  })
})
