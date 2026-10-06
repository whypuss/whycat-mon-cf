import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  baseTooltip,
  cpuChartOption,
  memoryChartOption,
  metricSeriesChartOption,
  networkChartOption,
} from '@/domain/detail-chart-options'
import { buildGeneralCards } from '@/domain/theme-presentation'
import { getChartSeriesPalette, getChartThemeColors, getLoadChartPalette } from '@/utils/chart-palette'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

/*
 * 注释里会出现被删掉的那些声明名（用于解释为什么删），所以断言一律跑在
 * 去掉注释之后的副本上，否则会断在自己写的说明文字上。
 */
const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const serverCard = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')

/*
 * 第 15 轮的字体一致性回归。
 *
 * 基准是 Komari Glassmorphism `bf83765`：
 * - `styles/main.css` 的 `--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`，
 *   `@layer base` 只设 background 与 font-family，**没有** `font-synthesis` / `text-rendering`。
 * - `components/NodeCard.vue`：指标数值 `tabular-nums font-medium`（500），
 *   延迟 / 丢包面板数值 `<span class="font-medium">`（500，无 tabular-nums）。
 * - `components/ui/badge/index.ts`：`h-5 … px-2 py-0.5 text-xs font-medium` → 12px / 500 / 16px。
 * - `components/Header.vue`：站点名 `m-0 text-lg font-semibold` → 18px / 600 / 无负字距。
 * - `components/MetricSeriesChartCard.vue`：tooltip `textStyle: { fontSize: 12 }`。
 *
 * 浏览器实测（Chrome / Windows / zh-CN，`system-ui` 解析为微软雅黑）：该字族只有
 * Regular 与 Bold 两档实体字面，CSS 字重匹配把 500 落到 Regular、把 ≥550 落到 Bold。
 * 因此「600 而不是 500」不是一个纸面差异，而是整列数字直接变成粗体。
 */

function cssBlock(selector: string): string {
  const start = stylesheet.indexOf(`${selector} {`)
  expect(start, `未找到选择器 ${selector}`).toBeGreaterThan(-1)
  return stylesheet.slice(start, stylesheet.indexOf('}', start))
}

describe('全局字体令牌逐字对齐 Komari', () => {
  it('字体栈与上游 --font-sans 完全一致，不追加额外字族', () => {
    const root = stylesheet.slice(stylesheet.indexOf(':root {'), stylesheet.indexOf('--page:'))
    expect(root).toContain('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif')
    expect(root).not.toContain('Microsoft YaHei')
  })

  it('不保留 Vite 模板自带的 font-synthesis / text-rendering', () => {
    expect(stylesheet).not.toContain('font-synthesis')
    expect(stylesheet).not.toContain('optimizeLegibility')
  })
})

describe('字重落在与上游相同的实体字面上', () => {
  it('首页指标数值是 500，对应上游的 font-medium', () => {
    expect(cssBlock('.node-metric__value')).toContain('font-weight: 500')
  })

  it('延迟 / 丢包面板数值是 500，且不加上游没有的 tabular-nums', () => {
    const probe = cssBlock('.node-probe__value')
    expect(probe).toContain('font-weight: 500')
    expect(probe).not.toContain('tabular-nums')
  })

  it('徽章是 12px / 500 / 16px，对应上游 badgeVariants 的 text-xs font-medium', () => {
    const badge = cssBlock('.app-badge')
    expect(badge).toContain('font-size: 12px')
    expect(badge).toContain('font-weight: 500')
    expect(badge).toContain('line-height: 16px')
  })

  it('站点名是 600 且不加负字距，对应上游 text-lg font-semibold', () => {
    const brand = cssBlock('.brand__copy strong')
    expect(brand).toContain('font-weight: 600')
    expect(brand).not.toContain('letter-spacing')
  })

  it('图表卡标题是 600 且不加负字距，对应上游 MetricChartHeader 的 text-sm font-semibold sm:text-base', () => {
    const heading = cssBlock('.metric-chart-header__title')
    expect(heading).toContain('font-size: 14px')
    expect(heading).toContain('font-weight: 600')
    expect(heading).not.toContain('letter-spacing')
    expect(stylesheet).toContain('.metric-chart-header__title {\n    font-size: 16px;\n    line-height: 24px;')
  })

  it('图表卡右侧最新值是 12px / 16px 的 muted 文字，对应上游 text-xs text-muted-foreground', () => {
    const value = cssBlock('.metric-chart-header__value')
    expect(value).toContain('font-size: 12px')
    expect(value).toContain('line-height: 16px')
    expect(value).toContain('color: var(--muted)')
  })
})

describe('canvas 内的图表文字', () => {
  const theme = getChartThemeColors(false)
  const context = { rows: [], hours: 1, load: getLoadChartPalette(false), series: getChartSeriesPalette(false), theme }

  it('tooltip 字号与上游一致：LoadChart / PingChart 12px 行高 20，MetricSeriesChartCard 12px', () => {
    expect(baseTooltip(theme).textStyle).toMatchObject({ fontSize: 12, lineHeight: 20 })
    expect(metricSeriesChartOption([], theme).tooltip.textStyle.fontSize).toBe(12)
  })

  it('坐标轴与图例字号照抄上游：内联卡 11px，卡片图 10px', () => {
    const cpu = cpuChartOption(context)
    expect(cpu.xAxis.axisLabel.fontSize).toBe(11)
    expect(cpu.yAxis[0]?.axisLabel.fontSize).toBe(11)
    expect(memoryChartOption(context).legend.textStyle.fontSize).toBe(10)
    expect(networkChartOption(context).legend.textStyle.fontSize).toBe(11)
    const card = metricSeriesChartOption([], theme)
    expect(card.xAxis.axisLabel.fontSize).toBe(10)
    expect(card.legend.textStyle.fontSize).toBe(10)
  })
})

/*
 * 六列栅格下总览卡的内容宽度只有 90 多 px。768px 实测：本主题 `455.0` 主数值
 * clientWidth 43 / scrollWidth 63，单位 `GB / 1.56 TB` 48 / 71；上游同宽度下
 * `258.6` 只有 38 / 63、单位 48 / 80，截得更狠，而且 memory / disk / swap 三张卡
 * 在上游**根本没有 tooltip**（`tooltip` 字段未定义，DataTooltip 不渲染气泡）。
 * 完整值因此在两边都读不出来，属于必须处理的可访问性缺口而不是「上游同等行为」。
 */
function server(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    id: 'n1',
    source: { base: 'https://status.example', label: 'status.example' },
    name: 'node-1',
    online: true,
    cpu: 10,
    cpuCores: 2,
    cpuModel: null,
    architecture: null,
    virtualization: null,
    operatingSystem: 'Ubuntu 24.04.4 LTS',
    kernel: null,
    region: 'HK',
    group: null,
    tags: [],
    load: { one: 0.1, five: 0.1, fifteen: 0.1 },
    memory: { used: 4096, total: 8192, percentage: 50 },
    swap: { used: 0, total: 0, percentage: null },
    disk: { used: 466944, total: 1638400, percentage: 28.5 },
    diskIo: null,
    network: { inSpeed: 0, outSpeed: 0, received: 0, transmitted: 0, monthlyReceived: null, monthlyTransmitted: null },
    gpus: [],
    processes: 100,
    tcpConnections: 10,
    udpConnections: 5,
    uptimeSeconds: 3600,
    lastUpdated: Date.now(),
    latency: [],
    history: { latencySeries: {}, packetLossSeries: {} },
    price: null,
    billingCycle: null,
    expiredAt: null,
    trafficLimit: null,
    trafficPolicy: null,
    ipV4Reachable: null,
    ipV6Reachable: null,
    ...overrides,
  } as GlassServer
}

describe('被截断的总览数值仍然可读（D-02）', () => {
  const settings = { ...cloneThemeSettings(DEFAULT_THEME_SETTINGS), generalCardPreset: '完整' as const }

  it('内存 / 硬盘 / 交换内存的 tooltip 带完整的已用与总量', () => {
    const cards = buildGeneralCards([server()], settings)
    const disk = cards.find((card) => card.key === 'disk')
    expect(disk).toBeDefined()
    // 卡面只放得下 `456.0` 与被截断的 `GB / 1.56 TB`，气泡里必须能读到两段完整值。
    expect(disk?.hint).toContain(disk?.value ?? '__missing__')
    expect(disk?.hint).toContain('GB')
    expect(disk?.hint).toContain('TB')
    expect(disk?.hint).toContain('%')

    const memory = cards.find((card) => card.key === 'memory')
    expect(memory?.hint).toContain(memory?.value ?? '__missing__')
    expect(memory?.hint).toContain('%')
  })

  it('系统分布 / 地区分布的 tooltip 列出完整名称与台数，对应上游 formatDistributionTooltip', () => {
    const cards = buildGeneralCards([server(), server({ id: 'n2', operatingSystem: 'Debian GNU/Linux 12', region: 'JP' })], settings)
    const system = cards.find((card) => card.key === 'systemDistribution')
    expect(system?.hint).toContain('Ubuntu 24.04.4 LTS: 1 台')
    expect(system?.hint).toContain('Debian GNU/Linux 12: 1 台')

    const region = cards.find((card) => card.key === 'regionDistribution')
    expect(region?.hint).toContain('HK: 1 台')
    expect(region?.hint).toContain('JP: 1 台')
  })

  it('没有任何节点时分布 tooltip 说明暂无数据，而不是留空', () => {
    const cards = buildGeneralCards([], settings)
    expect(cards.find((card) => card.key === 'systemDistribution')?.hint).toBe('暂无数据')
  })
})

/*
 * 第二阶段 Test 1：节点卡盒模型逐行对齐（1440 浅色，同一浏览器，同一时刻）。
 *
 * 上游 `bf83765` 实测：卡片 padding 0 / 无 gap / 边框 1px，头部 `px-4 py-3`
 * （12px 16px，高 44），主体 `p-4 pt-0`（0 16px 16px，高 285.81），
 * 五行高度 19 / 97.41 / 45.41 / 44 / 20，延迟面板 padding 8 + gap 6、高 44、柱区 11。
 *
 * 修复前后（本主题，同一环境）：
 *   行高   18.84 / 92 / 45.41 / 45 / 18.5  →  18.84 / 97.44 / 45.41 / 44 / 20
 *   卡片   333.75（+1.94）                 →  331.69（−0.12）
 *   头部   24（卡片级 14px 内边距近似）     →  44
 *   内容宽 273（比上游多 4px）             →  269
 * 375 与 768 档同步复测：卡片 x/y/宽、总览卡片几何、页面无横向溢出均未变化。
 */
describe('节点卡盒模型照抄上游，而不是用内边距抵消行盒误差', () => {
  // 必须按行首匹配：`.node-probe__bars {` 也是 `.node-card--mini .node-probe__bars {` 的子串。
  function block(selector: string): string {
    const start = stylesheet.indexOf(`
${selector} {`)
    expect(start, `未找到 ${selector}`).toBeGreaterThan(-1)
    return stylesheet.slice(start, stylesheet.indexOf('}', start))
  }

  it('卡片本身不再自带内边距与 gap，改由头部与主体各自承担', () => {
    const card = block('.node-card--compact')
    expect(card).toContain('padding: 0')
    expect(card).toContain('gap: 0')
    expect(block('.node-card--compact .node-card__header')).toContain('padding: 12px 16px')
    expect(block('.node-card--compact .node-card__body')).toContain('padding: 0 16px 16px')
    // 上游这一行带 -mt-1，mini 档早就有，compact 档本轮补上。
    expect(block('.node-card--compact .node-card__chips')).toContain('margin-top: -4px')
  })

  it('卡内文字行盒取上游的具体行高，不是 normal', () => {
    expect(block('.node-metric__label')).toContain('line-height: 16px')
    expect(block('.node-metric__value')).toContain('line-height: 16px')
    expect(block('.node-metric__hint')).toContain('line-height: 15.7143px')
    expect(block('.node-tag')).toContain('height: 20px')
  })

  it('延迟 / 丢包面板的盒模型与上游一致', () => {
    const probe = block('.node-probe')
    expect(probe).toContain('padding: 8px')
    expect(probe).toContain('gap: 6px')
    expect(probe).toContain('min-height: 44px')
    expect(block('.node-probe__bars')).toContain('min-height: 11px')
  })
})

/*
 * 第二阶段 Test 1 rc2：节点卡第三个盒子「剩余 N 天」被切在字形中间。
 *
 * 线上（test.1）实测，303px 卡片下该行可用宽 74px：
 *   剩余 78 天   68.91px  放得下
 *   剩余 662 天  75.36px  溢出 1.36px
 *   剩余 1653 天 81.81px  溢出 7.81px
 * 四个 span 全是 `flex: 0 0 auto` 且无省略号，overflow: hidden 直接切在字形中间。
 *
 * 上游这两行用的是 `gap-0.5`（2px），只有前两个盒子才是 `gap-1`（4px）；
 * 本主题三个盒子统一 4px，三个间隙多占 6px。改回 2px 后：
 *   剩余 401 天  69.36px  放得下（余 4.64px）
 *   剩余 1655 天 75.81px  仍溢出 1.81px —— 该数值与上游同一算法得数相同
 * 因此整行另挂原生 title，超出时仍可读回完整值。
 */
describe('剩余天数行按上游收紧间隙', () => {
  function block(selector: string): string {
    const start = stylesheet.indexOf(`\n${selector} {`)
    expect(start, `未找到 ${selector}`).toBeGreaterThan(-1)
    return stylesheet.slice(start, stylesheet.indexOf('}', start))
  }

  it('第三个盒子的行间隙是上游的 2px，前两个盒子仍是 4px', () => {
    expect(block('.node-box__row--remaining')).toContain('gap: 2px')
    expect(block('.node-box__row')).toContain('gap: 4px')
  })

  /*
   * rc2 之后用户仍能看到「天」被削掉一截，而 Komari 原版完整。两边 scrollWidth 都是 76、
   * 行宽都是 74——差别在**哪一层裁切**：上游行本身 overflow: visible，溢出部分伸进盒子
   * 右侧 6px 内边距、到盒子内边距外沿才裁；本主题行上多一层 overflow: hidden，在行边就裁。
   * 实测 1440：上游裁切边 x=376.98、「天」墨迹止于 374.14，削掉 0；
   * 本主题裁切边 x=370.98，削掉 3.16px。
   */
  it('行本身不裁切，裁切只发生在盒子层，与上游一致', () => {
    expect(block('.node-box__row')).not.toContain('overflow: hidden')
    expect(block('.node-box')).toContain('overflow: hidden')
    // 单文本行的截断仍由文字 span 自己负责（上游 truncate min-w-0 overflow-hidden）。
    const text = block('.node-box__text')
    expect(text).toContain('overflow: hidden')
    expect(text).toContain('text-overflow: ellipsis')
    expect(text).toContain('min-width: 0')
  })

  it('整行挂完整文本的 title，超出时仍可读回', () => {
    expect(serverCard).toContain('node-box__row--remaining')
    expect(serverCard).toContain(':title="expiryFullText"')
    expect(serverCard).toContain(':title="remainingValueText"')
  })
})
