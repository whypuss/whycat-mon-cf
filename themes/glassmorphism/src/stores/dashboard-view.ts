import { ref } from 'vue'
import { defineStore } from 'pinia'
import { ALL_GROUPS } from '@/domain/dashboard'
import type { QuickControlKey } from '@/domain/theme-presentation'
import type { DashboardSort } from '@/types/glassmorphism'

/**
 * 首页的会话级浏览状态。
 *
 * 与 Komari 一致：从首页进入节点详情再返回时，搜索词、分组、排序与快捷筛选
 * 应当保持不变，不要求用户刷新或重新筛选。这些值只在当前会话内存中存活，
 * 既不进入 theme_options，也不写 localStorage —— 它们是浏览状态而不是主题配置。
 * 视图模式（card/list）仍由主题设置层拥有，避免同一外观状态出现两个写入者。
 * 高级工具的展开状态同样属于会话浏览状态；默认收起，避免工具面板抢占首页主层级。
 */
export const useDashboardViewStore = defineStore('dashboard-view', () => {
  const query = ref('')
  const selectedGroup = ref<string>(ALL_GROUPS)
  const sort = ref<DashboardSort>('order')
  const activeQuickFilter = ref<QuickControlKey | null>(null)
  const advancedToolsVisible = ref(false)
  const scrollTop = ref(0)

  function clearFilters(): void {
    query.value = ''
    selectedGroup.value = ALL_GROUPS
  }

  return {
    query,
    selectedGroup,
    sort,
    activeQuickFilter,
    advancedToolsVisible,
    scrollTop,
    clearFilters,
  }
})
