import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ServerCard from '@/components/dashboard/ServerCard.vue'
import { ICONS } from '@/constants/icons'
import type { GlassServer } from '@/types/glassmorphism'
import { MISSING_TEXT } from '@/utils/format'

function server(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'example:node', id: 'node', sourceBase: 'https://example.invalid', sourceLabel: 'Example',
    name: 'Example Node', group: '', tags: [], providerTags: { asn: null, org: null }, region: 'HK',
    price: '12', billingCycle: 'year', currency: 'USD', expireDate: null, trafficLimit: null,
    trafficCalculationType: null, showPrice: true, showExpire: true, showTraffic: true,
    online: true, sortOrder: null, cpu: 5, load: { one: 1.11, five: 2.22, fifteen: 3.33 },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: { inSpeed: null, outSpeed: null, received: null, transmitted: null, monthlyReceived: null, monthlyTransmitted: null },
    processes: null, tcpConnections: null, udpConnections: null, latency: [],
    history: { latencySeries: {}, packetLossSeries: {} }, gpus: [],
    connectivity: { ipv4: null, ipv6: null }, operatingSystem: null, architecture: null,
    cpuInfo: null, cpuCores: null, kernelVersion: null, agentVersion: null, bootTime: null, lastUpdated: null,
    ...overrides,
  }
}

async function renderCard(overrides: Partial<GlassServer> = {}, priceVisible = true) {
  const html = await renderToString(createSSRApp(ServerCard, {
    server: server(overrides), showSource: false, density: 'comfortable', favorite: false, priceVisible,
  }))
  const boxes = [...html.matchAll(/<div class="node-box">([\s\S]*?)<\/div>/g)]
  expect(boxes).toHaveLength(3)
  return { html, thirdBox: boxes[2]![1]! }
}

function rows(box: string): number {
  return (box.match(/class="node-box__row/g) ?? []).length
}

function placeholders(box: string): number {
  return (box.match(new RegExp(`<span class="node-box__text">${MISSING_TEXT}</span>`, 'g')) ?? []).length
}

describe('首页节点卡第三个信息盒', () => {
  it('有公开到期日期时保持原有剩余天数和价值', async () => {
    const { thirdBox } = await renderCard({ expireDate: '2030-01-01' })
    expect(thirdBox).toContain('剩余')
    expect(thirdBox).toContain('USD12')
    expect(rows(thirdBox)).toBe(2)
  })

  /*
   * v1.1.14 在这里只画一行「📅 —」。v1.1.15 按上游恢复两行结构：上游是 `-` 加剩余价值，
   * 但它把未知到期的剩余价值算成 0 显示「€0」。这里第二行同样是硬币图标，值如实为占位，
   * 不出现任何金额。占位符也按上游从 `—` 改为 `-`。
   */
  it.each([null, 'not-a-date'])('有公开正价格但到期日期缺失或无效时保留两行占位，剩余价值不写成 0：%s', async (expireDate) => {
    const { html, thirdBox } = await renderCard({ expireDate })
    expect(rows(thirdBox)).toBe(2)
    expect(placeholders(thirdBox)).toBe(2)
    expect(thirdBox).toContain(ICONS['tabler:calendar-stats'].body)
    expect(thirdBox).toContain(ICONS['tabler:coins'].body)
    expect(thirdBox).not.toContain('1.11')
    expect(thirdBox).not.toContain('2.22')
    expect(thirdBox).not.toContain('USD12')
    expect(thirdBox).not.toMatch(/USD\s*0/)
    expect(html).toMatch(/1\.11,\s*2\.22,\s*3\.33/)
  })

  it('隐藏到期日期时不泄露日期、剩余天数或价值', async () => {
    const { thirdBox } = await renderCard({ showExpire: false, expireDate: '2030-01-01' })
    expect(rows(thirdBox)).toBe(2)
    expect(placeholders(thirdBox)).toBe(2)
    expect(thirdBox).not.toContain('剩余')
    expect(thirdBox).not.toContain('2030')
    expect(thirdBox).not.toContain('USD12')
  })

  it.each([
    [{ price: '0', expireDate: null }, true],
    [{ price: '-1', expireDate: null }, true],
    [{ price: null, expireDate: null }, true],
    [{ price: 'invalid', expireDate: null }, true],
    [{ price: '12', expireDate: null }, false],
    [{ price: '12', showPrice: false, expireDate: null }, true],
  ] as const)('免费、无价、无效价或隐藏价格维持负载回退 %#', async (overrides, priceVisible) => {
    const { thirdBox } = await renderCard(overrides, priceVisible)
    expect(thirdBox).toContain('1.11')
    expect(thirdBox).toContain('2.22 / 3.33')
    expect(rows(thirdBox)).toBe(2)
  })
})
