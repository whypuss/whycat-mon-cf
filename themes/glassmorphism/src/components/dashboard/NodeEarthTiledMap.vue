<script setup lang="ts">
import { computed } from 'vue'
import EARTH_DAY_TEXTURE from '@/assets/earth/earth-blue-marble.jpg'
import EARTH_BUMP_MAP from '@/assets/earth/earth-topology.png'
import EARTH_SPECULAR_MAP from '@/assets/earth/earth-water.png'
import { useServerGeoClusters } from '@/composables/useServerGeoClusters'
import { flagUrl, hideMissingFlag } from '@/utils/flags'
import type { GlassServer } from '@/types/glassmorphism'

/**
 * `stopped` 与 `isDark` 由统一的 Earth 调度器传入以保持三种渲染器接口一致。
 * tiled 地图本身不旋转（与 Komari 相同），明暗完全由 CSS 主题变量驱动，
 * 因此这两个值在本组件内没有运行时行为。
 */
const props = defineProps<{
  servers: readonly GlassServer[]
  stopped?: boolean
  isDark?: boolean
}>()

const MAP_WIDTH = 1440
const MAP_HEIGHT = 720
const MAP_PADDING = 18
const VISIBLE_NORTH_LAT = 74
const VISIBLE_SOUTH_LAT = -58
const TEXTURE_FULL_HEIGHT = MAP_HEIGHT * 180 / (VISIBLE_NORTH_LAT - VISIBLE_SOUTH_LAT)
const TEXTURE_SOURCE_Y = TEXTURE_FULL_HEIGHT * (90 - VISIBLE_NORTH_LAT) / 180

interface MapPoint {
  x: number
  y: number
}

interface ClusterMarker {
  id: string
  index: number
  code: string
  label: string
  meta: string
  x: number
  y: number
  statusClass: string
}

const {
  regionClusters,
  totalServers,
  onlineServers,
  offlineServers,
} = useServerGeoClusters(() => props.servers)

const legendDensityClass = computed(() => {
  const count = regionClusters.value.length
  if (count > 36) return 'legend-ultra-dense'
  if (count > 28) return 'legend-very-dense'
  if (count > 20) return 'legend-dense'
  return ''
})

const onlineRate = computed(() => {
  if (totalServers.value === 0) return 0
  return Math.round((onlineServers.value / totalServers.value) * 100)
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function projectCoord(coord: [number, number]): MapPoint {
  const [lat, lng] = coord
  const visibleLat = clamp(lat, VISIBLE_SOUTH_LAT, VISIBLE_NORTH_LAT)
  return {
    x: clamp(((lng + 180) / 360) * MAP_WIDTH, MAP_PADDING, MAP_WIDTH - MAP_PADDING),
    y: clamp(
      ((VISIBLE_NORTH_LAT - visibleLat) / (VISIBLE_NORTH_LAT - VISIBLE_SOUTH_LAT)) * MAP_HEIGHT,
      MAP_PADDING,
      MAP_HEIGHT - MAP_PADDING,
    ),
  }
}

const clusterMarkers = computed<ClusterMarker[]>(() => regionClusters.value.map((cluster, index) => {
  const point = projectCoord(cluster.coord)
  return {
    id: cluster.id,
    index: index + 1,
    code: cluster.code,
    label: cluster.label,
    // CFSM 公开主题 API 不提供 ASN/Provider，因此只显示可靠的地区代码，不猜测运营商。
    meta: cluster.code || 'NODE',
    x: point.x,
    y: point.y,
    statusClass: cluster.onlineServers > 0 ? 'is-online' : 'is-offline',
  }
}))
</script>

<template>
  <div class="earth-map-scroll">
    <div class="earth-map-shell">
      <div class="earth-map">
        <svg
          class="map-svg"
          :viewBox="`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="真实地球贴图节点世界地图"
        >
          <defs>
            <filter id="earth-relief" x="-4%" y="-4%" width="108%" height="108%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#ffffff" flood-opacity="0.14" />
              <feDropShadow dx="0" dy="-5" stdDeviation="9" flood-color="#082f49" flood-opacity="0.16" />
            </filter>
          </defs>

          <image
            :href="EARTH_DAY_TEXTURE" x="0" :y="-TEXTURE_SOURCE_Y" :width="MAP_WIDTH"
            :height="TEXTURE_FULL_HEIGHT" preserveAspectRatio="none" class="earth-image earth-image-base"
          />
          <image
            :href="EARTH_BUMP_MAP" x="0" :y="-TEXTURE_SOURCE_Y" :width="MAP_WIDTH"
            :height="TEXTURE_FULL_HEIGHT" preserveAspectRatio="none" class="earth-image earth-image-bump"
            filter="url(#earth-relief)"
          />
          <image
            :href="EARTH_SPECULAR_MAP" x="0" :y="-TEXTURE_SOURCE_Y" :width="MAP_WIDTH"
            :height="TEXTURE_FULL_HEIGHT" preserveAspectRatio="none" class="earth-image earth-image-water"
          />
          <rect :width="MAP_WIDTH" :height="MAP_HEIGHT" class="earth-overlay" />

          <g class="city-points">
            <template v-for="marker in clusterMarkers" :key="`${marker.id}-point`">
              <circle :cx="marker.x" :cy="marker.y" r="11" class="city-region" :class="marker.statusClass" />
              <circle :cx="marker.x" :cy="marker.y" r="3.8" class="city-dot" :class="marker.statusClass" />
              <image
                v-if="marker.code"
                :href="flagUrl(marker.code)"
                :x="marker.x - 13"
                :y="marker.y - 34"
                width="26"
                height="26"
                preserveAspectRatio="xMidYMid slice"
                class="map-flag"
              />
            </template>
          </g>
        </svg>

        <div class="map-status">
          <span class="map-status__online">
            <span class="map-status__dot" />
            {{ onlineServers }} ONLINE
          </span>
          <span v-if="offlineServers > 0" class="map-status__offline">
            <span class="map-status__dot map-status__dot--offline" />
            {{ offlineServers }} OFF
          </span>
        </div>
      </div>

      <div class="legend-panel" :class="legendDensityClass">
        <div class="legend-title">
          EARTH MAP
          <span v-if="totalServers > 0">{{ onlineRate }}%</span>
        </div>
        <div v-for="marker in clusterMarkers" :key="marker.id" class="legend-item" :class="marker.statusClass">
          <span class="legend-index">{{ marker.index }}</span>
          <img
            v-if="marker.code" :src="flagUrl(marker.code)" :alt="marker.code" class="legend-flag"
            @error="hideMissingFlag"
          >
          <span class="legend-copy">
            <span v-if="marker.label" class="legend-name">{{ marker.label }}</span>
            <span class="legend-meta">{{ marker.meta }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.earth-map-scroll {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: visible;
  pointer-events: auto;
}

.earth-map-shell {
  position: relative;
  display: grid;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-height: 18rem;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 26%);
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: 1.5rem;
  background: color-mix(in oklab, var(--page) 68%, rgb(56 189 248 / 24%));
  box-shadow: 0 24px 80px rgb(15 23 42 / 18%);
  backdrop-filter: blur(24px);
}

.earth-map {
  position: relative;
  height: 100%;
  min-width: 0;
  min-height: 18rem;
  overflow: hidden;
  border-right: 1px solid rgb(255 255 255 / 24%);
}

.earth-map::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at 18% 18%, rgb(255 255 255 / 18%), transparent 32%),
    linear-gradient(135deg, rgb(255 255 255 / 10%), transparent 38%, rgb(15 23 42 / 8%));
  content: '';
  pointer-events: none;
}

.map-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding-inline: 0;
}

.earth-image-base {
  opacity: 0.92;
  filter: saturate(1.08) contrast(1) brightness(1.12);
}

.earth-image-bump {
  opacity: 0.2;
  mix-blend-mode: overlay;
  filter: contrast(1.35) brightness(1.12);
}

.earth-image-water {
  opacity: 0.16;
  mix-blend-mode: screen;
  filter: saturate(0.42) contrast(1.22) brightness(1.04);
}

.earth-overlay {
  fill: rgb(255 255 255 / 5%);
  mix-blend-mode: soft-light;
}

:global([data-theme='dark']) .earth-image-base {
  filter: saturate(1.1) contrast(1.04) brightness(0.92);
}

:global([data-theme='dark']) .earth-image-bump {
  opacity: 0.28;
}

:global([data-theme='dark']) .earth-image-water {
  opacity: 0.2;
}

.map-status {
  position: absolute;
  left: 0.75rem;
  top: 0.75rem;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--glass-border) 35%, transparent);
  border-radius: 999px;
  padding: 0.25rem 0.625rem;
  background: color-mix(in srgb, var(--glass) 55%, transparent);
  box-shadow: var(--shadow-soft);
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
  backdrop-filter: blur(20px);
}

@media (min-width: 768px) {
  .map-status {
    left: 1rem;
    top: 1rem;
  }
}

.map-status__online,
.map-status__offline {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.map-status__online {
  color: var(--emerald);
}

.map-status__offline {
  color: var(--red);
}

.map-status__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 999px;
  background: var(--emerald);
  box-shadow: 0 0 10px color-mix(in srgb, var(--emerald) 85%, transparent);
}

.map-status__dot--offline {
  background: var(--red);
  box-shadow: 0 0 10px color-mix(in srgb, var(--red) 70%, transparent);
}

.city-region {
  fill: rgb(253 224 71 / 24%);
  stroke: rgb(253 224 71 / 46%);
  stroke-width: 1.1;
  vector-effect: non-scaling-stroke;
}

.city-region.is-offline {
  fill: rgb(251 113 133 / 14%);
  stroke: rgb(251 113 133 / 38%);
}

.city-dot {
  fill: rgb(253 224 71 / 95%);
  stroke: rgb(21 128 61 / 84%);
  stroke-width: 1.3;
  vector-effect: non-scaling-stroke;
}

.city-dot.is-offline {
  fill: rgb(251 113 133 / 90%);
  stroke: rgb(190 18 60 / 80%);
}

.map-flag {
  overflow: hidden;
  clip-path: inset(0 round 1.6px);
  filter: drop-shadow(0 3px 5px rgb(15 23 42 / 32%));
}

.legend-panel {
  --legend-grid-columns: repeat(2, minmax(0, 1fr));
  --legend-gap: 0.22rem;
  --legend-item-columns: 1.05rem 0.85rem minmax(0, 1fr);
  --legend-item-gap: 0.26rem;
  --legend-item-radius: 0.55rem;
  --legend-item-padding: 0.2rem 0.32rem;
  --legend-index-size: 1rem;
  --legend-index-font-size: 0.58rem;
  --legend-flag-size: 0.86rem;
  --legend-copy-line-height: 1.05;
  --legend-name-font-size: 0.58rem;
  --legend-meta-font-size: 0.46rem;

  position: relative;
  z-index: 14;
  display: grid;
  min-width: 0;
  max-height: 100%;
  align-content: start;
  grid-template-columns: var(--legend-grid-columns);
  gap: var(--legend-gap);
  overflow: hidden;
  padding: 0.7rem 0.75rem;
  background: rgb(255 255 255 / 8%);
  pointer-events: none;
}

.legend-title {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid rgb(255 255 255 / 36%);
  border-radius: 999px;
  background: rgb(255 255 255 / 45%);
  box-shadow: 0 8px 18px rgb(15 23 42 / 10%);
  padding: 0.22rem 0.7rem;
  color: rgb(14 116 144 / 86%);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  backdrop-filter: blur(12px) saturate(150%);
}

.legend-title span {
  color: rgb(5 150 105 / 95%);
  letter-spacing: normal;
}

.legend-dense {
  --legend-gap: 0.16rem;
  --legend-item-columns: 0.92rem 0.74rem minmax(0, 1fr);
  --legend-item-gap: 0.18rem;
  --legend-item-radius: 0.45rem;
  --legend-item-padding: 0.14rem 0.24rem;
  --legend-index-size: 0.82rem;
  --legend-index-font-size: 0.5rem;
  --legend-flag-size: 0.74rem;
  --legend-copy-line-height: 1;
  --legend-name-font-size: 0.52rem;
  --legend-meta-font-size: 0.4rem;
}

.legend-very-dense {
  --legend-gap: 0.12rem;
  --legend-item-columns: 0.82rem 0.66rem minmax(0, 1fr);
  --legend-item-gap: 0.14rem;
  --legend-item-radius: 0.38rem;
  --legend-item-padding: 0.1rem 0.2rem;
  --legend-index-size: 0.72rem;
  --legend-index-font-size: 0.44rem;
  --legend-flag-size: 0.66rem;
  --legend-copy-line-height: 0.96;
  --legend-name-font-size: 0.48rem;
  --legend-meta-font-size: 0.36rem;
}

.legend-ultra-dense {
  --legend-gap: 0.1rem;
  --legend-item-columns: 0.74rem 0.58rem minmax(0, 1fr);
  --legend-item-gap: 0.12rem;
  --legend-item-radius: 0.34rem;
  --legend-item-padding: 0.08rem 0.16rem;
  --legend-index-size: 0.64rem;
  --legend-index-font-size: 0.38rem;
  --legend-flag-size: 0.58rem;
  --legend-copy-line-height: 0.94;
  --legend-name-font-size: 0.44rem;
  --legend-meta-font-size: 0.32rem;
}

.legend-item {
  display: grid;
  grid-template-columns: var(--legend-item-columns);
  align-items: center;
  gap: var(--legend-item-gap);
  border: 1px solid rgb(255 255 255 / 38%);
  border-radius: var(--legend-item-radius);
  background: rgb(255 255 255 / 44%);
  box-shadow: 0 8px 18px rgb(15 23 42 / 12%);
  padding: var(--legend-item-padding);
  backdrop-filter: blur(12px) saturate(150%);
}

.legend-index {
  display: inline-grid;
  width: var(--legend-index-size);
  height: var(--legend-index-size);
  place-items: center;
  border-radius: 999px;
  background: rgb(253 224 71 / 92%);
  color: rgb(15 23 42 / 86%);
  font-size: var(--legend-index-font-size);
  font-weight: 800;
}

.legend-item.is-offline .legend-index {
  background: rgb(251 113 133 / 85%);
  color: white;
}

.legend-flag {
  width: var(--legend-flag-size);
  height: var(--legend-flag-size);
  border-radius: 0.12rem;
  object-fit: cover;
}

.legend-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: var(--legend-copy-line-height);
}

.legend-name {
  overflow: hidden;
  color: rgb(15 23 42 / 84%);
  font-size: var(--legend-name-font-size);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-meta {
  overflow: hidden;
  color: rgb(71 85 105 / 76%);
  font-size: var(--legend-meta-font-size);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global([data-theme='dark']) .earth-map {
  border-right-color: rgb(125 211 252 / 12%);
}

:global([data-theme='dark']) .legend-panel {
  background: rgb(15 23 42 / 18%);
}

:global([data-theme='dark']) .legend-title,
:global([data-theme='dark']) .legend-item {
  border-color: rgb(125 211 252 / 18%);
  background: rgb(15 23 42 / 58%);
}

:global([data-theme='dark']) .legend-title {
  color: rgb(186 230 253 / 86%);
}

:global([data-theme='dark']) .legend-title span {
  color: rgb(110 231 183 / 92%);
}

:global([data-theme='dark']) .legend-name {
  color: rgb(255 255 255 / 90%);
}

:global([data-theme='dark']) .legend-meta {
  color: rgb(186 230 253 / 66%);
}

@media (max-width: 640px) {
  .earth-map-scroll {
    touch-action: pan-x pan-y;
  }

  .earth-map-shell {
    min-width: 42rem;
    grid-template-columns: minmax(28rem, 1fr) minmax(11rem, 30%);
  }

  .earth-map {
    min-width: 0;
    min-height: 18rem;
  }

  .map-svg {
    padding-inline: 0;
  }

  .legend-panel {
    --legend-grid-columns: 1fr;
    --legend-gap: 0.16rem;
    --legend-item-columns: 0.92rem 0.74rem minmax(0, 1fr);
    --legend-item-gap: 0.18rem;
    --legend-item-radius: 0.45rem;
    --legend-item-padding: 0.14rem 0.24rem;
    --legend-index-size: 0.82rem;
    --legend-index-font-size: 0.5rem;
    --legend-flag-size: 0.74rem;
    --legend-copy-line-height: 1;
    --legend-name-font-size: 0.52rem;
    --legend-meta-font-size: 0.4rem;

    padding: 0.55rem 0.5rem;
  }

  .legend-title {
    padding: 0.18rem 0.45rem;
    font-size: 0.54rem;
    letter-spacing: 0.15em;
  }

  .legend-very-dense,
  .legend-ultra-dense {
    --legend-gap: 0.12rem;
    --legend-item-columns: 0.78rem 0.62rem minmax(0, 1fr);
    --legend-item-gap: 0.12rem;
    --legend-item-radius: 0.36rem;
    --legend-item-padding: 0.08rem 0.16rem;
    --legend-index-size: 0.66rem;
    --legend-index-font-size: 0.4rem;
    --legend-flag-size: 0.62rem;
    --legend-copy-line-height: 0.94;
    --legend-name-font-size: 0.44rem;
    --legend-meta-font-size: 0.32rem;
  }
}
</style>
