import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ICONS } from '@/constants/icons'
import { resolveNodeProvider, resolveProviderInfo } from '@/domain/provider'
import { mergeRealtimeSample, normalizeServer } from '@/services/cfsm/adapters'
import { providerAsnFromTag, providerOrgFromTag, splitProviderTags } from '@/services/cfsm/provider-tags'

const providerSource = readFileSync(new URL('../src/domain/provider.ts', import.meta.url), 'utf8')
const tagSource = readFileSync(new URL('../src/services/cfsm/provider-tags.ts', import.meta.url), 'utf8')
const source = { base: 'https://status.example', label: 'status.example' }

/** CFSM `handlers/admin.js` 保存标签时的清洗规则，逐字照抄。 */
function cfsmSanitize(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 32))
    .filter(Boolean)
    .slice(0, 12)
}

describe('厂商标签约定', () => {
  it('识别 ASN 的各种写法，统一成 AS 前缀', () => {
    for (const tag of ['AS3258', 'as3258', 'asn AS3258', 'asn-AS3258', 'asn_3258', 'asnAS3258', 'ASN3258', 'asn:AS3258', 'asn：3258']) {
      expect(providerAsnFromTag(tag), tag).toBe('AS3258')
    }
  })

  it('裸写的 AS 号至少 3 位，避免把 AS1 这类可用区简写当成 ASN', () => {
    expect(providerAsnFromTag('AS1')).toBeNull()
    expect(providerAsnFromTag('AS12')).toBeNull()
    expect(providerAsnFromTag('AS123')).toBe('AS123')
    expect(providerAsnFromTag('ASIA')).toBeNull()
  })

  it('识别带分隔符的组织名，不识别无分隔符的形式', () => {
    expect(providerOrgFromTag('org xTom Japan Corporation')).toBe('xTom Japan Corporation')
    expect(providerOrgFromTag('org-xTom')).toBe('xTom')
    expect(providerOrgFromTag('org_xTom')).toBe('xTom')
    expect(providerOrgFromTag('ORG:xTom')).toBe('xTom')
    expect(providerOrgFromTag('orgxTom')).toBeNull()
    expect(providerOrgFromTag('organic')).toBeNull()
    expect(providerOrgFromTag('org')).toBeNull()
    expect(providerOrgFromTag('org-')).toBeNull()
  })

  it('约定标签从普通标签里拿走，其余标签保持原顺序，同类取第一个', () => {
    expect(splitProviderTags(['生产', 'AS3258', 'org xTom', '高可用', 'AS20473', 'org Other'])).toEqual({
      tags: ['生产', '高可用'],
      providerTags: { asn: 'AS3258', org: 'xTom' },
    })
  })

  it('经过 CFSM 保存清洗后仍然成立：冒号被删掉时 ASN 仍可识别，组织名要用空格或连字符', () => {
    const saved = cfsmSanitize('asn:AS3258,org:xTom Japan,org xTom Japan')
    expect(saved).toEqual(['asnAS3258', 'orgxTom Japan', 'org xTom Japan'])
    expect(splitProviderTags(saved)).toEqual({
      tags: ['orgxTom Japan'],
      providerTags: { asn: 'AS3258', org: 'xTom Japan' },
    })
  })

  it('适配层把约定标签拆出来，实时推送带 tags 时一并更新', () => {
    const server = normalizeServer({ id: 'node', tags: '生产,AS3258,org xTom Japan Corporation' }, source)
    expect(server.tags).toEqual(['生产'])
    expect(server.providerTags).toEqual({ asn: 'AS3258', org: 'xTom Japan Corporation' })
    const next = mergeRealtimeSample(server, { serverId: 'node', timestamp: 1, data: { tags: 'AS20473' } })
    expect(next.tags).toEqual([])
    expect(next.providerTags).toEqual({ asn: 'AS20473', org: null })
  })
})

describe('厂商识别与上游 providerInfo 一致', () => {
  it('节点名里的关键词识别为商家', () => {
    const result = resolveProviderInfo({ metadata: 'V.PS 东京' })
    expect(result).toMatchObject({ displayName: 'V.PS (xTom)', seller: { source: 'metadata', matched: 'v.ps' } })
    expect(result?.tooltipLines).toEqual(['商家：V.PS (xTom)', '来源：节点名称 / 分组 / 地区 / 标签（v.ps）'])
  })

  it('ASN 命中上游 ASN 库时识别为网络', () => {
    const result = resolveProviderInfo({ asn: 'AS20473' })
    expect(result).toMatchObject({ displayName: 'Vultr (Choopa)', network: { source: 'asn' } })
    expect(result?.tooltipLines).toEqual(['网络：Vultr (Choopa)', 'ASN：AS20473'])
  })

  it('商家与网络不同时并列显示', () => {
    expect(resolveProviderInfo({ metadata: 'DMIT HK', asn: 'AS20473' })?.displayName).toBe('DMIT / Vultr (Choopa)')
  })

  it('组织名不在库里时按原文作为网络显示', () => {
    expect(resolveProviderInfo({ org: '绿云' })).toMatchObject({ displayName: '绿云', primary: { icon: 'tabler:server' } })
  })

  it('支持上游 providerAliases 格式的自定义别名', () => {
    expect(resolveProviderInfo({ metadata: '绿云 JP 01', customAliases: '绿云:greencloud' }))
      .toMatchObject({ displayName: '绿云', seller: { source: 'custom-alias' } })
  })

  it('什么都识别不到时返回 null', () => {
    expect(resolveProviderInfo({ metadata: 'Node A' })).toBeNull()
  })
})

describe('详情页厂商格与顶栏标识', () => {
  function node(overrides: Record<string, unknown>) {
    return normalizeServer({ id: 'node', ...overrides }, source)
  }

  it('厂商格是「厂商 · ASN」，tooltip 注明来自标签、没有做 IP 查询', () => {
    const view = resolveNodeProvider(node({ name: 'V.PS 东京', tags: 'AS3258,org xTom Japan Corporation' }))
    expect(view.display).toBe('V.PS (xTom) · AS3258')
    expect(view.tooltip.split('\n')).toEqual([
      '商家：V.PS (xTom)',
      '来源：节点名称 / 分组 / 地区 / 标签（v.ps）',
      'ASN：AS3258',
      'Org：xTom Japan Corporation',
      'ASN / Org 取自节点标签，未做 IP 查询',
    ])
  })

  it('没有任何线索时和上游一样显示 -', () => {
    expect(resolveNodeProvider(node({ name: 'Node A' })))
      .toMatchObject({ provider: null, display: '-', icon: 'icon-park-outline:server', tooltip: '' })
  })

  it('只有未收录的 ASN 时，厂商格仍显示运营者写下的 ASN', () => {
    const view = resolveNodeProvider(node({ name: 'Node A', tags: 'AS3258' }))
    expect(view.provider).toBeNull()
    expect(view.display).toBe('AS3258')
  })

  it('只读运营者自己填写的文本：没有网络请求，也不碰 IP 字段', () => {
    for (const code of [providerSource, tagSource]) {
      expect(code).not.toMatch(/\bfetch\s*\(/)
      expect(code).not.toMatch(/ip_v4|ipV4|ipv4|ip_v6|ipV6/)
    }
  })

  it('厂商图标全部在构建期内联的图标表里', () => {
    const icons = [...providerSource.matchAll(/'((?:simple-icons|tabler|icon-park-outline):[a-z0-9-]+)'/g)]
      .map((match) => match[1] as string)
    expect(icons.length).toBeGreaterThan(10)
    for (const icon of icons) expect(Object.keys(ICONS), icon).toContain(icon)
  })
})
