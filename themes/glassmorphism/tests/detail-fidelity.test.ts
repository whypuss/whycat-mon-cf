import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDetailCards, resolveDetailCardKeys, trafficUsageBytes } from '@/domain/theme-presentation'
import {
  detailExpireStatus,
  formatDetailExpireText,
  formatDetailUptime,
  formatDisplayBytes,
} from '@/utils/format'
import { getCpuBenchmarkRating, getPassMarkCpuLookupUrl } from '@/utils/cpu-benchmark'
import { normalizeServer } from '@/services/cfsm/adapters'
import { cloneThemeSettings, DEFAULT_THEME_SETTINGS } from '@/theme/settings'

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const detailView = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')
const loadChart = readFileSync(new URL('../src/components/detail/LoadChart.vue', import.meta.url), 'utf8')
const pingChart = readFileSync(new URL('../src/components/detail/PingChart.vue', import.meta.url), 'utf8')
const serverCard = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')
const serverList = readFileSync(new URL('../src/components/dashboard/ServerList.vue', import.meta.url), 'utf8')

const source = { base: 'https://status.example', label: 'status.example' }

function detailSettings(preset: (typeof DEFAULT_THEME_SETTINGS)['detailMetricCardPreset'] = '财务') {
  const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
  settings.detailMetricCardPreset = preset
  return settings
}

function node(overrides: Record<string, unknown> = {}) {
  return normalizeServer({
    id: 'node',
    name: 'Node',
    is_online: 1,
    cpu: 42.55,
    cpu_cores: 4,
    cpu_info: 'AMD EPYC 7B13',
    arch: 'x86_64',
    agent_version: '1.5.2',
    os: 'Debian 12',
    kernel_version: '6.8.0',
    ram_used: 4096,
    ram_total: 8192,
    swap_used: 512,
    swap_total: 2048,
    disk_used: 20 * 1024,
    disk_total: 160 * 1024,
    net_in_speed: 1024 ** 2,
    net_out_speed: 2 * 1024 ** 2,
    net_rx: 3 * 1024 ** 3,
    net_tx: 1024 ** 3,
    load_avg: '1.25 0.80 0.42',
    processes: 180,
    tcp_conn: 120,
    udp_conn: 30,
    boot_time: 1_700_000_000,
    ...overrides,
  }, source)
}

describe('详情页运行时间与到期文案（Komari InstanceDetail 规则）', () => {
  it('运行时间到分钟，为零的单位省略', () => {
    const now = Date.UTC(2026, 8, 10, 12, 30)
    expect(formatDetailUptime(Date.UTC(2026, 8, 8, 12, 30) / 1000, now)).toBe('2 天')
    expect(formatDetailUptime(Date.UTC(2026, 8, 8, 9, 15) / 1000, now)).toBe('2 天 3 小时 15 分钟')
    expect(formatDetailUptime(Date.UTC(2026, 8, 10, 12, 29, 30) / 1000, now)).toBe('不足 1 分钟')
    expect(formatDetailUptime(null, now)).toBe('-')
  })

  it('到期状态与文案对齐上游 5 / 10 / 36500 天阈值', () => {
    expect(detailExpireStatus(null)).toBe('unknown')
    expect(detailExpireStatus(0)).toBe('expired')
    expect(detailExpireStatus(5)).toBe('critical')
    expect(detailExpireStatus(10)).toBe('warning')
    expect(detailExpireStatus(30)).toBe('normal')
    expect(detailExpireStatus(40_000)).toBe('long_term')
    expect(formatDetailExpireText(null)).toBe('-')
    expect(formatDetailExpireText(-3)).toBe('已过期')
    expect(formatDetailExpireText(40_000)).toBe('长期')
    expect(formatDetailExpireText(30)).toBe('30 天')
  })

  it('详情页与首页共用同一套字节规则', () => {
    expect(formatDisplayBytes(1024 ** 3)).toBe('1.0 GB')
    expect(detailView).toContain('formatDisplayBytes')
    expect(detailView).toContain('formatDetailUptime')
    // 首页节点卡的「在线 N 天」不得渗进详情页。
    expect(detailView).not.toContain('formatHomeUptimeDays')
  })
})

describe('详情指标卡对齐 Komari getDetailMetricCard', () => {
  it('月流量缺一向时保持未知，不把缺失伪造成 0 或无限流量', () => {
    expect(trafficUsageBytes(100, null, 'sum')).toBeNull()
    expect(trafficUsageBytes(null, 100, 'max')).toBeNull()
    expect(trafficUsageBytes(100, null, 'dl')).toBe(100)
    expect(trafficUsageBytes(null, 100, 'ul')).toBe(100)

    const cards = buildDetailCards(node({
      traffic_limit: '1 TiB',
      traffic_calc_type: 'sum',
      net_rx_monthly: 100,
      net_tx_monthly: null,
    }), detailSettings('财务'))
    expect(cards.find((card) => card.key === 'trafficQuota')).toMatchObject({
      value: '-',
      hint: '- / 1.00 TB',
    })
  })

  it('累计流量缺一向时隐藏总量卡，不显示不完整合计', () => {
    const cards = buildDetailCards(node({ net_rx: 100, net_tx: null }), detailSettings('综合'))
    expect(cards.find((card) => card.key === 'totalTraffic')).toBeUndefined()
  })

  it('value / unit 分离：价格、剩余时间、速率、百分比与流量', () => {
    const cards = buildDetailCards(
      node({ price: '18', billing_cycle: 'year', currency: 'USD', expire_date: '2026-10-10' }),
      detailSettings('综合'),
      Date.UTC(2026, 8, 10),
    )
    const byKey = Object.fromEntries(cards.map((card) => [card.key, card]))

    expect(byKey.nodePrice).toMatchObject({ label: '节点价格', value: 'USD18', unit: '/ 年' })
    expect(byKey.remainingTime).toMatchObject({ label: '剩余时间', value: '31', unit: '天', tone: 'ok' })
    expect(byKey.cpuUsage).toMatchObject({ label: 'CPU 使用率', value: '42.5', unit: '%' })
    expect(byKey.memoryUsage).toMatchObject({ label: '内存使用率', value: '50.0', unit: '%', hint: '4.0 GB / 8.0 GB' })
    expect(byKey.uploadSpeed).toMatchObject({ label: '实时上行', value: '2.0', unit: 'MB/s' })
    expect(byKey.downloadSpeed).toMatchObject({ label: '实时下行', value: '1.0', unit: 'MB/s' })
    expect(byKey.totalTraffic).toMatchObject({ label: '累计流量', value: '4.0', unit: 'GB' })
    expect(byKey.load).toMatchObject({ label: '系统负载', value: '1.25', unit: '1m' })
    expect(byKey.uptime?.unit).toBeUndefined()
  })

  it('月均支出按官方周期折算成 30 天口径，未知周期显示「不适用」', () => {
    const yearly = buildDetailCards(node({ price: '120', billing_cycle: 'year', currency: '$' }), detailSettings('综合'))
    expect(yearly.find((card) => card.key === 'monthlyCost')).toMatchObject({ value: '$9.86', unit: '/ 月' })

    const unknown = buildDetailCards(node({ price: '120', billing_cycle: '每两周', currency: '$' }), detailSettings('综合'))
    expect(unknown.find((card) => card.key === 'monthlyCost')?.value).toBe('不适用')

    const free = buildDetailCards(node({ price: '0', billing_cycle: 'year', currency: '$' }), detailSettings('综合'))
    expect(free.find((card) => card.key === 'monthlyCost')?.value).toBe('免费')
  })

  /*
   * v1.1.7 起与上游 InstanceDetail 的分工一致：节点价格、月均支出保留原币，剩余价值换算成
   * 财务显示币种（默认 CNY）。此前这里断言剩余价值保持原币 `€60`，那是还没有汇率时的做法。
   * 测试汇率是人工值：1 CNY = 0.125 EUR。
   */
  const testRates = { target: 'CNY' as const, view: { rates: { CNY: 1, EUR: 0.125 }, sources: { EUR: 'network' as const }, pending: false } }

  it('剩余价值换算成财务显示币种，原币金额与汇率来源放进 tooltip；免费节点显示「无」', () => {
    const paidNode = node({ price: '60', billing_cycle: 'year', currency: '€', expire_date: '2027-01-01' })
    const paid = buildDetailCards(paidNode, detailSettings('综合'), Date.UTC(2026, 0, 1), testRates)
    expect(paid.find((card) => card.key === 'remainingValue')).toMatchObject({
      value: '¥480.00',
      hint: '原币 €60\n汇率：今日网络汇率',
    })
    expect(paid.find((card) => card.key === 'remainingValue')?.unit).toBeUndefined()
    // 节点价格与月均支出仍是原币。
    expect(paid.find((card) => card.key === 'nodePrice')).toMatchObject({ value: '€60', unit: '/ 年' })
    expect(paid.find((card) => card.key === 'monthlyCost')?.value).toBe('€4.93')

    const free = buildDetailCards(node({ price: '0', currency: '€' }), detailSettings('综合'), Date.now(), testRates)
    expect(free.find((card) => card.key === 'remainingValue')?.value).toBe('无')
  })

  it('同币种不需要汇率；汇率未到、缺失或币种无法识别时如实显示', () => {
    const now = Date.UTC(2026, 0, 1)
    const settings = detailSettings('综合')
    const yuan = buildDetailCards(node({ price: '120', billing_cycle: 'year', currency: '¥', expire_date: '2027-01-01' }), settings, now)
    expect(yuan.find((card) => card.key === 'remainingValue')).toMatchObject({ value: '¥120.00', hint: '' })

    const euro = node({ price: '60', billing_cycle: 'year', currency: '€', expire_date: '2027-01-01' })
    const pending = buildDetailCards(euro, settings, now, { target: 'CNY', view: { rates: {}, sources: {}, pending: true } })
    expect(pending.find((card) => card.key === 'remainingValue')).toMatchObject({ value: '-', unit: '载入中' })
    const missing = buildDetailCards(euro, settings, now, { target: 'CNY', view: { rates: {}, sources: {}, pending: false } })
    expect(missing.find((card) => card.key === 'remainingValue')).toMatchObject({ value: '-', unit: '汇率不可用', hint: '原币 €60\n缺少汇率，无法换算' })
    const krona = buildDetailCards(node({ price: '60', billing_cycle: 'year', currency: 'kr', expire_date: '2027-01-01' }), settings, now, testRates)
    expect(krona.find((card) => card.key === 'remainingValue')).toMatchObject({ value: '-', unit: '不可换算' })

    const reference = buildDetailCards(euro, settings, now, { target: 'CNY', view: { rates: { CNY: 1, EUR: 0.125 }, sources: { EUR: 'reference' }, pending: false } })
    expect(reference.find((card) => card.key === 'remainingValue')).toMatchObject({ value: '¥480.00', unit: '参考' })
  })

  it('缺到期时间或周期未知时不出剩余价值卡，不写成已过期的 0', () => {
    const settings = detailSettings('综合')
    const noExpiry = buildDetailCards(node({ price: '60', billing_cycle: 'year', currency: '€', expire_date: '' }), settings, Date.UTC(2026, 0, 1), testRates)
    expect(noExpiry.find((card) => card.key === 'remainingValue')).toBeUndefined()
    const expired = buildDetailCards(node({ price: '60', billing_cycle: 'year', currency: '€', expire_date: '2025-01-01' }), settings, Date.UTC(2026, 0, 1), testRates)
    expect(expired.find((card) => card.key === 'remainingValue')?.value).toBe('¥0.00')
  })

  it('未填价格或价格无法识别时，三张财务卡都不出现，不当作免费', () => {
    const settings = detailSettings('综合')
    const now = Date.UTC(2026, 0, 1)
    // CFSM 未填价格时返回空串，适配层把它归一成 null。
    const unset = buildDetailCards(node({ price: '', billing_cycle: 'month', currency: '¥', expire_date: '2027-01-01' }), settings, now, testRates)
    const keys = (cards: typeof unset) => cards.map((card) => card.key)
    expect(keys(unset)).not.toContain('nodePrice')
    // 此前月均支出这一张会单独显示「—」，另外两张不出现；v1.1.7 起三张一致。
    expect(keys(unset)).not.toContain('monthlyCost')
    expect(keys(unset)).not.toContain('remainingValue')
    expect(keys(unset)).toContain('remainingTime')

    const invalid = buildDetailCards(node({ price: 'abc', billing_cycle: 'month', currency: '¥', expire_date: '2027-01-01' }), settings, now, testRates)
    expect(invalid.find((card) => card.key === 'nodePrice')?.value).toBe('-')
    expect(keys(invalid)).not.toContain('monthlyCost')
    expect(keys(invalid)).not.toContain('remainingValue')
  })

  it('GPU / 交换分区 / 流量配额缺数据时不渲染，也不写成 0', () => {
    const bare = buildDetailCards(node({ swap_total: 0, swap_used: 0 }), detailSettings('综合'))
    expect(bare.some((card) => card.key === 'gpuUsage')).toBe(false)
    expect(bare.some((card) => card.key === 'swapUsage')).toBe(false)

    const quota = buildDetailCards(
      node({ traffic_limit: '1TB', traffic_calc_type: 'total', net_rx_monthly: 200 * 1024 ** 3, net_tx_monthly: 100 * 1024 ** 3 }),
      detailSettings('财务'),
    )
    expect(quota.find((card) => card.key === 'trafficQuota')).toMatchObject({ value: '29.3', unit: '%' })
  })

  it('使用上游图标名', () => {
    const cards = buildDetailCards(
      node({ price: '18', billing_cycle: 'year', currency: 'USD', expire_date: '2026-10-10' }),
      detailSettings('财务'),
      Date.UTC(2026, 8, 10),
    )
    expect(cards.map((card) => `${card.key}:${card.icon}`)).toEqual([
      'nodePrice:tabler:cash',
      'monthlyCost:tabler:receipt-2',
      'remainingTime:tabler:calendar-dollar',
      'remainingValue:tabler:coins',
      'totalTraffic:tabler:arrows-transfer-up-down',
      'uptime:tabler:clock-up',
      'connections:tabler:plug-connected',
    ])
  })
})

describe('详情指标卡预设对齐 Komari DETAIL_METRIC_CARD_PRESETS', () => {
  function keysFor(preset: (typeof DEFAULT_THEME_SETTINGS)['detailMetricCardPreset']): string[] {
    return resolveDetailCardKeys(detailSettings(preset))
  }

  it('保持上游顺序，只删掉 CFSM 不提供的 temperature', () => {
    expect(keysFor('财务')).toEqual(['nodePrice', 'monthlyCost', 'remainingTime', 'remainingValue', 'totalTraffic', 'trafficQuota', 'uptime', 'connections'])
    expect(keysFor('状态')).toEqual(['cpuUsage', 'memoryUsage', 'diskUsage', 'load', 'uptime', 'processes', 'connections'])
    expect(keysFor('资源')).toEqual(['cpuUsage', 'gpuUsage', 'memoryUsage', 'swapUsage', 'diskUsage', 'load', 'processes', 'connections', 'uptime', 'uploadSpeed', 'downloadSpeed'])
    expect(keysFor('网络')).toEqual(['uploadSpeed', 'downloadSpeed', 'totalTraffic', 'trafficQuota', 'connections', 'processes', 'uptime', 'remainingTime'])
    expect(keysFor('GPU')).toEqual(['gpuUsage', 'cpuUsage', 'memoryUsage', 'load', 'processes', 'connections', 'uptime'])
    expect(keysFor('综合')).toEqual(['nodePrice', 'monthlyCost', 'remainingTime', 'remainingValue', 'cpuUsage', 'gpuUsage', 'memoryUsage', 'swapUsage', 'diskUsage', 'load', 'processes', 'connections', 'uploadSpeed', 'downloadSpeed', 'totalTraffic'])
  })

  it('自定义模式的允许集合独立于「综合」预设', () => {
    const settings = detailSettings('自定义')
    settings.detailMetricCardKeys = 'uptime\ntrafficQuota\ntemperature\nnodePrice'
    expect(resolveDetailCardKeys(settings)).toEqual(['uptime', 'trafficQuota', 'nodePrice'])
  })
})

describe('CPU 近似分级与 PassMark 外链', () => {
  it('只读取型号字符串，不产生 CFSM 之外的数据', () => {
    expect(getCpuBenchmarkRating('AMD EPYC 7B13').tier).not.toBe('?')
    expect(getCpuBenchmarkRating('').tier).toBe('?')
    expect(getPassMarkCpuLookupUrl('Intel Xeon Gold 6152 CPU @ 2.10GHz'))
      .toContain('cpubenchmark.net/cpu_lookup.php?cpu=')
    expect(getPassMarkCpuLookupUrl('')).toBe('https://www.cpubenchmark.net/cpu-list/all')
  })
})

describe('详情页 DOM 与分区结构', () => {
  it('顶部导航保持返回 / 身份 / 状态 / 标签 / 收藏 / 上下节点 / 选择器', () => {
    expect(detailView).toContain('detail-topbar')
    expect(detailView).toContain('tabler:arrow-left')
    expect(detailView).toContain('detail-topbar__flag')
    expect(detailView).toContain('tabler:star-filled')
    expect(detailView).toContain('tabler:chevron-left')
    expect(detailView).toContain('tabler:chevron-right')
    expect(detailView).toContain('detail-topbar__select')
  })

  it('四张信息卡按硬件 / 系统 / 存储 / 网络的顺序渲染', () => {
    const order = ['硬件信息', '系统信息', '存储信息', '网络信息']
      .map((title) => detailView.indexOf(`<h2>${title}</h2>`))
    expect(order.every((index) => index > 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
  })

  it('分区 Tab 按 概览 / 负载 / 延迟 组织，并受 nodeDetailSectionTabsEnabled 控制', () => {
    expect(detailView).toContain('nodeDetailSectionTabsEnabled')
    expect(detailView).toContain("{ value: 'overview', label: '概览', icon: 'tabler:layout-dashboard' }")
    expect(detailView).toContain("{ value: 'load', label: '负载', icon: 'tabler:activity' }")
    expect(detailView).toContain("{ value: 'ping', label: '延迟', icon: 'tabler:timeline' }")
    expect(detailView).toContain('overviewVisible')
    expect(detailView).toContain('pingVisible')
    expect(detailView).toContain('loadVisible')
  })

  it('指标卡没有进度条，说明文字走 title tooltip', () => {
    expect(detailView).toContain(':title="card.hint || undefined"')
    expect(detailView).not.toContain('card.percentage !== undefined')
  })

  it('下半部与上游一致，只有 LoadChart 与 PingChart，按分区可见性挂载', () => {
    expect(detailView).toContain('<LoadChart v-if="loadVisible" />')
    expect(detailView).toContain('<PingChart v-if="pingVisible" />')
    // 旧的 PROBES / DISK IO / GPU / HISTORY 四个自创分区不再存在。
    for (const legacy of ['detail-section', 'probe-detail', 'gpu-detail', 'detail-stat-grid', 'history-range', 'HistoryChart']) {
      expect(detailView).not.toContain(legacy)
    }
  })

  it('GPU / 磁盘 IO / 探针仍按真实数据存在与否出现', () => {
    // 卡片可见性统一走 visibleLoadCards：不在方案里、或所选时段没有真实采样的卡片不渲染。
    expect(loadChart).toContain('visibleLoadCards(')
    expect(loadChart).toContain('theme.runtime.gpuChartEnabled')
    // 延迟面板的任务只来自真实配置过的探测目标。
    expect(pingChart).toContain('activeProbeTargets(current, pingHistoryPoints.value)')
  })

  it('「实时」档位的时间格式不沿用上一次选中的历史窗口', () => {
    expect(loadChart).toContain('hours: loadChartHours(liveMode.value, historyHours.value)')
  })

  /*
   * 2026-10-03 线上实测：匿名访客先选「2 天」（CFSM 返回 401），再切到「实时」，负载图仍停在 401 提示，
   * 实时数据被挡住。上游进入实时会先清空 error；这里历史失败只在历史档位显示。
   */
  it('历史档位的请求失败不会挡住「实时」档位', () => {
    expect(loadChart).toContain(`v-if="!liveMode && historyState === 'error'"`)
    expect(loadChart).not.toContain(`v-if="historyState === 'error'"`)
  })

  it('CFSM 没有的字段不出现在详情页的可见文案里；厂商只取运营者文本', () => {
    // 只断言渲染出来的标签，避免误伤解释这些缺口的注释文字。
    const labels = [...detailView.matchAll(/label: '([^']+)'/g)].map((match) => match[1])
    expect(labels).not.toContain('虚拟机')
    expect(labels).not.toContain('物理核心')
    expect(labels).not.toContain('IP')
    expect(labels).toEqual(expect.arrayContaining(['架构', 'Agent', '操作系统', '内核版本', '运行时间', '厂商']))
    // 上游第四格就是「厂商」；原来的数据源名称保留在这一格的 title 里。
    expect(labels).not.toContain('数据源')
    expect(detailView).toContain('`数据源：${current.source.label}`')
    expect(detailView).toContain('resolveNodeProvider(server.value, theme.runtime.providerAliases)')
  })
})

describe('详情页表面契约（浏览器实测值）', () => {
  it('指标卡与信息卡是 --background 的 50%、无边框、8px 圆角、无阴影、无 backdrop', () => {
    const block = stylesheet.slice(
      stylesheet.indexOf('.detail-metric-card,\n.detail-info-card,'),
      stylesheet.indexOf('.detail-metric-card:hover,'),
    )
    expect(block).toContain('border: none')
    expect(block).toContain('border-radius: var(--radius-md)')
    expect(block).toContain('background: color-mix(in oklab, var(--background) 50%, transparent)')
    expect(block).toContain('box-shadow: none')
    expect(block).toContain('backdrop-filter: none')
    expect(stylesheet).toContain('--radius-md: 8px')
  })

  it('信息格表面取自上游对 .bg-slate-500/5 的覆盖值', () => {
    expect(stylesheet).toContain('background: rgb(255 255 255 / 15%)')
    expect(stylesheet).toContain(":root[data-theme='dark'] .detail-fact {\n  background: rgb(255 255 255 / 5%);\n}")
  })

  it('图表卡片、延迟任务卡与大图和指标卡同源，不再使用自创的 glass-panel', () => {
    for (const code of [detailView, loadChart, pingChart]) expect(code).not.toContain('glass-panel')
    const surface = stylesheet.slice(
      stylesheet.indexOf('.detail-metric-card,\n.detail-info-card,'),
      stylesheet.indexOf('.detail-metric-card:hover,'),
    )
    for (const selector of ['.metric-chart-card', '.ping-task', '.ping-chart__canvas']) expect(surface).toContain(selector)
    // hover 变不透明只有图表卡片（上游 CardX 的 hover:bg-background）；延迟大图没有 hover。
    const hover = stylesheet.slice(stylesheet.indexOf('.detail-metric-card:hover,'), stylesheet.indexOf('.detail-metric-card {'))
    expect(hover).toContain('.metric-chart-card:hover')
    expect(hover).not.toContain('.ping-chart__canvas')
  })

  it('图表卡片几何照上游 CardX size="small" 与 h-48，延迟大图照 h-80 p-4', () => {
    expect(stylesheet).toContain('.metric-chart-card__header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 12px;\n}')
    expect(stylesheet).toContain('.metric-chart-card__body {\n  padding: 0 12px 12px;\n}')
    expect(stylesheet).toContain('.metric-chart-card__chart {\n  height: 192px;\n}')
    expect(stylesheet).toContain('.ping-chart__canvas {\n  height: 320px;\n  padding: 16px;\n}')
  })

  it('指标卡高度与字号按上游 min-h-10 / md:min-h-18 与 text-base / sm:text-2xl', () => {
    expect(stylesheet).toContain('min-height: 64px')
    expect(stylesheet).toContain('min-height: 96px')
    expect(stylesheet).toContain('line-height: 24px')
    expect(stylesheet).toContain('line-height: 32px')
  })
})

describe('第 11 轮首页成果在本轮不回退', () => {
  it('首页格式化器仍是首页那一套', () => {
    expect(serverCard).toContain('formatHomeUptimeDays')
    expect(serverCard).toContain('formatDisplayPrice')
    expect(serverList).toContain('formatUptime(server.bootTime)')
    expect(serverList).not.toContain('formatDetailUptime')
  })

  it('Ping / Loss 满高柱与 signal 色阶未被改动', () => {
    expect(serverCard).toContain('EMPTY_PING_BAR_COUNT = 20')
    expect(serverCard).toContain("if (loss <= 1) return 'is-signal-1'")
  })

  it('总览卡片仍是 --radius 圆角、节点卡仍是 14px', () => {
    const overview = stylesheet.slice(stylesheet.indexOf('.overview-card {'), stylesheet.indexOf('.overview-card:hover'))
    expect(overview).toContain('border-radius: var(--radius)')
    const card = stylesheet.slice(stylesheet.indexOf('.node-card {'), stylesheet.indexOf('.node-card:hover'))
    expect(card).toContain('border-radius: 14px')
  })
})
