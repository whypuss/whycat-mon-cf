<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ThemeMode } from '@/theme/settings'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTooltip from '@/components/ui/AppTooltip.vue'

/**
 * 与 Komari `Header.vue` 一致：只承载站点身份与全局动作。
 * 首页的高级工具开关属于控制区，不放在 Header 里。
 */
const props = withDefaults(defineProps<{
  title: string | null
  titlePending?: boolean
  version: string | null
  loading: boolean
  online?: number
  total?: number
  sourceCount?: number
  adminUrl: string | null
  /** 站点自己配置的主题模式：本地没有覆盖时按它描述。 */
  themeMode: ThemeMode
  /** 当前真实呈现的明暗，决定图标。 */
  resolvedTheme: 'light' | 'dark'
  /** 访客在本浏览器里的覆盖；null 表示跟随站点设置。 */
  themeOverride?: 'light' | 'dark' | null
  /*
   * 设置页不订阅节点数据，显示「0/0 在线」会是假状态，因此那里关掉状态条，
   * 只保留站点身份与全局动作——首页与详情页仍然照旧显示真实计数。
   */
  showStatus?: boolean
}>(), {
  online: 0,
  total: 0,
  sourceCount: 0,
  showStatus: true,
  themeOverride: null,
  titlePending: false,
})

defineEmits<{
  refresh: []
  cycleTheme: []
}>()

const scrolled = ref(false)

/*
 * 主题按钮的文案，对应 Komari `Header.vue` 的 `themeTitleMap`：
 * 访客在本浏览器里选了浅色 / 深色就直接说明；没选时说明站点自己的设置会怎么决定。
 */
const themeLabel = computed(() => {
  if (props.themeOverride === 'light') return '浅色'
  if (props.themeOverride === 'dark') return '深色'
  if (props.themeMode === 'beijing') return `跟随站点设置（北京时间${props.resolvedTheme === 'dark' ? '夜间' : '日间'}）`
  if (props.themeMode === 'system') return '跟随站点设置（跟随系统）'
  return `跟随站点设置（${props.themeMode === 'dark' ? '深色' : '浅色'}）`
})

/*
 * 站点标记优先用站点自己的图标，与 Komari `Header.vue` 的 Avatar 一致
 * （那边是 `AvatarImage src="/favicon.ico"` + 站点名首字兜底）。
 *
 * CFSM 不一定有 `/favicon.ico`：它把站点图标作为 `<link rel="icon">` 注入
 * index.html，值常常是 data: URI。所以先读文档里已有的那一条，再退到固定路径。
 * 两者都取不到、或图片加载失败时退回站点名首字，首字也没有才用内置几何标记——
 * 任何一步都不会让这个位置空着。
 */
const faviconFailed = ref(false)
const brandInitial = computed(() => (
  props.titlePending ? '' : (props.title?.trim().slice(0, 1) ?? '')
))
const brandImage = computed(() => (faviconFailed.value ? '' : faviconSource.value))

function resolveFavicon(): string {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return ''
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  const href = link?.getAttribute('href')?.trim() ?? ''
  return href === '' ? '/favicon.ico' : href
}

const faviconSource = ref(resolveFavicon())

function updateScrolled(): void {
  scrolled.value = window.scrollY > 12
}

onMounted(() => {
  updateScrolled()
  window.addEventListener('scroll', updateScrolled, { passive: true })
})

onUnmounted(() => window.removeEventListener('scroll', updateScrolled))
</script>

<template>
  <header class="app-header" :class="{ 'app-header--scrolled': scrolled }">
    <div class="app-header__inner">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          <img
            v-if="brandImage"
            class="brand__mark-image"
            :src="brandImage"
            alt=""
            decoding="sync"
            referrerpolicy="no-referrer"
            @error="faviconFailed = true"
          >
          <b v-else-if="brandInitial" class="brand__mark-initial">{{ brandInitial }}</b>
          <span v-else class="brand__mark-dot" />
        </span>
        <div class="brand__copy">
          <span v-if="titlePending" class="brand__title-placeholder skeleton" aria-hidden="true" />
          <strong v-else>{{ title }}</strong>
          <span>
            CFSM Glassmorphism Theme
            <template v-if="version">· v{{ version }}</template>
          </span>
        </div>
      </div>

      <div v-if="showStatus" class="header-status" aria-label="节点在线状态">
        <span
          class="status-dot"
          :class="loading ? 'status-dot--pending' : 'status-dot--online'"
        />
        <span>{{ online }}/{{ total }} 在线</span>
        <span class="header-status__divider" aria-hidden="true" />
        <span>{{ sourceCount }} 个数据源</span>
      </div>

      <div class="header-actions">
        <AppTooltip :content="`主题：${themeLabel}（点击切换）`">
          <button
            class="icon-button"
            type="button"
            :aria-label="`切换主题，当前${themeLabel}`"
            @click="$emit('cycleTheme')"
          >
            <AppIcon :name="resolvedTheme === 'dark' ? 'tabler:moon' : 'tabler:sun'" :size="18" />
          </button>
        </AppTooltip>
        <AppTooltip content="刷新数据">
          <button
            class="icon-button"
            :class="{ 'is-spinning': loading }"
            type="button"
            :disabled="loading"
            aria-label="刷新数据"
            @click="$emit('refresh')"
          >
            <AppIcon name="tabler:refresh" :size="18" />
          </button>
        </AppTooltip>
        <AppTooltip content="主题设置">
          <RouterLink class="icon-button" :to="{ name: 'theme-settings' }" aria-label="主题设置">
            <AppIcon name="tabler:settings" :size="18" />
          </RouterLink>
        </AppTooltip>
        <AppTooltip v-if="adminUrl" content="打开 CFSM 官方管理端">
          <a class="icon-button" :href="adminUrl" aria-label="管理端">
            <AppIcon name="tabler:external-link" :size="18" />
          </a>
        </AppTooltip>
      </div>
    </div>
  </header>
</template>
