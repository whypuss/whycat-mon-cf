import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useServerDetailStore } from '@/stores/server-detail'

afterEach(() => vi.unstubAllGlobals())

describe('detail request lifetime', () => {
  it.each(['resolve', 'reject'] as const)('ignores a server request that %ss after close', async (outcome) => {
    setActivePinia(createPinia())
    let finish: (() => void) | undefined
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve, reject) => {
      finish = () => outcome === 'resolve'
        ? resolve(new Response(JSON.stringify({ id: 'node-1', name: 'Node 1' })))
        : reject(new Error('aborted request'))
    }))
    const store = useServerDetailStore()
    const opening = store.open('node-1', ['https://status.example'])
    const settled = expect(opening).resolves.toBeUndefined()
    store.close()
    finish?.()
    await settled
    expect(store.server).toBeNull()
    expect(store.issue).toBeNull()
  })
})
