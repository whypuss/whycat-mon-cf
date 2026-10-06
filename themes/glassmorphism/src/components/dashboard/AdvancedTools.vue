<script setup lang="ts">
import { computed, ref } from 'vue'
import AppTabs from '@/components/ui/AppTabs.vue'
import {
  buildHealthSummary,
  buildSnapshot,
  buildSnapshotCsv,
  buildTopology,
  buildValueGroups,
  type HealthTone,
} from '@/domain/advanced-tools'
import { parseBillingPrice } from '@/domain/finance'
import type { ThemeSettings } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'
import { MISSING_TEXT } from '@/utils/format'

type ToolKey = 'health' | 'value' | 'snapshot' | 'topology'

const props = defineProps<{
  servers: GlassServer[]
  settings: ThemeSettings
  siteTitle: string
}>()

const emit = defineEmits<{
  select: [server: GlassServer]
}>()

const activeTool = ref<ToolKey>('health')
const password = ref('')
const exportError = ref<string | null>(null)
const health = computed(() => buildHealthSummary(props.servers, props.settings))
const valueGroups = computed(() => buildValueGroups(props.servers))
const topology = computed(() => buildTopology(props.servers))
const healthCounts = computed(() => health.value.reduce<Record<HealthTone, number>>((counts, item) => {
  counts[item.tone] += 1
  return counts
}, { healthy: 0, warning: 0, critical: 0, unknown: 0 }))
const historyNodeCount = computed(() => health.value.filter((item) => item.historySamples > 0).length)
// 只有 CFSM 的免费值（0 / -1）才算免费；未填写价格（`Number('')` 也是 0）不算。
const freeNodeCount = computed(() => props.servers.filter((server) => (
  parseBillingPrice(server.price).status === 'free'
)).length)

const tools: ReadonlyArray<{ key: ToolKey, label: string, hint: string }> = [
  { key: 'health', label: '健康摘要', hint: '真实指标规则' },
  { key: 'value', label: '性价比', hint: '分币种排行' },
  { key: 'snapshot', label: '快照导出', hint: '当前已加载数据' },
  { key: 'topology', label: '拓扑', hint: '地区与分组' },
]
const toolTabs = tools.map((tool) => ({ value: tool.key, label: tool.label, hint: tool.hint }))
const healthTones: readonly HealthTone[] = ['healthy', 'warning', 'critical', 'unknown']

function toneLabel(tone: HealthTone): string {
  return { healthy: '健康', warning: '关注', critical: '严重', unknown: '数据不足' }[tone]
}

function numberLabel(value: number | null, digits = 1): string {
  return value === null ? MISSING_TEXT : value.toFixed(digits)
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportSnapshot(format: 'json' | 'csv'): void {
  exportError.value = null
  if (props.settings.exportSecondaryPassword && password.value !== props.settings.exportSecondaryPassword) {
    exportError.value = '二级确认密码不匹配，未创建文件。'
    return
  }
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  if (format === 'json') {
    download(`cfsm-snapshot-${timestamp}.json`, JSON.stringify(buildSnapshot(props.servers, props.siteTitle), null, 2), 'application/json;charset=utf-8')
  } else {
    download(`cfsm-snapshot-${timestamp}.csv`, buildSnapshotCsv(props.servers), 'text/csv;charset=utf-8')
  }
  password.value = ''
}
</script>

<template>
  <section class="advanced-tools glass-panel">
    <header class="advanced-tools__header">
      <div>
        <span class="eyebrow">ADVANCED OPERATIONS</span>
        <h2>高级工具</h2>
        <p>只处理当前页面已取得的 CFSM 真实数据，不调用额外管理接口。</p>
      </div>
      <span class="advanced-tools__badge">{{ servers.length }} NODES</span>
    </header>

    <AppTabs
      v-model="activeTool"
      class="advanced-tools__tabs"
      list-label="高级工具"
      :items="toolTabs"
    />

    <div v-if="activeTool === 'health'" class="tool-panel" role="tabpanel">
      <div class="health-summary">
        <article class="health-summary__lead">
          <span>真实历史覆盖</span>
          <strong>{{ historyNodeCount }}/{{ servers.length }}</strong>
          <small>来自 /api/servers 的真实 Ping/Loss 窗口；未拉取逐节点 History。</small>
        </article>
        <article v-for="tone in healthTones" :key="tone" :class="`health-tone--${tone}`">
          <span>{{ toneLabel(tone) }}</span>
          <strong>{{ healthCounts[tone] }}</strong>
        </article>
      </div>
      <div v-if="health.length" class="health-list">
        <button v-for="item in health" :key="item.server.key" type="button" @click="emit('select', item.server)">
          <span class="health-list__name"><i :class="`health-tone--${item.tone}`" />{{ item.server.name }}</span>
          <span class="health-list__issues">
            {{ item.issues.slice(0, 2).map((issue) => issue.message).join(' · ') || (item.tone === 'unknown' ? '没有足够指标形成判断' : '可用指标未触发阈值') }}
          </span>
          <strong>{{ item.score === null ? MISSING_TEXT : item.score }}</strong>
          <small>{{ item.evaluatedSignals }} 项 · {{ item.historySamples }} 历史样本</small>
        </button>
      </div>
      <p v-else class="tool-empty">
        暂无节点，不能生成健康摘要。
      </p>
    </div>

    <div v-else-if="activeTool === 'value'" class="tool-panel" role="tabpanel">
      <div class="tool-boundary-note">
        <strong>币种严格分组，不做汇率换算</strong>
        <span>得分 =（CPU×4 + RAM GiB×2 + Disk GiB÷25 + 配额 TiB×8）÷月均费用，仅作同币种相对比较。{{ freeNodeCount }} 个免费节点单独排除。</span>
      </div>
      <div v-if="valueGroups.length" class="value-groups">
        <section v-for="group in valueGroups" :key="group.currency">
          <header><strong>{{ group.currency }}</strong><span>{{ group.rows.length }} 个可比较节点</span></header>
          <button v-for="(row, index) in group.rows" :key="row.server.key" type="button" @click="emit('select', row.server)">
            <b>{{ index + 1 }}</b>
            <span><strong>{{ row.server.name }}</strong><small>CPU {{ numberLabel(row.resources.cpuCores, 0) }} · RAM {{ numberLabel(row.resources.memoryGiB) }} GiB · Disk {{ numberLabel(row.resources.diskGiB) }} GiB · 配额 {{ numberLabel(row.resources.trafficTiB, 2) }} TiB</small></span>
            <span><strong>{{ row.monthlyCost.toFixed(2) }}/月</strong><small>{{ row.coverage }}/4 资源字段</small></span>
            <em>{{ row.score.toFixed(2) }}</em>
          </button>
        </section>
      </div>
      <p v-else class="tool-empty">
        没有同时具备有效正价格、可识别账期和资源字段的节点。
      </p>
    </div>

    <div v-else-if="activeTool === 'snapshot'" class="tool-panel snapshot-panel" role="tabpanel">
      <div>
        <span class="snapshot-panel__icon" aria-hidden="true">↓</span>
        <h3>导出当前数据快照</h3>
        <p>JSON 保留全部字段，延迟与丢包区分数值、超时与未配置；CSV 提供常用指标。内容取自页面已加载的数据，不会额外读取隐藏节点或管理数据。</p>
      </div>
      <label v-if="settings.exportSecondaryPassword" class="snapshot-password">
        <span>二级确认密码</span>
        <input v-model="password" type="password" autocomplete="off" @input="exportError = null">
        <small>这是浏览器端确认步骤，不替代 CFSM 登录与权限边界。</small>
      </label>
      <div class="snapshot-actions">
        <button type="button" @click="exportSnapshot('json')">
          导出 JSON
        </button>
        <button type="button" @click="exportSnapshot('csv')">
          导出 CSV
        </button>
      </div>
      <span v-if="exportError" class="snapshot-error" role="alert">{{ exportError }}</span>
    </div>

    <div v-else class="tool-panel" role="tabpanel">
      <div class="tool-boundary-note">
        <strong>分类拓扑，不是网络链路图</strong>
        <span>只使用 region、server_group 与 tags；不展示或推断 IP、ASN、Provider、BGP 或上游关系。</span>
      </div>
      <div v-if="topology.length" class="topology-grid">
        <section v-for="region in topology" :key="region.region">
          <header><span>REGION</span><strong>{{ region.region }}</strong></header>
          <article v-for="group in region.groups" :key="group.group">
            <div><span>GROUP</span><strong>{{ group.group }}</strong><small>{{ group.servers.length }} 节点</small></div>
            <button v-for="server in group.servers" :key="server.key" type="button" @click="emit('select', server)">
              <i :class="{ 'is-offline': !server.online }" />
              <span><strong>{{ server.name }}</strong><small>{{ server.tags.join(' · ') || '无标签' }}</small></span>
            </button>
          </article>
        </section>
      </div>
      <p v-else class="tool-empty">
        暂无节点，不能生成分类拓扑。
      </p>
    </div>

    <footer class="advanced-tools__boundary">
      Audit Log 已隐藏：CFSM 第三方主题 API 不提供审计日志，未调用管理端私有接口。
    </footer>
  </section>
</template>
