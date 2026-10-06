import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCfsmDate,
  formatCurrencyValue,
  formatDisplayBytesSplit,
  formatDisplaySpeed,
  formatLatency,
  formatPrice,
  formatProbePercent,
  formatSpeed,
  formatTimestamp,
  formatUptime,
  parseCfsmDate,
} from '@/utils/format'

describe('time formatting', () => {
  it('supports CFSM boot timestamps in seconds and milliseconds', () => {
    expect(formatUptime(1_700_000_000, 1_700_093_780_000)).toBe('1 天 2 小时')
    expect(formatUptime(1_700_000_000_000, 1_700_003_780_000)).toBe('1 小时 3 分')
  })

  it('keeps missing, zero and future timestamps unavailable', () => {
    expect(formatUptime(null)).toBe('-')
    expect(formatUptime(0)).toBe('-')
    expect(formatUptime(Date.now() + 60_000)).toBe('-')
    expect(formatTimestamp(null)).toBe('-')
  })

  it('renders probe timeout, absence and zero as distinct states', () => {
    expect(formatLatency(null)).toBe('超时')
    expect(formatLatency(false)).toBe('-')
    expect(formatLatency(0)).toBe('0.0 ms')
    expect(formatProbePercent(null)).toBe('超时')
    expect(formatProbePercent(false)).toBe('-')
    expect(formatProbePercent(0)).toBe('0.0%')
  })

  it('strictly parses CFSM expiry dates without leaking Invalid Date', () => {
    expect(formatCfsmDate('2028-02-29')).toBe('2028/02/29')
    expect(parseCfsmDate('2027-02-29')).toBeNull()
    expect(parseCfsmDate('2026-13-01')).toBeNull()
    expect(parseCfsmDate('12/31/2026')).toBeNull()
    expect(parseCfsmDate('2026-02-30T00:00:00Z')).toBeNull()
    expect(parseCfsmDate('2026-12-31T23:59:00+08:00')?.getTime()).toBe(1_798_732_740_000)
    expect(formatCfsmDate('not-a-date')).toBe('-')
    expect(formatCfsmDate(null)).toBe('-')
  })

  it('handles free, missing and invalid prices without NaN', () => {
    expect(formatPrice('0', '¥', 'month')).toBe('免费')
    expect(formatPrice('-1', '$', 'year')).toBe('免费')
    expect(formatPrice('30.00', '¥', 'month')).toBe('¥30 / month')
    expect(formatPrice('invalid', '$', 'month')).toBe('-')
    expect(formatPrice('', '$', 'month')).toBe('-')
    expect(formatPrice(null, null, null)).toBe('-')
    expect(formatCurrencyValue(12.345, '€')).toBe('€12.35')
    expect(formatCurrencyValue(null, '€')).toBe('-')
  })
})

describe('byte formatting', () => {
  it('keeps sub-byte values in bytes instead of indexing past the unit table', () => {
    // 对数为负时若不钳到 0，展示层会落到 PB 兜底，把 0.5 B 显示成 512.00 PB。
    expect(formatBytes(0.5)).toBe('0.50 B')
    expect(formatSpeed(0.5)).toBe('0.50 B/s')
    expect(formatDisplayBytesSplit(0.4)).toEqual({ value: '0', unit: 'B' })
    expect(formatDisplaySpeed(0.75)).toBe('1 B/s')
  })
})
