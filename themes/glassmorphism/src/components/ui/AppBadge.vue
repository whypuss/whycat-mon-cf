<script setup lang="ts">
import { Primitive } from 'reka-ui'

/**
 * 对齐 Komari `components/ui/badge`：基于 reka-ui `Primitive` 的多态徽章，
 * variant 取值与上游一致（default / secondary / outline / destructive）。
 */
withDefaults(defineProps<{
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
  as?: string
}>(), {
  variant: 'default',
  as: 'span',
})
</script>

<template>
  <Primitive :as="as" data-slot="badge" class="app-badge" :class="`app-badge--${variant}`">
    <slot />
  </Primitive>
</template>
