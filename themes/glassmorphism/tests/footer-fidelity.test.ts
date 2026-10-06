import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 页脚样式对齐 Komari `Footer.vue`（审计矩阵 38）。
 *
 * 上游：外层 `w-full max-w-[1280px] mx-auto p-4`，内层
 * `flex flex-row justify-between gap-4 text-xs text-muted-foreground`；
 * 链接文字 `font-medium text-foreground`，`transition-opacity hover:opacity-80`。
 * Tailwind v4 的 `text-xs` 是 12px / 16px，`p-4` 与 `gap-4` 是 16px，`gap-1` 是 4px。
 * 此前本主题是 9px、`--faint` 色、`18px 2px 24px` 内边距、680 字重、悬停变绿，
 * 并在窄屏改为上下堆叠；上游没有任何响应式变体。
 * 文字内容按规格第 82 节归因到 CF-Server-Monitor，不在这里约束。
 */

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')

function block(selector: string): string {
  const start = stylesheet.indexOf(`${selector} {`)
  expect(start).toBeGreaterThan(-1)
  return stylesheet.slice(start, stylesheet.indexOf('}', start))
}

describe('页脚对齐 Komari Footer.vue 的计算样式', () => {
  it('字号、行高、颜色、内边距、间距与宽度按上游取值', () => {
    const footer = block('.app-footer')
    expect(footer).toContain('font-size: 12px')
    expect(footer).toContain('line-height: 16px')
    expect(footer).toContain('color: var(--muted)')
    expect(footer).toContain('padding: 16px')
    expect(footer).toContain('gap: 16px')
    expect(footer).toContain('max-width: 1280px')
    expect(footer).toContain('justify-content: space-between')
    expect(footer).not.toContain('9px')
  })

  it('左右两段按上游 gap-1 排列，右段可换行并右对齐', () => {
    expect(block('.app-footer > span')).toContain('gap: 4px')
    const right = block('.app-footer > span:last-child')
    expect(right).toContain('flex-wrap: wrap')
    expect(right).toContain('justify-content: flex-end')
    expect(right).toContain('text-align: right')
  })

  it('CFSM 归因文字更长：放不下时整段换到下一行并左对齐，不在词组中间折行', () => {
    expect(block('.app-footer')).toContain('flex-flow: row wrap')
    // 换行后由 space-between 排到行首；不额外推到右侧，避免窄屏上下两行错位。
    expect(block('.app-footer > span:last-child')).not.toContain('margin-left')
  })

  it('链接是 font-medium 的正文色，悬停只降低不透明度', () => {
    const link = block('.app-footer a')
    expect(link).toContain('color: var(--ink)')
    expect(link).toContain('font-weight: 500')
    expect(link).toContain('transition: opacity 150ms')
    const hover = block('.app-footer a:hover')
    expect(hover).toContain('opacity: 0.8')
    expect(hover).not.toContain('color')
  })

  it('与上游一样没有响应式变体', () => {
    const rules = [...stylesheet.matchAll(/^\s*([^\n{}]*\.app-footer[^\n{}]*)\{/gm)].map((match) => match[1]?.trim())
    expect(rules).toEqual([
      '.app-footer',
      '.app-footer > span',
      '.app-footer > span:last-child',
      '.app-footer a',
      '.app-footer a:hover',
    ])
  })

  it('所用令牌就是上游 --muted-foreground / --foreground 的明暗取值', () => {
    expect(stylesheet).toContain('--muted: oklch(0.34 0.02 285.938);')
    expect(stylesheet).toContain('--muted: oklch(0.86 0.012 286.067);')
    expect(stylesheet).toContain('--ink: oklch(0.11 0.01 285.823);')
    expect(stylesheet).toContain('--ink: oklch(0.985 0 0);')
  })
})
