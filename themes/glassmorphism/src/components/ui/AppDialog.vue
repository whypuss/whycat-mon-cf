<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import AppIcon from '@/components/ui/AppIcon.vue'

/**
 * 对齐 Komari `components/ui/app-dialog`：reka-ui Dialog 渲染到 body，
 * 半透明遮罩、居中卡片、标题栏与右上角关闭按钮，内容区独立滚动。
 * 焦点锁定、Escape 关闭、点遮罩关闭与关闭后焦点归还都由 reka-ui 负责。
 * 样式是上游 Tailwind 类的运行时取值（见 `main.css` 的 `.app-dialog`）。
 */
defineProps<{
  title: string
  description?: string
}>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="app-dialog__overlay" />
      <DialogContent class="app-dialog">
        <div class="app-dialog__header">
          <div class="app-dialog__heading">
            <DialogTitle class="app-dialog__title">
              {{ title }}
            </DialogTitle>
            <DialogDescription class="app-dialog__description" :class="{ 'sr-only': !description }">
              {{ description || title }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-dialog__close" aria-label="关闭">
              <AppIcon name="tabler:x" :size="17" />
            </button>
          </DialogClose>
        </div>
        <div class="app-dialog__body">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
