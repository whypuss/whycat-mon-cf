import { readFileSync } from 'node:fs'
import { createRenderer, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundMedia } from '@/composables/use-background-media'

class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  referrerPolicy = ''
  src = ''

  constructor() { FakeImage.instances.push(this) }
  succeed() { this.onload?.() }
  fail() { this.onerror?.() }
}

interface HostNode {
  tag: string
  text: string
  parent: HostNode | null
  children: HostNode[]
}

function node(tag: string, text = ''): HostNode {
  return { tag, text, parent: null, children: [] }
}

const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText(target, text) { target.text = text },
  setElementText(target, text) { target.text = text },
  patchProp() {},
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    const parent = child.parent
    if (parent) parent.children.splice(parent.children.indexOf(child), 1)
    child.parent = null
  },
  parentNode: child => child.parent,
  nextSibling(child) {
    const siblings = child.parent?.children ?? []
    return siblings[siblings.indexOf(child) + 1] ?? null
  },
})

function mountState(coldStartCustomHint = false) {
  const enabled = ref(false)
  const url = ref('')
  const type = ref<'image' | 'video'>('image')
  const blur = ref(0)
  const overlay = ref(0)
  const configResolved = ref(false)
  let state!: ReturnType<typeof useBackgroundMedia>
  const app = renderer.createApp({
    setup() {
      state = useBackgroundMedia(
        enabled, url, type, blur, overlay, configResolved, coldStartCustomHint,
      )
      return () => h('div')
    },
  })
  app.mount(node('root'))
  return { enabled, url, type, blur, overlay, configResolved, state, unmount: () => app.unmount() }
}

describe('Komari background media state with CFSM cold-start gate', () => {
  beforeEach(() => {
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps all four fade wrappers and the upstream 0.8-second media transition', () => {
    const component = readFileSync(new URL('../src/components/dashboard/DynamicBackground.vue', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
    expect(component.match(/<Transition name="fade">/g)).toHaveLength(4)
    expect(styles).toContain('.dynamic-background .fade-enter-active')
    expect(styles).toContain('.dynamic-background .fade-leave-active')
    expect(styles).toContain('transition: opacity 0.8s ease')
    expect(styles).toContain(':root[data-motion=\'reduced\'] *')
    expect(component).toContain('referrerpolicy="no-referrer"')
  })

  it('keeps the default image until a first-visit custom image has loaded', async () => {
    const view = mountState()
    expect(view.state.showDefaultBackground.value).toBe(true)
    view.configResolved.value = true
    view.enabled.value = true
    view.url.value = '/slow.jpg'
    await nextTick()
    expect(FakeImage.instances).toHaveLength(1)
    expect(FakeImage.instances[0]?.referrerPolicy).toBe('no-referrer')
    expect(FakeImage.instances[0]?.src).toBe('/slow.jpg')
    expect(view.state.showDefaultBackground.value).toBe(true)
    expect(view.state.showMediaBackground.value).toBe(false)
    FakeImage.instances[0]?.succeed()
    await nextTick()
    expect(view.state.showMediaBackground.value).toBe(true)
    expect(view.state.showDefaultBackground.value).toBe(false)
    view.unmount()
  })

  it('keeps the default image after a custom image load error', async () => {
    const view = mountState()
    view.configResolved.value = true
    view.enabled.value = true
    view.url.value = '/missing.jpg'
    await nextTick()
    FakeImage.instances[0]?.fail()
    await nextTick()
    expect(view.state.hasError.value).toBe(true)
    expect(view.state.showDefaultBackground.value).toBe(true)
    expect(view.state.showMediaBackground.value).toBe(false)
    view.unmount()
  })

  it('holds video transparent over the loading layer, then shows media or fallback', async () => {
    const view = mountState()
    view.configResolved.value = true
    view.enabled.value = true
    view.type.value = 'video'
    view.url.value = '/slow.webm'
    await nextTick()
    expect(view.state.showLoadingBackground.value).toBe(true)
    expect(view.state.showMediaBackground.value).toBe(true)
    expect(view.state.backgroundStyle.value.opacity).toBe(0)
    view.state.handleVideoLoaded()
    expect(view.state.showLoadingBackground.value).toBe(false)
    expect(view.state.backgroundStyle.value.opacity).toBe(1)
    view.state.handleVideoError()
    expect(view.state.showFallbackBackground.value).toBe(true)
    expect(view.state.showMediaBackground.value).toBe(false)
    expect(view.state.showDefaultBackground.value).toBe(true)
    view.unmount()
  })

  it('never requests the default image during a hinted custom image first load', async () => {
    const view = mountState(true)
    expect(view.state.showDefaultBackground.value).toBe(false)
    view.configResolved.value = true
    view.enabled.value = true
    view.url.value = '/custom.jpg'
    await nextTick()
    expect(view.state.showDefaultBackground.value).toBe(false)
    FakeImage.instances[0]?.succeed()
    await nextTick()
    expect(view.state.showMediaBackground.value).toBe(true)
    expect(view.state.showDefaultBackground.value).toBe(false)
    view.unmount()
  })

  it('shows the default on hinted custom image failure or stale config', async () => {
    const failed = mountState(true)
    failed.configResolved.value = true
    failed.enabled.value = true
    failed.url.value = '/404.jpg'
    await nextTick()
    FakeImage.instances[0]?.fail()
    await nextTick()
    expect(failed.state.showDefaultBackground.value).toBe(true)
    failed.unmount()

    const stale = mountState(true)
    expect(stale.state.showDefaultBackground.value).toBe(false)
    stale.configResolved.value = true
    await nextTick()
    expect(stale.state.showDefaultBackground.value).toBe(true)
    stale.unmount()
  })

  it('preloads the other URL on a light/dark switch and restores default while waiting', async () => {
    const view = mountState(true)
    view.configResolved.value = true
    view.enabled.value = true
    view.url.value = '/light.jpg'
    await nextTick()
    const first = FakeImage.instances[0]
    first?.succeed()
    await nextTick()
    view.url.value = '/dark.jpg'
    await nextTick()
    expect(first?.onload).toBeNull()
    expect(first?.onerror).toBeNull()
    expect(view.state.showDefaultBackground.value).toBe(true)
    expect(view.state.showMediaBackground.value).toBe(false)
    expect(FakeImage.instances[1]?.src).toBe('/dark.jpg')
    FakeImage.instances[1]?.succeed()
    await nextTick()
    expect(view.state.showMediaBackground.value).toBe(true)
    view.unmount()
  })

  it('applies positive overlay to either layer, negative overlay to the whole container', async () => {
    const view = mountState()
    view.overlay.value = 50
    expect(view.state.showDefaultBackground.value).toBe(true)
    expect(view.state.showBackgroundOverlay.value).toBe(true)
    expect(view.state.overlayStyle.value).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0.5)' })
    view.configResolved.value = true
    view.enabled.value = true
    view.url.value = '/custom.jpg'
    await nextTick()
    FakeImage.instances[0]?.succeed()
    expect(view.state.showMediaBackground.value).toBe(true)
    expect(view.state.showBackgroundOverlay.value).toBe(true)
    view.overlay.value = -50
    expect(view.state.showBackgroundOverlay.value).toBe(false)
    expect(view.state.backgroundContainerStyle.value).toEqual({ opacity: 0.5 })
    expect(view.state.overlayStyle.value).toEqual({})
    view.overlay.value = 0
    expect(view.state.showBackgroundOverlay.value).toBe(false)
    expect(view.state.backgroundContainerStyle.value).toEqual({})
    view.unmount()
  })

  it('uses blur or none without scaling the media', () => {
    const view = mountState()
    expect(view.state.backgroundStyle.value).toEqual({ filter: 'none', opacity: 1 })
    view.blur.value = 18
    expect(view.state.backgroundStyle.value).toEqual({ filter: 'blur(18px)', opacity: 1 })
    view.unmount()
  })

  it('clears image handlers and the active video source on unmount', async () => {
    const image = mountState()
    image.configResolved.value = true
    image.enabled.value = true
    image.url.value = '/custom.jpg'
    await nextTick()
    const loader = FakeImage.instances[0]
    image.unmount()
    expect(loader?.onload).toBeNull()
    expect(loader?.onerror).toBeNull()

    const video = mountState()
    video.configResolved.value = true
    video.enabled.value = true
    video.type.value = 'video'
    video.url.value = '/custom.webm'
    await nextTick()
    const pause = vi.fn()
    const removeAttribute = vi.fn()
    const load = vi.fn()
    video.state.videoRef.value = { pause, removeAttribute, load } as unknown as HTMLVideoElement
    video.unmount()
    expect(pause).toHaveBeenCalledOnce()
    expect(removeAttribute).toHaveBeenCalledWith('src')
    expect(load).toHaveBeenCalledOnce()
  })
})
