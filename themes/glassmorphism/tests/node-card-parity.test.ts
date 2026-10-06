import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { trafficStatus, trafficTextTone, usageStatus } from '@/utils/progress-status'

/*
 * 第二阶段 Test 2 的首页节点卡回归。取值全部来自 Komari（bf83765）页面的浏览器实测
 * （1440×900，浅色，同一台机器），不是照模板类名推断：
 * - mini 档指标区是 `grid-cols-[3fr_2fr]`，左栏 CPU / 内存只有图标；
 * - 标签文字是玻璃卡片里的次要色，只有图标着 Tailwind 500 档的颜色；
 * - 进度条是纯色 success / warning / destructive，轨道是 `bg-muted`；
 * - 离线遮罩只盖内容区；模板里的红圈被玻璃样式覆盖，实际页面没有；
 * - 配色预设的文字色只在节点卡内部生效。
 */

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '')
const stylesheet = strip(readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8'))
const serverCard = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')
const homeView = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')
const themeStore = readFileSync(new URL('../src/stores/theme-settings.ts', import.meta.url), 'utf8')
const glassSurfaces = readFileSync(new URL('../src/domain/glass-surfaces.ts', import.meta.url), 'utf8')

function block(selector: string): string {
  const start = stylesheet.indexOf(`\n${selector} {`)
  expect(start, `未找到选择器 ${selector}`).toBeGreaterThan(-1)
  return stylesheet.slice(start, stylesheet.indexOf('}', start))
}

describe('进度条状态照上游阈值，不再跟随「高负载阈值」', () => {
  it('CPU / 内存 / 硬盘：<60 success、<80 warning、其余 error（Komari getStatus）', () => {
    expect([0, 59.9, 60, 79.9, 80, 100].map(usageStatus))
      .toEqual(['success', 'success', 'warning', 'warning', 'error', 'error'])
    expect(usageStatus(null)).toBe('success')
  })

  it('流量：无配额 success，≥60 info，≥80 warning，≥95 error（Komari trafficStatus）', () => {
    expect([null, 59, 60, 80, 95].map(trafficStatus)).toEqual(['success', 'success', 'info', 'warning', 'error'])
  })

  it('流量百分比文字：无配额 muted，≥60 warning，≥95 destructive，其余 success', () => {
    expect([null, 10, 60, 94.9, 95].map(trafficTextTone)).toEqual(['muted', 'success', 'warning', 'warning', 'danger'])
  })

  it('节点卡与列表视图都用这组函数，卡片不再接收 highLoadThreshold', () => {
    expect(serverCard).toContain('usageStatus(server.cpu)')
    expect(serverCard).toContain('trafficStatus(trafficPercent)')
    expect(serverCard).not.toContain('highLoadThreshold')
    expect(homeView).not.toContain('high-load-threshold')
  })

  it('填充是纯色，轨道是上游 bg-muted', () => {
    expect(block('.resource-meter__fill--success')).toContain('background: var(--success)')
    expect(block('.resource-meter__fill--warning')).toContain('background: var(--warning)')
    expect(block('.resource-meter__fill--error')).toContain('background: var(--destructive)')
    expect(block('.resource-meter__track')).toContain('background: var(--progress-track)')
    expect(stylesheet).not.toContain('linear-gradient(90deg, var(--emerald)')
    expect(stylesheet).toContain('--success: oklch(0.696 0.17 162.48);')
    expect(stylesheet).toContain('--progress-track: oklch(0.967 0.001 286.375);')
  })
})

describe('mini 档是上游的另一套结构，不是四项挤成三列', () => {
  it('外层 3fr / 2fr，左栏再分两列放 CPU 与内存', () => {
    expect(block('.node-metrics--mini')).toContain('grid-template-columns: 3fr 2fr')
    expect(block('.node-metrics--mini')).toContain('gap: 8px 16px')
    expect(block('.node-metrics__pair')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(block('.node-metrics__pair')).toContain('gap: 4px 12px')
    expect(stylesheet).not.toContain('3fr 3fr 4fr')
  })

  it('CPU 与内存只有图标（带无障碍名称），内存用量占满左栏', () => {
    expect(serverCard).toContain('class="node-metrics__pair"')
    expect(serverCard).toContain('role="img" title="CPU" aria-label="CPU"')
    expect(serverCard).toContain('role="img" title="内存" aria-label="内存"')
    expect(block('.node-metrics__pair > .node-metric__hint')).toContain('grid-column: 1 / -1')
  })
})

describe('标签只有图标着色，文字与提示行是次要色', () => {
  it('图标取 Tailwind v4 500 档（上游实测计算值）', () => {
    expect(block('.node-metric__label--cpu > .app-icon')).toContain('oklch(0.685 0.169 237.323)')
    expect(block('.node-metric__label--memory > .app-icon')).toContain('oklch(0.696 0.17 162.48)')
    expect(block('.node-metric__label--disk > .app-icon')).toContain('oklch(0.705 0.213 47.604)')
    expect(block('.node-metric__label--traffic > .app-icon')).toContain('oklch(0.606 0.25 292.717)')
    // 标签本身不再按指标上色。
    expect(stylesheet).not.toMatch(/\n\.node-metric__label--(cpu|memory|disk|traffic) \{/)
  })

  it('提示行是次要色，流量用量 ≥95% 时换成 destructive', () => {
    expect(block('.node-metric__hint')).toContain('color: var(--muted)')
    expect(block('.node-metric__hint--danger')).toContain('color: var(--destructive)')
  })

  it('上行 success、下行 blue-600，盒子与面板是玻璃主题覆盖后的白色 15%', () => {
    expect(block('.node-box__row--up')).toContain('color: var(--success)')
    expect(block('.node-box__row--down')).toContain('oklch(0.546 0.245 262.881)')
    expect(block('.node-box')).toContain('background: rgb(255 255 255 / 15%)')
    expect(block('.node-probe')).toContain('background: rgb(255 255 255 / 15%)')
  })

  it('标签边框用不受预设影响的基础次要色', () => {
    expect(block('.node-tag')).toContain('color-mix(in oklab, var(--muted-base) 15%, transparent)')
  })
})

describe('离线卡照上游实际页面', () => {
  it('遮罩只盖内容区：上 0、左右与底部让出 16px 内边距', () => {
    const overlay = block('.node-card__offline')
    expect(overlay).toContain('inset: 0 16px 16px')
    expect(overlay).toContain('border-radius: 14px')
    expect(overlay).toContain('background: rgb(255 255 255 / 20%)')
    expect(stylesheet).not.toContain('inset: -14px')
  })

  it('没有红圈，面板模糊 4px 并半透明', () => {
    expect(stylesheet).not.toMatch(/\n\.node-card--offline \{/)
    expect(block('.node-card--offline .node-probe')).toContain('filter: blur(4px)')
    expect(block('.node-card--offline .node-probe')).toContain('opacity: 0.5')
  })

  it('时间是完整的年月日时分秒，不带前缀', () => {
    expect(serverCard).toContain('`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `')
    expect(serverCard).not.toContain('最后上报')
  })
})

describe('配色预设的文字色只在节点卡内部生效', () => {
  it('运行时只写 --glass-text / --glass-muted-text，不再覆盖全局 --ink / --muted', () => {
    expect(themeStore).toContain("root.style.setProperty('--glass-text', surfaces.text)")
    expect(themeStore).toContain("root.style.setProperty('--glass-muted-text', surfaces.mutedText)")
    expect(themeStore).not.toContain("setProperty('--ink'")
    expect(themeStore).not.toContain("setProperty('--muted'")
  })

  it('节点卡内部接管，其余地方是上游基础色', () => {
    const card = block('.node-card')
    expect(card).toContain('--ink: var(--glass-text, oklch(0.11 0.01 285.823))')
    expect(card).toContain('--muted: var(--glass-muted-text, oklch(0.34 0.02 285.938))')
    const root = stylesheet.slice(stylesheet.indexOf(':root {\n  color-scheme: light;'), stylesheet.indexOf(':root[data-theme=\'dark\'] {\n  color-scheme: dark;'))
    expect(root).toContain('--ink: oklch(0.11 0.01 285.823)')
    expect(root).toContain('--muted: oklch(0.34 0.02 285.938)')
  })

  // 预设表格第 13 轮起在 `domain/glass-surfaces.ts`（与上游 PRESET_TOKENS 同构）。
  it('预设文字色逐字取自上游 glassTheme.ts', () => {
    for (const pair of [
      ["lightText: '#10151c'", "lightMutedText: '#374151'"],
      ["lightText: '#14151a'", "lightMutedText: '#4b5563'"],
      ["lightText: '#080b12'", "lightMutedText: '#1f2937'"],
      ["lightText: '#0f172a'", "lightMutedText: '#334155'"],
    ]) {
      for (const entry of pair) expect(glassSurfaces).toContain(entry)
    }
  })
})
