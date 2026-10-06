<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { daysUntilExpiry } from '@/domain/theme-presentation'
import {
  describeSkipped,
  describeSources,
  DISPLAY_CURRENCIES,
  formatFinanceAmount,
  isDisplayCurrency,
  RATE_SOURCE_LABELS,
  REFERENCE_RATES_ORIGIN,
  skipReasonLabel,
  summarizeFinance,
  type BillableNode,
  type CurrencyCode,
  type FinanceRow,
  type FinanceTotal,
  type RowAmount,
} from '@/domain/finance'
import { useFinanceStore } from '@/stores/finance'
import { detailExpireStatus, formatDisplayPrice, MISSING_TEXT } from '@/utils/format'

/**
 * 对齐 Komari `FinanceDetailsDialog`：顶部汇总、固定账单明细与汇率设置。
 *
 * - 固定费用列保留原币与付款周期；剩余价值、月均支出与合计按财务显示币种。
 * - 上游的「按量估算」页签与对应的汇总栏不在本次范围内，没有移植，也不留空壳。
 * - 算不出来的节点不按 0 计入合计，原因写在合计下方与单元格的 title 里。
 * - 手动汇率与内置参考汇率在汇率页单独列出，不冒充网络汇率。
 */
const props = defineProps<{
  nodes: readonly BillableNode[]
}>()

const open = defineModel<boolean>('open', { required: true })
const finance = useFinanceStore()
const activeTab = ref<'fixed' | 'rates'>('fixed')
const now = ref(Date.now())

watch(open, (value) => {
  if (value) now.value = Date.now()
}, { immediate: true })

const target = computed(() => finance.preferences.displayCurrency)
const summary = computed(() => summarizeFinance(props.nodes, {
  target: target.value,
  view: finance.view,
  excludeFree: finance.preferences.excludeFree,
  now: now.value,
}))

watch(() => summary.value.needsRates, (needed) => {
  if (needed) void finance.ensureRates()
}, { immediate: true })

function totalText(total: FinanceTotal): string {
  if (total.pending) return '载入中'
  if (total.counted === 0 && describeSkipped(total).length > 0) return '不可用'
  return formatFinanceAmount(total.amount, target.value)
}

/** 合计下方的说明：用到参考、旧缓存或手动汇率时先注明来源，再列出未计入的节点。 */
function summaryNotes(total: FinanceTotal): string[] {
  const sources = summary.value.sources
  const fresh = sources.every((source) => source === 'network' || source === 'cache')
  const described = describeSources(sources)
  const sourceNote = !fresh && described && total.counted > 0 && !total.pending ? [`汇率：${described}`] : []
  return [...sourceNote, ...describeSkipped(total)]
}

function amountText(value: RowAmount, freeText: string): string {
  if (value.status === 'free') return freeText
  if (value.status === 'ok') return formatFinanceAmount(value.amount, target.value)
  if (value.status === 'pending') return '载入中'
  return MISSING_TEXT
}

function amountTitle(value: RowAmount): string | undefined {
  if (value.status === 'none') return skipReasonLabel(value.reason)
  if (value.status !== 'ok') return undefined
  const stale = value.sources.filter((source) => source !== 'network' && source !== 'cache')
  return stale.length > 0 ? `汇率：${describeSources(value.sources) ?? ''}` : undefined
}

function priceText(row: FinanceRow): string {
  return formatDisplayPrice(row.node.price, row.node.currency, row.node.billingCycle)
}

function priceTitle(row: FinanceRow): string | undefined {
  if (row.price.status === 'unset') return '未设置价格'
  if (row.price.status === 'invalid') return '价格无法识别'
  if (row.price.status !== 'paid' || row.currency.status === 'known') return undefined
  const reason = row.currency.status === 'missing'
    ? 'currency-missing'
    : row.currency.status === 'ambiguous' ? 'currency-ambiguous' : 'currency-unknown'
  return `${skipReasonLabel(reason)}，不参与换算`
}

/** 对应上游 `expiryLabel`：未设置 / 已过期 / 长期 / N 天；日期写错时单独说明，不当作未设置。 */
function expiryText(row: FinanceRow): string {
  if (row.expiry.status === 'missing') return '未设置'
  if (row.expiry.status === 'invalid') return '日期无效'
  const days = daysUntilExpiry(row.node.expireDate, now.value)
  const status = detailExpireStatus(days)
  if (status === 'expired') return '已过期'
  if (status === 'long_term') return '长期'
  return days === null ? '未设置' : `${days} 天`
}

function rowKey(row: FinanceRow): string {
  return row.node.key
}

/* ===== 汇率页 ===== */

/** 显示币种沿用上游 12 种；节点实际用到的其它币种追加在后面，方便查看与手动覆盖。 */
const rateCurrencies = computed<CurrencyCode[]>(() => {
  const extra = new Set<CurrencyCode>()
  for (const row of summary.value.rows) {
    if (row.currency.status === 'known' && !isDisplayCurrency(row.currency.code)) extra.add(row.currency.code)
  }
  return [...DISPLAY_CURRENCIES, ...[...extra].sort()]
})

function rateValue(code: CurrencyCode): string {
  const rate = finance.view.rates[code]
  return rate === undefined ? '' : String(rate)
}

function updateRate(code: CurrencyCode, event: Event): void {
  if (!(event.target instanceof HTMLInputElement) || code === 'CNY') return
  const raw = event.target.value.trim()
  if (!raw) return
  finance.setOverride(code, Number(raw))
}

function updateCurrency(event: Event): void {
  if (event.target instanceof HTMLSelectElement) finance.setDisplayCurrency(event.target.value)
}

function updateExcludeFree(event: Event): void {
  if (event.target instanceof HTMLInputElement) finance.setExcludeFree(event.target.checked)
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

const sourceLine = computed(() => {
  const origin = finance.tableOrigin
  const label = origin === null ? '载入中' : RATE_SOURCE_LABELS[origin]
  const snapshot = finance.snapshot
  const updated = snapshot && origin !== 'reference' ? formatDateTime(snapshot.fetchedAt) : '无更新时间'
  return `${label} · ${updated} · 1 CNY 对应数值`
})

const sourceDetail = computed(() => {
  const origin = finance.tableOrigin
  if (origin === null) return ''
  const snapshot = finance.snapshot
  if (!snapshot || origin === 'reference') return `内置参考汇率取自 ${REFERENCE_RATES_ORIGIN}，不是当日汇率。`
  const date = snapshot.sourceDate
  const dateText = date === null
    ? ''
    : /^\d{4}-\d{2}-\d{2}$/.test(date) ? `，数据日期 ${date}` : `，数据更新于 ${formatDateTime(Date.parse(date))}`
  return `数据源 ${snapshot.provider}${dateText}。每日参考汇率，不是实时成交价。`
})

const rateNotes = computed(() => {
  const manual: string[] = []
  const reference: string[] = []
  for (const code of rateCurrencies.value) {
    const source = finance.view.sources[code]
    if (source === 'manual') manual.push(code)
    else if (source === 'reference' && finance.tableOrigin !== 'reference') reference.push(code)
  }
  const notes: string[] = []
  if (manual.length > 0) notes.push(`手动：${manual.join('、')}`)
  if (reference.length > 0) notes.push(`数据源未提供，使用内置参考汇率：${reference.join('、')}`)
  return notes.join('；')
})

/*
 * 「恢复今日汇率」只清除手动汇率；当前表不是今日取得的就不这么称呼它。
 * 没有手动汇率时按钮置灰：点下去本来就什么都不会变，不该看起来可点。
 */
const restoreLabel = computed(() => (finance.hasTodayTable ? '恢复今日汇率' : '清除手动汇率'))
</script>

<template>
  <AppDialog v-model:open="open" title="价值与费用明细" description="固定账单明细与汇率设置">
    <div class="finance-dialog">
      <div class="finance-dialog__summary">
        <div class="finance-dialog__metric">
          <div class="finance-dialog__metric-label">
            剩余价值
          </div>
          <div class="finance-dialog__metric-value">
            {{ totalText(summary.remaining) }}
          </div>
          <div v-for="note in summaryNotes(summary.remaining)" :key="note" class="finance-dialog__metric-note">
            {{ note }}
          </div>
        </div>
        <div class="finance-dialog__metric">
          <div class="finance-dialog__metric-label">
            固定月均支出
          </div>
          <div class="finance-dialog__metric-value">
            {{ totalText(summary.monthly) }}
          </div>
          <div v-for="note in summaryNotes(summary.monthly)" :key="note" class="finance-dialog__metric-note">
            {{ note }}
          </div>
        </div>
      </div>

      <TabsRoot v-model="activeTab" class="finance-dialog__tabs" activation-mode="automatic">
        <div class="finance-dialog__toolbar">
          <TabsList class="finance-dialog__tab-list" aria-label="财务明细">
            <TabsTrigger value="fixed" class="finance-dialog__tab">
              <AppIcon name="tabler:calendar-dollar" />固定账单
            </TabsTrigger>
            <TabsTrigger value="rates" class="finance-dialog__tab">
              <AppIcon name="tabler:currency-yuan" />汇率设置
            </TabsTrigger>
          </TabsList>
          <label class="finance-dialog__exclude">
            <input type="checkbox" :checked="finance.preferences.excludeFree" @change="updateExcludeFree">
            排除免费节点
          </label>
        </div>

        <TabsContent value="fixed" class="finance-dialog__panel">
          <div class="finance-dialog__panel-head">
            <div>
              <h3>固定账单明细</h3>
              <p>沿用 CFSM 后台填写的价格、周期和到期时间。</p>
            </div>
            <select class="finance-dialog__select" aria-label="显示币种" :value="target" @change="updateCurrency">
              <option v-for="item in DISPLAY_CURRENCIES" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
          </div>

          <div class="finance-dialog__table-wrap">
            <table class="finance-dialog__table">
              <thead>
                <tr>
                  <th>节点</th>
                  <th>固定费用</th>
                  <th>到期</th>
                  <th>剩余价值</th>
                  <th class="is-end">
                    月均支出
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in summary.rows" :key="rowKey(row)">
                  <td class="finance-dialog__name">
                    <div>{{ row.node.name }}</div>
                  </td>
                  <td :title="priceTitle(row)">
                    {{ priceText(row) }}
                  </td>
                  <td>{{ expiryText(row) }}</td>
                  <td :title="amountTitle(row.remaining)">
                    {{ amountText(row.remaining, '无') }}
                  </td>
                  <td class="is-end is-strong" :title="amountTitle(row.monthly)">
                    {{ amountText(row.monthly, formatFinanceAmount(0, target)) }}
                  </td>
                </tr>
                <tr v-if="summary.rows.length === 0">
                  <td colspan="5" class="finance-dialog__empty">
                    暂无账单节点
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="rates" class="finance-dialog__panel finance-dialog__panel--rates">
          <div class="finance-dialog__rates-head">
            <div class="finance-dialog__rates-title">
              <h3>汇率</h3>
              <p>{{ sourceLine }}</p>
              <p v-if="sourceDetail">
                {{ sourceDetail }}
              </p>
            </div>
            <select class="finance-dialog__select" aria-label="显示币种" :value="target" @change="updateCurrency">
              <option v-for="item in DISPLAY_CURRENCIES" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
            <button
              type="button"
              class="finance-dialog__outline-button"
              :disabled="!finance.hasOverrides"
              :title="finance.hasOverrides ? undefined : '当前没有手动汇率'"
              @click="finance.clearOverrides()"
            >
              <AppIcon name="tabler:refresh" :size="14" />{{ restoreLabel }}
            </button>
          </div>

          <div class="finance-dialog__rate-grid">
            <label v-for="code in rateCurrencies" :key="code" class="finance-dialog__rate">
              <span>{{ code }}</span>
              <input
                type="number"
                min="0"
                step="any"
                class="finance-dialog__rate-input"
                :disabled="code === 'CNY'"
                :value="rateValue(code)"
                :aria-label="`${code} 汇率`"
                @input="updateRate(code, $event)"
              >
            </label>
          </div>
          <p v-if="rateNotes" class="finance-dialog__rate-note">
            {{ rateNotes }}
          </p>
        </TabsContent>
      </TabsRoot>
    </div>
  </AppDialog>
</template>
