<script setup lang="ts">
import { computed } from 'vue'
import { ICONS, type IconName } from '@/constants/icons'

/**
 * 与 Komari `<Icon icon="tabler:xxx" />` 等价的图标组件。
 *
 * 图标名与上游一致，路径数据在构建期内联（见 `@/constants/icons`），
 * 因此不依赖运行时图标 CDN——这是自托管 CFSM 主题必要的交付方式差异。
 */
const props = withDefaults(defineProps<{
  name: IconName
  size?: number | string
}>(), {
  size: 16,
})

const icon = computed(() => ICONS[props.name])
const dimension = computed(() => (
  typeof props.size === 'number' ? `${props.size}px` : props.size
))
</script>

<template>
  <!--
    图标内容来自构建期内联的常量（`@/constants/icons`），是固定的官方 SVG 路径，
    不含任何用户输入或接口返回数据，因此此处的 v-html 不存在 XSS 面。
  -->
  <!-- eslint-disable vue/no-v-html -->
  <svg
    class="app-icon"
    :viewBox="icon.viewBox"
    :width="dimension"
    :height="dimension"
    role="presentation"
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
    v-html="icon.body"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
