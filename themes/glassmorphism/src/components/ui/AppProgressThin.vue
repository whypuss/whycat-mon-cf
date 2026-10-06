<script setup lang="ts">
import { computed } from 'vue'
import type { ProgressStatus } from '@/utils/progress-status'

/**
 * 对齐 Komari `components/ui/progress-thin`：`bg-muted` 轨道 + 按状态着色的纯色填充
 * （`bg-success` / `bg-warning` / `bg-destructive` / `bg-info`），
 * 宽度动画是 `transition-[width] duration-300 ease-out`。
 * 百分比为 null 时表示无采样，只画中性轨道而不是 0%。
 */
const props = withDefaults(defineProps<{
  percentage: number | null
  status?: ProgressStatus
  height?: number
}>(), {
  status: 'success',
  height: 4,
})

const width = computed(() => `${Math.min(100, Math.max(0, props.percentage ?? 0))}%`)
const tone = computed(() => (props.percentage === null ? 'neutral' : props.status))
</script>

<template>
  <div
    data-slot="progress-thin"
    class="resource-meter__track"
    :style="{ height: `${height}px` }"
    role="progressbar"
    :aria-valuenow="percentage ?? undefined"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <span class="resource-meter__fill" :class="`resource-meter__fill--${tone}`" :style="{ width }" />
  </div>
</template>
