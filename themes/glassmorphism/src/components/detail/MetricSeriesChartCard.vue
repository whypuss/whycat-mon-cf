<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import MetricChartHeader from '@/components/detail/MetricChartHeader.vue'
import type { IconName } from '@/constants/icons'
import {
  metricSeriesChartOption,
  metricSeriesLatestText,
  type MetricChartTone,
  type MetricSeriesData,
} from '@/domain/detail-chart-options'
import type { ChartThemeColors } from '@/utils/chart-palette'
import '@/utils/echarts'

/** 移植自 Komari `components/MetricSeriesChartCard.vue`：流量、Ping 延迟、Ping 丢包三张卡。 */
const props = withDefaults(defineProps<{
  title: string
  icon: IconName
  tone?: MetricChartTone
  series: MetricSeriesData[]
  theme: ChartThemeColors
  order?: number
  subtitle?: string
  percentScale?: boolean
}>(), {
  tone: 'slate',
  order: 99,
  subtitle: '',
  percentScale: false,
})

const latestText = computed(() => metricSeriesLatestText(props.series))
const option = computed(() => metricSeriesChartOption(props.series, props.theme, props.percentScale))
</script>

<template>
  <article class="metric-chart-card" :style="{ order }">
    <header class="metric-chart-card__header">
      <MetricChartHeader :title="title" :icon="icon" :tone="tone" :subtitle="subtitle">
        {{ latestText }}
      </MetricChartHeader>
    </header>
    <div class="metric-chart-card__body">
      <div class="metric-chart-card__chart">
        <VChart :option="option" autoresize />
      </div>
    </div>
  </article>
</template>
