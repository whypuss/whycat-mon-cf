import { describe, expect, it } from 'vitest'
import { configReady } from '@/domain/config-readiness'

describe('后台设置冷启动门禁', () => {
  it('配置未确定时保持骨架屏，不渲染默认设置驱动的区域', () => {
    expect(configReady(null, 'idle')).toBe(false)
    expect(configReady(null, 'loading')).toBe(false)
  })

  it('手动刷新时继续使用上一份真实配置', () => {
    expect(configReady({}, 'loading')).toBe(true)
  })

  it('冷启动配置明确失败后允许默认设置和既有错误提示', () => {
    expect(configReady(null, 'error')).toBe(true)
  })
})
