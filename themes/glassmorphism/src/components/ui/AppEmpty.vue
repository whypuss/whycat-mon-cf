<script setup lang="ts">
/**
 * 对齐 Komari `components/ui/empty`：图标 / 描述 / extra 三段式空状态。
 * CFSM 的错误面板与空列表共用它，避免每处自写一套结构。
 */
defineProps<{
  description: string
  title?: string
  tone?: 'neutral' | 'error'
}>()
</script>

<template>
  <div data-slot="empty" class="app-empty" :class="tone === 'error' && 'app-empty--error'">
    <span v-if="$slots.icon" class="app-empty__icon" aria-hidden="true"><slot name="icon" /></span>
    <strong v-if="title" class="app-empty__title">{{ title }}</strong>
    <p class="app-empty__description">
      {{ description }}
    </p>
    <div v-if="$slots.extra" class="app-empty__extra">
      <slot name="extra" />
    </div>
  </div>
</template>
