<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTooltip from '@/components/ui/AppTooltip.vue'
import type { BillableNode } from '@/domain/finance'
import {
  buildGeneralCards,
  type GeneralFinanceContext,
  type PresentationCard,
} from '@/domain/theme-presentation'
import type { ThemeSettings } from '@/theme/settings'
import type { GlassServer } from '@/types/glassmorphism'

/**
 * 对齐 Komari `NodeGeneralCards` 的总览卡片。
 *
 * Komari 的总览区没有独立标题块，卡片本身就是 12 栅格中的 `col-span-4` 单元：
 * 标签在左上、图标在右上（淡色、hover 变深），数值与单位基线对齐放在卡片底部。
 * 这里保持同一 DOM 层级与视觉treatment，只把数据源换成 CFSM 的 normalized model。
 *
 * 数值行是上游的两段式：主数值大字 + 单位小字（`GB / 62 GB`、`/ 10`、`%`、`台`），
 * 说明文字放进 tooltip（上游 `DataTooltip`），不占单位那一栏，
 * 否则手机端会被「接收 + 发送」这类长文本挤成省略号。
 *
 * 剩余价值卡与上游一样可以点开「价值与费用明细」（按键 Enter / 空格同样有效）；
 * 价格被遮蔽时卡片不带这个动作。明细弹窗按需异步加载。
 *
 * 模板有两个根节点（栅格与弹窗），调用点写的 class 必须显式落到栅格上，
 * 否则 Vue 会静默丢弃（第 16 轮在 AppTooltip 上踩过同样的坑）。
 */
defineOptions({ inheritAttrs: false })

const FinanceDetailsDialog = defineAsyncComponent(() => import('@/components/finance/FinanceDetailsDialog.vue'))

const props = defineProps<{
  servers: GlassServer[]
  settings: ThemeSettings
  finance?: GeneralFinanceContext
  /** 明细弹窗使用的节点：只含价格对访客可见的节点。 */
  financeNodes?: readonly BillableNode[]
}>()

const cards = computed(() => buildGeneralCards(props.servers, props.settings, Date.now(), props.finance))
const financeDetailsOpen = ref(false)

function activate(card: PresentationCard): void {
  if (card.action === 'financeDetails') financeDetailsOpen.value = true
}

function onKeydown(event: KeyboardEvent, card: PresentationCard): void {
  if (!card.action || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  activate(card)
}
</script>

<template>
  <div class="overview-grid" role="group" aria-label="节点总览" v-bind="$attrs">
    <article
      v-for="card in cards"
      :key="card.key"
      class="overview-card"
      :class="{ 'is-actionable': card.action }"
      :data-general-card-key="card.key"
      :role="card.action ? 'button' : undefined"
      :tabindex="card.action ? 0 : undefined"
      :aria-label="card.action ? `查看${card.label}明细` : undefined"
      @click="activate(card)"
      @keydown="onKeydown($event, card)"
    >
      <div class="overview-card__head">
        <span class="overview-card__label">{{ card.label }}</span>
        <AppIcon class="overview-card__icon" :name="card.icon" :size="20" />
      </div>
      <AppTooltip
        v-if="card.hint"
        :content="card.hint"
        placement="top"
        as="div"
        class="overview-card__value-slot"
      >
        <div class="overview-card__value">
          <span class="overview-card__number">{{ card.value }}</span>
          <span v-if="card.unit" class="overview-card__unit">{{ card.unit }}</span>
        </div>
      </AppTooltip>
      <div v-else class="overview-card__value">
        <span class="overview-card__number">{{ card.value }}</span>
        <span v-if="card.unit" class="overview-card__unit">{{ card.unit }}</span>
      </div>
    </article>
  </div>
  <FinanceDetailsDialog
    v-if="financeDetailsOpen"
    v-model:open="financeDetailsOpen"
    :nodes="financeNodes ?? []"
  />
</template>
