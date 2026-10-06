import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 毛玻璃模糊必须同时写标准与前缀两种形式，而且取值一致。
 *
 * - Chromium 只认标准的 `backdrop-filter`：Chrome 152 实测
 *   `CSS.supports('-webkit-backdrop-filter', 'blur(14px)') === false`。
 * - Safari 18 起认标准写法，更早的版本只认 `-webkit-backdrop-filter`。
 *
 * 这不是理论问题。Komari `bf83765` 的构建产物里，`.node-card` 与 `.bg-background`
 * 这几条规则只剩 `-webkit-backdrop-filter:blur(14px)saturate(145%)`——标准写法被它的
 * 构建流程丢掉了，于是这些表面在 Chromium 里运行时一律没有模糊，只有 Safari 才有。
 *
 * 本主题的构建目前会自动补前缀，但不能把兼容性押在压缩器的默认行为上；
 * 这里直接要求源码逐条双写，换了构建工具也不会悄悄丢掉其中一种。
 */

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

interface Declarations {
  selector: string
  standard: string[]
  prefixed: string[]
}

/** 只取最内层的声明块（不含嵌套花括号），@media 里的规则同样会被取到。 */
function blurBlocks(css: string): Declarations[] {
  const blocks: Declarations[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (const [, selector = '', body = ''] of css.matchAll(pattern)) {
    const standard = [...body.matchAll(/(?:^|;)\s*backdrop-filter\s*:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    const prefixed = [...body.matchAll(/-webkit-backdrop-filter\s*:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim())
    if (standard.length || prefixed.length) {
      blocks.push({ selector: selector.trim().replace(/\s+/g, ' '), standard, prefixed })
    }
  }
  return blocks
}

describe('backdrop-filter 双写', () => {
  const blocks = blurBlocks(stylesheet)

  it('样式表里确实有模糊规则可查', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(20)
  })

  it('每一条含模糊的规则都同时写了标准与前缀两种形式', () => {
    const missing = blocks
      .filter((block) => block.standard.length === 0 || block.prefixed.length === 0)
      .map((block) => block.selector)
    expect(missing).toEqual([])
  })

  it('两种形式的取值逐条一致', () => {
    const mismatched = blocks
      .filter((block) => block.standard.join('|') !== block.prefixed.join('|'))
      .map((block) => `${block.selector}: ${block.standard.join('|')} ≠ ${block.prefixed.join('|')}`)
    expect(mismatched).toEqual([])
  })
})
