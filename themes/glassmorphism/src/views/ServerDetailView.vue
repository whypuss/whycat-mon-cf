<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/dashboard/AppHeader.vue'
import LoadChart from '@/components/detail/LoadChart.vue'
import PingChart from '@/components/detail/PingChart.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppEmpty from '@/components/ui/AppEmpty.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTabs, { type AppTabItem } from '@/components/ui/AppTabs.vue'
import AppTooltip from '@/components/ui/AppTooltip.vue'
import type { IconName } from '@/constants/icons'
import { resolveRegionCoordinates } from '@/domain/advanced-tools'
import { issueCopy } from '@/domain/issue-copy'
import { resolveNodeProvider } from '@/domain/provider'
import { needsExchangeRate } from '@/domain/finance'
import { buildDetailCards, parseTrafficLimitBytes, resolveDetailCardKeys, trafficUsageBytes } from '@/domain/theme-presentation'
import { hasMultipleSources, serverDetailLocation } from '@/router/links'
import { getCpuBenchmarkRating, getPassMarkCpuLookupUrl } from '@/utils/cpu-benchmark'
import { osIconUrl } from '@/utils/os-icon'
import { detailDocumentTitle, injectedSiteTitleKey, injectedTitleForSource, resolveSiteTitle } from '@/domain/site-title'
import { bootstrapKey } from '@/domain/bootstrap'
import { configReady } from '@/domain/config-readiness'
import { useDashboardPreferencesStore } from '@/stores/dashboard-preferences'
import { useServersStore } from '@/stores/servers'
import { flagUrl, hideMissingFlag } from '@/utils/flags'
import { useAppStore } from '@/stores/app'
import { useFinanceStore } from '@/stores/finance'
import { useServerDetailStore } from '@/stores/server-detail'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import {
  formatCount,
  formatDetailUptime,
  formatDisplayBytes,
  formatDisplayMebibytes,
  formatDisplaySpeed,
  MISSING_TEXT,
} from '@/utils/format'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const detail = useServerDetailStore()
const theme = useThemeSettingsStore()
const finance = useFinanceStore()
const preferences = useDashboardPreferencesStore()
const serverStore = useServersStore()
const injectedSiteTitle = inject(injectedSiteTitleKey, null)
const bootstrap = inject(bootstrapKey, null)
const coldStartCover = bootstrap?.coverVisible ?? ref(false)
const {
  server,
  sourceConfig,
  sourceConfigState,
  state,
  historyState,
  pingHistoryState,
  issue,
  refreshIssue,
  fallbackActive,
  timedOut,
  paused,
} = storeToRefs(detail)
const mounted = ref(false)

const routeId = computed(() => (
  typeof route.params.id === 'string' ? route.params.id.trim() : ''
))
const multiSource = computed(() => hasMultipleSources(app.apiBases))
/*
 * 只有多来源部署才采用 URL 里的 `source`。单后端时它是冗余值，这里直接忽略——
 * 这样下面剥离该参数的 `router.replace` 不会让 `watch([routeId, requestedSource])`
 * 再触发一次加载，也就不会多发一轮请求。节点归属本身不受影响：单后端时
 * `fetchServerFromSources` 只有一个 base 可用。
 */
const requestedSource = computed(() => {
  const source = route.query.source
  return typeof source === 'string' && multiSource.value ? source : undefined
})
/*
 * 配置必须属于当前节点的 owning source。多源详情在 B 的配置未返回前不能借用
 * primary(A) 的标题、版本或授权状态；单源/primary 节点则继续复用已加载配置，
 * 不额外请求 `/api/config`。
 */
const expectedSourceBase = computed(() => server.value?.source.base ?? requestedSource.value ?? null)
const owningConfig = computed(() => {
  if (sourceConfig.value) return sourceConfig.value
  const base = expectedSourceBase.value
  if (app.config && (
    (base !== null && base === app.primaryBase)
    || (base === null && !multiSource.value)
  )) return app.config
  return null
})
const siteTitleResolution = computed(() => resolveSiteTitle(
  owningConfig.value?.siteTitle,
  state.value === 'idle'
    || state.value === 'loading'
    || (state.value === 'ready'
      && (sourceConfigState.value === 'idle' || sourceConfigState.value === 'loading')),
  injectedTitleForSource(injectedSiteTitle, app.primaryBase, expectedSourceBase.value),
))
const siteTitle = computed(() => siteTitleResolution.value.title)
const siteTitlePending = computed(() => siteTitleResolution.value.state === 'pending')
const pageLoading = computed(() => (
  (state.value === 'loading' && server.value === null)
  // 指标/布局取主后端 theme_options，标题和授权仍取节点所属后端。
  // B 的配置即使先返回，也不能在 A 尚未确定时以默认主题闪现详情内容。
  || (server.value !== null && (
    !configReady(owningConfig.value, sourceConfigState.value)
    || !configReady(app.config, app.state)
  ))
))
// A secondary owner's config can outlive /api/server; keep the cold-start cover
// until the existing detail gate can reveal real content rather than a skeleton.
watch([state, pageLoading], ([nextState, loading]) => {
  bootstrap?.reportDetailState(nextState === 'ready' && loading ? 'loading' : nextState)
}, { immediate: true, flush: 'sync' })
const refreshing = computed(() => (
  state.value === 'loading' || historyState.value === 'loading' || pingHistoryState.value === 'loading'
))
const headerTotal = computed(() => serverStore.servers.length || (server.value ? 1 : 0))
const headerOnline = computed(() => (
  serverStore.servers.length > 0
    ? serverStore.servers.filter((item) => item.online).length
    : server.value?.online ? 1 : 0
))
const sourceCount = computed(() => app.apiBases.length || (sourceConfig.value ? 1 : 0))
const visibleAdminUrl = computed(() => (
  !configReady(app.config, app.state)
    || (theme.runtime.hideAdminEntryWhenLoggedOut && app.config?.authorization !== true)
    ? null
    : app.administrationUrl
))
/*
 * 站点级展示开关只在 `/api/servers` 的顶层 `sysConfig` 里出现，
 * `/api/server` 只返回 `long_history_points`。详情页因此按 owning source
 * 回到 servers store 取站点开关，节点自身若带同名字段仍以节点为准。
 * 不这样做的话，运营方设置的 show_price / show_expire / show_tf 在详情页会完全失效。
 */
const siteVisibility = computed(() => (
  server.value ? serverStore.siteVisibility(server.value.source.base) : undefined
))
/*
 * 站点开关还没拿到时先按「隐藏」处理，等列表响应回来再决定。
 * 反过来（先显示再隐藏）会把运营方明确关掉的价格闪一下，那是真实的信息泄露；
 * 隐藏先行最多是晚一点出现。store 已经加载过（哪怕这个源没返回开关）就按可见处理，
 * 与之前的行为一致。
 */
const siteVisibilityKnown = computed(() => (
  server.value?.systemConfig !== undefined
  || (server.value !== null && serverStore.hasLoadedSource(server.value.source.base))
))
function visibilityFlag(flag: 'showPrice' | 'showExpire' | 'showTraffic'): boolean {
  if (!siteVisibilityKnown.value) return false
  return (server.value?.systemConfig?.[flag] ?? siteVisibility.value?.[flag]) !== false
}
const showPrice = computed(() => {
  const current = server.value
  if (!current) return false
  const authorized = owningConfig.value?.authorization ?? false
  if (theme.runtime.hidePriceWhenLoggedOut && !authorized) return false
  return visibilityFlag('showPrice')
    && (current.price !== null || current.billingCycle !== null || current.currency !== null)
})
const showExpiry = computed(() => {
  const current = server.value
  if (!current) return false
  return visibilityFlag('showExpire')
    && (current.expireDate !== null || current.autoRenewal !== null)
})
const showTrafficPolicy = computed(() => {
  const current = server.value
  if (!current) return false
  return visibilityFlag('showTraffic')
    && (current.trafficLimit !== null || current.trafficCalculationType !== null
      || current.resetDay !== null)
})
/*
 * 剩余价值与上游一样换算成财务显示币种。汇率只在价格可见、选用了这张卡、
 * 而且节点币种与显示币种不同时才请求；站点开关未知的冷启动阶段 showPrice 为 false，
 * 不会提前请求，也不会闪出金额。
 */
const detailFinance = computed(() => ({
  target: finance.preferences.displayCurrency,
  view: finance.view,
}))
watch(
  () => Boolean(
    server.value
    && showPrice.value
    && resolveDetailCardKeys(theme.runtime).includes('remainingValue')
    && needsExchangeRate(server.value.currency, finance.preferences.displayCurrency),
  ),
  (needed) => {
    if (needed) void finance.ensureRates()
  },
  { immediate: true },
)
const detailCards = computed(() => {
  if (!server.value) return []
  return buildDetailCards(server.value, theme.runtime, Date.now(), detailFinance.value).filter((card) => {
    // 剩余价值同样由价格推导，必须跟随 show_price 一起隐藏。
    if ((card.key === 'nodePrice' || card.key === 'monthlyCost' || card.key === 'remainingValue') && !showPrice.value) return false
    if (card.key === 'remainingTime' && !showExpiry.value) return false
    if (card.key === 'trafficQuota' && !showTrafficPolicy.value) return false
    return true
  })
})

/*
 * 与 Komari 详情页顶部工具条一致：收藏 + 上一台 / 节点选择 / 下一台。
 * 导航列表复用首页已经加载的轻量索引（CODEX_SPEC §79），
 * 详情页本身仍只订阅当前单节点，不会为了导航而订阅全量 WebSocket。
 */
const detailNodes = computed(() => serverStore.servers)
const currentNodeIndex = computed(() => detailNodes.value.findIndex(
  (item) => item.id === server.value?.id && item.source.base === server.value?.source.base,
))
const canNavigateNodes = computed(() => detailNodes.value.length > 1 && currentNodeIndex.value >= 0)
const favoriteKey = computed(() => (
  server.value ? `${server.value.source.base}::${server.value.id}` : null
))
const isFavorite = computed(() => (
  favoriteKey.value !== null && preferences.isFavorite(favoriteKey.value)
))
const regionCode = computed(() => resolveRegionCoordinates(server.value?.region ?? null)?.code ?? null)

/*
 * 厂商：上游在顶栏右侧放一个厂商标识，并在系统信息卡第四格显示「城市 · 厂商 · ASN」。
 * CFSM 没有厂商字段也不公开 IP，这里只从运营者自己填写的文本里识别——
 * 节点名称、分组、地区、普通标签，以及约定的 `asn` / `org` 标签（见 `domain/provider.ts`）。
 * 识别不到时与上游一样显示 `-`。原先这一格的数据源名称移到它的 title 里。
 */
const provider = computed(() => (
  server.value ? resolveNodeProvider(server.value, theme.runtime.providerAliases) : null
))

function toggleFavorite(): void {
  if (favoriteKey.value) preferences.toggleFavorite(favoriteKey.value)
}

function openNode(target: { id: string, source: { base: string } } | undefined): void {
  if (!target) return
  void router.push(serverDetailLocation(target.id, target.source.base, multiSource.value))
}

/*
 * 旧链接兼容：带 `?source=` 的地址照旧能打开，进入后把这个冗余参数抹掉。
 * 用 `replace` 而不是 `push`，不额外增加一条返回记录；其余查询参数原样保留。
 * 多来源部署不动这个参数——那里它是必需信息。
 */
function normalizeSourceQuery(): void {
  if (multiSource.value || typeof route.query.source !== 'string') return
  const query = { ...route.query }
  delete query.source
  void router.replace({ name: 'server-detail', params: { ...route.params }, query })
}

function navigateNode(step: number): void {
  if (!canNavigateNodes.value) return
  const size = detailNodes.value.length
  const next = (currentNodeIndex.value + step + size) % size
  openNode(detailNodes.value[next])
}

function selectNode(event: Event): void {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  openNode(detailNodes.value.find((item) => `${item.source.base}::${item.id}` === value))
}

function hideMissingImage(event: Event): void {
  const target = event.target
  if (target instanceof HTMLImageElement) target.style.display = 'none'
}

function meterWidth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '0%'
  return `${Math.min(Math.max(value, 0), 100)}%`
}

/*
 * 详情分区 Tab。上游 `InstanceDetail` 在 `nodeDetailSectionTabsEnabled` 打开时
 * 把页面切成 概览 / 负载 / 延迟 三段：概览是指标卡与四张信息卡，
 * 负载是 LoadChart，延迟是 PingChart。关闭时全部堆叠显示（上游默认关闭）。
 */
const DETAIL_SECTIONS: readonly AppTabItem[] = [
  { value: 'overview', label: '概览', icon: 'tabler:layout-dashboard' },
  { value: 'load', label: '负载', icon: 'tabler:activity' },
  { value: 'ping', label: '延迟', icon: 'tabler:timeline' },
]
const detailSections = DETAIL_SECTIONS
const activeSection = ref('overview')
const sectionTabs = computed(() => theme.runtime.nodeDetailSectionTabsEnabled)
const overviewVisible = computed(() => !sectionTabs.value || activeSection.value === 'overview')
const loadVisible = computed(() => !sectionTabs.value || activeSection.value === 'load')
const pingVisible = computed(() => !sectionTabs.value || activeSection.value === 'ping')

watch(() => server.value?.id, () => {
  activeSection.value = 'overview'
})

/*
 * 硬件卡的 CPU 块，逐项对应上游：型号 + vCPU 数、PassMark 外链、近似分级条。
 * 分级只读取 CPU 型号字符串，不引入 CFSM 之外的数据。
 */
const cpuName = computed(() => server.value?.cpuInfo?.trim() ?? '')
const cpuText = computed(() => {
  const name = cpuName.value || MISSING_TEXT
  const cores = server.value?.cpuCores
  return cores === null || cores === undefined ? name : `${name} (${formatCount(cores)} vCPU)`
})
const cpuBenchmarkUrl = computed(() => getPassMarkCpuLookupUrl(cpuName.value))
const cpuBenchmarkRating = computed(() => getCpuBenchmarkRating(cpuName.value))
const CPU_TIER_PERCENT: Record<string, number> = { S: 92, A: 76, B: 58, C: 38, D: 20, '?': 0 }
const cpuTierPercent = computed(() => CPU_TIER_PERCENT[cpuBenchmarkRating.value.tier] ?? 0)
const cpuTierTitle = computed(() => (
  `参考公开天梯与型号代际的本地近似分级，不代表当前 ${formatCount(server.value?.cpuCores ?? null)} vCPU 的实测性能。${cpuBenchmarkRating.value.description}`
))

interface InfoItem {
  label: string
  value: string
  icon: IconName
  title?: string
}

/*
 * 上游硬件小格共四项：IP（或架构）、物理核心数、虚拟机类型、GPU。
 * CFSM 的 `ip_v4` / `ip_v6` 只是可达性标志，也不提供物理核心数与虚拟机类型字段，
 * 因此前三项里只保留架构；补上 CFSM 真实提供的 Agent 版本，GPU 仍按存在与否显示。
 */
const hardwareItems = computed<InfoItem[]>(() => {
  const current = server.value
  if (!current) return []
  const items: InfoItem[] = [
    { label: '架构', value: current.architecture ?? '-', icon: 'icon-park-outline:application-two' },
    { label: 'Agent', value: current.agentVersion ?? '-', icon: 'icon-park-outline:server' },
  ]
  const gpuNames = current.gpus.map((gpu) => gpu.name.trim()).filter(Boolean)
  if (gpuNames.length > 0) {
    items.push({ label: 'GPU', value: gpuNames.join(' / '), icon: 'icon-park-outline:video-one' })
  }
  return items
})

const systemItems = computed<InfoItem[]>(() => {
  const current = server.value
  if (!current) return []
  return [
    { label: '操作系统', value: current.operatingSystem ?? '-', icon: 'icon-park-outline:computer' },
    { label: '内核版本', value: current.kernelVersion ?? '-', icon: 'icon-park-outline:code' },
    { label: '运行时间', value: formatDetailUptime(current.bootTime), icon: 'icon-park-outline:timer' },
    {
      label: '厂商',
      value: provider.value?.display ?? '-',
      icon: provider.value?.icon ?? 'icon-park-outline:server',
      title: [provider.value?.tooltip, `数据源：${current.source.label}`].filter(Boolean).join('\n'),
    },
  ]
})

const storageItems = computed<InfoItem[]>(() => {
  const current = server.value
  if (!current) return []
  return [
    { label: '内存', value: formatDisplayMebibytes(current.memoryTotal), icon: 'icon-park-outline:memory' },
    { label: '内存交换', value: formatDisplayMebibytes(current.swapTotal), icon: 'icon-park-outline:switch' },
    { label: '硬盘', value: formatDisplayMebibytes(current.diskTotal), icon: 'icon-park-outline:hard-disk' },
  ]
})

/*
 * 网络卡的总流量块。上游按 `traffic_limit_type` 选口径并把使用率画成背景进度条；
 * CFSM 的口径字段是 `traffic_calculation_type`，含义相同。
 * 没有可靠配额时显示「无限流量」，不猜一个上限。
 */
const trafficQuota = computed<{ used: number, limit: number, percent: number } | null>(() => {
  const current = server.value
  if (!current || !showTrafficPolicy.value) return null
  const limit = parseTrafficLimitBytes(current.trafficLimit)
  const received = current.monthlyNetworkReceived
  const transmitted = current.monthlyNetworkTransmitted
  const used = trafficUsageBytes(received, transmitted, current.trafficCalculationType)
  if (limit === null || used === null) return null
  return { used, limit, percent: Math.min(100, (used / limit) * 100) }
})
const trafficUsageText = computed(() => {
  const quota = trafficQuota.value
  if (!quota) {
    const limit = parseTrafficLimitBytes(server.value?.trafficLimit ?? null)
    return limit === null ? '无限流量' : `${MISSING_TEXT} / ${formatDisplayBytes(limit)}`
  }
  return `${formatDisplayBytes(quota.used)} / ${formatDisplayBytes(quota.limit)}`
})
const trafficProgressTone = computed(() => {
  const percent = trafficQuota.value?.percent ?? 0
  if (percent >= 80) return 'is-danger'
  if (percent >= 60) return 'is-warning'
  return 'is-ok'
})

async function loadCurrent(): Promise<void> {
  if (!mounted.value || routeId.value === '') return
  if (app.apiBases.length === 0) await app.initialize()
  await detail.open(routeId.value, app.apiBases, requestedSource.value)
}

async function refresh(): Promise<void> {
  await detail.refresh()
}

// 通过 Turnstile 人机验证后重新拉取数据：节点若因 403 从未载入就重新打开，否则按原有刷新路径更新；
// 顶部节点选择器依赖的列表同样被拒绝过，为空时按挂载时的规则补取。
watch(() => app.credentialRevision, () => {
  if (serverStore.collections.length === 0) void serverStore.load()
  void (server.value ? refresh() : loadCurrent())
})

onMounted(async () => {
  const initialPage = bootstrap?.claimInitialPage() ?? false
  // initialize() 会在第一次 await 之前同步解析 apiBases；不要在这里等待配置响应，
  // 否则慢 `/api/config` 会把 `/api/server`、列表和历史一起串行阻塞。
  // 详情 store 会复用同一份配置 Promise，因此并发启动也不会重复请求配置。
  const configPromise = app.state === 'idle' || (initialPage && app.state === 'loading')
    ? app.initialize() : Promise.resolve()
  mounted.value = true
  normalizeSourceQuery()
  /*
   * 站点级 show_price / show_expire / show_tf 只出现在 `/api/servers` 的顶层
   * `sysConfig`，`/api/server` 没有。从首页点进来时 store 里已经有这份数据，
   * 但直接粘贴详情链接冷启动时没有，运营方隐藏的价格 / 到期 / 流量会照常显示。
   *
   * 这里补一次**已有的**列表请求（首页用的同一个 store action、同一个端点），
   * 不新增请求形态，也不轮询：只在 store 为空时触发一次。
   * 顺带把顶部的上一台 / 选择器 / 下一台在冷启动时也补齐。
   */
  const listNeeded = initialPage
    ? serverStore.state === 'idle' || serverStore.state === 'loading'
    : serverStore.collections.length === 0
  const listPromise = listNeeded
    ? serverStore.load()
    : Promise.resolve()
  await Promise.all([configPromise, loadCurrent(), listPromise])
})

watch([routeId, requestedSource], () => {
  if (mounted.value) void loadCurrent()
})

/* 前进 / 后退回到旧的带 source 链接时同样规范化；抹掉后再次进入本回调会直接返回。 */
watch(() => route.query.source, () => {
  if (mounted.value) normalizeSourceQuery()
})

watch([server, siteTitle], () => {
  const title = detailDocumentTitle(server.value?.name, siteTitleResolution.value)
  // 切换 source 时先清掉上一页的标题；保留旧 A 标题直到 B 返回同样属于串源。
  document.title = title ?? ''
}, { immediate: true })

onUnmounted(() => detail.close())
</script>

<template>
  <div class="app-root detail-root">
    <div class="app-shell">
      <AppHeader
        :title="siteTitle"
        :title-pending="siteTitlePending"
        :version="owningConfig?.version ?? null"
        :loading="refreshing"
        :online="headerOnline"
        :total="headerTotal"
        :source-count="sourceCount"
        :admin-url="visibleAdminUrl"
        :theme-mode="theme.siteThemeMode"
        :resolved-theme="theme.resolvedTheme"
        :theme-override="theme.themeOverride"
        @refresh="refresh"
        @cycle-theme="theme.cycleTheme"
      />

      <main v-if="!coldStartCover" class="detail-page">
        <section v-if="pageLoading" class="detail-loading" aria-label="正在加载节点详情">
          <span class="skeleton detail-loading__hero" />
          <span v-for="index in 8" :key="index" class="skeleton detail-loading__card" />
        </section>

        <section v-else-if="state === 'error'" class="state-panel state-panel--error detail-state" role="alert">
          <AppEmpty
            tone="error"
            :title="issueCopy(issue, 'detail').title"
            :description="issueCopy(issue, 'detail').body"
          >
            <template #icon>
              <AppIcon name="lucide:octagon-x" :size="20" />
            </template>
            <template #extra>
              <small v-if="issue?.status">HTTP {{ issue.status }}</small>
              <div class="detail-state__actions">
                <button type="button" class="state-panel__retry" @click="loadCurrent">
                  重新加载
                </button>
                <button type="button" @click="router.push({ name: 'home' })">
                  返回首页
                </button>
              </div>
            </template>
          </AppEmpty>
        </section>

        <template v-else-if="server">
          <div class="detail-topbar">
            <button
              type="button"
              class="icon-button"
              aria-label="返回首页"
              title="返回首页"
              @click="router.push({ name: 'home' })"
            >
              <AppIcon name="tabler:arrow-left" :size="16" />
            </button>

            <div class="detail-topbar__identity">
              <img
                v-if="regionCode"
                class="detail-topbar__flag"
                :src="flagUrl(regionCode)"
                :alt="server.region ?? regionCode"
                @error="hideMissingFlag"
              >
              <span class="detail-topbar__name" :title="server.name">{{ server.name }}</span>
            </div>

            <AppBadge :variant="server.online ? 'default' : 'destructive'">
              {{ server.online ? '在线' : '离线' }}
            </AppBadge>

            <div v-if="server.tags.length" class="detail-topbar__tags">
              <AppBadge v-for="tag in server.tags" :key="tag" variant="outline">
                {{ tag }}
              </AppBadge>
            </div>

            <div class="detail-topbar__tools">
              <button
                type="button"
                class="icon-button favorite-button"
                :class="{ 'is-favorite': isFavorite }"
                :aria-label="isFavorite ? '取消收藏当前节点' : '收藏当前节点'"
                :title="isFavorite ? '取消收藏' : '收藏节点'"
                @click="toggleFavorite"
              >
                <AppIcon :name="isFavorite ? 'tabler:star-filled' : 'tabler:star'" :size="14" />
              </button>
              <button
                type="button"
                class="icon-button"
                :disabled="!canNavigateNodes"
                aria-label="上一个节点"
                title="上一个节点"
                @click="navigateNode(-1)"
              >
                <AppIcon name="tabler:chevron-left" :size="14" />
              </button>
              <select
                v-if="canNavigateNodes"
                class="detail-topbar__select"
                :value="favoriteKey ?? undefined"
                aria-label="切换节点"
                @change="selectNode"
              >
                <option v-for="node in detailNodes" :key="`${node.source.base}::${node.id}`" :value="`${node.source.base}::${node.id}`">
                  {{ node.name }}
                </option>
              </select>
              <button
                type="button"
                class="icon-button"
                :disabled="!canNavigateNodes"
                aria-label="下一个节点"
                title="下一个节点"
                @click="navigateNode(1)"
              >
                <AppIcon name="tabler:chevron-right" :size="14" />
              </button>
            </div>

            <div v-if="provider?.provider" class="detail-provider">
              <AppTooltip :content="provider.tooltip" placement="bottom">
                <span class="detail-provider__chip">
                  <AppIcon :name="provider.provider.primary.icon" :size="14" />
                  <span>{{ provider.provider.displayName }}</span>
                </span>
              </AppTooltip>
            </div>
          </div>

          <div v-if="timedOut" class="notice notice--warning notice--choice" role="status">
            <div><strong>实时连接已达到站点设定的时长</strong><span>可以继续接收实时数据，或先暂停实时更新。</span></div>
            <div class="notice__actions">
              <button type="button" @click="detail.continueAfterTimeout">
                继续实时连接
              </button>
              <button type="button" @click="detail.pauseAfterTimeout">
                保持暂停
              </button>
            </div>
          </div>
          <div v-else-if="paused" class="notice notice--warning notice--choice" role="status">
            <div><strong>实时更新已暂停</strong><span>页面停留在暂停前的最后数据，恢复后会重新连接。</span></div>
            <div class="notice__actions">
              <button type="button" @click="detail.resume">
                恢复实时连接
              </button>
            </div>
          </div>
          <div v-if="fallbackActive" class="notice notice--warning" role="status">
            <strong>实时连接暂不可用</strong>
            <span>暂时改为每 {{ theme.runtime.dataUpdateInterval }} 秒刷新一次，连接恢复后会自动切回实时更新。</span>
          </div>
          <div v-if="refreshIssue" class="notice notice--warning" role="status">
            <strong>{{ issueCopy(refreshIssue, 'detail').title }}</strong>
            <span>{{ issueCopy(refreshIssue, 'detail').body }}</span>
          </div>

          <div v-if="theme.runtime.nodeDetailSectionTabsEnabled" class="detail-tabs-bar">
            <AppTabs
              v-model="activeSection"
              list-label="详情分区"
              :items="detailSections"
            />
          </div>

          <section v-if="overviewVisible" class="detail-overview" aria-label="节点指标概览">
            <div class="detail-resource-grid">
              <article
                v-for="card in detailCards"
                :key="card.key"
                class="detail-metric-card"
                :class="`detail-metric-card--${card.key}`"
                :title="card.hint || undefined"
              >
                <span class="detail-metric-card__head">
                  <span class="detail-metric-card__label">{{ card.label }}</span>
                  <AppIcon :name="card.icon" :size="20" />
                </span>
                <span class="detail-metric-card__value" :class="card.tone ? `is-${card.tone}` : undefined">
                  <strong>{{ card.value }}</strong>
                  <em v-if="card.unit">{{ card.unit }}</em>
                </span>
              </article>
            </div>
          </section>

          <section v-if="overviewVisible" class="detail-information-grid" aria-label="节点基础信息">
            <article class="detail-info-card detail-info-card--hardware">
              <header><h2>硬件信息</h2></header>
              <div class="detail-info-card__body">
                <div class="detail-fact detail-fact--cpu">
                  <span class="detail-fact__head">
                    <span><AppIcon name="icon-park-outline:cpu" :size="14" />CPU</span>
                    <a
                      class="detail-cpu-link"
                      :href="cpuBenchmarkUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 PassMark 查看该 CPU 的公开 CPU Mark 跑分与排行"
                    >
                      <AppIcon name="tabler:chart-bar" :size="13" />
                      <span class="detail-cpu-link__long">CPU Mark 排行</span>
                      <span class="detail-cpu-link__short">CPU Mark</span>
                      <AppIcon name="tabler:external-link" :size="11" />
                    </a>
                  </span>
                  <strong>{{ cpuText }}</strong>
                  <div class="detail-cpu-tier" :title="cpuTierTitle">
                    <span class="detail-cpu-tier__letter" :class="`is-tier-${cpuBenchmarkRating.tier}`">
                      {{ cpuBenchmarkRating.tier }}
                    </span>
                    <div class="detail-cpu-tier__bar">
                      <i :class="`is-tier-${cpuBenchmarkRating.tier}`" :style="{ width: `${cpuTierPercent}%` }" />
                    </div>
                    <span class="detail-cpu-tier__label">{{ cpuBenchmarkRating.label }}</span>
                  </div>
                </div>
                <div class="detail-fact-grid" :class="hardwareItems.length <= 2 ? 'is-two' : 'is-three'">
                  <div v-for="item in hardwareItems" :key="item.label" class="detail-fact">
                    <span><AppIcon :name="item.icon" :size="14" />{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article class="detail-info-card detail-info-card--system">
              <header><h2>系统信息</h2></header>
              <div class="detail-fact-grid">
                <div v-for="item in systemItems" :key="item.label" class="detail-fact" :title="item.title">
                  <span><AppIcon :name="item.icon" :size="14" />{{ item.label }}</span>
                  <strong>
                    <img
                      v-if="item.label === '操作系统'"
                      class="detail-fact__os"
                      :src="osIconUrl(server.operatingSystem)"
                      :alt="server.operatingSystem ?? '操作系统'"
                      @error="hideMissingImage"
                    >
                    <span>{{ item.value }}</span>
                  </strong>
                </div>
              </div>
            </article>

            <article class="detail-info-card detail-info-card--storage">
              <header><h2>存储信息</h2></header>
              <div class="detail-storage-grid">
                <div v-for="item in storageItems" :key="item.label" class="detail-fact">
                  <span><AppIcon :name="item.icon" :size="14" />{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </article>

            <article class="detail-info-card detail-info-card--network">
              <header><h2>网络信息</h2></header>
              <div class="detail-network-grid">
                <div class="detail-network-card">
                  <i
                    v-if="trafficQuota"
                    class="detail-network-card__progress"
                    :class="trafficProgressTone"
                    :style="{ width: meterWidth(trafficQuota.percent) }"
                    aria-hidden="true"
                  />
                  <span class="detail-network-card__head">
                    <span><AppIcon name="icon-park-outline:transfer-data" :size="14" />总流量</span>
                    <span class="detail-network-card__protocols">
                      <AppBadge v-if="server.ipV4Reachable === '1'" variant="outline">IPv4</AppBadge>
                      <AppBadge v-if="server.ipV6Reachable === '1'" variant="outline">IPv6</AppBadge>
                    </span>
                    <small>{{ formatDisplayBytes(server.networkTransmitted) }} / {{ formatDisplayBytes(server.networkReceived) }}</small>
                  </span>
                  <strong>{{ trafficUsageText }}</strong>
                </div>
                <div class="detail-network-card">
                  <span class="detail-network-card__head">
                    <span><AppIcon name="icon-park-outline:dashboard-one" :size="14" />网络速率</span>
                  </span>
                  <strong class="detail-network-card__rates">
                    <span class="network-up"><AppIcon name="tabler:chevron-up" :size="12" />{{ formatDisplaySpeed(server.networkOutSpeed) }}</span>
                    <span class="network-down"><AppIcon name="tabler:chevron-down" :size="12" />{{ formatDisplaySpeed(server.networkInSpeed) }}</span>
                  </strong>
                </div>
              </div>
            </article>
          </section>

          <LoadChart v-if="loadVisible" />
          <PingChart v-if="pingVisible" />
        </template>
      </main>

      <footer v-if="!coldStartCover" class="app-footer">
        <span>Powered by <a href="https://github.com/huilang-me/CF-Server-Monitor/">CF-Server-Monitor<template v-if="sourceConfig?.version"> v{{ sourceConfig.version }}</template></a></span>
        <span>Glassmorphism Theme · Server Detail</span>
      </footer>
    </div>
  </div>
</template>
