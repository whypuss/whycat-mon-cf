<script setup lang="ts">
import { computed, inject, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/dashboard/AppHeader.vue'
import AdvancedTools from '@/components/dashboard/AdvancedTools.vue'
import DashboardControls from '@/components/dashboard/DashboardControls.vue'
import EarthMap from '@/components/dashboard/EarthMap.vue'
import MarkdownRenderer from '@/components/dashboard/MarkdownRenderer.vue'
import OverviewCards from '@/components/dashboard/OverviewCards.vue'
import ServerCard from '@/components/dashboard/ServerCard.vue'
import ServerList from '@/components/dashboard/ServerList.vue'
import {
  ALL_GROUPS,
  availableGroups,
  filterServers,
  sortServers,
  summarizeServers,
} from '@/domain/dashboard'
import {
  financeNodesOf,
  generalFinanceContext,
  isExpiring,
  isHighLoad,
  resolveQuickControlKeys,
  type QuickControlKey,
} from '@/domain/theme-presentation'
import { hasMultipleSources, serverDetailLocation } from '@/router/links'
import { createGlassServerMapper, issueFromFailure } from '@/services/cfsm'
import { useAppStore } from '@/stores/app'
import { useDashboardPreferencesStore } from '@/stores/dashboard-preferences'
import { useDashboardViewStore } from '@/stores/dashboard-view'
import { useFinanceStore } from '@/stores/finance'
import { useRealtimeStore } from '@/stores/realtime'
import { useServersStore } from '@/stores/servers'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { parseSettingKeys } from '@/theme/settings'
import { bootstrapKey } from '@/domain/bootstrap'
import { injectedSiteTitleKey, injectedTitleForPrimary, resolveSiteTitle } from '@/domain/site-title'
import { configReady } from '@/domain/config-readiness'
import { issueReason } from '@/domain/issue-copy'
import type { ServerSourceFailure } from '@/types/cfsm'
import type { DashboardSort, DashboardViewMode, GlassServer } from '@/types/glassmorphism'

// App.vue 的 `KeepAlive :include="['HomeView']"` 按组件名匹配，与 Komari 一致。
defineOptions({ name: 'HomeView' })

const app = useAppStore()
const serverStore = useServersStore()
const preferences = useDashboardPreferencesStore()
const realtime = useRealtimeStore()
const theme = useThemeSettingsStore()
const finance = useFinanceStore()
const router = useRouter()
const glassServerMapper = createGlassServerMapper()
const injectedSiteTitle = inject(injectedSiteTitleKey, null)
const bootstrap = inject(bootstrapKey, null)
const coldStartCover = bootstrap?.coverVisible ?? ref(false)

// 首页浏览状态放在会话级 store 中，保证「首页 → 详情 → 返回首页」后
// 搜索词、分组、排序与快捷筛选保持不变，不需要刷新或重新筛选。
const viewState = useDashboardViewStore()
const { query, selectedGroup, sort, activeQuickFilter, advancedToolsVisible } = storeToRefs(viewState)
const refreshing = ref(false)
// Komari UI_CONFIG.motion：staggerMs 35、staggerLimit 12。
const NODE_ITEM_DELAY_STYLES = Array.from({ length: 13 }, (_, index) => ({
  '--node-item-delay': `${index * 35}ms`,
}))

const siteTitleResolution = computed(() => resolveSiteTitle(
  app.config?.siteTitle,
  app.config === null && (app.state === 'idle' || app.state === 'loading'),
  injectedTitleForPrimary(injectedSiteTitle, app.primaryBase),
))
const siteTitle = computed(() => siteTitleResolution.value.title)
const siteTitlePending = computed(() => siteTitleResolution.value.state === 'pending')
const siteConfigReady = computed(() => configReady(app.config, app.state))
const viewMode = computed({
  get: () => theme.viewMode,
  set: (value: DashboardViewMode) => theme.setDashboardViewMode(value),
})
const visibleAdminUrl = computed(() => (
  !siteConfigReady.value || (theme.runtime.hideAdminEntryWhenLoggedOut && app.config?.authorization !== true)
    ? null
    : app.administrationUrl
))
const advancedToolsAvailable = computed(() => (
  theme.runtime.homeToolsEnabled && app.config?.authorization === true
))
const showAdvancedTools = computed(() => advancedToolsAvailable.value && advancedToolsVisible.value)
const isDark = computed(() => theme.resolvedTheme === 'dark')
/** 主题级价格隐私；每台节点自身的 showPrice 仍在卡片与列表内单独生效。 */
const priceVisible = computed(() => (
  !theme.runtime.hidePriceWhenLoggedOut || app.config?.authorization === true
))
// 与 Komari NodeGeneralCards 一致：Earth 与总览卡片同处一个栅格容器。
// 球体渲染器在桌面端占右半、卡片占左半；tiled 则卡片在上、整幅地图在下。
const showEarth = computed(() => !theme.runtime.hideEarth)
const showGeneralCards = computed(() => !theme.runtime.hideGeneralCard)
const isTiledEarth = computed(() => showEarth.value && theme.runtime.earthRenderer === 'tiled')
const showGeneralStage = computed(() => showEarth.value || showGeneralCards.value)
const generalStageClass = computed(() => {
  if (!showEarth.value) return 'general-stage--cards-only'
  return isTiledEarth.value ? 'general-stage--tiled' : 'general-stage--globe'
})
const metadataFields = computed(() => parseSettingKeys(theme.runtime.nodeListMetadataFields))
const quickControlKeys = computed(() => resolveQuickControlKeys(theme.runtime))
const glassServers = computed(() => (
  glassServerMapper.map(serverStore.servers, app.config)
))
const summary = computed(() => summarizeServers(glassServers.value))
/*
 * 总览里的剩余价值 / 月费用 / 年费用。只有选用了这些卡、价格对访客可见、而且确有跨币种换算时
 * 才请求汇率；站点关闭 show_price 的节点不参与合计，明细弹窗也只拿到这些节点。
 */
const financeNodes = computed(() => financeNodesOf(glassServers.value))
const generalFinance = computed(() => (
  siteConfigReady.value && showGeneralCards.value
    ? generalFinanceContext(glassServers.value, theme.runtime, {
      priceVisible: priceVisible.value,
      target: finance.preferences.displayCurrency,
      view: finance.view,
      excludeFree: finance.preferences.excludeFree,
      now: Date.now(),
    })
    : undefined
))
watch(
  () => generalFinance.value?.state === 'visible' && generalFinance.value.summary.needsRates,
  (needed) => {
    if (needed) void finance.ensureRates()
  },
  { immediate: true },
)
const groups = computed(() => availableGroups(glassServers.value))
const filteredServers = computed(() => {
  const servers = filterServers(
    glassServers.value,
    query.value,
    selectedGroup.value,
    activeQuickFilter.value === 'favorite' ? preferences.favorites : undefined,
  )
  if (activeQuickFilter.value === 'offline') return servers.filter((server) => !server.online)
  if (activeQuickFilter.value === 'highLoad') return servers.filter((server) => isHighLoad(server, theme.runtime.homeHighLoadThreshold))
  if (activeQuickFilter.value === 'expiring') return servers.filter((server) => isExpiring(server, theme.runtime.homeExpiringDays))
  return servers
})
const visibleServers = computed(() => sortServers(
  filteredServers.value,
  sort.value,
  theme.runtime.offlineNodesLast,
))
/*
 * 与上游 `quickControlCounts` / `getQuickControlCount` 一致：在当前分组与搜索范围内计数，
 * 不受正在使用的快捷筛选影响；排序类控制（总流量、上行、下行、峰值）显示范围内的节点数。
 */
const quickCountBase = computed(() => filterServers(glassServers.value, query.value, selectedGroup.value))
const quickCounts = computed<Record<QuickControlKey, number>>(() => {
  const base = quickCountBase.value
  return {
    favorite: base.filter((server) => preferences.isFavorite(server.key)).length,
    offline: base.filter((server) => !server.online).length,
    highLoad: base.filter((server) => isHighLoad(server, theme.runtime.homeHighLoadThreshold)).length,
    expiring: base.filter((server) => isExpiring(server, theme.runtime.homeExpiringDays)).length,
    totalTraffic: base.length,
    upload: base.length,
    download: base.length,
    peak: base.length,
  }
})
const isDenseCollection = computed(() => visibleServers.value.length >= 30)
// Komari enableNodeCardTransition：关闭页面动画或卡片超过 30 张（denseNodeAppearThreshold）时不播进场过渡。
const cardTransition = computed(() => !theme.runtime.disablePageAnimation && visibleServers.value.length <= 30)
const showSource = computed(() => (
  app.apiBases.length > 1 || serverStore.collections.length > 1
))
const sourceCount = computed(() => (
  app.apiBases.length || serverStore.collections.length
))
const initialLoading = computed(() => !siteConfigReady.value || (
  glassServers.value.length === 0
  && (app.state === 'idle' || app.state === 'loading'
    || serverStore.state === 'idle' || serverStore.state === 'loading')
))
const hasNoServers = computed(() => (
  !initialLoading.value
  && serverStore.state !== 'error'
  && glassServers.value.length === 0
))
const hasNoMatches = computed(() => (
  glassServers.value.length > 0 && visibleServers.value.length === 0
))
const allOffline = computed(() => summary.value.total > 0 && summary.value.online === 0)
// 页脚与上游一样用英文；状态只说访客能理解的结果，不出现 REST / WebSocket 这类实现细节。
const realtimeLabel = computed(() => {
  if (realtime.status === 'live') return 'Live updates'
  if (realtime.status === 'fallback') return 'Polling updates'
  if (realtime.status === 'timed-out') return 'Live updates timed out'
  if (realtime.status === 'paused') return 'Live updates paused'
  if (realtime.status === 'connecting') return 'Connecting live updates'
  return 'Snapshot'
})

/** 数据源失败的简短中文原因；不把 CFSM 返回的英文错误码直接显示给访客。 */
function failureReason(failure: ServerSourceFailure): string {
  return issueReason(issueFromFailure(failure))
}

// 节点一个都没加载到时的原因：单数据源直接说原因，多数据源逐个列出。
const serverLoadReason = computed(() => {
  const failures = serverStore.sourceFailures
  if (failures.length === 0) return '暂时无法读取节点数据，请稍后重试。'
  return failures
    .map((failure) => (showSource.value ? `${failure.source.label}：${failureReason(failure)}` : failureReason(failure)))
    .join('；')
})

watch(groups, (nextGroups) => {
  if (selectedGroup.value !== ALL_GROUPS && !nextGroups.includes(selectedGroup.value)) {
    selectedGroup.value = ALL_GROUPS
  }
})

// 首页由 KeepAlive 保留，离开后侦听仍在运行（与 Komari 的 isViewActive 一样区分前台）：
// 只有首页在前台时才改网页标题，否则停留详情页期间配置重读、站点名变化会把详情页的标题改掉。
let viewActive = true

watch(siteTitle, (title) => {
  if (title && viewActive) document.title = title
}, { immediate: true })

// KeepAlive 回到首页时组件不重建，上面的 watch 不会再执行，这里恢复被详情页改写的标题。
onActivated(() => {
  viewActive = true
  if (siteTitle.value) document.title = siteTitle.value
})

onDeactivated(() => {
  viewActive = false
})

async function refreshRest(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([
      app.initialize(),
      serverStore.load(),
    ])
  } finally {
    refreshing.value = false
  }
}

// 通过 Turnstile 人机验证后重新拉取数据：此前的请求都因缺少凭据被 CFSM 以 403 拒绝。
// 与手动刷新一样，拉取后让实时连接按新的节点列表同步；验证前列表为空，不同步的话 WebSocket 不会建立。
watch(() => app.credentialRevision, () => {
  void refresh()
})

async function refresh(): Promise<void> {
  await refreshRest()
  realtime.sync()
}

/**
 * 与 Komari 的 NodeCard / NodeList 主路径一致：卡片或列表行的主点击直接进入节点详情，
 * 中间不插入快速预览、二次确认或任何其它中间层。
 *
 * 链接由 `router/links` 统一生成：多 apiBase 场景仍然带上该节点的 owning source，
 * 避免把节点解析到错误的后端；单后端站点上该参数恒等于当前同源地址，予以省略。
 */
function openServer(server: GlassServer): void {
  void router.push(serverDetailLocation(
    server.id,
    server.sourceBase,
    hasMultipleSources(app.apiBases),
  ))
}

function cardStyle(index: number): Record<string, string> {
  return NODE_ITEM_DELAY_STYLES[Math.min(index, 12)] ?? NODE_ITEM_DELAY_STYLES[0] ?? {}
}

/**
 * Komari getNodeItemTransitionKey：key 含当前分组与快捷筛选。切换快捷筛选时整组卡片换新 key，
 * 旧卡片按离场过渡淡出、新卡片依次进场；切换分组时整个网格随外层 key 重新挂载（见模板）。
 * 实时数据更新、搜索与排序不改变 key，卡片保持原组件，换位时按 move 过渡滑到新位置。
 */
function cardTransitionKey(server: GlassServer): string {
  return `${selectedGroup.value}-${activeQuickFilter.value ?? 'all'}-${server.key}`
}

function quickAction(key: QuickControlKey): void {
  if (activeQuickFilter.value === key) {
    activeQuickFilter.value = null
    if (['totalTraffic', 'upload', 'download', 'peak'].includes(key)) sort.value = 'order'
    return
  }
  activeQuickFilter.value = key
  const sorts: Partial<Record<QuickControlKey, DashboardSort>> = {
    totalTraffic: 'traffic',
    upload: 'upload',
    download: 'download',
    peak: 'peak',
  }
  if (sorts[key]) sort.value = sorts[key] as DashboardSort
}

onMounted(async () => {
  preferences.initialize()
  if (bootstrap?.claimInitialPage()) {
    await Promise.all([
      app.state === 'idle' || app.state === 'loading' ? app.initialize() : Promise.resolve(),
      serverStore.state === 'idle' || serverStore.state === 'loading' ? serverStore.load() : Promise.resolve(),
    ])
  } else {
    await refreshRest()
  }
  realtime.start(refreshRest)
})

onUnmounted(() => realtime.stop())
</script>

<template>
  <div class="app-root">
    <div class="app-shell">
      <AppHeader
        :title="siteTitle"
        :title-pending="siteTitlePending"
        :version="app.config?.version ?? null"
        :loading="refreshing"
        :online="summary.online"
        :total="summary.total"
        :source-count="sourceCount"
        :admin-url="visibleAdminUrl"
        :theme-mode="theme.siteThemeMode"
        :resolved-theme="theme.resolvedTheme"
        :theme-override="theme.themeOverride"
        @refresh="refresh"
        @cycle-theme="theme.cycleTheme"
      />

      <main v-if="!coldStartCover" class="dashboard">
        <!--
          与 Komari 一致：公告位于总览与节点区之前，是首页第一块内容。结构对应上游
          `.alert.px-4` 里的 shadcn Alert：只有正文非空才出现，标题可选、没有默认标题与图标，
          正文按受限 Markdown 渲染（不执行 HTML）。
        -->
        <div
          v-if="siteConfigReady && theme.runtime.alertEnabled && theme.runtime.alertContent"
          class="theme-announcement"
        >
          <div data-slot="alert" class="theme-announcement__box" role="alert">
            <div v-if="theme.runtime.alertTitle" data-slot="alert-title" class="theme-announcement__title">
              {{ theme.runtime.alertTitle }}
            </div>
            <div data-slot="alert-description" class="theme-announcement__description">
              <MarkdownRenderer :content="theme.runtime.alertContent" />
            </div>
          </div>
        </div>

        <div
          v-if="app.state === 'error'"
          class="notice notice--warning"
          role="status"
        >
          <strong>无法读取站点配置</strong>
          <span>主题设置暂用默认值，节点数据会继续加载。</span>
        </div>

        <!-- 节点一个都没加载到时由下方的「无法加载节点」说明原因，这里只提示部分失败或刷新失败。 -->
        <div
          v-if="serverStore.sourceFailures.length > 0 && serverStore.state !== 'error'"
          class="notice notice--warning"
          role="status"
        >
          <template v-if="showSource">
            <strong>部分数据源暂不可用</strong>
            <span
              v-for="failure in serverStore.sourceFailures"
              :key="failure.source.base"
            >
              {{ failure.source.label }}：{{ failureReason(failure) }}
            </span>
          </template>
          <template v-else>
            <strong>数据刷新失败</strong>
            <span
              v-for="failure in serverStore.sourceFailures"
              :key="failure.source.base"
            >
              {{ failureReason(failure) }}，页面显示的是上次读取的数据。
            </span>
          </template>
        </div>

        <div
          v-if="realtime.timedOut"
          class="notice notice--warning notice--choice"
          role="status"
        >
          <div>
            <strong>实时连接已达到站点设定的时长</strong>
            <span>可以继续接收实时数据，或先暂停实时更新。</span>
          </div>
          <div class="notice__actions">
            <button type="button" @click="realtime.continueAfterTimeout">
              继续实时连接
            </button>
            <button type="button" @click="realtime.pauseAfterTimeout">
              保持暂停
            </button>
          </div>
        </div>

        <div
          v-else-if="realtime.paused"
          class="notice notice--warning notice--choice"
          role="status"
        >
          <div>
            <strong>实时更新已暂停</strong>
            <span>页面停留在暂停前的最后数据，恢复后会重新连接。</span>
          </div>
          <div class="notice__actions">
            <button type="button" @click="realtime.resume">
              恢复实时连接
            </button>
          </div>
        </div>

        <div
          v-if="realtime.fallbackActive"
          class="notice notice--warning"
          role="status"
        >
          <strong>实时连接暂不可用</strong>
          <span>暂时改为每 {{ theme.runtime.dataUpdateInterval }} 秒刷新一次，连接恢复后会自动切回实时更新。</span>
        </div>

        <div
          v-if="allOffline"
          class="notice notice--offline"
          role="status"
        >
          <strong>所有节点都已离线</strong>
          <span>显示的是各节点离线前最后一次上报的数据。</span>
        </div>

        <template v-if="initialLoading">
          <div class="overview-grid" aria-label="正在加载总览">
            <span
              v-for="index in 6"
              :key="index"
              class="skeleton skeleton--overview"
            />
          </div>
          <section class="skeleton-grid" aria-label="正在加载节点">
            <span
              v-for="index in 3"
              :key="index"
              class="skeleton skeleton--card"
            />
          </section>
        </template>

        <template v-else>
          <section
            v-if="showGeneralStage"
            class="general-stage"
            :class="generalStageClass"
          >
            <EarthMap
              v-if="showEarth"
              class="general-stage__earth"
              :servers="glassServers"
              :renderer="theme.runtime.earthRenderer"
              :stopped="theme.runtime.stopEarth"
              :is-dark="isDark"
            />

            <OverviewCards
              v-if="showGeneralCards"
              class="general-stage__cards"
              :servers="glassServers"
              :settings="theme.runtime"
              :finance="generalFinance"
              :finance-nodes="financeNodes"
            />
          </section>

          <AdvancedTools
            v-if="showAdvancedTools"
            :servers="glassServers"
            :settings="theme.runtime"
            :site-title="siteTitle ?? ''"
            @select="openServer"
          />

          <div
            v-if="serverStore.state === 'error'"
            class="state-panel state-panel--error"
            role="alert"
          >
            <span class="state-panel__icon" aria-hidden="true">!</span>
            <h2>无法加载节点</h2>
            <p>{{ serverLoadReason }}</p>
            <button type="button" class="state-panel__retry" @click="refresh">
              重新加载
            </button>
          </div>

          <div
            v-else-if="hasNoServers"
            class="state-panel"
          >
            <span class="state-panel__icon" aria-hidden="true">0</span>
            <h2>暂无节点</h2>
            <p>CFSM 返回了空服务器列表。添加节点后，它们会出现在这里。</p>
          </div>

          <div v-else class="dashboard-node-info">
            <DashboardControls
              v-model:query="query"
              v-model:group="selectedGroup"
              v-model:view-mode="viewMode"
              :groups="groups"
              :quick-controls-enabled="theme.runtime.homeQuickControlsEnabled"
              :quick-control-keys="quickControlKeys"
              :quick-counts="quickCounts"
              :active-quick-filter="activeQuickFilter"
              :tools-available="advancedToolsAvailable"
              :tools-visible="showAdvancedTools"
              @quick-action="quickAction"
              @toggle-tools="advancedToolsVisible = !advancedToolsVisible"
            />

            <div
              v-if="hasNoMatches"
              class="state-panel state-panel--compact"
            >
              <span class="state-panel__icon" aria-hidden="true">⌕</span>
              <h2>没有匹配节点</h2>
              <p>请调整搜索词或分组筛选。</p>
              <button
                type="button"
                @click="viewState.clearFilters()"
              >
                清除筛选
              </button>
            </div>

            <!--
              与 Komari 一致：卡片进场用 TransitionGroup 的过渡，只在首次渲染与卡片加入列表时播放；
              KeepAlive 重新插回页面时不会重播（CSS animation 会）。
              按分组加 key：上游每个分组各有一个 TabsContent，切换分组时旧分组的网格整个卸载、
              新分组的网格重新挂载并按 appear 依次进场，旧卡片当帧消失，不走离场过渡。
            -->
            <TransitionGroup
              v-else-if="viewMode === 'card'"
              :key="selectedGroup"
              :appear="cardTransition"
              :css="cardTransition"
              name="node-card-switch"
              tag="div"
              :class="[
                'server-grid',
                `server-grid--size-${theme.runtime.nodeCardSize}`,
                { 'server-grid--dense': isDenseCollection },
              ]"
            >
              <ServerCard
                v-for="(server, index) in visibleServers"
                :key="cardTransitionKey(server)"
                :server="server"
                :show-source="showSource"
                :density="theme.runtime.nodeCardSize"
                :favorite="preferences.isFavorite(server.key)"
                :price-visible="priceVisible"
                :style="cardStyle(index)"
                @open="openServer(server)"
                @toggle-favorite="preferences.toggleFavorite(server.key)"
              />
            </TransitionGroup>
            <!-- 与卡片网格同理：上游列表也在各分组的 TabsContent 里，切换分组时整个重新挂载。 -->
            <ServerList
              v-else
              :key="selectedGroup"
              :servers="visibleServers"
              :show-source="showSource"
              :favorite-keys="preferences.favorites"
              :metadata-enabled="theme.runtime.nodeListMetadataEnabled"
              :metadata-fields="metadataFields"
              :provider-aliases="theme.runtime.providerAliases"
              :custom-tags-visible="theme.runtime.nodeListCustomTagsVisible"
              :price-visible="priceVisible"
              :transition-key="selectedGroup"
              :motion="!theme.runtime.disablePageAnimation"
              @open="openServer"
              @toggle-favorite="preferences.toggleFavorite"
            />
          </div>
        </template>
      </main>

      <footer v-if="!coldStartCover" class="app-footer">
        <span>
          Powered by
          <a href="https://github.com/huilang-me/CF-Server-Monitor/">
            CF-Server-Monitor<template v-if="app.config?.version"> v{{ app.config.version }}</template>
          </a>
        </span>
        <span>Glassmorphism Theme · {{ realtimeLabel }}</span>
      </footer>
    </div>
  </div>
</template>
