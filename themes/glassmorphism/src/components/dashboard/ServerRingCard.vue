<script setup lang="ts">
import { computed } from 'vue'
import type { GlassServer } from '@/types/glassmorphism'
import type { ProbeTarget } from '@/types/cfsm'
import AppIcon from '@/components/ui/AppIcon.vue'
import { resolveRegionCoordinates } from '@/domain/advanced-tools'
import { probeSeriesFor, windowAverage, type ProbeSeriesMap } from '@/domain/probe-window'
import {
  daysUntilExpiry,
  remainingValue,
  trafficDisplay,
  trafficDisplayPercent,
  trafficHeadText,
  trafficRatioText,
} from '@/domain/theme-presentation'
import { flagUrl, hideMissingFlag } from '@/utils/flags'
import { osDisplayName, osIconUrl } from '@/utils/os-icon'
import {
  formatCurrencyValue,
  formatDisplayBytes,
  formatDisplayMebibytes,
  formatDisplayPrice,
  formatDisplaySpeed,
  formatHomeUptimeDays,
  formatLatency,
  formatLoad,
  formatPercent,
  formatProbePercent,
  MISSING_TEXT,
  normalizeTimestampMilliseconds,
} from '@/utils/format'
import { trafficStatus, usageStatus } from '@/utils/progress-status'

/**
 * Glassmorphism 风格的环图节点卡片：**指标区用 CPU/内存/硬盘三圆环**，
 * 其余区块（运行芯片、流量条、三网延迟/丢包、流媒体与 AI 解锁、标签、离线遮罩）
 * 与标准 `ServerCard` 完全一致，提供与 card 视图相同的完整信息密度。
 *
 * 圆环用 CSS `conic-gradient` + `backdrop-filter` 实现，颜色走全局 `--signal-*` 色板；
 * 缺数据时圆环退化为轨道色、中心显示 `--`，不写成 0。
 */
const props = defineProps<{
  server: GlassServer
  favorite: boolean
  priceVisible: boolean
}>()

const emit = defineEmits<{
  open: []
  toggleFavorite: []
}>()

function ratio(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null
  return Math.min(100, Math.max(0, (used / total) * 100))
}

const cpuPercent = computed(() => (props.server.cpu === null ? null : Math.min(100, Math.max(0, props.server.cpu))))
const memoryPercent = computed(() => ratio(props.server.memory.used, props.server.memory.total))
const diskPercent = computed(() => ratio(props.server.disk.used, props.server.disk.total))
const swapPercent = computed(() => ratio(props.server.swap.used, props.server.swap.total))
const hasSwap = computed(() => swapPercent.value !== null && (props.server.swap.total ?? 0) > 0)

const osName = computed(() => osDisplayName(props.server.operatingSystem))
const regionCode = computed(() => resolveRegionCoordinates(props.server.region)?.code ?? null)

const uptimeText = computed(() => formatHomeUptimeDays(props.server.bootTime))

const priceText = computed(() => {
  if (!props.priceVisible || !props.server.showPrice) return ''
  const text = formatDisplayPrice(props.server.price, props.server.currency, props.server.billingCycle)
  return text === MISSING_TEXT ? '' : text
})

const expireVisible = computed(() => props.server.showExpire && daysUntilExpiry(props.server.expireDate) !== null)

const expiryInfo = computed(() => {
  const days = daysUntilExpiry(props.server.expireDate)
  if (days === null) return { prefix: '', value: '', unit: '', text: '', tone: 'muted' }
  if (days < 0) return { prefix: '', value: '', unit: '', text: '已过期', tone: 'danger' }
  if (days === 0) return { prefix: '', value: '', unit: '', text: '今日到期', tone: 'warning' }
  const tone = days <= 7 ? 'danger' : days <= 30 ? 'warning' : 'success'
  return { prefix: '剩余', value: String(days), unit: '天', text: '', tone }
})

const remainingValueText = computed(() => {
  if (!props.priceVisible || !props.server.showPrice) return ''
  const rawPrice = props.server.price?.trim()
  if (!rawPrice) return ''
  const price = Number(rawPrice)
  if (!Number.isFinite(price) || (price < 0 && price !== -1)) return ''
  if (price === 0 || price === -1) return '无'
  return formatCurrencyValue(remainingValue(props.server), props.server.currency)
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

const offlineText = computed(() => {
  const timestamp = normalizeTimestampMilliseconds(props.server.lastUpdated)
  if (timestamp === null) return '尚无上报'
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

const chips = computed(() => {
  const list: string[] = [uptimeText.value]
  if (priceText.value) list.push(priceText.value)
  return list
})

/*
 * 三网延迟与丢包柱状图：与 ServerCard 完全一致的窗口平均 + 信号色板。
 * 一根柱子 = 一个时间桶；null 桶保留为 is-gap；整体无数据用 is-empty 占位。
 */

const EMPTY_PING_BAR_COUNT = 20

interface PingBar {
  key: string
  className: string
}

function latencyToneClass(latency: number): string {
  if (latency <= 60) return 'is-signal-1'
  if (latency <= 100) return 'is-signal-2'
  if (latency <= 160) return 'is-signal-3 ping-signal-pattern-2'
  if (latency <= 200) return 'is-signal-4 ping-signal-pattern-3'
  return 'is-signal-5 ping-signal-pattern-4'
}

function lossToneClass(loss: number): string {
  if (loss <= 1) return 'is-signal-1'
  if (loss <= 3) return 'is-signal-2'
  if (loss <= 6) return 'is-signal-3 ping-signal-pattern-2'
  if (loss <= 9) return 'is-signal-4 ping-signal-pattern-3'
  return 'is-signal-5 ping-signal-pattern-4'
}

function emptyBars(metric: string): PingBar[] {
  return Array.from({ length: EMPTY_PING_BAR_COUNT }, (_, index) => ({
    key: `${metric}-empty-${index}`,
    className: 'is-empty',
  }))
}

function buildBarsForTarget(
  metric: string,
  series: ProbeSeriesMap,
  tone: (value: number) => string,
  target?: ProbeTarget | null,
): PingBar[] {
  const points = target ? probeSeriesFor(series, target) : []
  if (points.length === 0) return emptyBars(metric)
  return points.map((point, index) => ({
    key: `${metric}-${target || 'def'}-${point.timestamp}-${index}`,
    className: typeof point.value === 'number' ? tone(point.value) : 'is-gap',
  }))
}

interface ProbeCardItem {
  target: ProbeTarget
  label: string
  latencyText: string
  lossText: string
  latencyBars: PingBar[]
  lossBars: PingBar[]
}

const primaryProbe = computed(() => props.server.latency[0] ?? null)

const allNetworkProbes = computed<ProbeCardItem[]>(() => {
  if (!props.server.latency || props.server.latency.length === 0) return []
  return props.server.latency.map((probe) => {
    const target = probe.target as ProbeTarget
    const latWin = target ? windowAverage(props.server.history.latencySeries, target) : { value: null, samples: 0 }
    const lossWin = target ? windowAverage(props.server.history.packetLossSeries, target) : { value: null, samples: 0 }
    const latencyText = latWin.value === null
      ? formatLatency(probe.latency ?? false)
      : formatLatency(latWin.value)
    const lossText = lossWin.value === null
      ? formatProbePercent(probe.packetLoss ?? false)
      : formatProbePercent(lossWin.value)
    return {
      target,
      label: probe.label || (target as string).toUpperCase(),
      latencyText,
      lossText,
      latencyBars: buildBarsForTarget('latency', props.server.history.latencySeries, latencyToneClass, target),
      lossBars: buildBarsForTarget('loss', props.server.history.packetLossSeries, lossToneClass, target),
    }
  })
})

const latencyWindow = computed(() => {
  const target = primaryProbe.value?.target
  return target ? windowAverage(props.server.history.latencySeries, target) : { value: null, samples: 0 }
})
const lossWindow = computed(() => {
  const target = primaryProbe.value?.target
  return target ? windowAverage(props.server.history.packetLossSeries, target) : { value: null, samples: 0 }
})
const latencyText = computed(() => (
  latencyWindow.value.value === null
    ? formatLatency(primaryProbe.value?.latency ?? false)
    : formatLatency(latencyWindow.value.value)
))
const lossText = computed(() => (
  lossWindow.value.value === null
    ? formatProbePercent(primaryProbe.value?.packetLoss ?? false)
    : formatProbePercent(lossWindow.value.value)
))

const latencyBars = computed(() =>
  buildBarsForTarget('latency', props.server.history.latencySeries, latencyToneClass, primaryProbe.value?.target)
)
const lossBars = computed(() =>
  buildBarsForTarget('loss', props.server.history.packetLossSeries, lossToneClass, primaryProbe.value?.target)
)

/* 流媒体与 AI 解锁条目（与 ServerCard 一致）。 */
interface UnlockItem {
  key: string
  name: string
  status: 'yes' | 'partial' | 'no'
  statusText: string
  latency?: number
  region?: string
}

const unlockItems = computed<UnlockItem[]>(() => {
  const u = props.server.unlocks
  if (!u) return []
  const items: UnlockItem[] = []
  if (u.youtube) {
    items.push({
      key: 'youtube',
      name: 'YouTube',
      status: u.youtube.status === 'yes' ? 'yes' : 'no',
      statusText: u.youtube.status === 'yes' ? '已解锁' : '未解锁',
      latency: u.youtube.latency,
      region: u.youtube.region ? u.youtube.region.toUpperCase() : '',
    })
  }
  if (u.netflix) {
    items.push({
      key: 'netflix',
      name: 'Netflix',
      status: u.netflix.status === 'yes' ? 'yes' : (u.netflix.status === 'partial' ? 'partial' : 'no'),
      statusText: u.netflix.status === 'yes' ? '原生解锁' : (u.netflix.status === 'partial' ? '仅自制剧' : '未解锁'),
      latency: u.netflix.latency,
    })
  }
  if (u.disney) {
    items.push({
      key: 'disney',
      name: 'Disney+',
      status: u.disney.status === 'yes' ? 'yes' : 'no',
      statusText: u.disney.status === 'yes' ? '已解锁' : '未解锁',
      latency: u.disney.latency,
    })
  }
  if (u.chatgpt) {
    items.push({
      key: 'chatgpt',
      name: 'ChatGPT',
      status: u.chatgpt.status === 'yes' ? 'yes' : 'no',
      statusText: u.chatgpt.status === 'yes' ? '已解锁' : '未解锁',
      latency: u.chatgpt.latency,
    })
  }
  if (u.claude) {
    items.push({
      key: 'claude',
      name: 'Claude',
      status: u.claude.status === 'yes' ? 'yes' : 'no',
      statusText: u.claude.status === 'yes' ? '已解锁' : '未解锁',
      latency: u.claude.latency,
    })
  }
  if (u.gemini) {
    items.push({
      key: 'gemini',
      name: 'Gemini',
      status: u.gemini.status === 'yes' ? 'yes' : 'no',
      statusText: u.gemini.status === 'yes' ? '已解锁' : '未解锁',
      latency: u.gemini.latency,
    })
  }
  return items
})

const trafficView = computed(() => trafficDisplay(props.server))
const trafficPercent = computed(() => trafficDisplayPercent(trafficView.value))
const trafficToneStatus = computed(() => trafficStatus(trafficPercent.value))
const trafficCritical = computed(() => trafficPercent.value !== null && trafficPercent.value >= 95)

function statusVar(status: ReturnType<typeof usageStatus>): string {
  if (status === 'success') return 'var(--signal-2)'
  if (status === 'warning') return 'var(--signal-4)'
  if (status === 'error') return 'var(--signal-5)'
  return 'var(--signal-3)'
}

function ringBackground(percent: number | null, color: string): string {
  if (percent === null) return 'transparent'
  const deg = Math.min(360, Math.max(0, (percent / 100) * 360))
  return `conic-gradient(${color} ${deg}deg, transparent ${deg}deg)`
}

const cpuRingStyle = computed(() => ({
  '--ring-fill': ringBackground(cpuPercent.value, statusVar(usageStatus(cpuPercent.value ?? 0))),
}))

const memoryRingStyle = computed(() => {
  const ramColor = statusVar(usageStatus(memoryPercent.value ?? 0))
  const swapColor = 'var(--signal-3)'
  return {
    '--ring-fill': ringBackground(memoryPercent.value, ramColor),
    '--ring-swap-fill': hasSwap.value ? ringBackground(swapPercent.value, swapColor) : 'transparent',
  }
})

const diskRingStyle = computed(() => ({
  '--ring-fill': ringBackground(diskPercent.value, statusVar(usageStatus(diskPercent.value ?? 0))),
}))

function percentText(p: number | null): string {
  return p === null ? '--' : formatPercent(p)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('open')
  }
}

function hideMissingImage(event: Event): void {
  const target = event.target
  if (target instanceof HTMLImageElement) target.style.display = 'none'
}
</script>

<template>
  <article
    class="node-card node-card--ring"
    :class="{ 'node-card--offline': !server.online }"
    role="button"
    tabindex="0"
    :aria-label="`查看节点 ${server.name} 详情`"
    @click="emit('open')"
    @keydown="handleKeydown"
  >
    <header class="node-card__header">
      <div class="node-card__identity">
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
        <span class="node-card__name" :title="server.name">{{ server.name }}</span>
      </div>
      <div class="node-card__header-extra">
        <button
          type="button"
          class="favorite-button"
          :class="{ 'is-favorite': favorite }"
          :aria-label="favorite ? `取消收藏 ${server.name}` : `收藏 ${server.name}`"
          :title="favorite ? '取消收藏' : '收藏节点'"
          @click.stop="emit('toggleFavorite')"
          @keydown.stop
        >
          <AppIcon :name="favorite ? 'tabler:star-filled' : 'tabler:star'" :size="14" />
        </button>
        <img
          class="node-card__os"
          :src="osIconUrl(server.operatingSystem)"
          :alt="osName"
          :title="server.operatingSystem ?? osName"
          @error="hideMissingImage"
        >
        <img
          v-if="regionCode"
          class="node-card__flag"
          :src="flagUrl(regionCode)"
          :alt="server.region ?? regionCode"
          :title="server.region ?? regionCode"
          @error="hideMissingFlag"
        >
      </div>
    </header>

    <div class="node-card__body">
      <div class="node-card__chips">
        <span v-for="chip in chips" :key="chip" class="node-chip">{{ chip }}</span>
      </div>

      <!-- 三圆环：CPU / 内存（可含 swap）/ 硬盘 -->
      <div class="ring-metrics">
        <div class="ring-metric" :title="`CPU ${percentText(cpuPercent)}`">
          <div class="ring" :style="cpuRingStyle">
            <div class="ring__disc">
              <span class="ring__value">{{ percentText(cpuPercent) }}</span>
            </div>
          </div>
          <span class="ring-metric__label">
            <AppIcon name="tabler:cpu" :size="11" />
            CPU
          </span>
        </div>

        <div
          class="ring-metric"
          :title="hasSwap ? `内存 ${percentText(memoryPercent)} · Swap ${percentText(swapPercent)} / ${formatDisplayMebibytes(server.swap.total)}` : `内存 ${percentText(memoryPercent)} / ${formatDisplayMebibytes(server.memory.total)}`"
        >
          <div class="ring ring--memory" :class="{ 'ring--has-swap': hasSwap }" :style="memoryRingStyle">
            <div v-if="hasSwap" class="ring__swap" aria-hidden="true" />
            <div class="ring__disc">
              <span class="ring__value">{{ percentText(memoryPercent) }}</span>
              <span v-if="hasSwap" class="ring__sub">{{ percentText(swapPercent) }}</span>
            </div>
          </div>
          <span class="ring-metric__label">
            <AppIcon name="tabler:database" :size="11" />
            内存
          </span>
        </div>

        <div class="ring-metric" :title="`硬盘 ${percentText(diskPercent)} / ${formatDisplayMebibytes(server.disk.total)}`">
          <div class="ring" :style="diskRingStyle">
            <div class="ring__disc">
              <span class="ring__value">{{ percentText(diskPercent) }}</span>
            </div>
          </div>
          <span class="ring-metric__label">
            <AppIcon name="tabler:server" :size="11" />
            硬盘
          </span>
        </div>
      </div>

      <!-- 流量条（与 ServerCard 一致） -->
      <div class="node-metric">
        <div class="node-metric__head">
          <span class="node-metric__label node-metric__label--traffic">
            <AppIcon name="tabler:arrows-transfer-up-down" :size="13" /><span>流量</span>
          </span>
          <span class="node-metric__value" :class="`node-metric__value--${trafficToneStatus}`">
            {{ trafficHeadText(trafficView) }}
          </span>
        </div>
        <div
          class="ring-progress"
          role="progressbar"
          :aria-valuenow="trafficPercent ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span
            class="ring-progress__fill"
            :class="`ring-progress__fill--${trafficToneStatus}`"
            :style="{ width: `${trafficPercent ?? 0}%` }"
          />
        </div>
        <div class="node-metric__hint" :class="{ 'node-metric__hint--danger': trafficCritical }">
          {{ trafficRatioText(trafficView) }}
        </div>
      </div>

      <!-- 三盒：上行/下行、总收/总发、负载 or 到期/余值（与 ServerCard 一致） -->
      <div class="node-boxes">
        <div class="node-box">
          <span class="node-box__row node-box__row--up">
            <AppIcon name="tabler:chevron-up" :size="11" />
            <span class="node-box__text">{{ formatDisplaySpeed(server.network.outSpeed) }}</span>
          </span>
          <span class="node-box__row node-box__row--down">
            <AppIcon name="tabler:chevron-down" :size="11" />
            <span class="node-box__text">{{ formatDisplaySpeed(server.network.inSpeed) }}</span>
          </span>
        </div>
        <div class="node-box">
          <span class="node-box__row">
            <AppIcon name="tabler:upload" :size="11" />
            <span class="node-box__text">{{ formatDisplayBytes(server.network.transmitted) }}</span>
          </span>
          <span class="node-box__row">
            <AppIcon name="tabler:download" :size="11" />
            <span class="node-box__text">{{ formatDisplayBytes(server.network.received) }}</span>
          </span>
        </div>
        <div class="node-box">
          <template v-if="expireVisible">
            <span
              class="node-box__row node-box__row--remaining"
              :class="`node-box__row--${expiryInfo.tone}`"
            >
              <AppIcon name="tabler:calendar-stats" :size="11" />
              <span v-if="expiryInfo.text" class="node-box__text">{{ expiryInfo.text }}</span>
              <template v-else>
                <span class="node-box__fixed-text">{{ expiryInfo.prefix }}</span>
                <span class="node-box__fixed-text node-box__number">{{ expiryInfo.value }}</span>
                <span class="node-box__fixed-text">{{ expiryInfo.unit }}</span>
              </template>
            </span>
            <span v-if="remainingValueText" class="node-box__row node-box__row--remaining">
              <AppIcon name="tabler:coins" :size="11" />
              <span class="node-box__text">{{ remainingValueText }}</span>
            </span>
          </template>
          <template v-else>
            <span class="node-box__row">
              <span class="node-box__text">{{ formatLoad(server.load.one) }}</span>
            </span>
            <span class="node-box__row">
              <span class="node-box__text">
                {{ formatLoad(server.load.five) }} / {{ formatLoad(server.load.fifteen) }}
              </span>
            </span>
          </template>
        </div>
      </div>

      <!-- 三网：电信/联通/移动 各自 延迟 + 丢包（与 ServerCard 一致） -->
      <div v-if="allNetworkProbes.length > 0" class="node-network-probes" aria-label="三网网络延迟与丢包">
        <div v-for="probe in allNetworkProbes" :key="probe.target" class="node-probes">
          <div class="node-probe">
            <div class="node-probe__head">
              <span>{{ probe.label }} 延迟</span>
              <span class="node-probe__value">{{ probe.latencyText }}</span>
            </div>
            <div
              class="node-probe__bars"
              :style="{ gridTemplateColumns: `repeat(${probe.latencyBars.length}, minmax(0, 1fr))` }"
            >
              <span v-for="bar in probe.latencyBars" :key="bar.key" :class="bar.className" />
            </div>
          </div>
          <div class="node-probe">
            <div class="node-probe__head">
              <span>{{ probe.label }} 丢包</span>
              <span class="node-probe__value">{{ probe.lossText }}</span>
            </div>
            <div
              class="node-probe__bars"
              :style="{ gridTemplateColumns: `repeat(${probe.lossBars.length}, minmax(0, 1fr))` }"
            >
              <span v-for="bar in probe.lossBars" :key="bar.key" :class="bar.className" />
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="primaryProbe" class="node-probes">
        <div class="node-probe">
          <div class="node-probe__head">
            <span>延迟</span>
            <span class="node-probe__value">{{ latencyText }}</span>
          </div>
          <div
            class="node-probe__bars"
            :style="{ gridTemplateColumns: `repeat(${latencyBars.length}, minmax(0, 1fr))` }"
          >
            <span v-for="bar in latencyBars" :key="bar.key" :class="bar.className" />
          </div>
        </div>
        <div class="node-probe">
          <div class="node-probe__head">
            <span>丢包</span>
            <span class="node-probe__value">{{ lossText }}</span>
          </div>
          <div
            class="node-probe__bars"
            :style="{ gridTemplateColumns: `repeat(${lossBars.length}, minmax(0, 1fr))` }"
          >
            <span v-for="bar in lossBars" :key="bar.key" :class="bar.className" />
          </div>
        </div>
      </div>

      <!-- 流媒体与 AI 解锁（与 ServerCard 一致） -->
      <div v-if="unlockItems.length > 0" class="node-unlock-bars-container" aria-label="流媒体与AI服务解锁条形图">
        <div class="unlock-bars-grid">
          <div
            v-for="item in unlockItems"
            :key="item.key"
            class="node-unlock-bar-item"
            :class="`is-${item.status}`"
          >
            <div class="node-unlock-bar-item__head">
              <span class="node-unlock-bar-item__name">
                {{ item.name }}
                <small v-if="item.region" class="node-unlock-bar-item__region">({{ item.region }})</small>
              </span>
              <span class="node-unlock-bar-item__status">
                <span :class="`unlock-status-text unlock-status-text--${item.status}`">{{ item.statusText }}</span>
                <small v-if="item.latency" class="node-unlock-bar-item__latency">{{ item.latency }}ms</small>
              </span>
            </div>
            <div class="node-unlock-bar-item__track">
              <span
                class="node-unlock-bar-item__fill"
                :class="`node-unlock-bar-item__fill--${item.status}`"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="server.tags.length > 0" class="node-tags" aria-label="节点标签">
        <span v-for="tag in server.tags" :key="tag" class="node-tag">{{ tag }}</span>
      </div>

      <div v-if="!server.online" class="node-card__offline" aria-hidden="true">
        <strong>离线</strong>
        <span>{{ offlineText }}</span>
      </div>
    </div>
  </article>
</template>
