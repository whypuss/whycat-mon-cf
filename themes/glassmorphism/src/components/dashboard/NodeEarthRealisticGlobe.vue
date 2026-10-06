<script setup lang="ts">
import type { GlobeInstance } from 'globe.gl'
import type { MeshPhongMaterial, Texture } from 'three'
import {
  useDocumentVisibility,
  useElementSize,
  useElementVisibility,
} from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EARTH_DAY_TEXTURE from '@/assets/earth/earth-blue-marble.jpg'
import EARTH_NIGHT_TEXTURE from '@/assets/earth/earth-night.jpg'
import EARTH_BUMP_MAP from '@/assets/earth/earth-topology.png'
import EARTH_SPECULAR_MAP from '@/assets/earth/earth-water.png'
import { useServerGeoClusters } from '@/composables/useServerGeoClusters'
import { flagUrl } from '@/utils/flags'
import type { GlassServer } from '@/types/glassmorphism'

const props = defineProps<{
  servers: readonly GlassServer[]
  stopped: boolean
  isDark: boolean
}>()

const CHINA_COORD: [number, number] = [35.8617, 104.1954]

const containerRef = ref<HTMLDivElement>()
const globeHostRef = ref<HTMLDivElement>()
const { width: containerWidth, height: containerHeight } = useElementSize(containerRef)

const documentVisibility = useDocumentVisibility()
const elementVisible = useElementVisibility(containerRef)
const shouldRender = computed(() => documentVisibility.value === 'visible' && elementVisible.value)

let globe: GlobeInstance | null = null
let globeMaterial: MeshPhongMaterial | null = null
let waterSpecularMap: Texture | null = null
let loadingGlobe = false
let destroyed = false

interface GlobePoint {
  id: string
  lat: number
  lng: number
  code: string
  servers: number
  onlineServers: number
}

interface GlobeLabel {
  id: string
  lat: number
  lng: number
  code: string
}

const {
  regionClusters,
  totalServers,
  onlineServers,
  offlineServers,
  clusterKey,
} = useServerGeoClusters(() => props.servers)

const pointsData = computed<GlobePoint[]>(() => regionClusters.value.map((cluster) => ({
  id: cluster.id,
  lat: cluster.coord[0],
  lng: cluster.coord[1],
  code: cluster.code,
  servers: cluster.servers,
  onlineServers: cluster.onlineServers,
})))

const labelsData = computed<GlobeLabel[]>(() => regionClusters.value.map((cluster) => ({
  id: cluster.id,
  lat: cluster.coord[0],
  lng: cluster.coord[1],
  code: cluster.code,
})))

function earthTextureUrl(): string {
  return props.isDark ? EARTH_NIGHT_TEXTURE : EARTH_DAY_TEXTURE
}

function pointColor(point: object): string {
  const data = point as GlobePoint
  if (data.onlineServers > 0)
    return props.isDark ? 'rgba(34, 211, 238, 1)' : 'rgba(2, 132, 199, 0.98)'
  return props.isDark ? 'rgba(250, 204, 21, 0.92)' : 'rgba(202, 138, 4, 0.88)'
}

function createLabelElement(data: object): HTMLElement {
  const label = data as GlobeLabel
  const root = document.createElement('div')
  root.className = 'earth-label'
  root.dataset.clusterId = label.id

  const flag = document.createElement('img')
  flag.className = 'earth-label-flag'
  flag.src = flagUrl(label.code)
  flag.alt = label.code
  flag.addEventListener('error', () => {
    flag.style.visibility = 'hidden'
  })
  root.appendChild(flag)

  return root
}

function getRenderSize(): { width: number, height: number } {
  const width = containerWidth.value || globeHostRef.value?.clientWidth || 320
  const height = containerHeight.value || globeHostRef.value?.clientHeight || width
  return { width, height }
}

function resizeGlobe(): void {
  if (!globe) return
  const { width, height } = getRenderSize()
  globe.width(width).height(height)
}

function resetPointOfView(transitionMs = 0): void {
  globe?.pointOfView({ lat: CHINA_COORD[0], lng: CHINA_COORD[1], altitude: 1.95 }, transitionMs)
}

function applyControls(): void {
  if (!globe) return
  const controls = globe.controls()
  controls.autoRotate = shouldRender.value && !props.stopped
  controls.autoRotateSpeed = 1.6
  controls.enableDamping = true
  controls.enableZoom = false
  controls.enablePan = false
  controls.rotateSpeed = 0.55
}

function applyMaterialStyle(): void {
  if (!globe || !globeMaterial) return
  globe.globeImageUrl(earthTextureUrl())
  globeMaterial.bumpScale = props.isDark ? 0.02 : 0.03
  globeMaterial.shininess = props.isDark ? 8 : 14
  globeMaterial.emissive.set(props.isDark ? 0x1E3A5F : 0x355C7D)
  globeMaterial.emissiveIntensity = props.isDark ? 0.48 : 0.32
  globeMaterial.needsUpdate = true
  globe
    .pointColor(pointColor)
    .ringColor(() => (props.isDark ? 'rgba(45, 212, 191, 0.34)' : 'rgba(14, 165, 233, 0.28)'))
    .atmosphereColor(props.isDark ? '#38bdf8' : '#60a5fa')
    .atmosphereAltitude(props.isDark ? 0.14 : 0.11)
}

function syncDataToGlobe(): void {
  if (!globe) return
  globe
    .pointsData(pointsData.value)
    .ringsData(pointsData.value)
    .htmlElementsData(labelsData.value)
}

async function startGlobe(): Promise<void> {
  if (globe || loadingGlobe || !globeHostRef.value) return

  loadingGlobe = true
  await nextTick()

  try {
    const [{ default: Globe }, THREE] = await Promise.all([
      import('globe.gl'),
      import('three'),
    ])

    if (destroyed || !globeHostRef.value) return

    const { width, height } = getRenderSize()
    globe = new Globe(globeHostRef.value, {
      rendererConfig: { alpha: true, antialias: true },
    })
      .width(width)
      .height(height)
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl(earthTextureUrl())
      .bumpImageUrl(EARTH_BUMP_MAP)
      .showAtmosphere(true)
      .pointsData(pointsData.value)
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude(0.008)
      .pointRadius((point: object) => ((point as GlobePoint).onlineServers > 0 ? 0.22 : 0.13))
      .pointColor(pointColor)
      .pointsMerge(false)
      .pointsTransitionDuration(500)
      .ringsData(pointsData.value)
      .ringLat('lat')
      .ringLng('lng')
      .ringColor(() => (props.isDark ? 'rgba(45, 212, 191, 0.34)' : 'rgba(14, 165, 233, 0.28)'))
      .ringMaxRadius(1.4)
      .ringPropagationSpeed(0.8)
      .ringRepeatPeriod(2400)
      .htmlElementsData(labelsData.value)
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.012)
      .htmlElement(createLabelElement)
      .htmlElementVisibilityModifier((el: HTMLElement, isVisible: boolean) => {
        el.style.opacity = isVisible ? '1' : '0'
        el.style.filter = isVisible ? 'blur(0)' : 'blur(14px)'
      })
      .htmlTransitionDuration(500)

    const renderer = globe.renderer()
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.background = 'transparent'

    const material = globe.globeMaterial()
    if ('shininess' in material) {
      globeMaterial = material as MeshPhongMaterial
      waterSpecularMap = new THREE.TextureLoader().load(EARTH_SPECULAR_MAP, () => {
        if (!globeMaterial) return
        globeMaterial.specularMap = waterSpecularMap
        globeMaterial.needsUpdate = true
      })
      globeMaterial.specular = new THREE.Color(props.isDark ? 0x64748B : 0x475569)
    }

    const frontLight = new THREE.DirectionalLight(0xFFFFFF, props.isDark ? 0.9 : 1.0)
    frontLight.position.set(1.2, 1.1, 1.6)
    const leftFill = new THREE.DirectionalLight(0xDBEAFE, props.isDark ? 0.62 : 0.48)
    leftFill.position.set(-1.2, 0.2, 1.2)
    const rearFill = new THREE.DirectionalLight(0xE0F2FE, props.isDark ? 0.52 : 0.38)
    rearFill.position.set(-1.0, -0.8, -1.2)
    globe.lights([
      new THREE.AmbientLight(0xFFFFFF, props.isDark ? 1.85 : 1.45),
      frontLight,
      leftFill,
      rearFill,
    ])

    applyMaterialStyle()
    applyControls()
    resetPointOfView(0)
    if (!shouldRender.value) globe.pauseAnimation()
  } finally {
    loadingGlobe = false
  }
}

function stopGlobe(): void {
  if (!globe) return

  globe.pauseAnimation()
  globe._destructor()
  globe = null
  globeMaterial = null
  waterSpecularMap?.dispose()
  waterSpecularMap = null
  if (globeHostRef.value) globeHostRef.value.replaceChildren()
}

onMounted(() => {
  void startGlobe()
})

onBeforeUnmount(() => {
  destroyed = true
  stopGlobe()
})

watch([containerWidth, containerHeight], ([width, height]) => {
  if (width <= 0 || height <= 0) return
  resizeGlobe()
})

watch(() => regionClusters.value.map(clusterKey).join(','), () => {
  syncDataToGlobe()
})

watch(() => props.isDark, () => {
  applyMaterialStyle()
})

watch(() => props.stopped, (stopped) => {
  applyControls()
  if (stopped) resetPointOfView(300)
})

watch(shouldRender, (visible) => {
  if (!globe) return
  if (visible) {
    globe.resumeAnimation()
    applyControls()
    resizeGlobe()
    return
  }
  globe.pauseAnimation()
  applyControls()
})
</script>

<template>
  <div ref="containerRef" class="earth-globe-frame">
    <div ref="globeHostRef" class="earth-globe-host" />

    <div v-if="totalServers > 0" class="earth-globe-status">
      <span v-if="onlineServers > 0" class="earth-globe-status__item earth-globe-status__item--online">
        <i aria-hidden="true" />{{ onlineServers }}
      </span>
      <span v-if="offlineServers > 0" class="earth-globe-status__item earth-globe-status__item--offline">
        <i aria-hidden="true" />{{ offlineServers }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.earth-globe-frame {
  position: relative;
  z-index: 0;
  aspect-ratio: 1 / 1;
  width: 100%;
  max-width: 28rem;
  margin-inline: auto;
  overflow: visible;
  transform: translateY(0.5rem);
  pointer-events: none;
}

@media (min-width: 768px) {
  .earth-globe-frame {
    transform: translateY(-0.25rem);
  }
}

.earth-globe-host {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  transform: scale(1.06);
  contain: layout paint;
  background: transparent;
  cursor: grab;
  pointer-events: auto;
  touch-action: auto;
  user-select: none;
}

.earth-globe-host:active {
  cursor: grabbing;
}

.earth-globe-host :deep(canvas) {
  background: transparent !important;
  outline: none;
}

.earth-globe-host :deep(.scene-container) {
  background: transparent !important;
}

.earth-globe-host :deep(.earth-label) {
  pointer-events: none;
  position: relative;
  transform: translate(-50%, -118%);
  transition:
    opacity 500ms ease,
    filter 500ms ease;
  will-change: opacity, filter;
}

.earth-globe-host :deep(.earth-label-flag) {
  position: relative;
  z-index: 2;
  width: 1.2rem;
  height: 1.2rem;
  display: block;
  border-radius: 0.18rem;
  box-shadow: 0 8px 20px rgb(15 23 42 / 24%);
}

.earth-globe-status {
  position: absolute;
  top: 1.5rem;
  left: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  background: color-mix(in srgb, var(--glass) 60%, transparent);
  color: var(--muted);
  font-size: 10px;
  backdrop-filter: blur(16px);
  pointer-events: none;
}

@media (min-width: 768px) {
  .earth-globe-status {
    top: 3rem;
  }
}

.earth-globe-status__item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.earth-globe-status__item i {
  display: inline-block;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 999px;
  background: currentcolor;
  animation: earth-status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.earth-globe-status__item--online {
  color: var(--emerald);
}

.earth-globe-status__item--offline {
  color: var(--amber);
}

@keyframes earth-status-pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .earth-globe-status__item i {
    animation: none;
  }
}
</style>
