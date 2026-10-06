import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { glassSurfaceTokens, resolveGlassSurfaces } from '@/domain/glass-surfaces'

/*
 * 基线是 Komari `utils/glassTheme.ts`（v3.3.7）的 `PRESET_TOKENS`。上一轮只把文字色
 * 对齐到上游，表面色仍是本主题自拟值；这一轮四套内置预设的 16 个值必须逐字相同。
 */
const UPSTREAM_EMERALD = {
  lightCard: '#f1f5f9bd',
  lightCardHover: '#f8fafccc',
  lightControl: '#e2e8f0c2',
  lightHeader: '#e2e8f0bd',
  lightText: '#10151c',
  lightMutedText: '#374151',
  lightBorder: '#cbd5e199',
  lightShadow: '0 8px 28px rgb(15 23 42 / 0.18)',
  darkCard: '#0d111ad9',
  darkCardHover: '#111827e8',
  darkControl: '#101624d9',
  darkHeader: '#0b1020d9',
  darkText: '#f8fafc',
  darkMutedText: '#d6dae4',
  darkBorder: '#ffffff2e',
  darkShadow: '0 8px 30px rgb(0 0 0 / 0.48)',
}

const CUSTOM = JSON.stringify({
  lightCard: '#11223344',
  lightControl: '#22334455',
  lightText: '#000000',
  lightMutedText: '#111111',
  lightBorder: '#333333',
  darkCard: '#44556677',
  darkControl: '#55667788',
  darkText: '#ffffff',
  darkMutedText: '#eeeeee',
  darkBorder: '#cccccc',
})

describe('毛玻璃表面色对齐上游预设', () => {
  it('翡翠逐字等于上游 emerald 的 16 个值', () => {
    expect(glassSurfaceTokens('翡翠', '')).toEqual(UPSTREAM_EMERALD)
  })

  it('其余三套内置预设的表面色也取自上游', () => {
    expect(glassSurfaceTokens('柔和', '').lightCard).toBe('#f8fafcdb')
    expect(glassSurfaceTokens('高对比', '').darkCard).toBe('#020617f2')
    expect(glassSurfaceTokens('午夜', '').darkBorder).toBe('#60a5fa40')
    expect(glassSurfaceTokens('午夜', '').lightShadow).toBe('0 8px 30px rgb(30 64 175 / 0.18)')
  })

  it('自定义按上游规则派生 hover / header / shadow，不要求用户多填字段', () => {
    const tokens = glassSurfaceTokens('自定义', CUSTOM)
    expect(tokens.lightCardHover).toBe('#112233e6')
    expect(tokens.darkCardHover).toBe('#445566e6')
    expect(tokens.lightHeader).toBe('#22334455')
    expect(tokens.darkHeader).toBe('#55667788')
    expect(tokens.lightShadow).toBe('0 8px 28px rgb(15 23 42 / 0.16)')
    expect(tokens.lightText).toBe('#000000')
  })

  it('六位十六进制不追加 hover alpha', () => {
    const custom = CUSTOM.replace('#11223344', '#112233')
    expect(glassSurfaceTokens('自定义', custom).lightCardHover).toBe('#112233')
  })

  it('自定义配色无效时回落到翡翠，不留空值', () => {
    expect(glassSurfaceTokens('自定义', 'not json')).toEqual(glassSurfaceTokens('翡翠', ''))
  })

  it('按当前明暗取出对应的一套', () => {
    const tokens = glassSurfaceTokens('翡翠', '')
    expect(resolveGlassSurfaces(tokens, false).card).toBe(tokens.lightCard)
    expect(resolveGlassSurfaces(tokens, true).card).toBe(tokens.darkCard)
    expect(resolveGlassSurfaces(tokens, true).shadow).toBe(tokens.darkShadow)
  })
})

describe('表面变量的作用范围', () => {
  const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../src/stores/theme-settings.ts', import.meta.url), 'utf8')

  it('节点卡消费独立的预设变量，并保留无 JS 时的回退', () => {
    expect(stylesheet).toContain('background: var(--node-card-surface, var(--card-surface))')
    expect(stylesheet).toContain('border: 1px solid var(--node-card-border, var(--card-surface-border))')
    expect(stylesheet).toContain('box-shadow: var(--node-card-shadow, var(--card-surface-shadow))')
  })

  it('预设不再整表覆盖应用界面的 --glass*', () => {
    expect(store).not.toContain("setProperty('--glass',")
    expect(store).not.toContain("setProperty('--glass-strong'")
    expect(store).not.toContain("setProperty('--glass-soft'")
    expect(store).not.toContain("setProperty('--glass-hover'")
    expect(store).not.toContain("setProperty('--glass-border'")
    expect(store).toContain("setProperty('--node-card-surface'")
  })

  it('--glass* 在 :root 有默认值，停止 JS 覆盖后应用界面不会塌掉', () => {
    expect(stylesheet).toContain('--glass: rgb(246 249 252 / 72%)')
    expect(stylesheet).toContain('--glass-strong: rgb(13 20 32 / 91%)')
  })
})
