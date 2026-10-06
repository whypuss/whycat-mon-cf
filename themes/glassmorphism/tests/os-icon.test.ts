import { describe, expect, it } from 'vitest'
import { findOsConfig, osDisplayName, osIconUrl } from '@/utils/os-icon'

/*
 * 系统图标。映射表与 CFSM 官方前端 `src/frontend/utils/osIcon.js` 逐条一致
 * （2026-10-03 比对：27 条的顺序、名称、图标与关键字全部相同）；
 * 唯一差异是图标路径用默认皮肤的绝对路径 `/os-icons/`，在任何路由下都能解析。
 */
describe('系统图标与显示名', () => {
  it('按关键字识别常见系统，图标取默认皮肤的 /os-icons/', () => {
    expect(osIconUrl('Debian GNU/Linux 12 (bookworm)')).toBe('/os-icons/os-debian.svg')
    expect(osIconUrl('Ubuntu 24.04.1 LTS')).toBe('/os-icons/os-ubuntu.svg')
    expect(osIconUrl('Windows Server 2022 Datacenter')).toBe('/os-icons/os-windows.svg')
    expect(osIconUrl('Alpine Linux v3.20')).toBe('/os-icons/os-alpine.webp')
    expect(osIconUrl('Rocky Linux 9.4 (Blue Onyx)')).toBe('/os-icons/os-rocky.svg')
    expect(osIconUrl('Proxmox VE 8.2')).toBe('/os-icons/os-proxmox.ico')
    expect(osIconUrl('Alibaba Cloud Linux 3')).toBe('/os-icons/os-alibaba.svg')
    expect(osIconUrl('ImmortalWrt 23.05')).toBe('/os-icons/os-openwrt.svg')
  })

  it('不区分大小写，显示名取映射表里的正式名称', () => {
    expect(findOsConfig('DEBIAN').name).toBe('Debian')
    expect(osDisplayName('ubuntu 22.04')).toBe('Ubuntu')
    expect(osDisplayName('elementary OS 7')).toBe('Ubuntu')
  })

  it('无法识别时用通用图标，显示名退回原文第一个词；没有原文时为 Unknown', () => {
    expect(osIconUrl('FreeBSD 14.1-RELEASE')).toBe('/os-icons/os-unknown.svg')
    expect(osDisplayName('FreeBSD 14.1-RELEASE')).toBe('FreeBSD')
    expect(osDisplayName('Haiku/R1')).toBe('Haiku')
    for (const value of [null, undefined, '', '   ']) {
      expect(osIconUrl(value)).toBe('/os-icons/os-unknown.svg')
      expect(osDisplayName(value)).toBe('Unknown')
    }
  })
})
