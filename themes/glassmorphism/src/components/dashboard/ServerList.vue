<script setup lang="ts">
import { computed } from 'vue'
import type { GlassServer } from '@/types/glassmorphism'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppProgressThin from '@/components/ui/AppProgressThin.vue'
import type { IconName } from '@/constants/icons'
import { resolveRegionCoordinates } from '@/domain/advanced-tools'
import { windowAverage } from '@/domain/probe-window'
import { resolveNodeProvider } from '@/domain/provider'
import {
  trafficDisplay,
  trafficDisplayPercent,
  trafficHeadText,
} from '@/domain/theme-presentation'
import { flagUrl, hideMissingFlag } from '@/utils/flags'
import { osDisplayName, osIconUrl } from '@/utils/os-icon'
import { trafficStatus, usageStatus } from '@/utils/progress-status'
import {
  formatDisplayPrice,
  formatDisplaySpeed,
  formatLatency,
  formatPercent,
  formatUptime,
  MISSING_TEXT,
} from '@/utils/format'

/**
 * 对齐 Komari `NodeList` 的节点列表。
 *
 * 与上游一致，采用 CSS 栅格行而不是语义化表格标签：
 * 状态 / 系统 / 节点 / 信息 / 运行时间 / CPU / 内存 / 硬盘 / 流量 / 速率。
 * 「信息」列受 `nodeListMetadataEnabled` 控制，与 Komari 的列过滤行为相同。
 * 行主点击直接进入详情，收藏按钮 stopPropagation。
 */
const props = defineProps<{
  servers: GlassServer[]
  showSource: boolean
  favoriteKeys: ReadonlySet<string>
  metadataEnabled: boolean
  metadataFields: string[]
  customTagsVisible: boolean
  /** 主题设置里的厂商别名原文，与详情页走同一套识别（`domain/provider.ts`）。 */
  providerAliases: string
  priceVisible: boolean
  /** 当前分组：与 Komari NodeList 的 `transitionKey` 一样并入行 key。 */
  transitionKey: string
  /** 页面动画开关（主题设置「禁用页面动画」的反面）。 */
  motion: boolean
}>()

const emit = defineEmits<{
  open: [server: GlassServer]
  toggleFavorite: [key: string]
}>()

interface ListColumn {
  key: string
  label: string
  width: string
  center?: boolean
}

const BASE_COLUMNS: readonly ListColumn[] = [
  { key: 'status', label: '状态', width: '40px', center: true },
  { key: 'os', label: '系统', width: '44px', center: true },
  { key: 'name', label: '节点', width: 'minmax(180px, 0.85fr)' },
  { key: 'metadata', label: '信息', width: 'minmax(240px, 1.1fr)' },
  { key: 'uptime', label: '运行时间', width: '116px' },
  { key: 'cpu', label: 'CPU', width: '100px' },
  { key: 'mem', label: '内存', width: '100px' },
  { key: 'disk', label: '硬盘', width: '100px' },
  { key: 'traffic', label: '流量', width: '104px' },
  { key: 'rate', label: '速率', width: '88px' },
]

const columns = computed(() => BASE_COLUMNS.filter(
  (column) => column.key !== 'metadata' || props.metadataEnabled,
))
const gridStyle = computed(() => ({
  gridTemplateColumns: columns.value.map((column) => column.width).join(' '),
}))

function ratio(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function regionCode(server: GlassServer): string | null {
  return resolveRegionCoordinates(server.region)?.code ?? null
}

function priceText(server: GlassServer): string {
  if (!props.priceVisible || !server.showPrice) return ''
  const text = formatDisplayPrice(server.price, server.currency, server.billingCycle)
  return text === MISSING_TEXT ? '' : text
}

interface MetadataBadge {
  key: string
  value: string
  flag?: string
  icon?: IconName
  title?: string
}

/**
 * 只展示 CFSM 真实存在的元数据。厂商与上游 NodeList 一样取 `displayName`、图标与识别依据，
 * 和详情页同一个识别函数：节点名称 / 分组 / 地区 / 标签、自定义别名，以及约定的 asn / org 标签。
 * 上游的 city / asn 两项来自 IP 地理查询，CFSM 不公开 IP，因此不提供。
 */
function metadataBadges(server: GlassServer): MetadataBadge[] {
  const fields = new Set(props.metadataFields)
  const badges: MetadataBadge[] = []

  if (fields.has('provider')) {
    const provider = resolveNodeProvider(server, props.providerAliases).provider
    if (provider?.displayName) {
      badges.push({
        key: 'provider',
        value: provider.displayName,
        icon: provider.primary.icon,
        title: provider.tooltipLines.length > 0 ? provider.tooltipLines.join('\n') : provider.displayName,
      })
    }
  }
  if (fields.has('region') && server.region) {
    const code = regionCode(server)
    badges.push({ key: 'region', value: server.region, ...(code ? { flag: flagUrl(code) } : {}) })
  }
  if (fields.has('group') && server.group) {
    badges.push({ key: 'group', value: server.group })
  }
  if (props.showSource) {
    badges.push({ key: 'source', value: server.sourceLabel })
  }
  if (props.customTagsVisible && fields.has('tags')) {
    for (const tag of server.tags) badges.push({ key: `tag:${tag}`, value: tag })
  }

  return badges
}

/*
 * 与节点卡、上游一致：显示 `/api/servers` 已返回的窗口平均延迟，而不是最近一次采样
 * （上游 `useNodePingDisplay` 的 `latencyDisplay` 取的是 `pingStats.avgLatency`）。
 * 站点关闭三网详情时窗口为空，回落到本次上报的最新值。
 */
function probeText(server: GlassServer): string {
  const probe = server.latency[0]
  if (!probe) return MISSING_TEXT
  const average = windowAverage(server.history.latencySeries, probe.target)
  return `${probe.label} ${formatLatency(average.value ?? probe.latency)}`
}

/** 与节点卡同一口径（`trafficDisplay`）：关闭流量展示或已用量缺失时不写成「∞」。 */
function trafficPercent(server: GlassServer): number | null {
  return trafficDisplayPercent(trafficDisplay(server))
}

function trafficHead(server: GlassServer): string {
  return trafficHeadText(trafficDisplay(server))
}

/*
 * 行切换动画，对应 Komari NodeList 的 node-row-switch：key 含分组，快捷筛选、实时数据与
 * 排序不改变 key——留下的行保持原元素，离开的行淡出、新增的行依次进场，换位时滑到新位置。
 * 上游超过 30 行改用虚拟列表、不做行过渡；关闭页面动画时同样不做。
 */
const ROW_DELAY_STYLES = Array.from({ length: 13 }, (_, index) => ({
  '--node-row-delay': `${index * 35}ms`,
}))
const rowTransition = computed(() => props.motion && props.servers.length <= 30)

function rowTransitionKey(server: GlassServer): string {
  return `${props.transitionKey}-${server.key}`
}

function rowStyle(index: number): Record<string, string> {
  return ROW_DELAY_STYLES[Math.min(index, 12)] ?? ROW_DELAY_STYLES[0] ?? {}
}

function handleRowKeydown(event: KeyboardEvent, server: GlassServer): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('open', server)
}

function hideMissingImage(event: Event): void {
  const target = event.target
  if (target instanceof HTMLImageElement) target.style.display = 'none'
}
</script>

<template>
  <div class="node-list">
    <div class="node-list__inner">
      <div class="node-list__head" :style="gridStyle" role="row">
        <span
          v-for="column in columns"
          :key="column.key"
          class="node-list__heading"
          :class="{ 'node-list__heading--center': column.center }"
          role="columnheader"
        >
          {{ column.label }}
        </span>
      </div>

      <TransitionGroup
        :appear="rowTransition"
        :css="rowTransition"
        name="node-row-switch"
      >
        <div
          v-for="(server, index) in servers"
          :key="rowTransitionKey(server)"
          v-memo="[
            server,
            index,
            favoriteKeys.has(server.key),
            showSource,
            metadataEnabled,
            metadataFields,
            customTagsVisible,
            providerAliases,
            priceVisible,
          ]"
          class="node-list__row"
          :class="{ 'node-list__row--offline': !server.online }"
          :style="rowStyle(index)"
          role="button"
          tabindex="0"
          :aria-label="`查看节点 ${server.name} 详情`"
          @click="emit('open', server)"
          @keydown="handleRowKeydown($event, server)"
        >
          <div class="node-list__cells" :style="gridStyle">
            <div class="node-list__cell node-list__cell--center">
              <span class="node-status-wrap" aria-hidden="true">
                <span
                  class="node-status"
                  :class="server.online ? 'node-status--online' : 'node-status--offline'"
                />
                <span
                  class="node-status-pulse"
                  :class="server.online ? 'node-status-pulse--online' : 'node-status-pulse--offline'"
                />
              </span>
            </div>

            <div class="node-list__cell node-list__cell--center">
              <img
                class="node-list__os"
                :src="osIconUrl(server.operatingSystem)"
                :alt="osDisplayName(server.operatingSystem)"
                :title="server.operatingSystem ?? osDisplayName(server.operatingSystem)"
                @error="hideMissingImage"
              >
            </div>

            <div class="node-list__cell node-list__cell--name">
              <div class="node-list__identity">
                <img
                  v-if="regionCode(server)"
                  class="node-list__flag"
                  :src="flagUrl(regionCode(server) as string)"
                  :alt="server.region ?? ''"
                  @error="hideMissingFlag"
                >
                <span class="node-list__name" :title="server.name">{{ server.name }}</span>
                <button
                  type="button"
                  class="favorite-button"
                  :class="{ 'is-favorite': favoriteKeys.has(server.key) }"
                  :aria-label="favoriteKeys.has(server.key) ? `取消收藏 ${server.name}` : `收藏 ${server.name}`"
                  :title="favoriteKeys.has(server.key) ? '取消收藏' : '收藏节点'"
                  @click.stop="emit('toggleFavorite', server.key)"
                  @keydown.stop
                >
                  <AppIcon :name="favoriteKeys.has(server.key) ? 'tabler:star-filled' : 'tabler:star'" :size="13" />
                </button>
              </div>
              <span v-if="priceText(server)" class="node-list__sub">{{ priceText(server) }}</span>
            </div>

            <div v-if="metadataEnabled" class="node-list__cell node-list__cell--metadata">
              <span
                v-for="badge in metadataBadges(server)"
                :key="badge.key"
                class="node-list__badge"
                :title="badge.title ?? badge.value"
              >
                <img v-if="badge.flag" :src="badge.flag" alt="" @error="hideMissingFlag">
                <AppIcon v-else-if="badge.icon" :name="badge.icon" :size="12" />
                <span>{{ badge.value }}</span>
              </span>
            </div>

            <div class="node-list__cell">
              <span class="node-list__sub">{{ formatUptime(server.bootTime) }}</span>
              <span class="node-list__sub">{{ probeText(server) }}</span>
            </div>

            <div class="node-list__cell node-list__cell--metric">
              <span class="node-list__metric-value">{{ formatPercent(server.cpu) }}</span>
              <!-- 上游 NodeList 的进度条同样按 `getStatus` 着色。 -->
              <AppProgressThin :percentage="server.cpu" :status="usageStatus(server.cpu)" />
            </div>

            <div class="node-list__cell node-list__cell--metric">
              <span class="node-list__metric-value">
                {{ formatPercent(ratio(server.memory.used, server.memory.total)) }}
              </span>
              <AppProgressThin
                :percentage="ratio(server.memory.used, server.memory.total)"
                :status="usageStatus(ratio(server.memory.used, server.memory.total))"
              />
            </div>

            <div class="node-list__cell node-list__cell--metric">
              <span class="node-list__metric-value">
                {{ formatPercent(ratio(server.disk.used, server.disk.total)) }}
              </span>
              <AppProgressThin
                :percentage="ratio(server.disk.used, server.disk.total)"
                :status="usageStatus(ratio(server.disk.used, server.disk.total))"
              />
            </div>

            <div class="node-list__cell node-list__cell--metric">
              <span class="node-list__metric-value">
                {{ trafficHead(server) }}
              </span>
              <AppProgressThin :percentage="trafficPercent(server)" :status="trafficStatus(trafficPercent(server))" />
            </div>

            <div class="node-list__cell">
              <span class="node-list__sub node-list__sub--up">↑ {{ formatDisplaySpeed(server.network.outSpeed) }}</span>
              <span class="node-list__sub node-list__sub--down">↓ {{ formatDisplaySpeed(server.network.inSpeed) }}</span>
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>
