import type { ProviderTags } from '@/types/cfsm'

/*
 * 厂商 / ASN 的标签约定。
 *
 * CFSM 没有厂商字段；作者的意见是不为此新增数据库列，由运营者写进 tags。
 * 约定必须能在 CFSM 保存标签时的清洗之后存活——`handlers/admin.js` 按英文逗号
 * 拆分，再用 `[^\p{L}\p{N} ._\-]` 删掉其它字符，单项截到 32 字符，最多 12 项：
 *
 *   ASN   `AS3258`，或带前缀 `asn AS3258` / `asn-AS3258` / `asn_3258`。
 *         冒号会被 CFSM 删掉，所以 `asn:AS3258` 实际存成 `asnAS3258`，两者都识别。
 *   组织  `org xTom Japan Corporation` / `org-xTom` / `org_xTom`。
 *         `org:xTom` 同样会被存成 `orgxTom`，它与 `organic` 这类普通标签无法区分，
 *         因此**不**识别无分隔符的形式；作者若放开冒号，`org:xTom` 可直接识别。
 *
 * 裸写的 `AS` 号要求至少 3 位数字，避免把 `AS1` 这类可用区简写当成 ASN。
 * 同一类标签写了多个时取第一个。识别出的标签只用于厂商展示，
 * 不再作为普通标签渲染。这里只解析运营者自己写下的文本：不查 IP、不查任何外部库。
 */
const ASN_PREFIXED = /^asn[\s:：_-]*(?:as)?(\d{1,10})$/i
const ASN_BARE = /^as(\d{3,10})$/i
const ORG_PREFIXED = /^org[\s:：_-]+(.+)$/i

export function providerAsnFromTag(tag: string): string | null {
  const value = tag.trim()
  const digits = (ASN_PREFIXED.exec(value) ?? ASN_BARE.exec(value))?.[1]
  return digits ? `AS${digits}` : null
}

export function providerOrgFromTag(tag: string): string | null {
  const org = ORG_PREFIXED.exec(tag.trim())?.[1]?.trim()
  return org ? org : null
}

export interface ProviderTagSplit {
  tags: string[]
  providerTags: ProviderTags
}

export function splitProviderTags(tags: readonly string[]): ProviderTagSplit {
  let asn: string | null = null
  let org: string | null = null
  const rest: string[] = []
  for (const tag of tags) {
    const tagAsn = providerAsnFromTag(tag)
    if (tagAsn !== null) {
      asn ??= tagAsn
      continue
    }
    const tagOrg = providerOrgFromTag(tag)
    if (tagOrg !== null) {
      org ??= tagOrg
      continue
    }
    rest.push(tag)
  }
  return { tags: rest, providerTags: { asn, org } }
}
