<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/dashboard/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  isFieldEnabled,
  THEME_SETTINGS_FORM,
  type ThemeField,
} from '@/domain/theme-settings-form'
import { useAppStore } from '@/stores/app'
import { useRealtimeStore } from '@/stores/realtime'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { THEME_SETTING_KEYS, type ThemeSettings } from '@/theme/settings'
import { message } from '@/utils/message'
import { bootstrapKey } from '@/domain/bootstrap'
import { injectedSiteTitleKey, injectedTitleForPrimary, resolveSiteTitle } from '@/domain/site-title'
import { configReady } from '@/domain/config-readiness'

/*
 * Komari 自己没有设置页：48 项设置写在 `komari-theme.json` 的 managed configuration 里，
 * 由 Komari 后台渲染。CFSM 没有这套机制（第三方主题只能读 `/api/config.theme_options`、
 * 写 `POST /api/theme_options`），所以设置页由主题自己提供，分组、顺序与标题
 * 逐条对齐上游那份清单——见 `domain/theme-settings-form.ts`。
 *
 * 页面框架（Header、背景、玻璃面板）与首页、详情页共用，不再自建一套顶栏。
 */
const app = useAppStore()
const theme = useThemeSettingsStore()
const router = useRouter()
const injectedSiteTitle = inject(injectedSiteTitleKey, null)
const bootstrap = inject(bootstrapKey, null)
const coldStartCover = bootstrap?.coverVisible ?? ref(false)
const copying = ref(false)

const realtime = useRealtimeStore()
const groups = THEME_SETTINGS_FORM
const primaryBase = computed(() => app.primaryBase)
const siteTitleResolution = computed(() => resolveSiteTitle(
  app.config?.siteTitle,
  app.config === null && (app.state === 'idle' || app.state === 'loading'),
  injectedTitleForPrimary(injectedSiteTitle, app.primaryBase),
))
const siteTitle = computed(() => siteTitleResolution.value.title)
const siteTitlePending = computed(() => siteTitleResolution.value.state === 'pending')
const siteConfigReady = computed(() => configReady(app.config, app.state))
const authorized = computed(() => (
  app.config?.authorization === true && theme.hasBackendCredential
))
const visibleAdminUrl = computed(() => (
  !siteConfigReady.value || (theme.runtime.hideAdminEntryWhenLoggedOut && app.config?.authorization !== true)
    ? null
    : app.administrationUrl
))
const backendLabel = computed(() => {
  if (!primaryBase.value) return '未配置 CFSM 数据源'
  try {
    return new URL(primaryBase.value).host
  } catch {
    return primaryBase.value
  }
})
const backendSaveCopy = computed(() => {
  const failure = theme.saveError
  if (!failure) return null
  // 保存失败时修改一律保留在页面上，每条都说清这一点；状态码与错误码放在提示的副标题里。
  if (failure.code === 'saveInProgress') return failure.message
  if (failure.kind === 'invalid-format') {
    return 'CFSM 未接受这份设置，没有保存。修改仍保留在页面上，请检查后重试。'
  }
  if (failure.kind === 'unauthorized') {
    return '需要登录 CFSM 管理后台才能保存到站点。修改仍保留在页面上，登录后再试。'
  }
  if (failure.kind === 'forbidden') {
    return '人机验证已失效，请完成验证后再保存。修改仍保留在页面上。'
  }
  if (failure.kind === 'network') {
    return failure.code === 'timeout'
      ? 'CFSM 长时间没有响应，设置没有保存。修改仍保留在页面上，可以稍后重试。'
      : '网络连接失败，设置没有保存。修改仍保留在页面上，可以稍后重试。'
  }
  return '保存没有成功。修改仍保留在页面上，可以稍后重试。'
})
const snapshotJson = computed(() => JSON.stringify(theme.draftSnapshot, null, 2))

/** 上游把分组写成「01 · 基础与外观」，这里拆成序号徽标与标题两段显示。 */
function groupIndex(title: string): string {
  return title.split(' · ')[0] ?? ''
}

function groupTitle(title: string): string {
  return title.split(' · ')[1] ?? title
}

function issueFor(key: keyof ThemeSettings): string | null {
  return theme.draftIssues.find((issue) => issue.key === key)?.message ?? null
}

/*
 * 「数据更新间隔」只在 WebSocket 不可用时才被读到，正常连接时它一次也不生效。
 * 光靠说明文字看不出此刻算哪种，这里补一行当下的判断。
 *
 * 设置页自己不建实时连接，读的是首页留下的那次观察；没有观察过就不显示，
 * 不拿「未知」冒充「正常」。
 */
function fieldState(key: keyof ThemeSettings): string | null {
  if (key !== 'dataUpdateInterval') return null
  const observed = realtime.lastObservedStatus
  if (observed === 'live') return '最近检测到实时连接正常，此项暂未生效。'
  if (observed === 'fallback') return '最近检测到实时连接不可用，正在按此间隔刷新。'
  return null
}

function fieldEnabled(field: ThemeField): boolean {
  return isFieldEnabled(field, theme.draft)
}

function textValue(key: keyof ThemeSettings): string {
  const value = theme.draft[key]
  return typeof value === 'string' ? value : ''
}

function numberValue(key: keyof ThemeSettings): number | null {
  const value = theme.draft[key]
  return typeof value === 'number' ? value : null
}

function booleanValue(key: keyof ThemeSettings): boolean {
  return theme.draft[key] === true
}

/*
 * 草稿是一份完整的 `ThemeSettings`，这里按控件类型写回单个键。
 * 值域与类型校验仍然只有一处——`theme/settings.ts` 的 schema，
 * 页面不重复实现，也不在写回时悄悄纠正用户输入。
 */
function setValue(key: keyof ThemeSettings, value: string | number | boolean): void {
  Object.assign(theme.draft, { [key]: value })
}

function onText(key: keyof ThemeSettings, event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    setValue(key, target.value)
  }
}

function onSelect(key: keyof ThemeSettings, event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement) setValue(key, target.value)
}

function onSwitch(key: keyof ThemeSettings, event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) setValue(key, target.checked)
}

/** 清空输入框时保留原值，不把空串写成 NaN 让 schema 报一条假错误。 */
function onNumber(key: keyof ThemeSettings, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.value === '') return
  const parsed = Number(target.value)
  if (Number.isFinite(parsed)) setValue(key, parsed)
}

async function saveBackend(): Promise<void> {
  const base = primaryBase.value
  if (!base || !authorized.value) return
  const outcome = await theme.saveBackend(base)
  if (outcome.config) app.applyConfig(outcome.config)
}

async function copySnapshot(): Promise<void> {
  copying.value = true
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API is unavailable')
    await navigator.clipboard.writeText(snapshotJson.value)
    message.info('完整设置 JSON 已复制。')
  } catch {
    message.info('浏览器未允许写入剪贴板；可展开下方 JSON 手动复制。')
  } finally {
    copying.value = false
  }
}

watch(() => theme.draft, () => theme.previewDraft(), { deep: true })

/*
 * 与 Komari `utils/message.ts` 一致：瞬时结果反馈走 sonner toast，不在页面内常驻。
 * 草稿校验问题仍留在页面里，因为它需要持续可见直到被修正。
 */
watch(() => theme.message, (text) => {
  if (text) message.success(text)
})

watch(backendSaveCopy, (copy) => {
  if (!copy) return
  const failure = theme.saveError
  const detail = failure?.status ? `HTTP ${failure.status} · ${failure.code ?? 'unknown'}` : undefined
  message.error(copy, detail)
})


onMounted(async () => {
  const initialPage = bootstrap?.claimInitialPage() ?? false
  if (app.state === 'idle' || (!initialPage && app.state === 'error')) await app.initialize()
})

watch(siteTitle, (title) => {
  document.title = title ? `主题设置 · ${title}` : '主题设置'
}, { immediate: true })
</script>

<template>
  <div class="app-root settings-root">
    <div class="app-shell">
      <AppHeader
        :title="siteTitle"
        :title-pending="siteTitlePending"
        :version="app.config?.version ?? null"
        :loading="app.state === 'loading'"
        :admin-url="visibleAdminUrl"
        :theme-mode="theme.siteThemeMode"
        :resolved-theme="theme.resolvedTheme"
        :theme-override="theme.themeOverride"
        :show-status="false"
        @refresh="app.initialize"
        @cycle-theme="theme.cycleTheme"
      />

      <main v-if="!coldStartCover" class="settings-page">
        <section class="settings-intro glass-panel">
          <div class="settings-intro__copy">
            <button class="detail-back" type="button" @click="router.push({ name: 'home' })">
              <AppIcon name="tabler:arrow-left" :size="14" />
              <span>返回节点列表</span>
            </button>
            <h1>主题设置</h1>
            <p>
              共 {{ THEME_SETTING_KEYS.length }} 项设置。修改会立即预览，
              只有明确保存后才写入本浏览器或 CFSM 后端。
            </p>
          </div>
          <dl v-if="siteConfigReady" class="settings-layer-stats">
            <div>
              <dt>配置来源</dt>
              <dd>默认 → 后端 → 本地</dd>
            </div>
            <div>
              <dt>后端</dt>
              <dd>{{ backendLabel }}</dd>
            </div>
            <div>
              <dt>本地覆盖</dt>
              <dd>{{ theme.localOverrideCount }} 项</dd>
            </div>
            <div>
              <dt>预览</dt>
              <dd>{{ theme.hasDraftChanges ? '有未保存修改' : '已同步' }}</dd>
            </div>
          </dl>
        </section>

        <div v-if="app.state === 'error'" class="notice notice--warning" role="alert">
          <strong>无法读取站点配置</strong>
          <span>可以继续编辑并保存到此浏览器；保存到站点需要先重新读取配置。</span>
          <button type="button" @click="app.initialize">
            重新读取
          </button>
        </div>

        <section v-if="!siteConfigReady" class="detail-loading" aria-label="正在加载主题设置">
          <span v-for="index in 4" :key="index" class="skeleton detail-loading__card" />
        </section>

        <form v-else class="settings-layout" @submit.prevent>
          <div class="settings-sections">
            <section v-for="group in groups" :key="group.title" class="settings-section glass-panel">
              <header>
                <div>
                  <span class="settings-section__index">{{ groupIndex(group.title) }}</span>
                  <h2>{{ groupTitle(group.title) }}</h2>
                </div>
              </header>

              <div class="settings-fields settings-fields--two">
                <template v-for="field in group.fields" :key="field.key">
                  <label
                    v-if="field.kind === 'switch'"
                    class="settings-switch"
                    :class="{ 'settings-field--wide': field.wide }"
                  >
                    <input
                      type="checkbox"
                      :checked="booleanValue(field.key)"
                      :disabled="!fieldEnabled(field)"
                      @change="onSwitch(field.key, $event)"
                    >
                    <span>
                      <strong>{{ field.label }}</strong>
                      <small>{{ field.help }}</small>
                      <small v-if="field.note" class="settings-note">{{ field.note }}</small>
                    </span>
                  </label>

                  <label
                    v-else
                    class="settings-field"
                    :class="{ 'settings-field--wide': field.wide }"
                  >
                    <span>{{ field.label }}</span>

                    <select
                      v-if="field.kind === 'select'"
                      :value="textValue(field.key)"
                      :disabled="!fieldEnabled(field)"
                      @change="onSelect(field.key, $event)"
                    >
                      <option v-for="option in field.options" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>

                    <span v-else-if="field.kind === 'number'" class="settings-number">
                      <input
                        type="number"
                        :value="numberValue(field.key)"
                        :min="field.min"
                        :max="field.max"
                        :disabled="!fieldEnabled(field)"
                        @input="onNumber(field.key, $event)"
                      >
                      <i>{{ field.unit }}</i>
                    </span>

                    <textarea
                      v-else-if="field.kind === 'textarea'"
                      :value="textValue(field.key)"
                      :rows="field.rows ?? 3"
                      :disabled="!fieldEnabled(field)"
                      spellcheck="false"
                      @input="onText(field.key, $event)"
                    />

                    <input
                      v-else
                      :type="field.kind === 'password' ? 'password' : 'text'"
                      :value="textValue(field.key)"
                      :disabled="!fieldEnabled(field)"
                      :autocomplete="field.kind === 'password' ? 'new-password' : 'off'"
                      @input="onText(field.key, $event)"
                    >

                    <small :class="{ 'is-error': issueFor(field.key) }">
                      {{ issueFor(field.key) ?? field.help }}
                    </small>
                    <small v-if="field.note" class="settings-note">{{ field.note }}</small>
                    <small v-if="fieldState(field.key)" class="settings-state">{{ fieldState(field.key) }}</small>
                  </label>
                </template>
              </div>
            </section>
          </div>

          <aside class="settings-save-panel glass-panel">
            <span class="eyebrow">PERSISTENCE</span>
            <h2>保存设置</h2>
            <p>
              本地覆盖只影响当前浏览器；保存到后端会提交全部 {{ THEME_SETTING_KEYS.length }} 项设置，
              并原样保留其它不认识的配置项。
            </p>

            <div v-if="theme.draftIssues.length" class="settings-save-alert is-error" role="alert">
              <strong>需要修正 {{ theme.draftIssues.length }} 项</strong>
              <span v-for="issue in theme.draftIssues" :key="issue.key">{{ issue.message }}</span>
            </div>

            <button class="settings-action settings-action--primary" type="button" :disabled="!theme.canSaveDraft" @click="theme.saveLocal">
              保存到此浏览器
            </button>
            <button class="settings-action" type="button" :disabled="theme.saveState === 'saving'" @click="theme.useBackend">
              使用后端配置
            </button>
            <button
              class="settings-action settings-action--backend"
              type="button"
              :disabled="!authorized || !primaryBase || !theme.canSaveDraft"
              @click="saveBackend"
            >
              {{ theme.saveState === 'saving' ? '正在保存…' : '保存到 CFSM 后端' }}
            </button>
            <p v-if="!authorized" class="settings-auth-note">
              当前未登录，后端保存已禁用。请使用 <a v-if="app.administrationUrl" :href="app.administrationUrl">CFSM 官方管理端</a><span v-else>CFSM 官方管理端</span>登录后再试。
            </p>
            <p v-else-if="app.config?.turnstileEnabled" class="settings-auth-note">
              站点开启了人机验证：保存时沿用当前的验证结果，验证失效时会提示重新验证，修改不会丢失。
            </p>

            <button class="settings-action settings-action--quiet" type="button" :disabled="copying" @click="copySnapshot">
              {{ copying ? '正在复制…' : '复制完整 JSON' }}
            </button>
            <button v-if="theme.hasDraftChanges" class="settings-action settings-action--quiet" type="button" @click="theme.resetDraft">
              放弃未保存预览
            </button>

            <details class="settings-json-preview">
              <summary>查看将保存的完整 JSON</summary>
              <pre>{{ snapshotJson }}</pre>
            </details>
          </aside>
        </form>
      </main>
    </div>
  </div>
</template>
