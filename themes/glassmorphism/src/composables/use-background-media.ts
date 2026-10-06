import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

type Source<T> = Readonly<Ref<T>>

/** Komari Background.vue 的媒体状态机；仅增加 CFSM 的冷启动请求门。 */
export function useBackgroundMedia(
  enabled: Source<boolean>,
  url: Source<string>,
  type: Source<'image' | 'video'>,
  blur: Source<number>,
  overlay: Source<number>,
  configResolved: Source<boolean>,
  coldStartCustomHint: boolean,
) {
  const isLoaded = ref(false)
  const hasError = ref(false)
  // 只对本次冷启动的第一个媒体生效；后续明暗切换完全按上游回退默认层。
  const suppressDefaultUntilFirstOutcome = ref(coldStartCustomHint)

  const hasCustomBackground = computed(() => enabled.value && !!url.value)
  const showBackgroundOverlay = computed(() => overlay.value > 0)
  const backgroundStyle = computed(() => ({
    filter: blur.value > 0 ? `blur(${blur.value}px)` : 'none',
    opacity: type.value === 'video' && !isLoaded.value ? 0 : 1,
  }))
  const backgroundContainerStyle = computed(() => (
    overlay.value >= 0 ? {} : { opacity: 1 - Math.abs(overlay.value) / 100 }
  ))
  const overlayStyle = computed(() => (
    overlay.value <= 0 ? {} : { backgroundColor: `rgba(0, 0, 0, ${overlay.value / 100})` }
  ))

  const showLoadedBackground = computed(() =>
    hasCustomBackground.value && isLoaded.value && !hasError.value,
  )
  const showMediaBackground = computed(() =>
    hasCustomBackground.value && !hasError.value && (type.value === 'video' || showLoadedBackground.value),
  )
  const showDefaultBackground = computed(() => {
    const upstreamDefault = !hasCustomBackground.value || !showMediaBackground.value || hasError.value
    if (!suppressDefaultUntilFirstOutcome.value) return upstreamDefault
    // 缓存表明「自定义」时，配置前及首个媒体加载期间不请求默认图。
    // 若缓存过期或加载失败，立即回到默认图。
    return (hasError.value || (configResolved.value && !hasCustomBackground.value)) && upstreamDefault
  })
  const showLoadingBackground = computed(() =>
    hasCustomBackground.value && type.value === 'video' && !isLoaded.value && !hasError.value,
  )
  const showFallbackBackground = computed(() =>
    hasCustomBackground.value && type.value === 'video' && hasError.value,
  )

  let imageLoader: HTMLImageElement | null = null

  function clearImageLoader() {
    if (imageLoader) {
      imageLoader.onload = null
      imageLoader.onerror = null
      imageLoader = null
    }
  }

  function loadImage(nextUrl: string) {
    isLoaded.value = false
    hasError.value = false
    clearImageLoader()

    // SSR 只能展示默认层；真实浏览器由 Image 负责预加载。
    if (typeof Image === 'undefined') return
    imageLoader = new Image()
    imageLoader.referrerPolicy = 'no-referrer'
    imageLoader.onload = () => {
      isLoaded.value = true
      hasError.value = false
    }
    imageLoader.onerror = () => {
      isLoaded.value = false
      hasError.value = true
    }
    imageLoader.src = nextUrl
  }

  const videoRef = ref<HTMLVideoElement | null>(null)

  function resetBackgroundState() {
    clearImageLoader()

    if (videoRef.value) {
      videoRef.value.pause()
      videoRef.value.removeAttribute('src')
      videoRef.value.load()
    }

    isLoaded.value = false
    hasError.value = false
  }

  function handleVideoLoaded() {
    isLoaded.value = true
    hasError.value = false
  }

  function handleVideoError() {
    isLoaded.value = false
    hasError.value = true
  }

  watch([enabled, url, type], ([nextEnabled, nextUrl, nextType]) => {
    if (!nextEnabled || !nextUrl) {
      resetBackgroundState()
      return
    }

    if (nextType === 'image') {
      loadImage(nextUrl)
    } else if (nextType === 'video') {
      clearImageLoader()
      isLoaded.value = false
      hasError.value = false
    }
  }, { immediate: true })

  watch([configResolved, hasCustomBackground, isLoaded, hasError], () => {
    if (isLoaded.value || hasError.value || (configResolved.value && !hasCustomBackground.value)) {
      suppressDefaultUntilFirstOutcome.value = false
    }
  }, { immediate: true })

  onUnmounted(() => {
    resetBackgroundState()
  })

  return {
    isLoaded,
    hasError,
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
  }
}
