<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import VChart from 'vue-echarts'
import AppEmpty from '@/components/ui/AppEmpty.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTabs, { type AppTabItem } from '@/components/ui/AppTabs.vue'
import { DEFAULT_PROBE_LABELS } from '@/constants/probes'
import {
  HISTORY_RANGE_LABELS,
  pingChartOption,
  pingSpikeMasks,
  visibleSpikeCount,
  type PingTaskLine,
} from '@/domain/detail-chart-options'
import { HISTORY_HOURS } from '@/services/cfsm'
import { issueCopy } from '@/domain/issue-copy'
import {
  activeProbeTargets,
  buildChartRows,
  labeledProbeTargets,
  probeStats,
  type ProbeStats,
} from '@/domain/server-detail'
import type { HistoryHours } from '@/services/cfsm'
import { useServerDetailStore } from '@/stores/server-detail'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import type { ProbeTarget } from '@/types/cfsm'
import { getChartSeriesPalette, getPingChartThemeColors } from '@/utils/chart-palette'
import '@/utils/echarts'

/*
 * 移植自 Komari `components/PingChart.vue`（bf83765）：左侧时间范围、右侧全选 / 全不选，
 * 下面是可点击开关的任务卡（平均延迟 · 丢包率 · 波动率，信息按钮展开统计），
 * 然后是「隐藏尖峰」开关与 320px 的延迟大图。
 *
 * 上游的任务来自后端 Ping 任务，CFSM 对应的是旧四线路与 Node 1–4 这 8 个探测目标。
 *
 * 时间范围与负载图共用同一份档位。上游两张图档位不同，是因为那边取自两个独立端点；
 * CFSM 只有一个 `/api/history/all`，本主题默认让延迟区跟随负载图的窗口、复用同一份响应，
 * 档位若只取子集，负载图切到 10 分钟或 2 天时跟随过来的窗口会落在选择器之外，选中态就没了。
 */
const PING_RANGES: readonly HistoryHours[] = HISTORY_HOURS
/*
 * 上游同名开关叫「平滑峰值」，而它真的会削峰：先把偏离邻域均值超过 30% 的点置空，
 * 再用 EWMA 重写整条序列并用运行值填补空洞。本主题只保留「隐藏尖峰」：在绘图副本里
 * 遮蔽短时高值、原位留断口，不改写任何采样值，统计始终来自原始数据。
 * v1.1.8 起不再提供只改折线曲率的「曲线平滑」开关，曲率固定为上游未开启时的取值。
 */

interface PingTask extends PingTaskLine {
  stats: ProbeStats
}

const detail = useServerDetailStore()
const theme = useThemeSettingsStore()
const {
  server,
  sourceConfig,
  sourceConfigState,
  pingHistoryPoints,
  pingHistoryHours,
  pingHistoryState,
  pingHistoryIssue,
} = storeToRefs(detail)

const accessible = computed(() => theme.runtime.colorVisionMode === '色觉友好')
/* 延迟区只画取回的那份历史：负载图的「实时」档位不带它一起走。 */
const rows = computed(() => buildChartRows(pingHistoryPoints.value))
const sourceConfigPending = computed(() => (
  sourceConfigState.value === 'idle' || sourceConfigState.value === 'loading'
))
const loading = computed(() => pingHistoryState.value === 'loading' || sourceConfigPending.value)
const errorCopy = computed(() => issueCopy(pingHistoryIssue.value, 'history'))
const selected = ref<ProbeTarget[]>([])
/* 开关状态只活在本组件的生命周期里；实时推送、主题切换与重绘都不会重置它。 */
const hideSpikes = ref(false)
/* 图例的显示状态。显式交给图表，按钮上的计数才能与画出来的线保持一致。 */
const legendSelected = ref<Record<string, boolean>>({})
const helpOpen = ref(false)

const rangeItems: AppTabItem[] = PING_RANGES.map((hours) => ({
  value: String(hours),
  label: HISTORY_RANGE_LABELS[hours],
}))
const rangeModel = computed({
  get: () => String(pingHistoryHours.value),
  set: (value: string) => {
    const hours = PING_RANGES.find((item) => String(item) === value)
    if (hours === undefined || hours === pingHistoryHours.value) return
    // 上游切换视图时先清空选择，数据回来后再全选。
    selected.value = []
    void detail.loadPingHistory(hours)
  },
})

/** 任务颜色按任务在完整列表里的位置取序列板，与上游 `getTaskColor` 一致。 */
const tasks = computed<PingTask[]>(() => {
  const current = server.value
  if (!current || sourceConfigPending.value) return []
  const palette = getChartSeriesPalette(accessible.value)
  const labels = sourceConfig.value?.probeLabels ?? DEFAULT_PROBE_LABELS
  return labeledProbeTargets(activeProbeTargets(current, pingHistoryPoints.value), labels)
    .map((entry, index) => ({
      ...entry,
      color: palette[index % palette.length] ?? '#FF6B6B',
      stats: probeStats(pingHistoryPoints.value, entry.target),
    }))
})
const selectedTasks = computed(() => tasks.value.filter((task) => selected.value.includes(task.target)))
const allSelected = computed(() => tasks.value.every((task) => selected.value.includes(task.target)))

watch(() => (server.value ? `${server.value.source.base}::${server.value.id}` : ''), () => {
  selected.value = []
  openTip.value = null
  helpOpen.value = false
})
/*
 * 上游在每次取回数据后、选择为空时全选。这里只跟随历史数据本身变化，
 * 不跟随实时快照：否则用户点了「全不选」，下一次 WebSocket 推送又会全选回来。
 */
watch([pingHistoryPoints, sourceConfigState], () => {
  if (selected.value.length === 0) selected.value = tasks.value.map((task) => task.target)
}, { immediate: true })

function isSelected(target: ProbeTarget): boolean {
  return selected.value.includes(target)
}

function toggleTask(target: ProbeTarget): void {
  selected.value = isSelected(target)
    ? selected.value.filter((item) => item !== target)
    : [...selected.value, target]
}

function showAll(): void {
  selected.value = tasks.value.map((task) => task.target)
}

function hideAll(): void {
  selected.value = []
}

/*
 * 遮蔽集合对**全部**任务从原始行算出：勾选或取消某条线不会改变其它线的结果。
 * 计数只数当前实际画出来的线。
 */
const spikeMasks = computed(() => pingSpikeMasks(rows.value, tasks.value))
const spikeCount = computed(() => visibleSpikeCount(selectedTasks.value, spikeMasks.value, legendSelected.value))

function isFlagMap(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object' && value !== null
    && Object.values(value).every((item) => typeof item === 'boolean')
}

/* ECharts 的 legendselectchanged 事件载荷按未知数据处理，只取形状正确的 selected。 */
function onLegendSelect(event: unknown): void {
  if (typeof event !== 'object' || event === null || !('selected' in event)) return
  if (isFlagMap(event.selected)) legendSelected.value = { ...event.selected }
}

const option = computed(() => pingChartOption({
  rows: rows.value,
  hours: pingHistoryHours.value,
  theme: getPingChartThemeColors(theme.resolvedTheme === 'dark'),
  tasks: tasks.value,
  selected: selectedTasks.value,
  accessible: accessible.value,
  hideSpikes: hideSpikes.value,
  spikeMasks: spikeMasks.value,
  legendSelected: legendSelected.value,
}))

function avgText(task: PingTask): string {
  return task.stats.avg === null ? '-' : `${Math.round(task.stats.avg)}ms`
}

function lossText(task: PingTask): string {
  return task.stats.loss === null ? '-' : `${task.stats.loss.toFixed(2)}%`
}

function statItems(task: PingTask): Array<{ label: string, value: string }> {
  const { stats } = task
  const ms = (value: number | null) => (value === null ? null : `${Math.round(value)} ms`)
  return [
    { label: '最小', value: ms(stats.min) },
    { label: '最大', value: ms(stats.max) },
    { label: '平均', value: ms(stats.avg) },
    { label: '最新', value: ms(stats.latest) },
    { label: 'P50', value: ms(stats.p50) },
    { label: 'P99', value: ms(stats.p99) },
    { label: '波动率', value: stats.ratio === null ? null : stats.ratio.toFixed(2) },
    { label: '标准差', value: stats.stddev === null ? null : stats.stddev.toFixed(1) },
    { label: '总数', value: String(stats.total) },
    { label: '有效', value: String(stats.valid) },
  ].filter((item): item is { label: string, value: string } => item.value !== null)
}

/*
 * 上游在粗指针设备上把信息气泡改成点击开关（悬浮在触屏上不存在）。
 * 精细指针下保持非受控，由 reka-ui 处理悬浮与键盘焦点。
 */
const touchMode = ref(false)
const openTip = ref<ProbeTarget | null>(null)
let coarsePointer: MediaQueryList | null = null

function syncTouchMode(): void {
  touchMode.value = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
}

function setTip(target: ProbeTarget, open: boolean): void {
  openTip.value = open ? target : openTip.value === target ? null : openTip.value
}

function toggleHelp(): void {
  if (!touchMode.value) return
  helpOpen.value = !helpOpen.value
}

function toggleTip(target: ProbeTarget): void {
  if (!touchMode.value) return
  openTip.value = openTip.value === target ? null : target
}

onMounted(() => {
  syncTouchMode()
  coarsePointer = window.matchMedia('(pointer: coarse)')
  coarsePointer.addEventListener('change', syncTouchMode)
})

onBeforeUnmount(() => {
  coarsePointer?.removeEventListener('change', syncTouchMode)
})

function retry(): void {
  void detail.loadPingHistory(pingHistoryHours.value)
}
</script>

<template>
  <section class="ping-chart" aria-label="延迟历史">
    <div class="ping-chart__toolbar">
      <div class="ping-chart__range">
        <AppTabs v-model="rangeModel" class="detail-range-tabs" list-label="延迟图时间范围" :items="rangeItems" />
      </div>
      <div class="ping-chart__actions">
        <button type="button" class="ping-chart__button" :class="{ 'is-active': allSelected }" @click="showAll">
          全选
        </button>
        <button type="button" class="ping-chart__button" :class="{ 'is-active': selected.length === 0 }" @click="hideAll">
          全不选
        </button>
      </div>
    </div>

    <div class="chart-spinner" :class="{ 'is-loading': loading }">
      <div v-if="pingHistoryState === 'error'" class="detail-chart-error" role="alert">
        <strong>{{ errorCopy.title }}</strong>
        <p>{{ errorCopy.body }}</p>
        <small v-if="pingHistoryIssue?.status">HTTP {{ pingHistoryIssue.status }}</small>
        <button type="button" @click="retry">
          重试
        </button>
      </div>
      <AppEmpty v-else-if="tasks.length === 0 && !loading" description="暂无延迟数据" />

      <div v-else class="ping-chart__content">
        <div v-if="tasks.length > 0" class="ping-task-grid">
          <div
            v-for="task in tasks"
            :key="task.target"
            class="ping-task"
            :class="{ 'is-off': !isSelected(task.target) }"
            role="button"
            tabindex="0"
            :aria-pressed="isSelected(task.target)"
            :data-ping-task="task.target"
            @click="toggleTask(task.target)"
            @keydown.enter.prevent="toggleTask(task.target)"
            @keydown.space.prevent="toggleTask(task.target)"
          >
            <div class="ping-task__main">
              <div class="ping-task__head">
                <span class="ping-task__bar" :style="{ backgroundColor: task.color }" />
                <span class="ping-task__name">{{ task.label }}</span>
                <TooltipProvider :delay-duration="0">
                  <TooltipRoot
                    :open="touchMode ? openTip === task.target : undefined"
                    @update:open="(open: boolean) => setTip(task.target, open)"
                  >
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="ping-task__info"
                        :aria-label="`${task.label} 统计`"
                        @click.stop="toggleTip(task.target)"
                        @keydown.enter.stop
                        @keydown.space.stop
                      >
                        <AppIcon name="carbon:information" :size="14" />
                      </button>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent
                        class="app-tooltip__bubble ping-task-stats"
                        side="top"
                        :side-offset="6"
                        :collision-padding="8"
                      >
                        <div class="ping-task-stats__grid">
                          <template v-for="item in statItems(task)" :key="item.label">
                            <span>{{ item.label }}</span>
                            <strong>{{ item.value }}</strong>
                          </template>
                        </div>
                        <p class="ping-task-stats__note">
                          按所选时段的 {{ task.stats.total }} 个历史采样计算
                        </p>
                        <TooltipArrow class="app-tooltip__arrow" :width="10" :height="5" />
                      </TooltipContent>
                    </TooltipPortal>
                  </TooltipRoot>
                </TooltipProvider>
              </div>
              <div class="ping-task__stats">
                <span class="ping-task__avg" title="平均延迟">{{ avgText(task) }}</span>
                <span class="is-dim">·</span>
                <span title="丢包率">{{ lossText(task) }}</span>
                <template v-if="task.stats.ratio !== null">
                  <span class="is-dim">·</span>
                  <span title="波动率">{{ task.stats.ratio.toFixed(2) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div class="ping-chart__options">
          <div class="ping-chart__toggles">
            <button
              type="button"
              class="ping-chart__button"
              :class="{ 'is-active': hideSpikes }"
              :aria-pressed="hideSpikes"
              data-spike-toggle
              @click="hideSpikes = !hideSpikes"
            >
              隐藏尖峰<template v-if="hideSpikes">
                · {{ spikeCount }}
              </template>
            </button>
            <TooltipProvider :delay-duration="0">
              <TooltipRoot
                :open="touchMode ? helpOpen : undefined"
                @update:open="(open: boolean) => (helpOpen = open)"
              >
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="ping-task__info"
                    aria-label="图表显示说明"
                    data-chart-help
                    @click="toggleHelp"
                  >
                    <AppIcon name="carbon:information" :size="14" />
                  </button>
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent
                    class="app-tooltip__bubble ping-chart-help"
                    side="top"
                    :side-offset="6"
                    :collision-padding="8"
                  >
                    <strong class="ping-chart-help__title">图表显示说明</strong>
                    <dl class="ping-chart-help__list">
                      <dt>隐藏尖峰</dt>
                      <dd>仅在图上隐藏识别出的短时高值，隐藏处保留断口；关闭后恢复显示。</dd>
                      <dt>不会隐藏</dt>
                      <dd>持续高延迟、阶跃抬升与缓慢爬升照常显示。原始数据和统计结果均不变。</dd>
                    </dl>
                    <TooltipArrow class="app-tooltip__arrow" :width="10" :height="5" />
                  </TooltipContent>
                </TooltipPortal>
              </TooltipRoot>
            </TooltipProvider>
          </div>
        </div>

        <div class="ping-chart__canvas">
          <VChart :option="option" autoresize @legendselectchanged="onLegendSelect" />
        </div>
      </div>

      <div v-if="loading" class="chart-spinner__overlay" role="status" aria-label="正在加载延迟历史">
        <span class="chart-spinner__ring" />
      </div>
    </div>
  </section>
</template>
