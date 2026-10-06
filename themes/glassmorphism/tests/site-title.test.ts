import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  captureInjectedSiteTitle,
  detailDocumentTitle,
  injectedTitleForSource,
  resolveSiteTitle,
} from '@/domain/site-title'

const detailView = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')
const homeView = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')

describe('site title resolution', () => {
  it('uses a verified same-origin HTML title before config resolves, without a placeholder', () => {
    const injected = captureInjectedSiteTitle(' 示例站点 ', 'https://site.example', ['https://site.example'])
    expect(injected).toEqual({ title: '示例站点', primaryBase: 'https://site.example', sourceCount: 1 })
    expect(resolveSiteTitle(null, true, injectedTitleForSource(injected, null, null)))
      .toEqual({ state: 'injected', title: '示例站点' })
  })

  it.each(['CFSM-Glassmorphism', 'Cloudflare Server Monitor', '  '])(
    'keeps the placeholder for untrusted HTML title %j', (htmlTitle) => {
      const injected = captureInjectedSiteTitle(htmlTitle, 'https://site.example', ['https://site.example'])
      expect(injected).toBeNull()
      expect(resolveSiteTitle(null, true, injectedTitleForSource(injected, null, null)))
        .toEqual({ state: 'pending', title: null })
    },
  )

  it('does not use a page-origin title for a cross-origin primary API base', () => {
    expect(captureInjectedSiteTitle('示例站点', 'https://site.example', ['https://api.example'])).toBeNull()
  })

  it('lets the fetched config replace a different HTML title', () => {
    expect(resolveSiteTitle('新站名', true, '示例站点')).toEqual({ state: 'ready', title: '新站名' })
  })

  it('captures the HTML title once instead of reading a later document-title mutation', () => {
    const html = { title: '示例站点' }
    const injected = captureInjectedSiteTitle(html.title, 'https://site.example', ['https://site.example'])
    html.title = '节点 · 示例站点'
    expect(injectedTitleForSource(injected, null, null)).toBe('示例站点')
  })

  it('uses the hint only for the page-origin owning source on multi-source detail', () => {
    const injected = captureInjectedSiteTitle('示例站点', 'https://site.example', ['https://site.example', 'https://other.example'])
    expect(injectedTitleForSource(injected, null, null)).toBeNull()
    expect(injectedTitleForSource(injected, 'https://site.example', 'https://other.example')).toBeNull()
    expect(injectedTitleForSource(injected, 'https://site.example', 'https://site.example')).toBe('示例站点')
    expect(injectedTitleForSource(injected, 'https://other.example', 'https://site.example')).toBeNull()
  })

  it('keeps an unresolved title pending instead of inventing a default name', () => {
    expect(resolveSiteTitle(null, true)).toEqual({ state: 'pending', title: null })
  })

  it('uses a real title immediately and only falls back after resolution', () => {
    expect(resolveSiteTitle('  示例站点  ', true)).toEqual({ state: 'ready', title: '示例站点' })
    expect(resolveSiteTitle(null, false)).toEqual({ state: 'fallback', title: 'CF Server Monitor' })
  })

  it('writes only the server name until its owning source title is known', () => {
    const pending = resolveSiteTitle(null, true)
    expect(detailDocumentTitle(null, pending)).toBeNull()
    expect(detailDocumentTitle('Node B', pending)).toBe('Node B')
    expect(detailDocumentTitle('Node B', resolveSiteTitle('Source B', false))).toBe('Node B · Source B')
  })

  it('clears the previous source title while the next source and server are unresolved', () => {
    expect(detailView).toContain("document.title = title ?? ''")
    expect(detailView).not.toContain('if (title) document.title = title')
  })

  it('does not put a fake pending title into exported advanced-tool snapshots', () => {
    expect(homeView).toContain(':site-title="siteTitle ?? \'\'"')
    expect(homeView).not.toContain(':site-title="siteTitle ?? \'CF Server Monitor\'"')
  })
})
