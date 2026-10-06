import { parseGlassCustomColors, type GlassColorPreset } from '@/theme/settings'

/*
 * 毛玻璃表面色，逐字移植 Komari `utils/glassTheme.ts` 的 `PRESET_TOKENS` 与
 * `buildGlassThemeTokens`：四套内置预设的卡片、hover、控制条、头部、文字、边框与阴影
 * 取值与上游完全相同；自定义预设按上游同样的派生规则补齐 hover / header / shadow，
 * 因此不需要用户多填字段。
 *
 * 上游把这 16 个值写到 `:root`，样式表里写了三组选择器（上游 `styles/main.css`）：
 *   `.node-card, .bg-card, [data-slot='card']` → card / card-hover / border / shadow
 *   `header`                                   → header
 *   `.bg-background`                           → control / text / muted-text
 *
 * 写了规则不等于有元素消费。运行时实测：`header` 命中 0 个；`.bg-background` 的注释写着
 * 「顶部统计栏」，但统计卡的类是 `bg-background/50`，不命中，真正命中的是选中态的
 * 快捷筛选胶囊、连接失败提示里的「重试」、财务对话框的下拉框与描边按钮等。本主题据此
 * 只接三处：节点卡、激活态的快捷筛选胶囊、节点数据加载失败时的「重新加载」。
 * 其余消费者在本主题里没有对应元素，清单见 `docs/todo.md` TODO-03。
 */
export interface GlassSurfaceTokens {
  lightCard: string
  lightCardHover: string
  lightControl: string
  lightHeader: string
  lightText: string
  lightMutedText: string
  lightBorder: string
  lightShadow: string
  darkCard: string
  darkCardHover: string
  darkControl: string
  darkHeader: string
  darkText: string
  darkMutedText: string
  darkBorder: string
  darkShadow: string
}

const PRESET_TOKENS: Record<Exclude<GlassColorPreset, '自定义'>, GlassSurfaceTokens> = {
  翡翠: {
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
  },
  柔和: {
    lightCard: '#f8fafcdb',
    lightCardHover: '#f8fafceb',
    lightControl: '#f1f5f9e0',
    lightHeader: '#f1f5f9e0',
    lightText: '#14151a',
    lightMutedText: '#4b5563',
    lightBorder: '#cbd5e1a6',
    lightShadow: '0 8px 24px rgb(15 23 42 / 0.12)',
    darkCard: '#111827e6',
    darkCardHover: '#111827f2',
    darkControl: '#111827e0',
    darkHeader: '#0f172ae6',
    darkText: '#f8fafc',
    darkMutedText: '#cbd5e1',
    darkBorder: '#ffffff24',
    darkShadow: '0 8px 26px rgb(0 0 0 / 0.42)',
  },
  高对比: {
    lightCard: '#f8fafcf2',
    lightCardHover: '#f8fafcff',
    lightControl: '#f1f5f9f2',
    lightHeader: '#f1f5f9f2',
    lightText: '#080b12',
    lightMutedText: '#1f2937',
    lightBorder: '#cbd5e1cc',
    lightShadow: '0 10px 30px rgb(2 6 23 / 0.2)',
    darkCard: '#020617f2',
    darkCardHover: '#020617ff',
    darkControl: '#020617f0',
    darkHeader: '#020617f2',
    darkText: '#ffffff',
    darkMutedText: '#e5e7eb',
    darkBorder: '#ffffff3d',
    darkShadow: '0 10px 34px rgb(0 0 0 / 0.58)',
  },
  午夜: {
    lightCard: '#eaf4ffcc',
    lightCardHover: '#f3f8ffe6',
    lightControl: '#eaf4ffe0',
    lightHeader: '#eaf4ffd9',
    lightText: '#0f172a',
    lightMutedText: '#334155',
    lightBorder: '#c7ddff99',
    lightShadow: '0 8px 30px rgb(30 64 175 / 0.18)',
    darkCard: '#07111fcc',
    darkCardHover: '#0b1628e6',
    darkControl: '#07111fd9',
    darkHeader: '#07111fd9',
    darkText: '#eaf2ff',
    darkMutedText: '#c7d2fe',
    darkBorder: '#60a5fa40',
    darkShadow: '0 8px 34px rgb(0 0 0 / 0.52)',
  },
}

/** 上游 `withHoverAlpha`：八位十六进制色把 alpha 换成 `e6`，其余原样返回。 */
function withHoverAlpha(color: string): string {
  return color.length === 9 ? `${color.slice(0, 7)}e6` : color
}

/**
 * 上游 `buildGlassThemeTokens`。自定义配色无效时回落到「翡翠」，
 * 与此前 `activeColors` 的回落行为一致。
 */
export function glassSurfaceTokens(
  preset: GlassColorPreset,
  customColors: string,
): GlassSurfaceTokens {
  if (preset !== '自定义') return PRESET_TOKENS[preset]
  const custom = parseGlassCustomColors(customColors)
  if (custom === null) return PRESET_TOKENS.翡翠
  return {
    lightCard: custom.lightCard,
    lightCardHover: withHoverAlpha(custom.lightCard),
    lightControl: custom.lightControl,
    lightHeader: custom.lightControl,
    lightText: custom.lightText,
    lightMutedText: custom.lightMutedText,
    lightBorder: custom.lightBorder,
    lightShadow: '0 8px 28px rgb(15 23 42 / 0.16)',
    darkCard: custom.darkCard,
    darkCardHover: withHoverAlpha(custom.darkCard),
    darkControl: custom.darkControl,
    darkHeader: custom.darkControl,
    darkText: custom.darkText,
    darkMutedText: custom.darkMutedText,
    darkBorder: custom.darkBorder,
    darkShadow: '0 8px 30px rgb(0 0 0 / 0.48)',
  }
}

export interface GlassSurfaces {
  card: string
  cardHover: string
  control: string
  header: string
  text: string
  mutedText: string
  border: string
  shadow: string
}

/** 按当前明暗取出这一套的八个值。 */
export function resolveGlassSurfaces(tokens: GlassSurfaceTokens, dark: boolean): GlassSurfaces {
  return dark
    ? {
        card: tokens.darkCard,
        cardHover: tokens.darkCardHover,
        control: tokens.darkControl,
        header: tokens.darkHeader,
        text: tokens.darkText,
        mutedText: tokens.darkMutedText,
        border: tokens.darkBorder,
        shadow: tokens.darkShadow,
      }
    : {
        card: tokens.lightCard,
        cardHover: tokens.lightCardHover,
        control: tokens.lightControl,
        header: tokens.lightHeader,
        text: tokens.lightText,
        mutedText: tokens.lightMutedText,
        border: tokens.lightBorder,
        shadow: tokens.lightShadow,
      }
}
