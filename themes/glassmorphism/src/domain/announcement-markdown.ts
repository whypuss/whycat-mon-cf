/*
 * 首页公告的受限 Markdown，解析规则与地址白名单逐条移植自 Komari
 * `components/MarkdownRenderer.vue`：只认图片、链接、粗体、斜体、行内代码与换行。
 *
 * 这里只产出记号，不拼 HTML 字符串；渲染交给模板绑定（文字插值、`:href` / `:src`），
 * 运营者写进公告的任何标签都只会作为文字出现。
 *
 * 与上游的一处差异：上游先把文字做 HTML 转义、再用 `{{ }}` 输出，结果 `<`、`&`
 * 在页面上显示成 `&lt;`、`&amp;`。这里文字保持原样，只由模板转义一次。
 */

export type MarkdownToken =
  | { readonly type: 'text', readonly content: string }
  | { readonly type: 'bold' | 'italic' | 'code', readonly content: string }
  | { readonly type: 'link', readonly content: string, readonly url: string }
  | { readonly type: 'image', readonly alt: string, readonly url: string }
  | { readonly type: 'br' }

const IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)/
const LINK_REGEX = /^\[([^\]]+)\]\(([^)]+)\)/
const BOLD_ASTERISK_REGEX = /^\*\*([^*]+)\*\*/
const BOLD_UNDERSCORE_REGEX = /^__([^_]+)__/
const ITALIC_ASTERISK_REGEX = /^\*([^*]+)\*/
const ITALIC_UNDERSCORE_REGEX = /^_([^_]+)_/
const CODE_REGEX = /^`([^`]+)`/
const NEXT_SPECIAL_REGEX = /[![*_`\n]/

export function parseAnnouncementMarkdown(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  let remaining = text

  while (remaining.length > 0) {
    const imageMatch = IMAGE_REGEX.exec(remaining)
    if (imageMatch) {
      tokens.push({ type: 'image', alt: imageMatch[1] ?? '', url: imageMatch[2] ?? '' })
      remaining = remaining.slice(imageMatch[0].length)
      continue
    }

    const linkMatch = LINK_REGEX.exec(remaining)
    if (linkMatch) {
      tokens.push({ type: 'link', content: linkMatch[1] ?? '', url: linkMatch[2] ?? '' })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    const boldMatch = BOLD_ASTERISK_REGEX.exec(remaining) ?? BOLD_UNDERSCORE_REGEX.exec(remaining)
    if (boldMatch) {
      tokens.push({ type: 'bold', content: boldMatch[1] ?? '' })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    const italicMatch = ITALIC_ASTERISK_REGEX.exec(remaining) ?? ITALIC_UNDERSCORE_REGEX.exec(remaining)
    if (italicMatch) {
      tokens.push({ type: 'italic', content: italicMatch[1] ?? '' })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    const codeMatch = CODE_REGEX.exec(remaining)
    if (codeMatch) {
      tokens.push({ type: 'code', content: codeMatch[1] ?? '' })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    if (remaining[0] === '\n') {
      tokens.push({ type: 'br' })
      remaining = remaining.slice(1)
      continue
    }

    // 没有构成语法的特殊字符按普通文字输出一个，避免卡在原地。
    const nextSpecial = remaining.search(NEXT_SPECIAL_REGEX)
    const length = nextSpecial === -1 ? remaining.length : Math.max(nextSpecial, 1)
    tokens.push({ type: 'text', content: remaining.slice(0, length) })
    remaining = remaining.slice(length)
  }

  return tokens
}

/**
 * 上游 `sanitizeMarkdownUrl`：站内路径与锚点原样放行；其余地址解析后，
 * 链接只认 http / https / mailto / tel，图片只认 http / https / data。不合格返回 undefined，
 * 模板随之省略 `href` / `src`，元素退化为普通文字或空图。
 */
export function safeMarkdownUrl(
  url: string,
  kind: 'link' | 'image',
  origin: string = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string | undefined {
  const normalized = url.trim()
  if (!normalized) return undefined
  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('#')) {
    return normalized
  }
  try {
    const parsed = new URL(normalized, origin)
    const allowed = kind === 'image' ? ['http:', 'https:', 'data:'] : ['http:', 'https:', 'mailto:', 'tel:']
    return allowed.includes(parsed.protocol) ? normalized : undefined
  } catch {
    return undefined
  }
}
