import { readFileSync } from 'node:fs'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationNormalized, type Router } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  historyNavigation,
  installNavigationMotion,
  pageLeft,
  pageMotionEnabled,
  pageScrollBehavior,
  pageTransitionActive,
} from '@/router/navigation-motion'

/*
 * 手机从详情页手势返回首页时卡片会「抖动」：浏览器先显示首页截图，随后首页被重建、
 * 卡片从透明重播进场动画。修复对齐 Komari App.vue：KeepAlive 保留首页、卡片进场改为
 * TransitionGroup 的过渡（重新插回页面时不会重播）、页面内导航播放 out-in 换页过渡。
 * 浏览器历史导航不再播放换页过渡，避免在浏览器自己的返回动画之后再闪一次。
 */

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

const Page = defineComponent({ render: () => null })

function motionRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Page },
      { path: '/server/:id', name: 'server-detail', component: Page },
    ],
  })
  installNavigationMotion(router)
  return router
}

function nextNavigation(router: Router): Promise<void> {
  return new Promise((resolve) => {
    const stop = router.afterEach(() => {
      stop()
      resolve()
    })
  })
}

function location(name: string, matched = 1): RouteLocationNormalized {
  return { name, matched: Array.from({ length: matched }, () => ({})) } as unknown as RouteLocationNormalized
}

afterEach(() => {
  pageMotionEnabled.value = true
  historyNavigation.value = false
  vi.unstubAllGlobals()
})

describe('导航分类', () => {
  it('浏览器历史导航不播换页过渡，页面内导航照常播放', async () => {
    const router = motionRouter()
    await router.push('/')
    await router.push('/server/a')
    expect(historyNavigation.value).toBe(false)
    expect(pageTransitionActive.value).toBe(true)

    const back = nextNavigation(router)
    router.back()
    await back
    expect(historyNavigation.value).toBe(true)
    expect(pageTransitionActive.value).toBe(false)

    await router.push('/server/b')
    expect(historyNavigation.value).toBe(false)
    expect(pageTransitionActive.value).toBe(true)
  })

  it('关闭页面动画时一律不播', () => {
    pageMotionEnabled.value = false
    expect(pageTransitionActive.value).toBe(false)
  })
})

describe('滚动时机', () => {
  it('初始导航、同一页面内切换与历史导航立即滚动', () => {
    expect(pageScrollBehavior(location('home'), location('', 0), null)).toEqual({ top: 0 })
    expect(pageScrollBehavior(location('server-detail'), location('server-detail'), null)).toEqual({ top: 0 })
    historyNavigation.value = true
    const saved = { left: 0, top: 900 }
    expect(pageScrollBehavior(location('home'), location('server-detail'), saved)).toBe(saved)
  })

  it('播放换页过渡时等旧页面淡出后再滚动，新导航开始时放弃', async () => {
    const waiting = pageScrollBehavior(location('server-detail'), location('home'), null)
    expect(waiting).toBeInstanceOf(Promise)
    pageLeft()
    await expect(waiting).resolves.toEqual({ top: 0 })

    const router = motionRouter()
    await router.push('/')
    const abandoned = pageScrollBehavior(location('server-detail'), location('home'), null)
    await router.push('/server/a')
    await expect(abandoned).resolves.toBe(false)
  })

  it('页面内导航回到首页时恢复离开首页时的位置', async () => {
    vi.stubGlobal('window', { scrollY: 640 })
    const router = motionRouter()
    await router.push('/')
    await router.push('/server/a')
    pageMotionEnabled.value = false
    expect(pageScrollBehavior(location('home'), location('server-detail'), null)).toEqual({ top: 640 })
  })
})

describe('接线与样式', () => {
  const app = source('../src/App.vue')
  const home = source('../src/views/HomeView.vue')
  const routerSource = source('../src/router/index.ts')
  const css = source('../src/styles/main.css')
  const list = source('../src/components/dashboard/ServerList.vue')

  it('App 按上游保留首页并播放换页过渡', () => {
    expect(app).toContain('<RouterView v-slot="{ Component }">')
    expect(app).toContain('<KeepAlive :include="[\'HomeView\']">')
    expect(app).toContain('name="page"')
    expect(app).toContain(':css="pageTransitionActive"')
    expect(app).toContain(':mode="pageTransitionActive ? \'out-in\' : \'default\'"')
    expect(app).toContain(':duration="{ enter: 300, leave: 150 }"')
    expect(app).toContain('@after-leave="pageLeft"')
    expect(app).toContain("pageMotionEnabled.value = !theme.runtime.disablePageAnimation && reducedMotion.value !== 'reduce'")
    expect(routerSource).toContain('scrollBehavior: pageScrollBehavior')
    expect(routerSource).toContain('installNavigationMotion(router)')
  })

  it('首页可被 KeepAlive 匹配，返回时不重连、不重拉，只恢复标题', () => {
    expect(home).toContain("defineOptions({ name: 'HomeView' })")
    expect(home).toMatch(/onActivated\(\(\) => \{\n\s+viewActive = true\n\s+if \(siteTitle\.value\) document\.title = siteTitle\.value\n\}\)/)
    // 离开首页只记录不在前台，不停止实时连接；实时连接只在真正卸载时释放。
    expect(home).toMatch(/onDeactivated\(\(\) => \{\n\s+viewActive = false\n\}\)/)
    expect(home).toContain('onUnmounted(() => realtime.stop())')
  })

  it('首页在后台时不改网页标题', () => {
    // KeepAlive 保留的首页侦听仍在运行：停留详情页期间配置重读、站点名变化，不能把详情页的标题改掉。
    expect(home).toMatch(/watch\(siteTitle, \(title\) => \{\n\s+if \(title && viewActive\) document\.title = title\n\}, \{ immediate: true \}\)/)
  })

  it('卡片进场改为 TransitionGroup，数值与上游一致', () => {
    expect(home).toMatch(/<TransitionGroup\n\s+v-else-if="viewMode === 'card'"\n\s+:key="selectedGroup"\n\s+:appear="cardTransition"\n\s+:css="cardTransition"\n\s+name="node-card-switch"/)
    expect(home).toContain('const cardTransition = computed(() => !theme.runtime.disablePageAnimation && visibleServers.value.length <= 30)')
    expect(home).toContain("'--node-item-delay': `${index * 35}ms`")
    expect(css).not.toContain('node-enter')
    expect(css).toMatch(/\.node-card\.node-card-switch-enter-active \{\n\s+transition-delay: var\(--node-item-delay, 0ms\);/)
    expect(css).toMatch(/\.node-card\.node-card-switch-enter-from \{\n\s+opacity: 0;\n\s+transform: translateY\(10px\) scale\(0\.985\);\n\s+filter: blur\(3px\);/)
  })

  it('切换分组或快捷筛选时整组卡片重新进场（Komari TabsContent + getNodeItemTransitionKey）', () => {
    // 分组：上游每个分组一个 TabsContent，切换时网格整个卸载重挂，旧卡片当帧消失、新卡片按 appear 依次进场。
    // 只换卡片 key 的话，Vue 要等下一帧才移走离场卡片，切换瞬间会多出一帧新旧卡片共存。
    expect(home).toMatch(/<TransitionGroup\n\s+v-else-if="viewMode === 'card'"\n\s+:key="selectedGroup"/)
    // 快捷筛选：key 含快捷筛选，切换时旧卡片按离场过渡淡出、新卡片依次进场；
    // 实时数据、搜索与排序不改变 key，卡片保持原组件。
    expect(home).toContain("return `${selectedGroup.value}-${activeQuickFilter.value ?? 'all'}-${server.key}`")
    expect(home).toContain(':key="cardTransitionKey(server)"')
    expect(home).not.toContain(':key="server.key"\n                :server="server"')
  })

  it('离场淡出与换位滑动照搬上游 node-card-switch', () => {
    expect(css).toMatch(/\.node-card\.node-card-switch-enter-active,\n\.node-card\.node-card-switch-leave-active \{\n\s+transition:\n\s+opacity 180ms ease,\n\s+transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\),\n\s+filter 180ms ease;\n\}/)
    expect(css).toMatch(/\.node-card\.node-card-switch-move \{\n\s+transition: transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\);\n\}/)
    expect(css).toMatch(/\.node-card\.node-card-switch-leave-to \{\n\s+opacity: 0;\n\s+transform: translateY\(-6px\) scale\(0\.99\);\n\s+filter: blur\(2px\);/)
    // 减少动态效果时与上游一样全部关闭。
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s+\.node-card\.node-card-switch-enter-active,\n\s+\.node-card\.node-card-switch-leave-active,\n\s+\.node-card\.node-card-switch-move \{\n\s+transition: none;\n\s+transition-delay: 0ms;/)
    expect(css).toMatch(/\.node-card\.node-card-switch-enter-from,\n\s+\.node-card\.node-card-switch-leave-to \{\n\s+opacity: 1;\n\s+transform: none;\n\s+filter: none;/)
  })

  it('列表行切换照搬上游 NodeList 的 node-row-switch', () => {
    // 分组：列表随分组 key 整个重新挂载（上游在各分组的 TabsContent 里），行按 appear 依次进场。
    expect(home).toMatch(/<ServerList\n\s+v-else\n\s+:key="selectedGroup"/)
    expect(home).toContain(':transition-key="selectedGroup"')
    expect(home).toContain(':motion="!theme.runtime.disablePageAnimation"')
    // 行 key 只含分组（Komari getRowTransitionKey）：快捷筛选、实时数据与排序不换 key。
    expect(list).toContain('return `${props.transitionKey}-${server.key}`')
    expect(list).toMatch(/<TransitionGroup\n\s+:appear="rowTransition"\n\s+:css="rowTransition"\n\s+name="node-row-switch"\n\s+>/)
    // 超过 30 行上游改用虚拟列表、不做行过渡；关闭页面动画时同样不做。
    expect(list).toContain('const rowTransition = computed(() => props.motion && props.servers.length <= 30)')
    expect(list).toContain("'--node-row-delay': `${index * 35}ms`")
    expect(list).toContain('return ROW_DELAY_STYLES[Math.min(index, 12)]')
    expect(css).toMatch(/\.node-list__row\.node-row-switch-enter-active,\n\.node-list__row\.node-row-switch-leave-active \{\n\s+transition:\n\s+opacity 170ms ease,\n\s+transform 210ms cubic-bezier\(0\.22, 1, 0\.36, 1\),\n\s+filter 170ms ease;\n\}/)
    expect(css).toMatch(/\.node-list__row\.node-row-switch-enter-active \{\n\s+transition-delay: var\(--node-row-delay, 0ms\);/)
    expect(css).toMatch(/\.node-list__row\.node-row-switch-move \{\n\s+transition: transform 210ms cubic-bezier\(0\.22, 1, 0\.36, 1\);\n\}/)
    expect(css).toMatch(/\.node-list__row\.node-row-switch-enter-from \{\n\s+opacity: 0;\n\s+transform: translateY\(8px\);\n\s+filter: blur\(3px\);/)
    expect(css).toMatch(/\.node-list__row\.node-row-switch-leave-to \{\n\s+opacity: 0;\n\s+transform: translateY\(-5px\);\n\s+filter: blur\(2px\);/)
    expect(css).toMatch(/\.node-list__row\.node-row-switch-enter-from,\n\s+\.node-list__row\.node-row-switch-leave-to \{\n\s+opacity: 1;\n\s+transform: none;\n\s+filter: none;/)
  })

  it('换页过渡作用于页面主体与页脚，顶栏不动，数值与上游一致', () => {
    // 页脚紧跟在内容之后：只让主体过渡时，内容透明期间页脚会单独露出来（「先看到页脚」）。
    const both = (state: string) => `\\.page-${state} \\.app-shell > main,\\n\\.page-${state} \\.app-shell > footer \\{`
    expect(css).toMatch(new RegExp(`${both('enter-active')}\\n\\s+transition: all 300ms cubic-bezier\\(0, 0, 0\\.2, 1\\);`))
    expect(css).toMatch(new RegExp(`${both('enter-from')}\\n\\s+opacity: 0;\\n\\s+translate: 0 0\\.5rem;`))
    expect(css).toMatch(new RegExp(`${both('leave-active')}\\n\\s+transition: opacity 150ms cubic-bezier\\(0\\.4, 0, 1, 1\\);`))
    expect(css).toMatch(new RegExp(`${both('leave-to')}\\n\\s+opacity: 0;`))
    expect(css).not.toMatch(/\.page-[a-z-]+ \.app-shell > \.app-header/)
  })

  it('页面主体至少一屏高，页脚总在一屏之后（Komari main.min-h-screen）', () => {
    // 否则详情仍在加载、只有骨架时，页脚贴在首屏底部，看上去先于内容出现。
    expect(css).toMatch(/\.app-shell > main \{\n\s+min-height: 100vh;\n\}/)
  })
})
