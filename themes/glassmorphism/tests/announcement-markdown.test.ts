import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import MarkdownRenderer from '@/components/dashboard/MarkdownRenderer.vue'
import { parseAnnouncementMarkdown, safeMarkdownUrl, type MarkdownToken } from '@/domain/announcement-markdown'

/*
 * 首页公告的受限 Markdown（Komari `MarkdownRenderer`）。
 * 公告正文由运营者在后台填写，主题商店里的其他站点也会用到，所以这里锁住三件事：
 * 解析规则与上游一致；链接与图片只放行白名单协议；任何 HTML 都只作为文字出现，且只转义一次。
 */
const ORIGIN = 'https://status.example'

function textOf(tokens: readonly MarkdownToken[]): string {
  return tokens.map((token) => (token.type === 'text' ? token.content : '')).join('')
}

async function render(content: string): Promise<string> {
  return renderToString(createSSRApp(MarkdownRenderer, { content }))
}

describe('公告受限 Markdown：解析', () => {
  it('按上游规则识别图片、链接、粗体、斜体、行内代码与换行', () => {
    expect(parseAnnouncementMarkdown('![图](https://img.example/a.png)[文档](https://doc.example)**粗**__粗__*斜*_斜_`code`\n尾')).toEqual([
      { type: 'image', alt: '图', url: 'https://img.example/a.png' },
      { type: 'link', content: '文档', url: 'https://doc.example' },
      { type: 'bold', content: '粗' },
      { type: 'bold', content: '粗' },
      { type: 'italic', content: '斜' },
      { type: 'italic', content: '斜' },
      { type: 'code', content: 'code' },
      { type: 'br' },
      { type: 'text', content: '尾' },
    ])
  })

  it('不成对的标记按普通文字原样输出', () => {
    const tokens = parseAnnouncementMarkdown('5 * 3 = 15_ [未闭合 `x')
    expect(tokens.every((token) => token.type === 'text')).toBe(true)
    expect(textOf(tokens)).toBe('5 * 3 = 15_ [未闭合 `x')
  })

  it('空内容不产出记号', () => {
    expect(parseAnnouncementMarkdown('')).toEqual([])
  })
})

describe('公告受限 Markdown：地址白名单', () => {
  it('链接只放行 http(s)、mailto、tel 与站内地址', () => {
    for (const url of ['https://ok.example/a', 'http://ok.example', 'mailto:ops@ok.example', 'tel:+8610000', '/admin', './a', '../b', '#top']) {
      expect(safeMarkdownUrl(url, 'link', ORIGIN)).toBe(url)
    }
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///etc/passwd', '   ']) {
      expect(safeMarkdownUrl(url, 'link', ORIGIN)).toBeUndefined()
    }
  })

  it('图片只放行 http(s)、data 与站内地址', () => {
    for (const url of ['https://img.example/a.png', 'data:image/png;base64,AAAA', '/themes/user-assets/a.png']) {
      expect(safeMarkdownUrl(url, 'image', ORIGIN)).toBe(url)
    }
    for (const url of ['javascript:alert(1)', 'mailto:ops@ok.example', 'blob:https://ok.example/1']) {
      expect(safeMarkdownUrl(url, 'image', ORIGIN)).toBeUndefined()
    }
  })
})

describe('公告受限 Markdown：渲染', () => {
  it('运营者写的 HTML 只作为文字出现，且只转义一次（上游会显示成实体）', async () => {
    const html = await render('<script>alert(1)</script> a < b & c')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('a &lt; b &amp; c')
    expect(html).not.toContain('&amp;lt;')
    expect(html).not.toContain('&amp;amp;')
  })

  it('危险链接不生成 href，安全链接在新窗口打开且不带来源', async () => {
    const html = await render('[坏](javascript:alert(1)) [好](https://ok.example)')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://ok.example"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('粗体、斜体、行内代码、换行与图片按上游元素输出', async () => {
    const html = await render('**粗** *斜* `x`\n![图](https://img.example/a.png)')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<code class="markdown-content__code">x</code>')
    expect(html).toContain('<br>')
    expect(html).toContain('<img class="markdown-content__image" src="https://img.example/a.png" alt="图" loading="lazy">')
  })

  it('组件不使用 v-html', () => {
    const component = readFileSync(new URL('../src/components/dashboard/MarkdownRenderer.vue', import.meta.url), 'utf8')
    expect(component).not.toMatch(/\sv-html\s*=/)
  })
})

describe('首页公告接线', () => {
  it('公告正文交给 MarkdownRenderer，不再直接插值', () => {
    const home = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')
    expect(home).toContain('<MarkdownRenderer :content="theme.runtime.alertContent" />')
    expect(home).not.toContain('{{ theme.runtime.alertContent }}')
  })

  it('公告标题的块级样式只作用于标题，不波及正文里的粗体', () => {
    const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
    expect(css).not.toMatch(/\.theme-announcement strong\b/)
    expect(css).toContain('.theme-announcement__title {')
  })

  /*
   * 外框对齐上游 `.alert.px-4` 里的 shadcn Alert（2026-10-03 与 Komari 本地预览并排实测，
   * 浅色 / 深色 / 390 全部计算值一致）：只有正文非空才出现，标题可选，没有默认标题与图标。
   */
  it('结构与上游 Alert 一致：正文为空不出现，没有默认标题与图标', () => {
    const home = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')
    const start = home.indexOf('class="theme-announcement"')
    const block = home.slice(start, home.indexOf('<MarkdownRenderer', start) + 80)
    expect(start).toBeGreaterThan(0)
    expect(home).toContain('v-if="siteConfigReady && theme.runtime.alertEnabled && theme.runtime.alertContent"')
    expect(block).toContain('data-slot="alert" class="theme-announcement__box" role="alert"')
    expect(block).toContain('v-if="theme.runtime.alertTitle" data-slot="alert-title"')
    expect(block).toContain('data-slot="alert-description"')
    expect(home).not.toContain('站点公告')
    expect(block).not.toContain('AppIcon')
  })

  it('外框取值与上游运行时一致', () => {
    const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.theme-announcement__box {'), css.indexOf('}', css.indexOf('.theme-announcement__box {')))
    expect(rule).toContain('padding: 12px 16px;')
    expect(rule).toContain('border-radius: 8px;')
    expect(rule).toContain('background-color: color-mix(in oklab, var(--background) 60%, transparent);')
    expect(rule).toContain('backdrop-filter: blur(4px);')
    expect(rule).toContain('font-size: 14px;')
  })
})
