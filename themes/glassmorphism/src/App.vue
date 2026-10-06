<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { computed, provide, readonly, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import DynamicBackground from '@/components/dashboard/DynamicBackground.vue'
import LoadingCover from '@/components/dashboard/LoadingCover.vue'
import TurnstileChallenge from '@/components/dashboard/TurnstileChallenge.vue'
import AppToaster from '@/components/ui/AppToaster.vue'
import { bootstrapKey, coldStartSettled, startBootstrapRequests, type EntryPage } from '@/domain/bootstrap'
import { captureInjectedSiteTitle, injectedSiteTitleKey, type InjectedSiteTitle } from '@/domain/site-title'
import { pageLeft, pageMotionEnabled, pageTransitionActive } from '@/router/navigation-motion'
import { getApiBases } from '@/services/cfsm/config'
import { useAppStore } from '@/stores/app'
import { useServersStore } from '@/stores/servers'
import type { DetailLoadState } from '@/stores/server-detail'
import { useThemeSettingsStore } from '@/stores/theme-settings'

// App runs before RouterView children: take this snapshot before their document.title watchers.
let injectedSiteTitle: InjectedSiteTitle | null = null
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  try {
    injectedSiteTitle = captureInjectedSiteTitle(document.title, window.location.origin, getApiBases())
  } catch {
    // Invalid or unavailable apiBase cannot establish the HTML title's ownership.
  }
}
provide(injectedSiteTitleKey, injectedSiteTitle)

const app = useAppStore()
const servers = useServersStore()
const theme = useThemeSettingsStore()
const route = useRoute()
const coverVisible = ref(true)
const entryDetailState = ref<DetailLoadState>('idle')
const reducedMotion = usePreferredReducedMotion()

watchEffect(() => {
  pageMotionEnabled.value = !theme.runtime.disablePageAnimation && reducedMotion.value !== 'reduce'
})
let initialPageClaimed = false

provide(bootstrapKey, {
  coverVisible: readonly(coverVisible),
  claimInitialPage() {
    if (initialPageClaimed) return false
    initialPageClaimed = true
    return true
  },
  reportDetailState(state) {
    entryDetailState.value = state
  },
})

theme.initialize()
// Start existing store requests while the lazy route chunk is still downloading.
// A settings deep link never needs the list; page consumers reuse in-flight work.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startBootstrapRequests(window.location.hash, app.initialize, servers.load)
}

const currentPage = computed<EntryPage | null>(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'server-detail') return 'server-detail'
  if (route.name === 'theme-settings') return 'theme-settings'
  return null
})
// 需要人机验证时遮罩不退出：数据请求此时都是 403，验证通过、页面重载数据后再按原条件退出。
watch([currentPage, () => app.state, () => servers.state, entryDetailState, () => app.turnstileSiteKey], () => {
  if (
    coverVisible.value
    && app.turnstileSiteKey === null
    && coldStartSettled(currentPage.value, app.state, servers.state, entryDetailState.value)
  ) {
    coverVisible.value = false
  }
}, { immediate: true, flush: 'sync' })

watch(() => app.config, (config) => {
  if (config) theme.hydrateBackend(config.themeOptions, config.preferredTheme)
}, { immediate: true })
watch(() => app.state, (state) => {
  if (state === 'error' && app.config === null) theme.resolveConfigFailure()
}, { immediate: true })
</script>

<template>
  <DynamicBackground />
  <Transition
    :css="!theme.runtime.disablePageAnimation"
    enter-active-class="loading-cover-enter-active"
    enter-from-class="loading-cover-enter-from"
    enter-to-class="loading-cover-enter-to"
    leave-active-class="loading-cover-leave-active"
    leave-from-class="loading-cover-leave-from"
    leave-to-class="loading-cover-leave-to"
  >
    <!-- 浏览中途凭据过期（403）时同样用遮罩承载人机验证。 -->
    <LoadingCover v-if="coverVisible || app.turnstileSiteKey !== null" :challenge="app.turnstileSiteKey !== null" :modal="!coverVisible">
      <TurnstileChallenge v-if="app.turnstileSiteKey !== null" :key="app.turnstileSiteKey" :site-key="app.turnstileSiteKey" />
    </LoadingCover>
  </Transition>
  <!--
    与 Komari App.vue 一致：首页由 KeepAlive 保留，返回时不重建、不重播卡片进场与数据加载；
    页面内导航播放 out-in 换页过渡。浏览器历史导航不播，原因见 router/navigation-motion.ts。
  -->
  <RouterView v-slot="{ Component }">
    <Transition
      name="page"
      :css="pageTransitionActive"
      :mode="pageTransitionActive ? 'out-in' : 'default'"
      :duration="{ enter: 300, leave: 150 }"
      @after-leave="pageLeft"
    >
      <KeepAlive :include="['HomeView']">
        <component :is="Component" />
      </KeepAlive>
    </Transition>
  </RouterView>
  <AppToaster />
</template>
