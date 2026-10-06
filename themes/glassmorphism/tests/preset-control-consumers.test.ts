import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 配色方案里「控制色」的消费范围。
 *
 * 上游把控制色写在 `.bg-background` 规则里（底色取控制色、文字取方案文字色，均带
 * `!important`）。在固定版本的上游页面里逐个打开后，真正带这个类的元素是：激活态快捷
 * 筛选胶囊、首次拉取节点失败时连接失败提示里的描边「重试」、财务对话框的下拉框与描边
 * 按钮、自定义时间范围的「应用」、健康 / 拓扑 / 对比工具里的选中态。
 *
 * 本主题里有对应元素的是前两项，以及 v1.1.7 移植的财务明细弹窗（显示币种下拉框与
 * 「恢复今日汇率」描边按钮）；其余要么本主题没有这个功能，要么上游对应元素的类是
 * `bg-background/60`、`bg-transparent`、`!bg-background` 这类不同的类名，并不消费方案。
 * 这里把消费范围钉住：既不能漏接，也不能顺手扩散到全站的输入框和按钮。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const stylesheet = read('../src/styles/main.css').replace(/\/\*[\s\S]*?\*\//g, '')
const homeView = read('../src/views/HomeView.vue')
const detailView = read('../src/views/ServerDetailView.vue')
const loadChart = read('../src/components/detail/LoadChart.vue')
const pingChart = read('../src/components/detail/PingChart.vue')
const settingsView = read('../src/views/ThemeSettingsView.vue')
const advancedTools = read('../src/components/dashboard/AdvancedTools.vue')

interface Rule {
  selector: string
  body: string
}

/** 最内层的声明块，@media 里的规则同样会被取到。 */
function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
    selector: selector.trim().replace(/\s+/g, ' '),
    body,
  }))
}

/** 按钮开始标签里带某段文字的那一个。模板里文字在开始标签之后，取紧邻的前一个 `<button`。 */
function buttonTag(template: string, label: string): string {
  const at = template.indexOf(label)
  expect(at, `找不到「${label}」`).toBeGreaterThan(-1)
  const start = template.lastIndexOf('<button', at)
  return template.slice(start, template.indexOf('>', start) + 1)
}

describe('控制色只被有上游对应的元素消费', () => {
  it('引用 --control-surface 的规则只有激活态胶囊、「重新加载」与财务弹窗的下拉框 / 描边按钮', () => {
    const consumers = rules(stylesheet)
      .filter((rule) => rule.body.includes('--control-surface'))
      .map((rule) => rule.selector)
    expect(consumers).toEqual([
      '.quick-controls button.is-active',
      '.state-panel button.state-panel__retry',
      '.finance-dialog__select, .finance-dialog__outline-button',
    ])
  })

  it('财务弹窗：下拉框与描边按钮只跟随底色和文字，边框用输入框颜色；汇率输入框不跟随方案', () => {
    const controls = rules(stylesheet).find((rule) => rule.selector === '.finance-dialog__select, .finance-dialog__outline-button')
    expect(controls?.body).toContain('background: var(--control-surface, var(--glass-strong))')
    expect(controls?.body).toContain('color: var(--glass-text, var(--ink))')
    expect(controls?.body).toContain('border: 1px solid var(--dialog-input-border)')
    const input = rules(stylesheet).find((rule) => rule.selector === '.finance-dialog__rate-input')
    expect(input?.body).toContain('background: var(--dialog-input-surface)')
    expect(input?.body).not.toContain('--control-surface')
  })

  it('「重新加载」按上游规则取控制色与方案文字色，模糊两种写法都有', () => {
    const retry = rules(stylesheet).find((rule) => rule.selector === '.state-panel button.state-panel__retry')
    expect(retry?.body).toContain('background: var(--control-surface, var(--glass-strong))')
    expect(retry?.body).toContain('color: var(--glass-text, var(--ink))')
    expect(retry?.body).toContain('backdrop-filter: blur(14px) saturate(145%)')
    expect(retry?.body).toContain('-webkit-backdrop-filter: blur(14px) saturate(145%)')
  })

  it('边框、圆角与尺寸不随方案变化，仍由面板按钮的通用规则决定', () => {
    const retry = rules(stylesheet).find((rule) => rule.selector === '.state-panel button.state-panel__retry')
    expect(retry?.body).not.toMatch(/border|padding|radius|font-size|box-shadow/)
    const shared = rules(stylesheet).find((rule) => rule.selector === '.state-panel button')
    expect(shared?.body).toContain('border: 1px solid var(--glass-border)')
    expect(shared?.body).toContain('background: var(--glass-strong)')
  })

  it('悬浮时底色与文字不变：上游规则带 !important，这里也没有任何悬浮规则改写它们', () => {
    const hovers = rules(stylesheet).filter((rule) => (
      /state-panel/.test(rule.selector) && /:hover|:active/.test(rule.selector)
    ))
    expect(hovers).toEqual([])
  })
})

describe('接入的按钮与不接入的按钮', () => {
  it('首页与详情页加载失败时的「重新加载」带上类名', () => {
    expect(buttonTag(homeView, '重新加载')).toContain('class="state-panel__retry"')
    expect(buttonTag(detailView, '重新加载')).toContain('class="state-panel__retry"')
  })

  it('上游没有对应消费者的按钮保持原样', () => {
    // 详情页同一面板的「返回首页」：上游对应的是实心主按钮，不带 bg-background。
    expect(buttonTag(detailView, '返回首页')).not.toContain('state-panel__retry')
    // 图表加载失败的「重试」：上游图表没有重试按钮。
    expect(buttonTag(loadChart, '重试')).not.toContain('state-panel__retry')
    expect(buttonTag(pingChart, '重试')).not.toContain('state-panel__retry')
    // 设置页读取配置失败的「重新读取」：上游主题没有设置页。
    expect(buttonTag(settingsView, '重新读取')).not.toContain('state-panel__retry')
    // 快照导出：上游密码框与导出按钮是 bg-background/60，不消费方案。
    expect(advancedTools).not.toContain('state-panel__retry')
    expect(advancedTools).not.toContain('--control-surface')
  })

  it('没有给全站的输入框或按钮加通配覆盖', () => {
    const global = rules(stylesheet).filter((rule) => (
      /(^|,\s*)(input|button|select|textarea)(\s*,|$|:)/.test(rule.selector)
      && /--control-surface|--glass-text/.test(rule.body)
    ))
    expect(global).toEqual([])
  })
})
