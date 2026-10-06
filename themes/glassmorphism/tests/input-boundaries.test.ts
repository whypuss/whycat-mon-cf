import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_SETTINGS,
  isSafeBackgroundSource,
  parseGlassCustomColors,
  resolveBackgroundSource,
} from '@/theme/settings'
import { backendSiteHint, parseSiteThemeHint } from '@/theme/site-theme-hint'
import {
  formatCount,
  formatDisplayBytesSplit,
  formatDisplaySpeedSplit,
  formatLoad,
  formatMebibytes,
  formatPercent,
  normalizeTimestampMilliseconds,
} from '@/utils/format'

/*
 * 直接锁住几处输入边界：此前它们只被上层逻辑间接带到。
 * 背景地址与自定义配色由运营者在设置里填写，主题提示读自浏览器本地存储，
 * 格式化函数面对的是接口里任何可能的数值——这些入口都不能因为异常输入而放行或崩溃。
 */

describe('自定义背景地址白名单', () => {
  it('只放行 http(s)、站内绝对路径与安全的 local: 路径', () => {
    for (const source of [
      '',
      'https://img.example/a.webp',
      'http://img.example/a.png?x=1#y',
      '  https://img.example/padded.png  ',
      '/bg.webp',
      'local:wallpaper.webp',
      'LOCAL:dir/sub/a.png',
    ]) {
      expect(isSafeBackgroundSource(source), source).toBe(true)
    }
  })

  it('拒绝脚本协议、协议相对地址、其它协议与路径穿越', () => {
    for (const source of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'java\nscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'ftp://files.example/a.png',
      '//evil.example/a.png',
      '\\\\evil.example\\a.png',
      'local:',
      'local:../secret.png',
      'local:a/../../b.png',
      'local:./a.png',
      'local:a//b.png',
      'local:a\\b.png',
      'not a url',
    ]) {
      expect(isSafeBackgroundSource(source), source).toBe(false)
    }
  })

  it('local: 映射到主题用户资源目录并逐段编码；不安全的地址解析为空', () => {
    expect(resolveBackgroundSource('local:my wallpaper.webp')).toBe('/themes/user-assets/my%20wallpaper.webp')
    expect(resolveBackgroundSource('local:dir/a b#1.png')).toBe('/themes/user-assets/dir/a%20b%231.png')
    expect(resolveBackgroundSource(' https://img.example/a.png ')).toBe('https://img.example/a.png')
    expect(resolveBackgroundSource('/bg.webp')).toBe('/bg.webp')
    expect(resolveBackgroundSource('javascript:alert(1)')).toBe('')
    expect(resolveBackgroundSource('local:../secret.png')).toBe('')
  })
})

describe('自定义毛玻璃配色 JSON', () => {
  const base = JSON.parse(DEFAULT_THEME_SETTINGS.glassCustomColors) as Record<string, string>

  it('默认值本身合法，字符串与对象两种输入等价', () => {
    expect(parseGlassCustomColors(DEFAULT_THEME_SETTINGS.glassCustomColors)).toEqual(base)
    expect(parseGlassCustomColors(base)).toEqual(base)
  })

  it('接受 #RRGGBB 与 #RRGGBBAA，大小写不限', () => {
    const colors = { ...base, lightCard: '#AbCdEf', darkCard: '#11223344' }
    expect(parseGlassCustomColors(colors)).toEqual(colors)
  })

  it('缺键、多键、原型键、错误色值与非对象输入一律拒绝', () => {
    const missing = { ...base }
    delete missing.darkBorder
    expect(parseGlassCustomColors(missing)).toBeNull()
    expect(parseGlassCustomColors({ ...base, extra: '#000000' })).toBeNull()
    expect(parseGlassCustomColors(`{"__proto__":{"polluted":"#000000"},${JSON.stringify(base).slice(1)}`)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    for (const color of ['#fff', 'red', '#GGGGGG', 'rgb(0, 0, 0)', '#1234567', '#123456789', ' #123456', '']) {
      expect(parseGlassCustomColors({ ...base, lightText: color }), color).toBeNull()
    }
    expect(parseGlassCustomColors({ ...base, lightText: 0x123456 })).toBeNull()
    for (const value of ['not json', '[]', 'null', '42', [], null, 42, undefined]) {
      expect(parseGlassCustomColors(value), String(value)).toBeNull()
    }
  })
})

describe('冷启动主题提示（浏览器本地存储）', () => {
  it('存储损坏或格式不对时按没有提示处理，不抛错', () => {
    for (const raw of [null, '', 'not json', '[]', '"dark"', '{}', '{"version":2,"themeMode":"dark"}', '{"version":1}', '{"version":1,"themeMode":"neon"}', '{"version":1,"themeMode":"dark","backgroundEnabled":"yes"}']) {
      expect(parseSiteThemeHint(raw), String(raw)).toBeNull()
    }
  })

  it('读出主题模式与背景开关；旧格式没有背景字段时视为未启用', () => {
    expect(parseSiteThemeHint('{"version":1,"themeMode":"dark"}')).toEqual({ themeMode: 'dark', backgroundEnabled: false })
    expect(parseSiteThemeHint('{"version":1,"themeMode":"beijing","backgroundEnabled":true}')).toEqual({ themeMode: 'beijing', backgroundEnabled: true })
  })

  it('只取后端设置与站点偏好，后端写了主题模式时以它为准', () => {
    expect(backendSiteHint({ themeMode: 'dark', backgroundEnabled: true }, 'light')).toEqual({ themeMode: 'dark', backgroundEnabled: true })
    expect(backendSiteHint({}, 'light')).toEqual({ themeMode: 'light', backgroundEnabled: false })
    expect(backendSiteHint(null, 'auto')).toEqual({ themeMode: 'system', backgroundEnabled: false })
    expect(backendSiteHint({ themeMode: 'neon' }, 'dark').themeMode).toBe(DEFAULT_THEME_SETTINGS.themeMode)
  })
})

describe('格式化函数的数值边界', () => {
  it('缺失、非有限与负数一律显示占位符，不出现 NaN / Infinity', () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(formatMebibytes(value)).toBe('-')
      expect(formatPercent(value)).toBe('-')
      expect(formatLoad(value)).toBe('-')
      expect(formatCount(value)).toBe('-')
      expect(formatDisplaySpeedSplit(value)).toEqual({ value: '-', unit: '' })
      expect(normalizeTimestampMilliseconds(value)).toBeNull()
    }
  })

  it('整数次方的容量落在正确单位上（1 GiB 不会显示成 1024 MiB）', () => {
    expect(formatMebibytes(0)).toBe('0 B')
    expect(formatMebibytes(0.5)).toBe('512 KiB')
    expect(formatMebibytes(1024)).toBe('1.00 GiB')
    expect(formatMebibytes(1536)).toBe('1.50 GiB')
    expect(formatMebibytes(1024 * 1024)).toBe('1.00 TiB')
    expect(formatDisplayBytesSplit(1024 ** 3)).toEqual({ value: '1.0', unit: 'GB' })
    expect(formatDisplayBytesSplit(1024 ** 4)).toEqual({ value: '1.00', unit: 'TB' })
    expect(formatDisplayBytesSplit(1024 ** 6)).toEqual({ value: '1024.00', unit: 'PB' })
  })

  it('速度带 /s，零值保留单位', () => {
    expect(formatDisplaySpeedSplit(0)).toEqual({ value: '0', unit: 'B/s' })
    expect(formatDisplaySpeedSplit(1024)).toEqual({ value: '1', unit: 'KB/s' })
    expect(formatDisplaySpeedSplit(1.5 * 1024 ** 2)).toEqual({ value: '1.5', unit: 'MB/s' })
  })

  it('百分比、负载与计数的精度', () => {
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(12.345)).toBe('12.3%')
    expect(formatLoad(0.5)).toBe('0.50')
    expect(formatCount(1234.6)).toBe('1,235')
  })

  it('秒级时间戳换算成毫秒，毫秒级原样保留，0 视为没有', () => {
    expect(normalizeTimestampMilliseconds(0)).toBeNull()
    expect(normalizeTimestampMilliseconds(1_700_000_000)).toBe(1_700_000_000_000)
    expect(normalizeTimestampMilliseconds(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
})
