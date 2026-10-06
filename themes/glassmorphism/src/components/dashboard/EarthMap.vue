<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import type { EarthRenderer } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

/**
 * Komari `NodeEarthGlobe.vue` 的 CFSM 对应实现：按主题设置分发到三种真实渲染器。
 *
 * 每种渲染器都是独立实现，懒加载以避免首页初始包引入 three/globe.gl/cobe：
 * - realistic：globe.gl + three 的真实 3D 地球（原主题贴图、大气、光照、marker/ring）
 * - cobe：真实 cobe 点阵地球
 * - tiled：真实地球贴图的等距世界地图
 *
 * 三者不得互相退化为 SVG 仿制。
 */
const props = defineProps<{
  servers: readonly GlassServer[]
  renderer: EarthRenderer
  stopped: boolean
  isDark: boolean
}>()

const NodeEarthRealisticGlobe = defineAsyncComponent(
  () => import('@/components/dashboard/NodeEarthRealisticGlobe.vue'),
)
const NodeEarthCobeGlobe = defineAsyncComponent(
  () => import('@/components/dashboard/NodeEarthCobeGlobe.vue'),
)
const NodeEarthTiledMap = defineAsyncComponent(
  () => import('@/components/dashboard/NodeEarthTiledMap.vue'),
)

const earthComponent = computed(() => {
  const components = {
    realistic: NodeEarthRealisticGlobe,
    cobe: NodeEarthCobeGlobe,
    tiled: NodeEarthTiledMap,
  }
  return components[props.renderer] ?? NodeEarthRealisticGlobe
})
</script>

<template>
  <component
    :is="earthComponent"
    :servers="props.servers"
    :stopped="props.stopped"
    :is-dark="props.isDark"
  />
</template>
