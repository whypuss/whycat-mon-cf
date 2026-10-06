import type { InjectionKey } from 'vue'

export const DEFAULT_SITE_TITLE = 'CF Server Monitor'

export interface InjectedSiteTitle {
  readonly title: string
  readonly primaryBase: string
  readonly sourceCount: number
}

export const injectedSiteTitleKey: InjectionKey<InjectedSiteTitle | null> = Symbol('injected-site-title')

/** A display-only snapshot of CFSM's HTML injection, captured before route title watchers run. */
export function captureInjectedSiteTitle(
  htmlTitle: string,
  pageOrigin: string,
  apiBases: readonly string[],
): InjectedSiteTitle | null {
  const title = htmlTitle.trim()
  if (!title || title === 'CFSM-Glassmorphism' || title === 'Cloudflare Server Monitor') return null
  if (apiBases[0] !== pageOrigin) return null
  return Object.freeze({ title, primaryBase: pageOrigin, sourceCount: apiBases.length })
}

export function injectedTitleForPrimary(
  injected: InjectedSiteTitle | null,
  currentPrimaryBase: string | null,
): string | null {
  if (!injected || (currentPrimaryBase && currentPrimaryBase !== injected.primaryBase)) return null
  return injected.title
}

export function injectedTitleForSource(
  injected: InjectedSiteTitle | null,
  currentPrimaryBase: string | null,
  owningBase: string | null,
): string | null {
  const title = injectedTitleForPrimary(injected, currentPrimaryBase)
  if (!title || !injected) return null
  if (owningBase !== null) return owningBase === injected.primaryBase ? title : null
  // Without a known owner, only a single-source deployment can prove ownership.
  return injected.sourceCount === 1 ? title : null
}

export type SiteTitleResolution =
  | { state: 'pending', title: null }
  | { state: 'ready' | 'injected' | 'fallback', title: string }

export function resolveSiteTitle(
  siteTitle: string | null | undefined,
  pending: boolean,
  injectedTitle: string | null = null,
): SiteTitleResolution {
  const title = siteTitle?.trim()
  if (title) return { state: 'ready', title }
  if (pending && injectedTitle) return { state: 'injected', title: injectedTitle }
  if (pending) return { state: 'pending', title: null }
  return { state: 'fallback', title: DEFAULT_SITE_TITLE }
}

export function detailDocumentTitle(
  serverName: string | null | undefined,
  site: SiteTitleResolution,
): string | null {
  const name = serverName?.trim()
  if (name && site.title) return `${name} · ${site.title}`
  return name || site.title
}
