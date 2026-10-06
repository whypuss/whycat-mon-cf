<script setup lang="ts">
import { computed } from 'vue'
import { parseAnnouncementMarkdown, safeMarkdownUrl } from '@/domain/announcement-markdown'

/**
 * 对齐 Komari `MarkdownRenderer`：公告正文的受限 Markdown。
 * 解析与地址白名单在 `domain/announcement-markdown.ts`；这里只按记号渲染，
 * 不使用 `v-html`。元素与上游一一对应，样式类见 `main.css` 的 `.markdown-content`。
 */
const props = defineProps<{
  content: string
}>()

const tokens = computed(() => parseAnnouncementMarkdown(props.content))
</script>

<template>
  <span class="markdown-content">
    <template v-for="(token, index) in tokens" :key="index">
      <img
        v-if="token.type === 'image'"
        class="markdown-content__image"
        :src="safeMarkdownUrl(token.url, 'image')"
        :alt="token.alt"
        loading="lazy"
      >
      <a
        v-else-if="token.type === 'link'"
        class="markdown-content__link"
        :href="safeMarkdownUrl(token.url, 'link')"
        target="_blank"
        rel="noopener noreferrer"
      >{{ token.content }}</a>
      <strong v-else-if="token.type === 'bold'">{{ token.content }}</strong>
      <em v-else-if="token.type === 'italic'">{{ token.content }}</em>
      <code v-else-if="token.type === 'code'" class="markdown-content__code">{{ token.content }}</code>
      <br v-else-if="token.type === 'br'">
      <span v-else-if="token.type === 'text'">{{ token.content }}</span>
    </template>
  </span>
</template>
