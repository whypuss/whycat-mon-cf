<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import AppIcon from '@/components/ui/AppIcon.vue'
import 'vue-sonner/style.css'

/**
 * 对齐 Komari `components/ui/sonner`：同一套 `vue-sonner` Toaster，
 * 并用与上游一致的 lucide 图标填充各状态插槽（图标为构建期内联，无运行时 CDN）。
 * 颜色变量映射到本主题的玻璃层次令牌。
 */
</script>

<template>
  <Toaster
    class="app-toaster"
    position="top-center"
    :style="{
      '--normal-bg': 'var(--glass-strong)',
      '--normal-text': 'var(--ink)',
      '--normal-border': 'var(--glass-border)',
      '--border-radius': 'var(--radius-sm)',
    }"
  >
    <template #success-icon>
      <AppIcon name="lucide:circle-check" :size="16" />
    </template>
    <template #info-icon>
      <AppIcon name="lucide:info" :size="16" />
    </template>
    <template #warning-icon>
      <AppIcon name="lucide:triangle-alert" :size="16" />
    </template>
    <template #error-icon>
      <AppIcon name="lucide:octagon-x" :size="16" />
    </template>
    <template #loading-icon>
      <AppIcon class="app-toaster__spin" name="lucide:loader-circle" :size="16" />
    </template>
    <template #close-icon>
      <AppIcon name="lucide:x" :size="16" />
    </template>
  </Toaster>
</template>
