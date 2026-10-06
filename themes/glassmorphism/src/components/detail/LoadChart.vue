<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import VChart from 'vue-echarts'
import MetricChartHeader from '@/components/detail/MetricChartHeader.vue'
import MetricSeriesChartCard from '@/components/detail/MetricSeriesChartCard.vue'
import AppEmpty from '@/components/ui/AppEmpty.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTabs, { type AppTabItem } from '@/components/ui/AppTabs.vue'
import { DEFAULT_PROBE_LABELS } from '@/constants/probes'
import {
  HISTORY_RANGE_LABELS,
  connectionsChartOption,
  cpuChartOption,
  diskChartOption,
  diskIoChartOption,
  gpuAverage,
  gpuChartOption,
  latestPoint,
  loadChartHours,
  memoryChartOption,
  networkChartOption,
  probeSeries,
  processChartOption,
  trafficSeries,
  visibleLoadCards,
  type LoadChartContext,
} from '@/domain/detail-chart-options'
import { analyzeDiskPrediction, diskPredictionSummary } from '@/domain/disk-prediction'
import { issueCopy } from '@/domain/issue-copy'
import { activeProbeTargets, buildChartRows, labeledProbeTargets } from '@/domain/server-detail'
import { resolveChartFamilies, type ChartFamily } from '@/domain/theme-presentation'
import { HISTORY_HOURS } from '@/services/cfsm'
import { useServerDetailStore } from '@/stores/server-detail'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { getChartSeriesPalette, getChartThemeColors, getLoadChartPalette } from '@/utils/chart-palette'
import { formatDisplayMebibytesSplit, formatDisplaySpeedSplit } from '@/utils/format'
import '@/utils/echarts'

/*
 * 移植自 Komari `components/LoadChart.vue`（bf83765）：顶部一条时间范围 Tab，
 * 下面是 1 / 2 / 3 列（md / xl）的图表卡片栅格，卡片顺序由「历史图表方案」决定。
 *
 * 历史档位只读 detail store 已取回的 `/api/history/all`；「实时」档位消费详情页已有的
 * single-server WebSocket，不增加接口或轮询。「自定义」仍因 CFSM 没有对应接口而不提供。
 */
const detail = useServerDetailStore()
const theme = useThemeSettingsStore()
const {
  server,
  sourceConfig,
  sourceConfigState,
  historyPoints,
  historyHours,
  historyState,
  historyIssue,
  liveMode,
  liveRows,
} = storeToRefs(detail)

const accessible = computed(() => theme.runtime.colorVisionMode === '色觉友好')
/*
 * 「实时」档位用最近 10 分钟历史垫底，再按 Agent 的 WSS 上报间隔逐条接续真实样本；
 * 历史档位画所选固定窗口。切走不会清空实时缓冲，回到实时后继续向前更新。
 */
const rows = computed(() => (liveMode.value ? liveRows.value : buildChartRows(historyPoints.value)))
const context = computed<LoadChartContext>(() => ({
  rows: rows.value,
  hours: loadChartHours(liveMode.value, historyHours.value),
  load: getLoadChartPalette(accessible.value),
  series: getChartSeriesPalette(accessible.value),
  theme: getChartThemeColors(theme.resolvedTheme === 'dark'),
}))
const loading = computed(() => !liveMode.value && historyState.value === 'loading')
const errorCopy = computed(() => issueCopy(historyIssue.value, 'history'))

const LIVE_RANGE = 'live'
const rangeItems: AppTabItem[] = [
  { value: LIVE_RANGE, label: '实时' },
  ...HISTORY_HOURS.map((hours) => ({ value: String(hours), label: HISTORY_RANGE_LABELS[hours] })),
]
const rangeModel = computed({
  get: () => (liveMode.value ? LIVE_RANGE : String(historyHours.value)),
  set: (value: string) => {
    if (value === LIVE_RANGE) {
      detail.setLiveMode(true)
      return
    }
    const hours = HISTORY_HOURS.find((item) => String(item) === value)
    if (hours === undefined) return
    // 回到历史档位：窗口没变就不再请求，直接用已经取回的那份。
    detail.setLiveMode(false)
    if (hours !== historyHours.value) void detail.loadHistory(hours)
  },
})

const families = computed(() => resolveChartFamilies(theme.runtime))
const probeTargets = computed(() => {
  const current = server.value
  if (!current || sourceConfigState.value === 'idle' || sourceConfigState.value === 'loading') return []
  return labeledProbeTargets(
    activeProbeTargets(current, historyPoints.value),
    sourceConfig.value?.probeLabels ?? DEFAULT_PROBE_LABELS,
  )
})
const traffic = computed(() => trafficSeries(context.value))
const pingSeries = computed(() => probeSeries(rows.value, probeTargets.value, 'latency', context.value.series, accessible.value))
const lossSeries = computed(() => probeSeries(rows.value, probeTargets.value, 'packetLoss', context.value.series, accessible.value))

/** 上游 `isChartCardEnabled`：在方案里、且所选时段确有真实采样的卡片才出现。 */
const visibleCards = computed(() => new Set(visibleLoadCards(
  families.value,
  rows.value,
  theme.runtime.gpuChartEnabled,
  { traffic: traffic.value.length, ping: pingSeries.value.length, pingLoss: lossSeries.value.length },
)))

function enabled(key: ChartFamily): boolean {
  return visibleCards.value.has(key)
}

/** 上游用 CSS `order` 按方案顺序排卡片，这里同样处理。 */
function cardOrder(key: ChartFamily): number {
  const index = families.value.indexOf(key)
  return index < 0 ? 99 : index
}

function orderStyle(key: ChartFamily): Record<string, string> {
  return { order: String(cardOrder(key)) }
}

const cpuOption = computed(() => cpuChartOption(context.value))
const memoryOption = computed(() => memoryChartOption(context.value))
const diskOption = computed(() => diskChartOption(context.value))
const networkOption = computed(() => networkChartOption(context.value))
const gpuOption = computed(() => gpuChartOption(context.value))
const connectionsOption = computed(() => connectionsChartOption(context.value))
const processOption = computed(() => processChartOption(context.value))
const diskIoOption = computed(() => diskIoChartOption(context.value))

/*
 * 卡片头部右侧的最新值。上游取图表最后一条记录（`latestStatus`），
 * 总量取节点当前信息（`nodeInfo.mem_total` / `disk_total`），这里一一对应。
 */
const header = computed(() => {
  const point = latestPoint(rows.value)
  const current = server.value
  const gpu = point ? gpuAverage(point) : null
  const gpuNames = (point?.gpus.length ? point.gpus : current?.gpus ?? [])
    .map((item) => item.name.trim() || `GPU ${item.id}`)
    .join(' / ')
  return {
    cpu: typeof point?.cpu === 'number' ? point.cpu.toFixed(1) : null,
    memoryUsed: typeof point?.memoryUsed === 'number' ? formatDisplayMebibytesSplit(point.memoryUsed) : null,
    memoryTotal: typeof current?.memoryTotal === 'number' ? formatDisplayMebibytesSplit(current.memoryTotal) : null,
    diskUsed: typeof point?.diskUsed === 'number' ? formatDisplayMebibytesSplit(point.diskUsed) : null,
    diskTotal: typeof current?.diskTotal === 'number' ? formatDisplayMebibytesSplit(current.diskTotal) : null,
    networkOut: typeof point?.networkOutSpeed === 'number' ? formatDisplaySpeedSplit(point.networkOutSpeed) : null,
    networkIn: typeof point?.networkInSpeed === 'number' ? formatDisplaySpeedSplit(point.networkInSpeed) : null,
    gpu: gpu === null ? null : gpu.toFixed(1),
    gpuNames,
    tcp: typeof point?.tcpConnections === 'number' ? String(point.tcpConnections) : '-',
    udp: typeof point?.udpConnections === 'number' ? String(point.udpConnections) : '-',
    processes: typeof point?.processes === 'number' ? String(point.processes) : '-',
    diskRead: point?.diskIo ? formatDisplaySpeedSplit(point.diskIo.readBps) : null,
    diskWrite: point?.diskIo ? formatDisplaySpeedSplit(point.diskIo.writeBps) : null,
  }
})

/*
 * 磁盘耗尽预测。上游同样把它放在 LoadChart 磁盘卡的副标题上，数据取自它自己的
 * load records；CFSM 没有对应接口，这里直接用本图已经取回的历史采样，不为预测
 * 追加任何请求。所以它是否成立取决于当前选中的时间范围——需要跨满两天，
 * 1 天及以下的范围照上游显示「趋势积累中」。
 */
const diskPrediction = computed(() => {
  if (!theme.runtime.diskPredictionEnabled) return { text: '', warning: false }
  const state = analyzeDiskPrediction(historyPoints.value, server.value?.diskTotal ?? null)
  return diskPredictionSummary(state, theme.runtime.diskPredictionThresholdDays)
})

function retry(): void {
  void detail.loadHistory(historyHours.value)
}
</script>

<template>
  <section class="load-chart" aria-label="负载历史">
    <AppTabs v-model="rangeModel" class="detail-range-tabs" list-label="负载图时间范围" :items="rangeItems" />

    <div class="chart-spinner" :class="{ 'is-loading': loading }">
      <!--
        历史请求的失败只属于历史档位。与上游一样，切到「实时」时不再显示它（上游进入实时会先清空
        error）：实时档位画的是推送数据，不能被另一个时段的 401 / 503 挡住。
      -->
      <div v-if="!liveMode && historyState === 'error'" class="detail-chart-error" role="alert">
        <strong>{{ errorCopy.title }}</strong>
        <p>{{ errorCopy.body }}</p>
        <small v-if="historyIssue?.status">HTTP {{ historyIssue.status }}</small>
        <button type="button" @click="retry">
          重试
        </button>
      </div>
      <AppEmpty
        v-else-if="rows.length === 0 && !loading"
        :description="liveMode ? '正在等待实时数据…' : '暂无负载数据'"
      />

      <div v-else class="metric-chart-grid">
        <article v-if="enabled('cpu')" class="metric-chart-card" data-load-chart-card="cpu" :style="orderStyle('cpu')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="CPU 与负载" icon="tabler:cpu" tone="rose">
              <div v-if="header.cpu !== null" class="metric-chart-value metric-chart-value--tight">
                <span>{{ header.cpu }}</span><span>%</span>
              </div>
              <span v-else>-</span>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="cpuOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('memory')" class="metric-chart-card" data-load-chart-card="memory" :style="orderStyle('memory')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="内存与 Swap" icon="tabler:database" tone="violet">
              <div class="metric-chart-value">
                <template v-if="header.memoryUsed">
                  <span>{{ header.memoryUsed.value }}</span><span>{{ header.memoryUsed.unit }}</span>
                </template>
                <span v-else>-</span>
                <span>·</span>
                <template v-if="header.memoryTotal">
                  <span>{{ header.memoryTotal.value }}</span><span>{{ header.memoryTotal.unit }}</span>
                </template>
                <span v-else>-</span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="memoryOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('disk')" class="metric-chart-card" data-load-chart-card="disk" :style="orderStyle('disk')">
          <header class="metric-chart-card__header">
            <MetricChartHeader
              title="磁盘"
              icon="tabler:device-floppy"
              tone="emerald"
              :subtitle="diskPrediction.text"
              :alert="diskPrediction.warning"
            >
              <div class="metric-chart-value">
                <template v-if="header.diskUsed">
                  <span>{{ header.diskUsed.value }}</span><span>{{ header.diskUsed.unit }}</span>
                </template>
                <span v-else>-</span>
                <span>·</span>
                <template v-if="header.diskTotal">
                  <span>{{ header.diskTotal.value }}</span><span>{{ header.diskTotal.unit }}</span>
                </template>
                <span v-else>-</span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="diskOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('network')" class="metric-chart-card" data-load-chart-card="network" :style="orderStyle('network')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="实时网络" icon="tabler:network" tone="sky">
              <div class="metric-chart-value metric-chart-value--wide">
                <span class="metric-chart-value__rate">
                  <AppIcon name="tabler:chevron-up" :size="12" />
                  <template v-if="header.networkOut">{{ header.networkOut.value }} {{ header.networkOut.unit }}</template>
                  <template v-else>-</template>
                </span>
                <span class="metric-chart-value__rate">
                  <AppIcon name="tabler:chevron-down" :size="12" />
                  <template v-if="header.networkIn">{{ header.networkIn.value }} {{ header.networkIn.unit }}</template>
                  <template v-else>-</template>
                </span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="networkOption" autoresize />
            </div>
          </div>
        </article>

        <MetricSeriesChartCard
          v-if="enabled('traffic')"
          title="累计与周期流量"
          icon="tabler:arrows-transfer-up-down"
          tone="sky"
          :series="traffic"
          :theme="context.theme"
          :order="cardOrder('traffic')"
        />

        <article v-if="enabled('gpu')" class="metric-chart-card" data-load-chart-card="gpu" :style="orderStyle('gpu')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="GPU 利用率" icon="tabler:device-desktop-analytics" tone="cyan" :subtitle="header.gpuNames">
              <div class="metric-chart-value">
                <template v-if="header.gpu !== null">
                  <span>{{ header.gpu }}</span><span>%</span>
                </template>
                <span v-else>-</span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="gpuOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('connections')" class="metric-chart-card" data-load-chart-card="connections" :style="orderStyle('connections')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="网络连接" icon="tabler:binary-tree" tone="amber">
              <div class="metric-chart-value">
                <span>TCP: {{ header.tcp }}</span>
                <span>·</span>
                <span>UDP: {{ header.udp }}</span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="connectionsOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('process')" class="metric-chart-card" data-load-chart-card="process" :style="orderStyle('process')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="进程" icon="tabler:activity" tone="slate">
              <span>{{ header.processes }}</span>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="processOption" autoresize />
            </div>
          </div>
        </article>

        <article v-if="enabled('diskIo')" class="metric-chart-card" data-load-chart-card="diskIo" :style="orderStyle('diskIo')">
          <header class="metric-chart-card__header">
            <MetricChartHeader title="磁盘 IO" icon="icon-park-outline:hard-disk" tone="orange">
              <div class="metric-chart-value metric-chart-value--wide">
                <span>读 <template v-if="header.diskRead">{{ header.diskRead.value }} {{ header.diskRead.unit }}</template><template v-else>-</template></span>
                <span>写 <template v-if="header.diskWrite">{{ header.diskWrite.value }} {{ header.diskWrite.unit }}</template><template v-else>-</template></span>
              </div>
            </MetricChartHeader>
          </header>
          <div class="metric-chart-card__body">
            <div class="metric-chart-card__chart">
              <VChart :option="diskIoOption" autoresize />
            </div>
          </div>
        </article>

        <MetricSeriesChartCard
          v-if="enabled('ping')"
          title="Ping 延迟"
          icon="tabler:radar"
          tone="cyan"
          :series="pingSeries"
          :theme="context.theme"
          :order="cardOrder('ping')"
        />

        <MetricSeriesChartCard
          v-if="enabled('pingLoss')"
          title="Ping 丢包"
          icon="tabler:cloud-exclamation"
          tone="rose"
          :series="lossSeries"
          :theme="context.theme"
          :order="cardOrder('pingLoss')"
          percent-scale
        />
      </div>

      <div v-if="loading" class="chart-spinner__overlay" role="status" aria-label="正在加载负载历史">
        <span class="chart-spinner__ring" />
      </div>
    </div>
  </section>
</template>
