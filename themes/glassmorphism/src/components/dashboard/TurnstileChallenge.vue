<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { loadTurnstileScript, removeTurnstileWidget, requestTurnstileToken, type TurnstileApi } from '@/services/cfsm'
import { useAppStore } from '@/stores/app'
import { useThemeSettingsStore } from '@/stores/theme-settings'

/**
 * CFSM 全局 Turnstile 的人机验证，显示在全屏加载遮罩里。流程与 CFSM 默认前端
 * `renderStartupTurnstile` 一致：加载官方脚本 → 渲染组件取得一次性令牌 → 由 app store 经
 * `/api/config` 换取凭据。成功后 store 重新读取配置并通知各页面重载数据，遮罩随之退出；
 * 失败时保留遮罩并提供重试，不刷新整页（设置页未保存的草稿不会丢失）。
 */
const props = defineProps<{ siteKey: string }>()
const app = useAppStore()
const theme = useThemeSettingsStore()
const container = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'pending' | 'verifying' | 'failed'>('loading')

const statusText = computed(() => {
  if (status.value === 'loading') return '正在加载人机验证…'
  if (status.value === 'pending') return '请完成人机验证'
  if (status.value === 'verifying') return '正在验证…'
  return '人机验证未通过，请重试'
})

// 当前渲染出的官方组件。重试和卸载前先 remove（与 CFSM 管理端一致），
// 否则 Turnstile 之后找不到已移除的容器，会在控制台警告。
let widget: { api: TurnstileApi, id: string } | null = null
let active = true

function removeWidget(): void {
  if (widget) removeTurnstileWidget(widget.api, widget.id)
  widget = null
}

async function start(): Promise<void> {
  const target = container.value
  if (!target) return
  status.value = 'loading'
  removeWidget()
  target.replaceChildren()
  try {
    const api = await loadTurnstileScript()
    // 脚本加载期间组件已卸载（不再需要验证）时，不再往移除的容器里渲染。
    if (!active) return
    status.value = 'pending'
    const token = await requestTurnstileToken(api, target, props.siteKey, theme.resolvedTheme, (id) => {
      widget = { api, id }
    })
    status.value = 'verifying'
    if (!(await app.completeTurnstile(token))) status.value = 'failed'
  } catch {
    status.value = 'failed'
  }
}

onMounted(() => {
  void start()
})

onBeforeUnmount(() => {
  active = false
  removeWidget()
})
</script>

<template>
  <div class="turnstile-challenge" :class="`turnstile-challenge--${status}`" role="status" aria-live="polite">
    <span class="turnstile-challenge__text">{{ statusText }}</span>
    <div ref="container" class="turnstile-challenge__widget" />
    <button v-if="status === 'failed'" type="button" class="turnstile-challenge__retry" @click="start">
      重新验证
    </button>
  </div>
</template>
