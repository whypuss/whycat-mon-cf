<script setup lang="ts">
import { computed } from 'vue'
import defaultBackground from '@/assets/background/default-background-v2.webp'
import { useBackgroundMedia } from '@/composables/use-background-media'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { resolveBackgroundSource } from '@/theme/settings'

/**
 * Komari Background.vue 的媒体与过渡层。CFSM 特有的只有 Vite 默认图 URL、
 * local: 地址解析、配置返回前的冷启动请求门，以及无 Referer 的图片请求。
 */
const theme = useThemeSettingsStore()
const showBackground = computed(() => theme.configResolved && theme.runtime.backgroundEnabled)
const selectedSource = computed(() => resolveBackgroundSource(
  theme.resolvedTheme === 'dark'
    ? theme.runtime.darkBackgroundUrl
    : theme.runtime.lightBackgroundUrl,
))
const currentUrl = computed(() => showBackground.value ? selectedSource.value : '')
const backgroundType = computed(() => theme.runtime.backgroundType)
const blur = computed(() => theme.runtime.backgroundBlur)
const overlay = computed(() => theme.runtime.backgroundOverlay)
const configResolved = computed(() => theme.configResolved)

const {
  hasCustomBackground,
  showBackgroundOverlay,
  backgroundStyle,
  backgroundContainerStyle,
  overlayStyle,
  showDefaultBackground,
  showLoadingBackground,
  showFallbackBackground,
  showMediaBackground,
  videoRef,
  handleVideoLoaded,
  handleVideoError,
} = useBackgroundMedia(
  showBackground,
  currentUrl,
  backgroundType,
  blur,
  overlay,
  configResolved,
  theme.coldStartBackgroundEnabled,
)
</script>

<template>
  <div
    class="dynamic-background"
    :class="{ 'dynamic-background--custom': hasCustomBackground }"
    :style="backgroundContainerStyle"
    aria-hidden="true"
  >
    <Transition name="fade">
      <div
        v-if="showDefaultBackground"
        class="dynamic-background__default"
        :style="{ backgroundImage: `url(${defaultBackground})` }"
      />
    </Transition>
    <Transition name="fade">
      <div v-if="showLoadingBackground" class="dynamic-background__loading" />
    </Transition>
    <Transition name="fade">
      <div v-if="showFallbackBackground" class="dynamic-background__loading" />
    </Transition>
    <Transition name="fade">
      <div
        v-if="showMediaBackground"
        :key="`${backgroundType}:${currentUrl}`"
        class="dynamic-background__media"
        :style="backgroundStyle"
      >
        <img
          v-if="backgroundType === 'image'"
          class="dynamic-background__image"
          :src="currentUrl"
          alt=""
          decoding="async"
          referrerpolicy="no-referrer"
        >
        <video
          v-else-if="backgroundType === 'video'"
          ref="videoRef"
          class="dynamic-background__video"
          :src="currentUrl"
          autoplay
          loop
          muted
          preload="auto"
          playsinline
          @loadeddata="handleVideoLoaded"
          @canplay="handleVideoLoaded"
          @error="handleVideoError"
        />
      </div>
    </Transition>
    <div v-if="showBackgroundOverlay" class="dynamic-background__overlay" :style="overlayStyle" />
  </div>
</template>
