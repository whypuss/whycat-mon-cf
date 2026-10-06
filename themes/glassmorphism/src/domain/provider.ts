import type { IconName } from '@/constants/icons'
import type { ProviderTags } from '@/types/cfsm'

/*
 * 厂商识别，逐段移植自 Komari Glassmorphism `utils/providerInfo.ts`（bf83765）：
 * 关键词库、ASN 库、文本归一化、自定义别名格式、商家 / 网络的合并规则与
 * tooltip 行都与上游一致。
 *
 * 与上游只有输入来源不同：上游的 `asn` / `org` 来自登录后的 IP Geo 查询，
 * CFSM 不公开 IP，本主题也不做任何 IP / ASN 查询，这两项只取自运营者写的
 * 约定标签（`services/cfsm/provider-tags.ts`）。关键词匹配只读节点名称、
 * 分组、地区与普通标签这些运营者自己填写的文本。
 */

export interface ProviderInfo {
  name: string
  icon: IconName
}

export type ProviderMatchSource = 'custom-alias' | 'metadata' | 'asn' | 'org' | 'fallback-org'

export interface ProviderMatch extends ProviderInfo {
  source: ProviderMatchSource
  matched?: string
}

export interface ProviderResolveResult {
  primary: ProviderInfo
  seller?: ProviderMatch
  network?: ProviderMatch
  displayName: string
  tooltipLines: string[]
}

interface ProviderEntry extends ProviderInfo {
  keywords: string[]
}

export interface ProviderResolveInput {
  metadata?: string
  org?: string
  asn?: string
  customAliases?: string
}

const COMPANY_SUFFIX_REGEX = /\b(?:llc|ltd|limited|inc|incorporated|gmbh|sas|bv|bhd|co|corp|corporation|company|pte|plc|sa|srl|sro|oy|ab|ag|kg|pte\s*ltd|co\s*ltd)\b/g
const ASN_PREFIX_REGEX = /^AS\d+\s*/i
const NON_ALNUM_REGEX = /[^a-z0-9\p{Script=Han}]+/gu
const SPACE_REGEX = /\s+/g
const ASN_DIGITS_REGEX = /\d+/
const CUSTOM_ALIAS_GROUP_SEPARATOR_REGEX = /[;\n]+/

const SERVER_ICON: IconName = 'tabler:server'

/*
 * 上游 Akamai (Linode) 用的是 `simple-icons:linode`，Iconify 的 simple-icons 集里
 * 并没有这个图标（上游运行时请求会落空，图标位留白）。本主题图标在构建期内联，
 * 不能引用不存在的名字，这一项退回与其它无品牌图标的厂商相同的服务器图标。
 * 上游的 `simple-icons:amazonaws` / `simple-icons:tencentqq` 在 Iconify 里只是别名，
 * 运行时由 API 解析到 `amazonwebservices` / `qq`；内联表只收实体图标，这里直接写解析后的名字，
 * 画出来的是同一个图标。
 */
const PROVIDER_DB: ProviderEntry[] = [
  { keywords: ['vultr', 'choopa', 'constant'], name: 'Vultr', icon: 'simple-icons:vultr' },
  { keywords: ['linode', 'akamai'], name: 'Akamai (Linode)', icon: SERVER_ICON },
  { keywords: ['digitalocean', 'digital ocean'], name: 'DigitalOcean', icon: 'simple-icons:digitalocean' },
  { keywords: ['amazon', 'aws', 'amazon web services'], name: 'Amazon AWS', icon: 'simple-icons:amazonwebservices' },
  { keywords: ['google cloud', 'google', 'gcp'], name: 'Google Cloud', icon: 'simple-icons:googlecloud' },
  { keywords: ['microsoft', 'azure'], name: 'Microsoft Azure', icon: 'simple-icons:microsoftazure' },
  { keywords: ['cloudflare'], name: 'Cloudflare', icon: 'simple-icons:cloudflare' },
  { keywords: ['hetzner'], name: 'Hetzner', icon: 'simple-icons:hetzner' },
  { keywords: ['ovh', 'ovhcloud'], name: 'OVHcloud', icon: 'simple-icons:ovh' },
  { keywords: ['contabo'], name: 'Contabo', icon: SERVER_ICON },
  { keywords: ['oracle'], name: 'Oracle Cloud', icon: 'simple-icons:oracle' },
  { keywords: ['ibm', 'softlayer'], name: 'IBM Cloud', icon: 'simple-icons:ibmcloud' },
  { keywords: ['scaleway', 'iliad', 'online sas'], name: 'Scaleway', icon: 'simple-icons:scaleway' },
  { keywords: ['tencent', 'qcloud', '腾讯云'], name: '腾讯云', icon: 'simple-icons:qq' },
  { keywords: ['alibaba', 'aliyun', '阿里云'], name: '阿里云', icon: 'simple-icons:alibabacloud' },
  { keywords: ['huawei', '华为云'], name: '华为云', icon: 'simple-icons:huawei' },
  { keywords: ['china mobile', 'cmi'], name: 'China Mobile (CMI)', icon: SERVER_ICON },
  { keywords: ['china unicom', 'unicom', 'cuii'], name: 'China Unicom', icon: SERVER_ICON },
  { keywords: ['china telecom', 'chinanet', 'ctg'], name: 'China Telecom', icon: SERVER_ICON },

  { keywords: ['racknerd', 'rack nerd'], name: 'RackNerd', icon: SERVER_ICON },
  { keywords: ['greencloud', 'green cloud', 'greencloudvps'], name: 'GreenCloudVPS', icon: SERVER_ICON },
  { keywords: ['hosthatch', 'host hatch'], name: 'HostHatch', icon: SERVER_ICON },
  { keywords: ['hostdare', 'host dare'], name: 'HostDare', icon: SERVER_ICON },
  { keywords: ['virmach', 'vir mach'], name: 'VirMach', icon: SERVER_ICON },
  { keywords: ['servarica'], name: 'Servarica', icon: SERVER_ICON },
  { keywords: ['bytevirt', 'byte virt'], name: 'ByteVirt', icon: SERVER_ICON },
  { keywords: ['spartanhost', 'spartan host'], name: 'SpartanHost', icon: SERVER_ICON },
  { keywords: ['lightnode', 'light node'], name: 'LightNode', icon: SERVER_ICON },
  { keywords: ['netcup'], name: 'Netcup', icon: SERVER_ICON },
  { keywords: ['time4vps', 'time 4 vps'], name: 'Time4VPS', icon: SERVER_ICON },
  { keywords: ['aeza'], name: 'Aeza', icon: SERVER_ICON },
  { keywords: ['pq.hosting', 'pqhosting', 'pq hosting'], name: 'PQ.Hosting', icon: SERVER_ICON },
  { keywords: ['xtom', 'x tom', 'v.ps', 'vps.hosting'], name: 'V.PS (xTom)', icon: SERVER_ICON },
  { keywords: ['dmit'], name: 'DMIT', icon: SERVER_ICON },
  { keywords: ['akile'], name: 'Akile', icon: SERVER_ICON },
  { keywords: ['misaka'], name: 'Misaka', icon: SERVER_ICON },
  { keywords: ['cloudie'], name: 'Cloudie', icon: SERVER_ICON },
  { keywords: ['gigsgigscloud', 'gigsgigs', 'gigs gigs cloud'], name: 'GigsGigsCloud', icon: SERVER_ICON },
  { keywords: ['evolution host', 'evolutionhost'], name: 'Evolution Host', icon: SERVER_ICON },
  { keywords: ['nexusbytes', 'nexus bytes'], name: 'NexusBytes', icon: SERVER_ICON },
  { keywords: ['hostslick', 'host slick'], name: 'HostSlick', icon: SERVER_ICON },
  { keywords: ['frantech', 'buyvm', 'buy vm'], name: 'BuyVM', icon: SERVER_ICON },
  { keywords: ['bandwagonhost', 'bandwagon host', 'it7'], name: 'BandwagonHost', icon: SERVER_ICON },
  { keywords: ['colocrossing', 'colo crossing'], name: 'ColoCrossing', icon: SERVER_ICON },
  { keywords: ['path.net', 'pathnet'], name: 'Path.net', icon: SERVER_ICON },
  { keywords: ['alice networks', 'alice'], name: 'Alice Networks', icon: SERVER_ICON },
  { keywords: ['psychz'], name: 'Psychz Networks', icon: SERVER_ICON },
  { keywords: ['m247'], name: 'M247', icon: SERVER_ICON },
  { keywords: ['zenlayer'], name: 'Zenlayer', icon: SERVER_ICON },
  { keywords: ['leaseweb'], name: 'Leaseweb', icon: SERVER_ICON },
  { keywords: ['g-core', 'gcore'], name: 'Gcore', icon: SERVER_ICON },
  { keywords: ['kamatera'], name: 'Kamatera', icon: SERVER_ICON },
  { keywords: ['clouvider'], name: 'Clouvider', icon: SERVER_ICON },
  { keywords: ['interserver', 'inter server'], name: 'InterServer', icon: SERVER_ICON },
  { keywords: ['cloudcone', 'cloud cone'], name: 'CloudCone', icon: SERVER_ICON },
  { keywords: ['crunchbits', 'crunch bits'], name: 'Crunchbits', icon: SERVER_ICON },
  { keywords: ['alphavps', 'alpha vps'], name: 'AlphaVPS', icon: SERVER_ICON },
  { keywords: ['webhorizon', 'web horizon'], name: 'WebHorizon', icon: SERVER_ICON },
  { keywords: ['terrahost', 'terra host'], name: 'TerraHost', icon: SERVER_ICON },
  { keywords: ['advin', 'advin servers'], name: 'Advin Servers', icon: SERVER_ICON },
  { keywords: ['datapacket', 'data packet'], name: 'DataPacket', icon: SERVER_ICON },
  { keywords: ['hivelocity', 'hive velocity'], name: 'Hivelocity', icon: SERVER_ICON },
  { keywords: ['worldstream', 'world stream'], name: 'WorldStream', icon: SERVER_ICON },
  { keywords: ['hostpapa'], name: 'HostPapa', icon: SERVER_ICON },
  { keywords: ['hytron', 'hinet'], name: 'Hytron', icon: SERVER_ICON },
  { keywords: ['hurricane electric', 'he.net'], name: 'Hurricane Electric', icon: SERVER_ICON },
]

const ASN_PROVIDER_DB: Record<string, ProviderInfo> = {
  AS36352: { name: 'ColoCrossing', icon: SERVER_ICON },
  AS53667: { name: 'FranTech (BuyVM)', icon: SERVER_ICON },
  AS20473: { name: 'Vultr (Choopa)', icon: 'simple-icons:vultr' },
  AS14061: { name: 'DigitalOcean', icon: 'simple-icons:digitalocean' },
  AS24940: { name: 'Hetzner', icon: 'simple-icons:hetzner' },
  AS16276: { name: 'OVHcloud', icon: 'simple-icons:ovh' },
  AS63949: { name: 'Akamai (Linode)', icon: SERVER_ICON },
  AS13335: { name: 'Cloudflare', icon: 'simple-icons:cloudflare' },
  AS51167: { name: 'Contabo', icon: SERVER_ICON },
  AS9009: { name: 'M247', icon: SERVER_ICON },
  AS8100: { name: 'ColoCrossing', icon: SERVER_ICON },
  AS35916: { name: 'Multacom', icon: SERVER_ICON },
  AS60068: { name: 'Datacamp', icon: SERVER_ICON },
  AS62240: { name: 'Clouvider', icon: SERVER_ICON },
  AS47890: { name: 'UNMANAGED LTD', icon: SERVER_ICON },
  AS212027: { name: 'YxVM', icon: SERVER_ICON },
}

/*
 * 上游这里写的是「节点名称 / 备注 / 标签」「IP 组织名」。CFSM 的备注是私有字段，
 * 公开接口会删掉；`org` 也不是 IP 查询结果而是标签。文案按实际来源改写，
 * 其余行为不变（只有 seller 的来源会显示出来）。
 */
const SOURCE_LABELS: Record<ProviderMatchSource, string> = {
  'custom-alias': '自定义别名',
  'metadata': '节点名称 / 分组 / 地区 / 标签',
  'asn': 'ASN 标签映射',
  'org': '组织名标签',
  'fallback-org': '组织名标签原文',
}

interface NormalizedText {
  spaced: string
  compact: string
}

function normalizeText(value: string): NormalizedText {
  const spaced = value
    .normalize('NFKC')
    .replace(ASN_PREFIX_REGEX, '')
    .toLowerCase()
    .replace(NON_ALNUM_REGEX, ' ')
    .replace(COMPANY_SUFFIX_REGEX, ' ')
    .replace(SPACE_REGEX, ' ')
    .trim()
  return { spaced, compact: spaced.replace(SPACE_REGEX, '') }
}

/*
 * 列表视图每一行、每次实时推送都会做一次厂商识别，内置厂商库的关键词是固定的，
 * 规范化结果缓存起来，不必每次重算上百个关键词。自定义别名同样进缓存，数量有限。
 */
const normalizedKeywordCache = new Map<string, NormalizedText>()

function keywordText(keyword: string): NormalizedText {
  const cached = normalizedKeywordCache.get(keyword)
  if (cached) return cached
  const normalized = normalizeText(keyword)
  normalizedKeywordCache.set(keyword, normalized)
  return normalized
}

function matchesKeyword(text: NormalizedText, keyword: string): boolean {
  const normalizedKeyword = keywordText(keyword)
  return Boolean(
    (normalizedKeyword.spaced && text.spaced.includes(normalizedKeyword.spaced))
    || (normalizedKeyword.compact && text.compact.includes(normalizedKeyword.compact)),
  )
}

function normalizeAsn(asn?: string): string {
  const digits = asn?.match(ASN_DIGITS_REGEX)?.[0]
  return digits ? `AS${digits}` : ''
}

function isSameProvider(a?: ProviderInfo | null, b?: ProviderInfo | null): boolean {
  if (!a || !b) return false
  return normalizeText(a.name).compact === normalizeText(b.name).compact
}

function providerFromName(name: string): ProviderInfo {
  const normalizedName = normalizeText(name)
  const matched = PROVIDER_DB.find((provider) => normalizeText(provider.name).compact === normalizedName.compact)
  return matched ? { name: matched.name, icon: matched.icon } : { name: name.trim(), icon: SERVER_ICON }
}

/** 与上游 `providerAliases` 同一格式：`厂商:别名1,别名2;厂商2:别名`。 */
function parseCustomAliases(config?: string): ProviderEntry[] {
  const key = config?.trim() ?? ''
  if (!key) return []

  return key
    .split(CUSTOM_ALIAS_GROUP_SEPARATOR_REGEX)
    .map((group) => {
      const [rawName, rawAliases] = group.split(':')
      const name = rawName?.trim()
      if (!name) return null
      const provider = providerFromName(name)
      const aliases = rawAliases?.split(',').map((alias) => alias.trim()).filter(Boolean) ?? []
      return { ...provider, keywords: [name, ...aliases] }
    })
    .filter((entry): entry is ProviderEntry => Boolean(entry))
}

function detectProviderInEntries(text: string, entries: ProviderEntry[], source: ProviderMatchSource): ProviderMatch | null {
  if (!text.trim()) return null

  const normalized = normalizeText(text)
  if (!normalized.spaced) return null

  for (const provider of entries) {
    const matched = provider.keywords.find((keyword) => matchesKeyword(normalized, keyword))
    if (matched) return { name: provider.name, icon: provider.icon, source, matched }
  }

  return null
}

export function detectProvider(text: string): ProviderMatch | null {
  return detectProviderInEntries(text, PROVIDER_DB, 'metadata')
}

export function detectProviderByAsn(asn?: string): ProviderMatch | null {
  const key = normalizeAsn(asn)
  const provider = key ? ASN_PROVIDER_DB[key] : null
  return provider ? { ...provider, source: 'asn', matched: key } : null
}

export function cleanProviderOrg(org: string): string {
  return org.replace(ASN_PREFIX_REGEX, '').trim()
}

export function providerSourceLabel(source: ProviderMatchSource): string {
  return SOURCE_LABELS[source]
}

export function resolveProviderInfo(input: ProviderResolveInput): ProviderResolveResult | null {
  const customEntries = parseCustomAliases(input.customAliases)
  const seller = input.metadata
    ? detectProviderInEntries(input.metadata, customEntries, 'custom-alias') ?? detectProvider(input.metadata)
    : null
  const byAsn = detectProviderByAsn(input.asn)
  const byOrg = input.org ? detectProviderInEntries(input.org, PROVIDER_DB, 'org') : null
  const fallbackOrg = input.org
    ? (() => {
        const orgName = cleanProviderOrg(input.org ?? '')
        return orgName ? { name: orgName, icon: SERVER_ICON, source: 'fallback-org' as const } : null
      })()
    : null
  const network = byAsn ?? byOrg ?? fallbackOrg
  const primary = seller ?? network

  if (!primary) return null

  const shouldShowNetwork = seller && network && !isSameProvider(seller, network)
  const displayName = shouldShowNetwork ? `${seller.name} / ${network.name}` : primary.name
  const tooltipLines: string[] = []

  if (seller) {
    tooltipLines.push(`商家：${seller.name}`)
    tooltipLines.push(`来源：${providerSourceLabel(seller.source)}${seller.matched ? `（${seller.matched}）` : ''}`)
  }
  if (network && (!seller || shouldShowNetwork)) tooltipLines.push(`网络：${network.name}`)
  if (input.asn) tooltipLines.push(`ASN：${input.asn}`)
  if (input.org) tooltipLines.push(`Org：${cleanProviderOrg(input.org)}`)

  return {
    primary,
    seller: seller ?? undefined,
    network: network ?? undefined,
    displayName,
    tooltipLines,
  }
}

export interface ProviderNodeText {
  name: string
  group: string
  region: string | null
  tags: readonly string[]
  providerTags: ProviderTags
}

export interface NodeProviderView {
  provider: ProviderResolveResult | null
  /** 系统信息卡「厂商」格的值：上游是 `城市 · 厂商 · ASN`，CFSM 没有城市，其余缺项同样省略。 */
  display: string
  icon: IconName
  /** 顶栏厂商标识的 tooltip，逐行对应上游 `tooltipLines`。 */
  tooltip: string
}

/*
 * 上游 `getProviderMetadataText` 拼的是 name / public_remark / remark / tags / group / region。
 * CFSM 没有公开备注，其余按同一顺序拼接；约定标签已在适配层从 `tags` 里拿走，
 * 以 `asn` / `org` 两个独立输入进入解析，与上游 Geo 查询结果的位置一致。
 */
export function resolveNodeProvider(node: ProviderNodeText, customAliases = ''): NodeProviderView {
  const metadata = [node.name, node.tags.join(' '), node.group, node.region ?? '']
    .filter((value) => value.trim() !== '')
    .join(' ')
  const { asn, org } = node.providerTags
  const provider = resolveProviderInfo({
    metadata,
    asn: asn ?? undefined,
    org: org ?? undefined,
    customAliases,
  })
  const parts = [provider?.displayName, asn].filter((value): value is string => Boolean(value))
  const tooltipLines = provider ? [...provider.tooltipLines] : []
  if (asn || org) tooltipLines.push('ASN / Org 取自节点标签，未做 IP 查询')
  return {
    provider,
    display: parts.length > 0 ? parts.join(' · ') : '-',
    icon: provider?.primary.icon ?? 'icon-park-outline:server',
    tooltip: tooltipLines.join('\n'),
  }
}
