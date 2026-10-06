<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/constants/icons'

/**
 * 对齐 Komari `components/ui/tabs` 的 reka-ui 组件族。
 *
 * 上游把 Tabs 拆成 `TabsRoot / TabsList / TabsTrigger / TabsContent` 四个包装；
 * CFSM 的三处标签区（高级工具、分组筛选、详情分区）都只需要「列表 + 触发器」，
 * 内容区由各自的既有布局承载，因此这里只暴露到 Trigger 一层，不制造空壳组件。
 *
 * reka-ui 负责真实的 roving focus、方向键导航、`data-state` 与 aria 属性。
 */
export interface AppTabItem {
  value: string
  label: string
  hint?: string
  disabled?: boolean
  /** 上游详情分区 Tab 带图标；其它调用点不传即可。 */
  icon?: IconName
}

defineProps<{
  items: readonly AppTabItem[]
  /** 无障碍名称。刻意不叫 `ariaLabel`，避免与原生 aria-label 属性透传冲突。 */
  listLabel: string
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <TabsRoot v-model="model" data-slot="tabs" class="app-tabs" activation-mode="automatic">
    <TabsList data-slot="tabs-list" class="app-tabs__list" :aria-label="listLabel">
      <TabsTrigger
        v-for="item in items"
        :key="item.value"
        data-slot="tabs-trigger"
        class="app-tabs__trigger"
        :value="item.value"
        :disabled="item.disabled"
      >
        <AppIcon v-if="item.icon" :name="item.icon" :size="12" />
        <span>{{ item.label }}</span>
        <small v-if="item.hint">{{ item.hint }}</small>
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>
