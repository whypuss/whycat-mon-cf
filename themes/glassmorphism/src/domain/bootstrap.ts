import type { InjectionKey, Ref } from 'vue'
import type { LoadState } from '@/stores/app'
import type { DetailLoadState } from '@/stores/server-detail'

export type EntryPage = 'home' | 'server-detail' | 'theme-settings'

export interface BootstrapContext {
  readonly coverVisible: Readonly<Ref<boolean>>
  claimInitialPage(): boolean
  reportDetailState(state: DetailLoadState): void
}

export const bootstrapKey: InjectionKey<BootstrapContext> = Symbol('bootstrap')

/** The hash is available before Vue Router downloads any lazy page component. */
export function entryPageFromHash(hash: string): EntryPage {
  const path = hash.startsWith('#') ? hash.slice(1) : hash
  if (/^\/settings(?:[/?]|$)/.test(path)) return 'theme-settings'
  if (/^\/server\/[^/?]+/.test(path)) return 'server-detail'
  return 'home'
}

export function startBootstrapRequests(
  hash: string,
  initialize: () => Promise<void>,
  loadServers: () => Promise<void>,
): void {
  void initialize()
  if (entryPageFromHash(hash) !== 'theme-settings') void loadServers()
}

export function coldStartSettled(
  page: EntryPage | null,
  config: LoadState,
  list: LoadState,
  detail: DetailLoadState,
): boolean {
  if (!page || config === 'idle' || config === 'loading') return false
  if (page === 'theme-settings') return true
  if (page === 'home') return list !== 'idle' && list !== 'loading'
  return detail !== 'idle' && detail !== 'loading'
}
