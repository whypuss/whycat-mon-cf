import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function exists(path: string): boolean {
  return existsSync(new URL(path, import.meta.url))
}

/**
 * 第 9.5 轮：正式版高保真移植收敛。
 *
 * 这些契约锁定「向原 Komari Glassmorphism 对齐」的结果，防止后续再退回
 * CFSM 自创的中间层或 SVG 仿制渲染器。
 */
describe('Komari fidelity contracts', () => {
  it('sends node card and list clicks straight to the detail route', () => {
    const home = source('../src/views/HomeView.vue')
    const card = source('../src/components/dashboard/ServerCard.vue')
    const list = source('../src/components/dashboard/ServerList.vue')

    // 主点击路径直接进入详情，并保留 owning source，避免多 apiBase 串节点。
    expect(home).toContain('function openServer')
    expect(home).toContain('serverDetailLocation(')
    // 归属信息仍由调用方传入；单后端时才省略冗余的 source 查询参数，
    // 生成规则本身由 tests/router-links.test.ts 锁定。
    expect(home).toContain('hasMultipleSources(app.apiBases)')
    expect(home).toContain('server.sourceBase')

    // 卡片与列表行的主点击都只发一个 open 事件，由 HomeView 直接导航。
    expect(card).toContain('@click="emit(\'open\')"')
    expect(list).toContain('@click="emit(\'open\', server)"')
  })

  it('keeps the forced quick-view intermediate layer removed', () => {
    const home = source('../src/views/HomeView.vue')

    expect(exists('../src/components/dashboard/ServerQuickView.vue')).toBe(false)
    expect(home).not.toContain('ServerQuickView')
    expect(home).not.toContain('viewServerDetails')
    // 不得再出现「先预览、再打开完整详情」的二次确认入口。
    expect(home).not.toContain('quick-view__detail-link')
  })

  it('stops independent card and list controls from triggering navigation', () => {
    const card = source('../src/components/dashboard/ServerCard.vue')
    const list = source('../src/components/dashboard/ServerList.vue')

    expect(card).toContain('@click.stop="emit(\'toggleFavorite\')"')
    expect(list).toContain('@click.stop="emit(\'toggleFavorite\', server.key)"')
  })

  it('dispatches the three Earth renderers as separate lazy implementations', () => {
    const dispatcher = source('../src/components/dashboard/EarthMap.vue')

    expect(dispatcher).toContain('defineAsyncComponent')
    expect(dispatcher).toContain('NodeEarthRealisticGlobe.vue')
    expect(dispatcher).toContain('NodeEarthCobeGlobe.vue')
    expect(dispatcher).toContain('NodeEarthTiledMap.vue')
    expect(dispatcher.match(/defineAsyncComponent\(/g)).toHaveLength(3)

    expect(exists('../src/components/dashboard/NodeEarthRealisticGlobe.vue')).toBe(true)
    expect(exists('../src/components/dashboard/NodeEarthCobeGlobe.vue')).toBe(true)
    expect(exists('../src/components/dashboard/NodeEarthTiledMap.vue')).toBe(true)
  })

  it('keeps the realistic renderer on globe.gl and three instead of an SVG imitation', () => {
    const realistic = source('../src/components/dashboard/NodeEarthRealisticGlobe.vue')

    expect(realistic).toContain('import(\'globe.gl\')')
    expect(realistic).toContain('import(\'three\')')
    expect(realistic).toContain('earth-blue-marble.jpg')
    expect(realistic).toContain('showAtmosphere(true)')
    // 不得退化成手绘 SVG 世界地图。
    expect(realistic).not.toContain('earth-continents')
    expect(realistic).not.toContain('earth-silhouette')
  })

  it('keeps the cobe renderer on the real cobe library instead of a CSS imitation', () => {
    const cobe = source('../src/components/dashboard/NodeEarthCobeGlobe.vue')

    expect(cobe).toContain('from \'cobe\'')
    expect(cobe).toContain('createGlobe(')
    expect(cobe).toContain('mapSamples')
    expect(cobe).not.toContain('earth-continents')
    expect(cobe).not.toContain('earth-silhouette')
  })

  it('keeps the tiled map a distinct renderer built on the real earth texture', () => {
    const tiled = source('../src/components/dashboard/NodeEarthTiledMap.vue')

    expect(tiled).toContain('earth-blue-marble.jpg')
    expect(tiled).toContain('earth-topology.png')
    expect(tiled).toContain('earth-water.png')
    // tiled 是独立渲染器，不是球体，也不复用 globe.gl / cobe。
    expect(tiled).not.toContain('globe.gl')
    expect(tiled).not.toContain('from \'cobe\'')
    // 移动端保留 Komari 的横向滚动行为。
    expect(tiled).toContain('earth-map-scroll')
    expect(tiled).toContain('overflow-x: auto')
  })

  it('locates nodes only from reliable CFSM region data', () => {
    const clusters = source('../src/composables/useServerGeoClusters.ts')

    expect(clusters).toContain('buildEarthPoints')
    // CFSM 不提供真实 IP/ASN/城市，绝不做外部 IP Geo 查询或坐标猜测。
    expect(clusters).not.toMatch(/\bfetch\s*\(/)
    expect(clusters).not.toContain('ipGeo')
    expect(clusters).not.toContain('lookupIp')
  })

  it('uses the CFSM default-skin flag assets instead of bundling its own', () => {
    const flags = source('../src/utils/flags.ts')

    // theme-develop.md：旗帜使用 /flags/<code>.svg，不要打包进主题。
    expect(flags).toContain('`/flags/${code.trim().toLowerCase()}.svg`')
  })

  it('keeps home browsing state across home -> detail -> home', () => {
    const home = source('../src/views/HomeView.vue')
    const viewStore = source('../src/stores/dashboard-view.ts')
    const router = source('../src/router/index.ts')

    // 搜索、分组、排序与快捷筛选放在会话级 store，返回首页时不重置。
    expect(viewStore).toContain('useDashboardViewStore')
    for (const key of ['query', 'selectedGroup', 'sort', 'activeQuickFilter']) {
      expect(viewStore).toContain(key)
    }
    expect(home).toContain('storeToRefs(viewState)')
    // 浏览器返回时恢复原滚动位置；页面内导航回到首页时恢复离开首页时的位置（Komari onActivated）。
    expect(router).toContain('scrollBehavior: pageScrollBehavior')
    expect(source('../src/router/navigation-motion.ts')).toContain("savedPosition ?? { top: to.name === 'home' ? homeScrollTop : 0 }")
    // 这些是浏览状态，不得混入后端主题配置或本地覆盖，也不做任何持久化。
    expect(viewStore).not.toMatch(/localStorage\s*\./)
    expect(viewStore).not.toMatch(/sessionStorage\s*\./)
    expect(viewStore).not.toMatch(/\bfetch\s*\(/)
  })

  it('renders Earth and the overview cards inside one general stage like Komari', () => {
    const home = source('../src/views/HomeView.vue')
    const stylesheet = source('../src/styles/main.css')

    expect(home).toContain('class="general-stage"')
    expect(home).toContain('general-stage__earth')
    expect(home).toContain('general-stage__cards')
    // 球体在桌面端占右半、卡片占左半；tiled 改为卡片在上、地图在下。
    expect(stylesheet).toMatch(/\.general-stage--globe \.general-stage__earth\s*\{[^}]*grid-row: 1/s)
    expect(stylesheet).toMatch(/\.general-stage--tiled \.general-stage__earth\s*\{[^}]*grid-row: 2/s)
  })

  it('keeps the Komari flat node flow and collapses optional tools by default', () => {
    const home = source('../src/views/HomeView.vue')
    const header = source('../src/components/dashboard/AppHeader.vue')
    const controls = source('../src/components/dashboard/DashboardControls.vue')
    const viewStore = source('../src/stores/dashboard-view.ts')

    // 节点直接进入一层卡片/列表，不恢复 CFSM 中间实现的分组容器。
    expect(home).toContain('v-for="(server, index) in visibleServers"')
    expect(home).toContain(':servers="visibleServers"')
    expect(home).not.toContain('groupedServers')
    expect(home).not.toContain('server-group')

    // 第 8 轮高级工具能力保留，但按 Komari 首页层级默认收起。
    // 第 11 轮把开关从 Header 移到控制区右侧，与上游 homeTools 的位置一致；
    // Header 只保留站点身份与全局动作。
    expect(viewStore).toContain('const advancedToolsVisible = ref(false)')
    expect(home).toContain('v-if="showAdvancedTools"')
    expect(home).toContain('@toggle-tools="advancedToolsVisible = !advancedToolsVisible"')
    expect(controls).toContain('tool-switch')
    expect(controls).toContain('<AppIcon name="tabler:tools"')
    expect(header).not.toContain('toggleTools')
  })

  /* 第 11 轮：首页高保真复刻。 */

  it('encodes ping bars by Komari signal tone instead of bar height', () => {
    const card = source('../src/components/dashboard/ServerCard.vue')
    const stylesheet = source('../src/styles/main.css')

    // 上游用 signal-1..5 的颜色分级表达数值，柱子一律满高。
    for (const threshold of ['latency <= 60', 'latency <= 100', 'latency <= 160', 'latency <= 200']) {
      expect(card).toContain(threshold)
    }
    for (const threshold of ['loss <= 1', 'loss <= 3', 'loss <= 6', 'loss <= 9']) {
      expect(card).toContain(threshold)
    }
    expect(card).toContain('ping-signal-pattern-2')
    expect(card).toContain('ping-signal-pattern-4')
    // 无采样时渲染固定数量的中性占位柱，而不是留白。
    expect(card).toContain('EMPTY_PING_BAR_COUNT = 20')
    // 柱子高度不再承载数值。
    expect(card).not.toContain('barHeights')
    expect(stylesheet).toMatch(/\.node-probe__bars span\s*\{[^}]*height: 100%/s)

    // signal 色阶按上游原样移植，含亮色、暗色与两套色觉友好变体。
    expect(stylesheet).toContain('--signal-1: #059669')
    expect(stylesheet).toContain('--signal-5: #f43f5e')
    expect(stylesheet).toContain("[data-color-vision='friendly']")
    expect(stylesheet).toContain('--signal-1: #0072b2')
  })

  it('keeps the home controls to the upstream shape', () => {
    const controls = source('../src/components/dashboard/DashboardControls.vue')
    const stylesheet = source('../src/styles/main.css')

    // 视图切换只有卡片与列表两个按钮，卡片密度是主题设置而非首页控件。
    expect(controls).toContain('tabler:layout-grid')
    expect(controls).toContain('tabler:table')
    expect(controls).not.toContain("'compact'")
    expect(controls).not.toContain("'mini'")
    // 上游首页没有排序下拉与结果计数。
    expect(controls).not.toContain('update:sort')
    expect(controls).not.toContain('select-field')
    expect(controls).not.toContain('result-count')
    // 折叠搜索：默认只有图标宽度，聚焦或有内容才展开，并支持 ESC 清空。
    expect(controls).toContain('searchExpanded')
    expect(controls).toContain('@keydown.esc.prevent="clearSearch"')
    expect(stylesheet).toMatch(/\.search-field\s*\{[^}]*width: 32px/s)
    // 分组与快捷控制整体横向滚动。
    expect(controls).toContain('dashboard-controls__scroll')
  })

  it('matches the upstream node grid widths and gaps', () => {
    const stylesheet = source('../src/styles/main.css')

    // 单列起步，640px 以上才按密度 auto-fill。
    expect(stylesheet).toMatch(/\.server-grid,\s*\.skeleton-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s)
    expect(stylesheet).toMatch(/@media \(min-width: 640px\)[\s\S]*?minmax\(270px/)
    expect(stylesheet).toMatch(/@media \(min-width: 640px\)[\s\S]*?minmax\(300px/)
    expect(stylesheet).toMatch(/@media \(min-width: 640px\)[\s\S]*?minmax\(360px/)
    expect(stylesheet).toMatch(/@media \(min-width: 640px\)[\s\S]*?minmax\(420px/)
    // gap 依次 12 / 12 / 16 / 20。
    expect(stylesheet).toMatch(/\.server-grid--size-comfortable\s*\{[^}]*gap: 16px/s)
    expect(stylesheet).toMatch(/\.server-grid--size-large\s*\{[^}]*gap: 20px/s)
  })

  it('separates the view mode from the card density like upstream', () => {
    const types = source('../src/types/glassmorphism.ts')
    const settings = source('../src/theme/settings.ts')
    const home = source('../src/views/HomeView.vue')

    expect(types).toContain("export type DashboardViewMode = 'card' | 'list'")
    // 切换 card/list 不得改写用户选择的卡片密度。
    expect(settings).toContain("return { defaultViewMode: viewMode === 'list' ? 'list' : 'card' }")
    expect(home).toContain(':density="theme.runtime.nodeCardSize"')
    expect(home).toContain('`server-grid--size-${theme.runtime.nodeCardSize}`')
  })

  /* 第 9.9 轮：表现层深度收敛。 */

  it('builds overview cards with the Komari card anatomy and no invented heading block', () => {
    const overview = source('../src/components/dashboard/OverviewCards.vue')
    const stylesheet = source('../src/styles/main.css')

    // Komari 的总览区没有独立标题块，卡片本身就是栅格单元。
    expect(overview).not.toContain('overview-stage')
    expect(overview).not.toContain('节点总览</h1>')
    // 标签在左上、图标在右上，数值与单位基线对齐在底部。
    expect(overview).toContain('overview-card__head')
    expect(overview).toContain('overview-card__label')
    expect(overview).toContain('overview-card__icon')
    expect(overview).toContain('overview-card__number')
    expect(overview).toContain('overview-card__unit')
    expect(stylesheet).toMatch(/\.overview-grid\s*\{[^}]*grid-template-columns: repeat\(12/s)
    expect(stylesheet).toMatch(/\.overview-card\s*\{[^}]*grid-column: span 4/s)
    // Earth 隐藏时上游改为独立的 3 / 6 列等分网格，不得在单列父网格中继续跨 12 列。
    expect(stylesheet).toMatch(/\.general-stage--cards-only \.general-stage__cards\s*\{[^}]*grid-column: 1;[^}]*repeat\(3/s)
    expect(stylesheet).toMatch(/\.general-stage--cards-only \.overview-card\s*\{[^}]*min-height: 72px;[^}]*grid-column: span 1/s)
    expect(stylesheet).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.general-stage--cards-only \.general-stage__cards\s*\{[^}]*repeat\(6/s)
  })

  it('builds the node card with the Komari section order', () => {
    const card = source('../src/components/dashboard/ServerCard.vue')

    for (const marker of [
      'node-card__header',
      'node-card__header-extra',
      'node-card__chips',
      'node-metrics',
      'node-boxes',
      'node-probes',
      'node-tags',
      'node-card__offline',
    ]) {
      expect(card).toContain(marker)
    }
    // 头部右侧与 Komari 一致：收藏、OS 图标、地区旗帜。
    expect(card).toContain('osIconUrl(server.operatingSystem)')
    expect(card).toContain('flagUrl(regionCode)')
    // 四项进度：CPU / 内存 / 硬盘 / 流量。
    expect(card).toContain('node-metric__label--cpu')
    expect(card).toContain('node-metric__label--memory')
    expect(card).toContain('node-metric__label--disk')
    expect(card).toContain('node-metric__label--traffic')
    // 三列信息框保持上游图标和独立截断层；到期日期不直接塞进窄框。
    expect(card).toContain('tabler:calendar-stats')
    expect(card).toContain('tabler:coins')
    expect(card).toContain('node-box__text')
    expect(card).not.toContain('到期 {{ server.expireDate }}')
  })

  it('builds the node list as a Komari-style grid with its column contract', () => {
    const list = source('../src/components/dashboard/ServerList.vue')

    // Komari 使用栅格行而非语义化表格标签。
    expect(list).not.toMatch(/<table[\s>]/)
    expect(list).not.toMatch(/<tbody[\s>]/)
    expect(list).toContain('node-list__row')
    expect(list).toContain('gridTemplateColumns')
    for (const key of ['status', 'os', 'name', 'metadata', 'uptime', 'cpu', 'mem', 'disk', 'traffic', 'rate']) {
      expect(list).toContain(`key: '${key}'`)
    }
    // 「信息」列由 nodeListMetadataEnabled 控制，与上游列过滤一致。
    expect(list).toContain("column.key !== 'metadata' || props.metadataEnabled")
    // 性能优化保留。
    expect(list).toContain('v-memo=')
  })

  it('renders real icon components instead of text glyphs, without a runtime icon CDN', () => {
    const icons = source('../src/constants/icons.ts')
    const appIcon = source('../src/components/ui/AppIcon.vue')
    const presentation = source('../src/domain/theme-presentation.ts')
    const card = source('../src/components/dashboard/ServerCard.vue')

    // 图标名与 Komari 一致，路径数据在构建期内联，运行时不访问图标 CDN。
    expect(icons).toContain("'tabler:cpu'")
    expect(icons).toContain("'icon-park-outline:memory'")
    expect(appIcon).toContain('ICONS[props.name]')
    expect(appIcon).not.toContain('api.iconify.design')
    expect(icons).not.toMatch(/\bfetch\s*\(/)
    // 卡片数据里不再出现字符占位图标，全部是 Komari 同源图标名。
    expect(presentation).not.toMatch(/icon: '(?!tabler:|icon-park-outline:)[^']*'/)
    expect(card).toContain('AppIcon')
  })

  /* 第 9.95 轮：详情页 / History 图表 / UI 基元。 */

  it('renders history on the upstream echarts stack instead of a hand-written SVG chart', () => {
    const charts = ['LoadChart', 'PingChart', 'MetricSeriesChartCard']
      .map((name) => source(`../src/components/detail/${name}.vue`))
    const registry = source('../src/utils/echarts.ts')

    for (const chart of charts) {
      expect(chart).toContain('vue-echarts')
      expect(chart).toContain('<VChart')
      expect(chart).toContain('autoresize')
      // 旧的手写 SVG 折线实现不得残留。
      expect(chart).not.toContain('pathSegments')
      expect(chart).not.toContain('viewBox="0 0 800 220"')
    }
    // 只注册实际用到的组件，与 Komari utils/echarts.ts 一致。
    expect(registry).toContain('echarts/core')
    expect(registry).toContain('LineChart')
    expect(registry).toContain('CanvasRenderer')
  })

  it('never fabricates history points when charting', () => {
    // 注释里会提到上游的插值函数名（用来解释为什么不移植），断言跑在去掉注释的副本上。
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const options = strip(source('../src/domain/detail-chart-options.ts'))
    const rows = strip(source('../src/domain/server-detail.ts'))

    // 缺口保持缺口：超时(null)与缺失(false)都不进入数值 series，也不连线跨越；
    // 离线空档只插入不带数值的断点标记，不插值、不写 0。
    expect(options).toContain('connectNulls: false')
    expect(options).toContain('probeNumber(')
    expect(options).not.toMatch(/\?\?\s*0\b/)
    expect(options).not.toContain('interpolateNullsLinear')
    expect(options).not.toContain('cutPeakValues')
    expect(rows).toContain('point: null')
    expect(rows).not.toMatch(/\?\?\s*0\b/)
  })

  it('lays the detail page out with the Komari top navigation bar', () => {
    const detail = source('../src/views/ServerDetailView.vue')

    // 返回 / 旗帜 + 名称 / 状态徽章 / 标签 / 收藏与上下节点工具条。
    expect(detail).toContain('detail-topbar')
    expect(detail).toContain('tabler:arrow-left')
    expect(detail).toContain('detail-topbar__flag')
    expect(detail).toContain('detail-topbar__tools')
    expect(detail).toContain('navigateNode(-1)')
    expect(detail).toContain('navigateNode(1)')
    // CFSM 自创的 hero 面板已移除。
    expect(detail).not.toContain('detail-hero')
    expect(detail).not.toContain('SERVER DETAIL')
    // 上一台/下一台只复用首页已加载的索引，详情页仍只订阅单节点。
    expect(detail).toContain('serverStore.servers')
    expect(detail).toContain('serverDetailLocation(target.id, target.source.base, multiSource.value)')
  })

  it('shares the released header and Komari information-card order on detail pages', () => {
    const detail = source('../src/views/ServerDetailView.vue')

    expect(detail).toContain("import AppHeader from '@/components/dashboard/AppHeader.vue'")
    expect(detail).toContain('<AppHeader')

    const hardware = detail.indexOf('detail-info-card--hardware')
    const system = detail.indexOf('detail-info-card--system')
    const storage = detail.indexOf('detail-info-card--storage')
    const network = detail.indexOf('detail-info-card--network')
    expect(hardware).toBeGreaterThan(-1)
    expect(hardware).toBeLessThan(system)
    expect(system).toBeLessThan(storage)
    expect(storage).toBeLessThan(network)
    expect(detail).toContain('总流量')
    expect(detail).toContain('网络速率')
  })

  it('builds UI primitives on the upstream reka-ui and vue-sonner stack', () => {
    const tooltip = source('../src/components/ui/AppTooltip.vue')
    const tabs = source('../src/components/ui/AppTabs.vue')
    const badge = source('../src/components/ui/AppBadge.vue')
    const toaster = source('../src/components/ui/AppToaster.vue')
    const app = source('../src/App.vue')

    // Tooltip 走 reka-ui 的 Portal + 碰撞处理，而不是自写 absolute 气泡。
    expect(tooltip).toContain('from \'reka-ui\'')
    expect(tooltip).toContain('TooltipPortal')
    expect(tooltip).toContain('TooltipProvider')
    expect(tooltip).not.toContain('position: absolute')

    expect(tabs).toContain('TabsRoot')
    expect(tabs).toContain('TabsList')
    expect(tabs).toContain('TabsTrigger')
    expect(badge).toContain('Primitive')

    // 提示走 vue-sonner，并在应用根挂载一次。
    expect(toaster).toContain('vue-sonner')
    expect(app).toContain('AppToaster')
  })

  it('routes transient settings feedback through the toast layer', () => {
    const settings = source('../src/views/ThemeSettingsView.vue')

    expect(settings).toContain('@/utils/message')
    expect(settings).toContain('message.success')
    expect(settings).toContain('message.error')
    // 瞬时结果不再常驻页面。
    expect(settings).not.toContain('settings-save-alert is-success')
  })

  it('drives every tab surface through the shared tabs primitive', () => {
    const tools = source('../src/components/dashboard/AdvancedTools.vue')
    const controls = source('../src/components/dashboard/DashboardControls.vue')

    expect(tools).toContain('<AppTabs')
    expect(controls).toContain('<AppTabs')
    // 不再手写 role="tablist" / role="tab"。
    expect(tools).not.toContain('role="tablist"')
    expect(controls).not.toContain('role="tablist"')
  })

  it('keeps price visibility gated by both theme privacy and per-server settings', () => {
    const card = source('../src/components/dashboard/ServerCard.vue')
    const list = source('../src/components/dashboard/ServerList.vue')
    const home = source('../src/views/HomeView.vue')

    expect(home).toContain('hidePriceWhenLoggedOut')
    expect(card).toContain('!props.priceVisible || !props.server.showPrice')
    expect(list).toContain('!props.priceVisible || !server.showPrice')
  })
})
