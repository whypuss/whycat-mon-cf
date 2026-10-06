<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/constants/icons'
import type { MetricChartTone } from '@/domain/detail-chart-options'

/**
 * 移植自 Komari `components/MetricChartHeader.vue`：
 * 左侧 32px 色调图标框（`bg-{tone}-500/10 text-{tone}-500 ring-1 ring-inset ring-{tone}-500/20`）
 * + 标题 / 副标题，右侧是插槽里的最新值。
 */
withDefaults(defineProps<{
  title: string
  icon: IconName
  tone?: MetricChartTone
  subtitle?: string
  /** 副标题转为预警色。上游没有这一状态，见磁盘耗尽预测阈值的说明。 */
  alert?: boolean
}>(), {
  tone: 'slate',
  subtitle: '',
  alert: false,
})
</script>

<template>
  <div class="metric-chart-header">
    <div class="metric-chart-header__lead">
      <div class="metric-chart-header__icon" :class="`is-${tone}`">
        <AppIcon :name="icon" :size="17" />
      </div>
      <div class="metric-chart-header__text">
        <div class="metric-chart-header__title">
          {{ title }}
        </div>
        <div
          v-if="subtitle"
          class="metric-chart-header__subtitle"
          :class="{ 'metric-chart-header__subtitle--alert': alert }"
          :title="subtitle"
        >
          {{ subtitle }}
        </div>
      </div>
    </div>
    <div class="metric-chart-header__value">
      <slot />
    </div>
  </div>
</template>
