import { describe, expect, it } from 'vitest'
import { numericWindowSamples, probeSeriesFor, windowAverage } from '@/domain/probe-window'
import type { GlassLatencySample } from '@/types/glassmorphism'

const START = 1_700_000_000_000

function samples(values: Array<number | null | false>): GlassLatencySample[] {
  return values.map((value, index) => ({ timestamp: START + index * 360_000, value }))
}

describe('首页探测窗口的平均值', () => {
  it('对窗口内的真实采样取平均，对应上游的 avgLatency / avgLoss', () => {
    const series = { ct: samples([10, 20, 30]) }
    expect(windowAverage(series, 'ct')).toEqual({ value: 20, samples: 3 })
  })

  it('跳过 null（该桶无采样）与 false（未配置），不把它们当作 0', () => {
    const series = { ct: samples([10, null, false, 30]) }
    expect(windowAverage(series, 'ct')).toEqual({ value: 20, samples: 2 })
  })

  it('窗口里没有任何真实采样时返回 null，而不是 0', () => {
    expect(windowAverage({ ct: samples([null, false]) }, 'ct')).toEqual({ value: null, samples: 0 })
  })

  it('该目标没有窗口序列时返回 null', () => {
    expect(windowAverage({}, 'cu')).toEqual({ value: null, samples: 0 })
    expect(probeSeriesFor({}, 'cu')).toEqual([])
  })

  it('只统计被问到的那个探测目标', () => {
    const series = { ct: samples([10, 10]), cu: samples([100, 100]) }
    expect(windowAverage(series, 'ct').value).toBe(10)
    expect(windowAverage(series, 'cu').value).toBe(100)
    // 聚合统计仍可跨目标取全部真实采样。
    expect(numericWindowSamples(series)).toEqual([10, 10, 100, 100])
  })

  it('丢包为 0 的窗口给出 0，而不是当成缺数据', () => {
    expect(windowAverage({ ct: samples([0, 0, 0]) }, 'ct')).toEqual({ value: 0, samples: 3 })
  })
})
