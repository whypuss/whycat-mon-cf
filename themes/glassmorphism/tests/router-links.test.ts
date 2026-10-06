import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasMultipleSources, serverDetailLocation } from '@/router/links'

describe('详情页链接生成', () => {
  it('单后端不写 source，链接就是 /#/server/<id>', () => {
    expect(serverDetailLocation('node-1', 'https://a.example', false)).toEqual({
      name: 'server-detail',
      params: { id: 'node-1' },
    })
  })

  it('多来源仍然带上该节点的 owning source', () => {
    expect(serverDetailLocation('node-1', 'https://b.example', true)).toEqual({
      name: 'server-detail',
      params: { id: 'node-1' },
      query: { source: 'https://b.example' },
    })
  })

  it('只有配置了多个 apiBase 才算多来源', () => {
    expect(hasMultipleSources([])).toBe(false)
    expect(hasMultipleSources(['https://a.example'])).toBe(false)
    expect(hasMultipleSources(['https://a.example', 'https://b.example'])).toBe(true)
  })
})

describe('两个链接入口统一走生成器', () => {
  const home = readFileSync(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('../src/views/ServerDetailView.vue', import.meta.url), 'utf8')

  it('首页与详情页的上一台 / 下一台都不再内联拼 source', () => {
    for (const source of [home, detail]) {
      expect(source).toContain("from '@/router/links'")
      expect(source).toContain('serverDetailLocation(')
      expect(source).not.toContain('query: { source:')
    }
  })

  it('单后端时读取端忽略 source，剥离参数不会重复加载', () => {
    expect(detail).toContain("typeof source === 'string' && multiSource.value ? source : undefined")
  })

  it('旧链接用 replace 规范化，并保留其余查询参数', () => {
    expect(detail).toContain('void router.replace({ name: \'server-detail\'')
    expect(detail).toContain('const query = { ...route.query }')
    expect(detail).toContain('delete query.source')
  })
})
