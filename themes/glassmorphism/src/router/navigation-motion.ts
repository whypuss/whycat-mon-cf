import { computed, ref } from 'vue'
import type { Router, RouterScrollBehavior } from 'vue-router'

/**
 * 换页动效，对应 Komari `App.vue`：RouterView 外包 out-in 的 Transition，内含 `KeepAlive(HomeView)`。
 *
 * 浏览器历史导航（手势返回、返回键、前进）由浏览器自己的动画或页面截图接管，
 * 页面再播一次淡出淡入会在截图之后多闪一下，所以这类导航直接呈现目标页；
 * 页面内的点击导航照上游播放过渡。关闭页面动画或系统要求减少动态效果时一律不播。
 */
export const pageMotionEnabled = ref(true)
export const historyNavigation = ref(false)
export const pageTransitionActive = computed(() => pageMotionEnabled.value && !historyNavigation.value)

let popPending = false
let homeScrollTop = 0
let pendingScroll: ((left: boolean) => void) | null = null

function settlePendingScroll(left: boolean): void {
  const settle = pendingScroll
  pendingScroll = null
  settle?.(left)
}

/** 换页 Transition 的 after-leave：旧页面淡出结束，放行等待中的滚动。 */
export function pageLeft(): void {
  settlePendingScroll(true)
}

export function installNavigationMotion(router: Router): void {
  // RouterHistory 只在浏览器历史遍历（popstate）时回调监听者，页面内的 push / replace 不会触发。
  router.options.history.listen(() => {
    popPending = true
  })
  router.beforeEach((_to, from) => {
    historyNavigation.value = popPending
    popPending = false
    // 新导航开始时放弃上一次尚未执行的滚动，避免它迟到后作用在新页面上。
    settlePendingScroll(false)
    if (from.name === 'home' && typeof window !== 'undefined') homeScrollTop = window.scrollY
  })
}

/**
 * 与 Komari 一致：首页由 KeepAlive 保留，回到首页时恢复离开时的位置（上游在 `onActivated`
 * 中恢复 `homeScrollPosition`）；浏览器历史导航沿用浏览器记录的位置；其余导航回到顶部。
 * 播放 out-in 过渡时，滚动等旧页面淡出后再执行，否则旧页面会在淡出途中跳到顶部。
 */
export const pageScrollBehavior: RouterScrollBehavior = (to, from, savedPosition) => {
  const target = savedPosition ?? { top: to.name === 'home' ? homeScrollTop : 0 }
  // 初始导航、同一页面内的切换（例如详情页切换节点）不播换页过渡，无需等待。
  const transitions = pageTransitionActive.value && from.matched.length > 0 && to.name !== from.name
  if (!transitions) return target
  return new Promise((resolve) => {
    pendingScroll = (left) => resolve(left ? target : false)
  })
}
