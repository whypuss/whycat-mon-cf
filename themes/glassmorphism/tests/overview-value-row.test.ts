import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import OverviewCards from '@/components/dashboard/OverviewCards.vue'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

/*
 * 第 16 轮：总览卡片数值行的结构回归。
 *
 * 这里断言的是**渲染结果**，不是源码里出现过 `align-items: baseline`。
 * 修复前的失效链条是：`OverviewCards` 把 `overview-card__value` 作为透传属性交给
 * `AppTooltip`，而 `AppTooltip` 的根节点 `TooltipProvider` 只渲染插槽（片段根），
 * Vue 无法把透传属性落到任何元素上——浏览器实测该类在页面里命中 0 个元素，
 * 数值行退回 `.app-tooltip` 的 `inline-flex`（align-items 为 stretch、无 gap），
 * 1440 宽实测单位基线比主数值高 9px、两段文字间距为 0。
 *
 * 因此下面既验证透传属性真的落到了触发元素上，也验证数值行是 Tooltip **内部**
 * 一个独立的容器，并且有提示 / 无提示两条分支的数值行结构与类名完全一致。
 * 对照基准是 Komari Glassmorphism `bf83765` 的 `NodeGeneralCards.vue`：
 * `DataTooltip` 内部是 `div.flex.items-baseline.gap-1.min-w-0`，
 * 主数值与单位是它的直接子元素。
 */

/** CFSM 的内存 / 硬盘字段单位是 MiB，`formatDisplayMebibytesSplit` 会再乘 1024²。 */
const MiB = 1024

function glass(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'source:node', id: 'node', sourceBase: 'https://status.example', sourceLabel: 'status.example',
    name: 'Acme Hong Kong Edge', group: 'Production', tags: [], providerTags: { asn: null, org: null }, region: 'HK',
    price: null, billingCycle: null, currency: null, expireDate: null, trafficLimit: null,
    trafficCalculationType: null, showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: null, cpu: null, load: { one: null, five: null, fifteen: null },
    memory: { used: 42 * MiB, total: 80 * MiB, percentage: 52.5 },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: { inSpeed: null, outSpeed: null, received: null, transmitted: null, monthlyReceived: null, monthlyTransmitted: null },
    processes: null, tcpConnections: null, udpConnections: null, latency: [],
    history: { latencySeries: {}, packetLossSeries: {} }, gpus: [],
    connectivity: { ipv4: null, ipv6: null }, operatingSystem: null, architecture: null,
    cpuInfo: null, cpuCores: null, kernelVersion: null, agentVersion: null, bootTime: null, lastUpdated: null,
    ...overrides,
  }
}

/** Vue 的 SSR 片段注释（`<!--[-->` 等）不是 DOM 结构，比对前先去掉。 */
async function renderOverview(keys: string): Promise<string> {
  const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
  settings.generalCardPreset = '自定义'
  settings.generalCardKeys = keys
  const app = createSSRApp(OverviewCards, { servers: [glass()], settings })
  const html = await renderToString(app)
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 取某个类所在元素的**首个子节点**，用来断言父子关系而不依赖属性顺序。 */
function firstChildAfter(html: string, className: string): string {
  const at = html.indexOf(className)
  expect(at, `${className} 应当出现在渲染结果里`).toBeGreaterThan(-1)
  return html.slice(html.indexOf('>', at) + 1)
}

const overviewSource = readFileSync(new URL('../src/components/dashboard/OverviewCards.vue', import.meta.url), 'utf8')
const tooltipSource = readFileSync(new URL('../src/components/ui/AppTooltip.vue', import.meta.url), 'utf8')
const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): string {
  const start = stylesheet.indexOf(`${selector} {`)
  expect(start, `${selector} 应当存在`).toBeGreaterThan(-1)
  return stylesheet.slice(start, stylesheet.indexOf('}', start))
}

describe('round 16 overview card value row', () => {
  it('lands the call-site class on the real trigger element', async () => {
    const html = await renderOverview('memory')
    expect(html).toContain('class="app-tooltip overview-card__value-slot"')
  })

  it('renders the value row as its own container inside the tooltip trigger', async () => {
    const html = await renderOverview('memory')

    // 数值行是触发元素**内部**的独立容器，而不是触发元素自己。
    expect(firstChildAfter(html, 'overview-card__value-slot')).toContain('<div class="overview-card__value">')

    // 主数值与单位是数值行的直接子元素，中间没有额外包裹层。
    const row = firstChildAfter(html, 'class="overview-card__value"')
    expect(row.startsWith('<span class="overview-card__number">')).toBe(true)
    expect(row).toContain('</span><span class="overview-card__unit">')
  })

  it('keeps one value row per card and never leaves an empty unit placeholder', async () => {
    const html = await renderOverview('memory')
    expect(html.match(/overview-card__value"/g)).toHaveLength(1)
    expect(html.match(/overview-card__value-slot/g)).toHaveLength(1)
    expect(html).not.toContain('<span class="overview-card__unit"></span>')
  })

  /*
   * 真实数据下每张总览卡都带 `hint`，`v-else` 分支跑不到，所以这里替换掉数据源，
   * 让组件真的渲染无提示分支：它必须仍然是同一个 `.overview-card__value` 容器，
   * 只是外面不再包一层 Tooltip 触发器。
   */
  it('renders the no-tooltip branch with the same value row container', async () => {
    vi.resetModules()
    vi.doMock('@/domain/theme-presentation', () => ({
      buildGeneralCards: () => [
        { key: 'memory', icon: 'icon-park-outline:memory', label: '内存用量', value: '42.0', unit: 'GB / 80.0 GB', hint: '' },
      ],
    }))
    try {
      const { default: Cards } = await import('@/components/dashboard/OverviewCards.vue')
      const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
      const html = (await renderToString(createSSRApp(Cards, { servers: [glass()], settings })))
        .replace(/<!--[\s\S]*?-->/g, '')

      expect(html).not.toContain('overview-card__value-slot')
      expect(html).not.toContain('app-tooltip')

      const row = firstChildAfter(html, 'class="overview-card__value"')
      expect(row.startsWith('<span class="overview-card__number">')).toBe(true)
      expect(row).toContain('</span><span class="overview-card__unit">')
    }
    finally {
      vi.doUnmock('@/domain/theme-presentation')
      vi.resetModules()
    }
  })

  it('uses an identical value row in the tooltip and the no-tooltip branch', () => {
    const rows = [...overviewSource.matchAll(
      /<span class="overview-card__number">\{\{ card\.value \}\}<\/span>\s*<span v-if="card\.unit" class="overview-card__unit">\{\{ card\.unit \}\}<\/span>/g,
    )].map(match => match[0].replace(/\s+/g, ' '))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(rows[1])
    expect(overviewSource).toContain('<div v-else class="overview-card__value">')
  })

  it('forwards fallthrough attributes to the tooltip trigger element', () => {
    expect(tooltipSource).toContain('defineOptions({ inheritAttrs: false })')
    expect(tooltipSource).toMatch(/<TooltipTrigger[^>]*class="app-tooltip"[^>]*v-bind="\$attrs"/)
  })

  it('pins the value row typography to the upstream measurements', () => {
    const value = block('.overview-card__value')
    expect(value).toContain('display: flex')
    expect(value).toContain('align-items: baseline')
    expect(value).toContain('gap: 4px')

    // 包裹层必须是布局中性的 block，覆盖 `.app-tooltip` 的 inline-flex。
    const slot = block('.overview-card__value-slot')
    expect(slot).toContain('display: block')
    expect(slot).toContain('min-width: 0')
    expect(stylesheet.indexOf('.overview-card__value-slot {')).toBeGreaterThan(stylesheet.indexOf('.app-tooltip {'))

    // 上游 `text-[11px]` 行高按 1.5 解析（实测 16.5px），`md:text-xs` 是 16px。
    expect(block('.overview-card__unit')).toContain('line-height: 1.5')
    const mediaStart = stylesheet.indexOf('@media (min-width: 768px)', stylesheet.indexOf('.overview-card__unit {'))
    expect(stylesheet.slice(mediaStart, mediaStart + 400)).toContain('line-height: 16px')

    // 上游标题是 `text-xs`：12px / 16px。
    expect(block('.overview-card__label')).toContain('line-height: 16px')
  })

  it('keeps the scrolled header transparent like the upstream top bar', () => {
    const scrolled = block('.app-header--scrolled')
    expect(scrolled).toContain('background: transparent')
    expect(scrolled).toContain('box-shadow: none')
    expect(scrolled).toContain('backdrop-filter: blur(16px)')
    expect(scrolled).not.toContain('--glass-strong')
    expect(scrolled).not.toContain('saturate')
  })
})
