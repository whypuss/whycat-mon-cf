import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppHeader from '@/components/dashboard/AppHeader.vue'

/*
 * 顶栏的站点标记。
 *
 * 此前这里是一枚纯 CSS 的固定几何标记（翡翠圆环 + 蓝点），既不是站点自己的图标，
 * 也不随配色方案变化，而 Komari `Header.vue` 在同一位置放的是站点 Avatar：
 * `AvatarImage src="/favicon.ico"` 加站点名首字兜底。
 *
 * CFSM 把站点图标存在后台「网站图标」里并作为 `<link rel="icon">` 注入 index.html，
 * 值通常是 data: URI；`/api/config` 不返回这个字段（实测顶层与 theme_options 里都没有），
 * 所以只能从文档里读那一条 link。下面锁住三级回退：图标 → 首字 → 几何标记，
 * 任何一步都不会让这个位置空着。
 */

const props = {
  title: '示例站点',
  version: '2.8.5',
  loading: false,
  adminUrl: null,
  themeMode: 'system' as const,
  resolvedTheme: 'light' as const,
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  const html = await renderToString(createSSRApp(AppHeader, { ...props, ...overrides }))
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

const source = readFileSync(new URL('../src/components/dashboard/AppHeader.vue', import.meta.url), 'utf8')
const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')

describe('header brand mark', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders the CFSM-injected favicon on the first render, before mounted', async () => {
    vi.stubGlobal('document', {
      querySelector: (selector: string) => selector === 'link[rel~="icon"]'
        ? { getAttribute: () => 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' }
        : null,
    })
    const html = await render()
    expect(html).toContain('class="brand__mark-image"')
    expect(html).toContain('src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"')
    expect(html).not.toContain('brand__mark-initial')
  })

  it('uses /favicon.ico on the first render when CFSM did not inject an icon', async () => {
    vi.stubGlobal('document', { querySelector: () => null })
    const html = await render()
    expect(html).toContain('class="brand__mark-image"')
    expect(html).toContain('src="/favicon.ico"')
  })

  /* SSR 没有 document，favicon 取不到，正好覆盖第二级回退。 */
  it('falls back to the site initial when no icon is available', async () => {
    const html = await render()
    expect(html).toContain('<b class="brand__mark-initial">示</b>')
    expect(html).not.toContain('brand__mark-image')
  })

  it('falls back to the built-in mark when there is no title either', async () => {
    const html = await render({ title: '   ' })
    expect(html).toContain('brand__mark-dot')
    expect(html).not.toContain('brand__mark-initial')
  })

  it('uses stable placeholders instead of a fake initial while the title is pending', async () => {
    const html = await render({ title: null, titlePending: true })
    expect(html).toContain('brand__mark-dot')
    expect(html).toContain('brand__title-placeholder skeleton')
    expect(html).not.toContain('brand__mark-initial')
    expect(html).not.toContain('CF Server Monitor')
  })

  it('keeps a fixed pending-title geometry inside the existing brand column', () => {
    const start = stylesheet.indexOf('.brand__title-placeholder {')
    expect(start).toBeGreaterThan(-1)
    const block = stylesheet.slice(start, stylesheet.indexOf('}', start))
    expect(block).toContain('width: min(152px, 32vw)')
    expect(block).toContain('height: 22px')
    expect(stylesheet).toContain('.brand__copy > span:not(.brand__title-placeholder)')
  })

  it('reads the injected link tag rather than assuming /favicon.ico exists', () => {
    expect(source).toContain('link[rel~="icon"]')
    // 取不到注入的那条时才退到固定路径。
    expect(source).toContain("'/favicon.ico'")
    // 服务端渲染没有 document，必须先挡一道。
    expect(source).toContain("typeof document === 'undefined'")
  })

  it('drops back to the initial when the icon fails to load', () => {
    expect(source).toMatch(/@error="faviconFailed = true"/)
    expect(source).toContain('faviconFailed.value ? \'\' : faviconSource.value')
  })

  /*
   * 关键回归：环与点此前挂在 `.brand__mark::before` 与 `.brand__mark span` 上，
   * 那样写的话站点图标显示时它们仍会画在底下。现在必须只作用于兜底元素。
   */
  it('never paints the geometric mark behind the site icon', () => {
    expect(stylesheet).not.toContain('.brand__mark::before')
    expect(stylesheet).not.toMatch(/\.brand__mark span \{/)
    expect(stylesheet).toContain('.brand__mark-dot')
  })

  it('clips the icon to the existing round container', () => {
    const start = stylesheet.indexOf('.brand__mark-image {')
    expect(start).toBeGreaterThan(-1)
    const block = stylesheet.slice(start, stylesheet.indexOf('}', start))
    expect(block).toContain('object-fit: cover')
    const markStart = stylesheet.indexOf('.brand__mark {')
    const markBlock = stylesheet.slice(markStart, stylesheet.indexOf('}', markStart))
    expect(markBlock).toContain('overflow: hidden')
    expect(markBlock).toContain('border-radius: 50%')
  })
})

/*
 * 明暗按钮。
 *
 * 此前它在四个主题模式之间轮换（北京时间自动 → 跟随系统 → 浅色 → 深色），而白天
 * 前三种看起来都是浅色，所以手机上要连点三下画面才会变暗，像是按钮失灵。现在按钮只
 * 表达三种状态：跟随站点设置 / 浅色 / 深色，图标跟随真实呈现的明暗。
 *
 * 提示气泡的文字由 Portal 在打开时才渲染，服务端渲染里取不到，因此这里断言按钮的
 * 可访问标签——它和气泡用的是同一份文案。
 */
describe('顶栏明暗按钮', () => {
  const buttonOf = (html: string) => {
    const at = html.indexOf('切换主题')
    const start = html.lastIndexOf('<button', at)
    return html.slice(start, html.indexOf('</button>', start))
  }

  it('图标跟随真实呈现的明暗，而不是配置里的模式名', async () => {
    const light = buttonOf(await render({ themeMode: 'beijing', resolvedTheme: 'light' }))
    const dark = buttonOf(await render({ themeMode: 'beijing', resolvedTheme: 'dark' }))
    // 同一个站点模式下，图标只由当前明暗决定：两次渲染的图形必须不同。
    expect(light).not.toBe(dark)
    const pathOf = (html: string) => /<path[^>]*d="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(pathOf(light)).not.toBe('')
    expect(pathOf(light)).not.toBe(pathOf(dark))
    // 站点设为浅色但当前呈现深色（访客自己切过）时，画的也是深色的图标。
    const overridden = buttonOf(await render({ themeMode: 'light', resolvedTheme: 'dark', themeOverride: 'dark' }))
    expect(pathOf(overridden)).toBe(pathOf(dark))
  })

  it('没有本地覆盖时说明跟随站点设置，并写明站点设置是什么', async () => {
    const labelOf = (html: string) => /aria-label="([^"]+)"/.exec(buttonOf(html))?.[1] ?? ''
    expect(labelOf(await render({ themeMode: 'beijing', resolvedTheme: 'light' }))).toBe('切换主题，当前跟随站点设置（北京时间日间）')
    expect(labelOf(await render({ themeMode: 'beijing', resolvedTheme: 'dark' }))).toBe('切换主题，当前跟随站点设置（北京时间夜间）')
    expect(labelOf(await render({ themeMode: 'system', resolvedTheme: 'light' }))).toBe('切换主题，当前跟随站点设置（跟随系统）')
    expect(labelOf(await render({ themeMode: 'dark', resolvedTheme: 'dark' }))).toBe('切换主题，当前跟随站点设置（深色）')
  })

  it('访客自己选过之后直接说明选的是哪一种', async () => {
    const labelOf = (html: string) => /aria-label="([^"]+)"/.exec(buttonOf(html))?.[1] ?? ''
    expect(labelOf(await render({ themeMode: 'beijing', resolvedTheme: 'dark', themeOverride: 'dark' }))).toBe('切换主题，当前深色')
    expect(labelOf(await render({ themeMode: 'dark', resolvedTheme: 'light', themeOverride: 'light' }))).toBe('切换主题，当前浅色')
  })
})
