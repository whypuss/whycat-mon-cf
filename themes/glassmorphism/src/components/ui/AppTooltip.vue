<script setup lang="ts">
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'

/**
 * 对齐 Komari `components/ui/tooltip` 的 reka-ui 组件族。
 *
 * 与上游一致地由 `TooltipProvider / Root / Trigger / Portal / Content / Arrow` 组成，
 * 因此具备真实的 portal 渲染、碰撞翻转、ESC 关闭、指针与键盘焦点行为；
 * 样式使用本主题的玻璃层次令牌而非 Tailwind 工具类。
 *
 * 保留原有调用 API（`content` / `placement` / `as`），调用点无需改动。
 *
 * `inheritAttrs: false` + 触发器上的 `v-bind="$attrs"`：根节点是 `TooltipProvider`，
 * 它只渲染插槽（片段根），Vue 无法把透传属性落到任何元素上，调用点写的 `class`
 * 会被静默丢弃。第 16 轮实测确认总览卡片的 `overview-card__value` 因此命中 0 个
 * 元素，数值行退回 `.app-tooltip` 的 `inline-flex`，失去 `align-items: baseline`
 * 与 `gap`，单位基线比主数值高 9px。这里把透传属性交给真正的触发元素。
 */
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  content: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  as?: string
}>(), {
  placement: 'top',
  as: 'span',
})
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <TooltipRoot data-slot="tooltip">
      <TooltipTrigger :as="as" data-slot="tooltip-trigger" class="app-tooltip" v-bind="$attrs">
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          data-slot="tooltip-content"
          class="app-tooltip__bubble"
          :side="placement"
          :side-offset="6"
          :collision-padding="8"
        >
          {{ content }}
          <TooltipArrow class="app-tooltip__arrow" :width="10" :height="5" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
