import { describe, expect, it } from 'vitest'
import { countMasked, detectSpikes, SPIKE_PARAMS, type SpikeSample } from '@/domain/spike-mask'

/*
 * 「隐藏尖峰」检测的固定样本。
 *
 * 遮蔽范围是「两侧都有正常基线证据的短时高值」：单点，或不超过
 * `maxRunPoints` 个采样、且真实跨度不超过 `maxRunMs` 的连续高值段。
 * 平台、阶跃、爬升、缺口旁、时间不规则、稳定高延迟一律保留。窗口第一个或最后一个
 * 采样上的高点可以隐藏；倒数第二 / 第二个点还会用边缘侧现有样本核对另一侧基线，避免
 * 刚发生的孤立尖峰在下一桶历史到来前把纵轴顶住。
 *
 * v1.1.7 只处理单点，因此线上出现过两种漏判，本文件末尾用真实采样钉住：
 * 相邻两个高点整段保留；以及近旁有尖峰时，某一侧中位数被抬高，孤立高点被
 * 误判成阶跃而保留。两者都会把纵轴继续撑在很高的位置。
 */

const START = 1_700_000_000_000
const STEP = 30_000

/** 按固定间隔把数值铺成样本；null 表示这一格没有可用数值。 */
function series(values: ReadonlyArray<number | null>, step = STEP): SpikeSample[] {
  return values.map((value, index) => ({ timestamp: START + index * step, value }))
}

function hiddenIndexes(values: ReadonlyArray<number | null>): number[] {
  return detectSpikes(series(values)).flatMap((hidden, index) => (hidden ? [index] : []))
}

/** 约 200ms、带正常小抖动的平稳线路。 */
const CALM = [198, 203, 200, 206, 197, 201, 204, 199, 202, 200, 205, 198]

describe('应当隐藏的形态', () => {
  it('平稳 200ms 线路中的单个 1200ms 高点，只隐藏这一个点', () => {
    const values = [...CALM]
    values[6] = 1200
    expect(hiddenIndexes(values)).toEqual([6])
  })

  it('同一条线上相距足够远的两个孤立高点各自隐藏', () => {
    const values = [...CALM, ...CALM]
    values[4] = 1100
    values[17] = 1300
    expect(hiddenIndexes(values)).toEqual([4, 17])
  })

  it('倒数第二个高点在窗口边缘只有一个正常邻居时即可隐藏', () => {
    expect(hiddenIndexes([198, 202, 199, 201, 1200, 200])).toEqual([4])
  })

  it('窗口第一个或最后一个采样上的高点，内侧证据足够时也隐藏', () => {
    // 2 天窗口的首个采样冲到 1200，此前一律保留，纵轴被它一个点顶到 1200。
    expect(hiddenIndexes([1200, 200, 201, 199, 202, 200, 203])).toEqual([0])
    expect(hiddenIndexes([200, 201, 199, 202, 200, 203, 1300])).toEqual([6])
    // 相邻两点都高、随后立即恢复时，仍是允许隐藏的两点短时高值段。
    expect(hiddenIndexes([1200, 1180, 201, 199, 202, 200, 203])).toEqual([0, 1])
    // 开头就是三点高平台：邻域里高点占了多数，基线抬高，判不成尖峰，整段保留。
    expect(hiddenIndexes([1200, 1180, 1195, 199, 202, 200, 203])).toEqual([])
  })

  it('真实零值基线上的孤立高点同样适用，零值本身不被遮蔽', () => {
    const values = [0, 0, 0, 0, 180, 0, 0, 0, 0]
    expect(hiddenIndexes(values)).toEqual([4])
  })

  it('相邻两个高点整段隐藏', () => {
    // v1.1.7 这里整段保留，纵轴仍被 1200 撑住；现在两点作为一段短时高值一起隐藏。
    expect(hiddenIndexes([200, 201, 199, 202, 200, 1200, 1180, 201, 199, 203, 200, 202])).toEqual([5, 6])
  })

  it('近旁还有尖峰时，参考邻域跳过它们，孤立高点照常隐藏', () => {
    // 左边 1219 / 1217 会把左侧中位数抬到 700 以上，v1.1.7 因此把 701 判成阶跃而保留。
    const values = [185, 185, 1219, 1217, 220, 184, 701, 175, 181, 202, 186, 190]
    expect(hiddenIndexes(values)).toEqual([2, 3, 6])
  })
})

describe('应当保留的形态', () => {
  it('稳定在 600ms 的线路完整保留', () => {
    expect(hiddenIndexes([604, 598, 611, 590, 603, 607, 596, 600, 612, 601])).toEqual([])
  })

  it('两条基线不同的线路互不干扰：各自独立判断', () => {
    const low = [...CALM]
    low[6] = 1200
    const high = [602, 598, 611, 590, 603, 607, 596, 600, 612, 601, 599, 604]
    // 两条线分别调用，高基线那条不因为另一条在 200ms 而被判高。
    expect(hiddenIndexes(low)).toEqual([6])
    expect(hiddenIndexes(high)).toEqual([])
  })

  it('连续高平台不隐藏：三个采样起就按持续高延迟保留', () => {
    expect(hiddenIndexes([200, 201, 199, 202, 1200, 1210, 1195, 200, 198, 203, 201, 199])).toEqual([])
    expect(hiddenIndexes([200, 201, 199, 202, 1200, 1210, 1195, 1205, 200, 198, 203, 201])).toEqual([])
  })

  it('采样间隔很大时，多点高值段按真实时长保留', () => {
    // 15 分钟一个采样：两个点就跨了 15 分钟，超过允许的最长跨度，按持续高延迟保留。
    const values = [200, 201, 199, 202, 200, 1200, 1180, 201, 199, 203, 200, 202]
    expect(detectSpikes(series(values, 15 * 60_000)).some(Boolean)).toBe(false)
    // 同样的间隔下，单点仍然隐藏：那是这条线在该分辨率下能表达的最短事件。
    const single = [...CALM]
    single[6] = 1200
    expect(detectSpikes(series(single, 15 * 60_000)).flatMap((hidden, index) => (hidden ? [index] : []))).toEqual([6])
  })

  it('两侧都被尖峰占满时不硬凑证据：跳过的高点超过上限就保留', () => {
    // 高点与安静区之间隔着 4 个高点，超过每侧允许跳过的数量。
    const values = [200, 201, 199, 900, 910, 905, 915, 1600, 905, 915, 900, 910, 201, 199, 202]
    expect(hiddenIndexes(values)).toEqual([])
  })

  it('阶跃抬升不隐藏', () => {
    expect(hiddenIndexes([200, 202, 198, 201, 199, 800, 805, 798, 802, 801, 799, 803])).toEqual([])
  })

  it('阶跃边沿上的冲高不隐藏：两侧基线不一致', () => {
    expect(hiddenIndexes([200, 202, 198, 201, 1600, 800, 805, 798, 802, 801])).toEqual([])
  })

  /*
   * 以下四组各自只由一条规则决定去留：去掉那一条，对应用例就会失败。
   * 这样每条规则都有独立的证据，而不是被别的规则顺带挡住。
   */
  it('小幅阶跃边沿上的冲高不隐藏：只由「两侧基线一致」挡下', () => {
    // 左侧约 200、右侧约 360，冲高本身远超噪声，紧邻两点也不高。
    expect(hiddenIndexes([200, 201, 199, 202, 1400, 360, 361, 359, 362])).toEqual([])
  })

  it('低基线线路上不足 100ms 的冲高保留：只由「绝对高出下限」挡下', () => {
    expect(hiddenIndexes([20, 21, 19, 20, 90, 20, 21, 19, 20])).toEqual([])
  })

  it('高基线线路上不足一倍的冲高保留：只由「相对高出下限」挡下', () => {
    expect(hiddenIndexes([600, 601, 599, 602, 800, 600, 601, 599, 600])).toEqual([])
  })

  it('剧烈抖动线路上落在噪声范围内的高点保留：只由「噪声倍数」挡下', () => {
    expect(hiddenIndexes([40, 160, 50, 150, 350, 45, 155, 55, 145])).toEqual([])
  })

  it('缓慢爬升不隐藏', () => {
    expect(hiddenIndexes([100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650])).toEqual([])
  })

  it('窗口边缘只剩一个正常邻居时，用另一侧充分证据核对后仍可隐藏', () => {
    expect(hiddenIndexes([200, 1200, 201, 199, 202, 200, 203])).toEqual([1])
    expect(hiddenIndexes([200, 201, 199, 202, 200, 1300, 203])).toEqual([5])
  })

  it('边缘侧与另一侧基线不一致时仍按阶跃保留', () => {
    expect(hiddenIndexes([200, 1200, 800, 801, 799, 802, 800])).toEqual([])
    expect(hiddenIndexes([800, 801, 799, 802, 800, 1200, 200])).toEqual([])
  })

  it('短序列不下结论', () => {
    expect(hiddenIndexes([200, 201, 1200, 199])).toEqual([])
    expect(hiddenIndexes([])).toEqual([])
    expect(hiddenIndexes([1200])).toEqual([])
  })

  it('紧挨原始缺失的高点不跨缺口借证据，保留', () => {
    expect(hiddenIndexes([200, 201, 199, null, 1200, 202, 200, 201, 199])).toEqual([])
    expect(hiddenIndexes([200, 201, 199, 202, 1200, null, 200, 201, 199])).toEqual([])
  })

  it('时间间隔不规则时不跨越大间隔取邻居', () => {
    // 第 3 与第 4 个样本之间隔了 10 个采样间隔，高点左侧只剩一个连续邻居。
    const samples: SpikeSample[] = [
      { timestamp: START, value: 200 },
      { timestamp: START + STEP, value: 201 },
      { timestamp: START + 2 * STEP, value: 199 },
      { timestamp: START + 12 * STEP, value: 202 },
      { timestamp: START + 13 * STEP, value: 1200 },
      { timestamp: START + 14 * STEP, value: 200 },
      { timestamp: START + 15 * STEP, value: 201 },
      { timestamp: START + 16 * STEP, value: 199 },
    ]
    expect(detectSpikes(samples)).toEqual(samples.map(() => false))
  })

  it('完全平稳（MAD 为 0）时一两毫秒的偏差不算高点', () => {
    expect(hiddenIndexes([200, 200, 200, 200, 203, 200, 200, 200, 200])).toEqual([])
  })

  it('正常抖动范围内的较高值不算孤立尖峰', () => {
    // 基线约 200，抖动约 ±30，单点 380 高出不到阈值。
    expect(hiddenIndexes([180, 230, 170, 225, 190, 380, 215, 175, 235, 185])).toEqual([])
  })
})

describe('缺失值与数据语义', () => {
  it('没有数值的格子永远不计为隐藏', () => {
    const values: Array<number | null> = [...CALM]
    values[2] = null
    values[9] = null
    const mask = detectSpikes(series(values))
    expect(mask[2]).toBe(false)
    expect(mask[9]).toBe(false)
  })

  it('遮蔽数组与输入等长，且不修改输入', () => {
    const values = [...CALM]
    values[6] = 1200
    const input = series(values)
    const snapshot = structuredClone(input)
    const mask = detectSpikes(input)
    expect(mask).toHaveLength(input.length)
    expect(input).toEqual(snapshot)
  })

  it('同样的输入得到同样的遮蔽集合', () => {
    const values = [...CALM]
    values[6] = 1200
    const input = series(values)
    expect(detectSpikes(input)).toEqual(detectSpikes(structuredClone(input)))
  })

  it('一条原本有数据的线不会被整条遮蔽', () => {
    // 交替高低：每个高点两侧都是低点，且不存在足够安静的邻域，整条线不会消失。
    const zigzag = Array.from({ length: 21 }, (_, index) => (index % 2 === 0 ? 200 : 1200))
    const mask = detectSpikes(series(zigzag))
    expect(mask.some((hidden) => !hidden)).toBe(true)
    for (const values of [[200, 1200, 200, 1200, 200], CALM, [0, 0, 0, 0, 0]]) {
      expect(detectSpikes(series(values)).every(Boolean)).toBe(false)
    }
  })

  it('计数只数真正被遮蔽的格子', () => {
    expect(countMasked([false, true, false, true])).toBe(2)
    expect(countMasked([])).toBe(0)
    expect(countMasked(undefined)).toBe(0)
  })
})

describe('参数集中定义', () => {
  it('阈值是一份冻结的常量，调用方不能顺手改掉', () => {
    expect(Object.isFrozen(SPIKE_PARAMS)).toBe(true)
    expect(SPIKE_PARAMS).toEqual({
      neighbors: 4,
      minPerSide: 2,
      gapFactor: 2,
      minRiseMs: 100,
      minRiseRatio: 1,
      madScale: 6,
      noiseFloorMs: 2,
      noiseFloorRatio: 0.05,
      sideAgreement: 0.5,
      maxRunPoints: 2,
      maxRunMs: 600_000,
      maxSkip: 3,
    })
  })
})

/*
 * 去标识化的历史线上采样。两组来自当时的 `/api/history/all`，
 * 只截取高点前后的片段，数值原样保留，节点名改为代称。
 * 它们是 v1.1.7 漏判的两种形态。
 */
describe('线上真实采样的回归', () => {
  it('节点 C · 移动线路：相邻两个高点（584 / 604）整段隐藏', () => {
    // 12 小时窗口，采样间隔 2～4 分钟，常态约 80ms。
    const values = [81, 81, 79, 79, 83, 81, 78, 98, 80, 584, 604, 81, 91, 100, 80, 91, 81, 80, 90, 81]
    const samples: SpikeSample[] = values.map((value, index) => ({ timestamp: START + index * 3 * 60_000, value }))
    const mask = detectSpikes(samples)
    expect(mask.flatMap((hidden, index) => (hidden ? [index] : []))).toEqual([9, 10])
    const visible = values.filter((_, index) => !mask[index])
    expect(Math.max(...visible)).toBe(100)
  })

  it('节点 D · 电信线路：双高点与近旁的 701ms 单点一并隐藏', () => {
    // 6 小时窗口，采样间隔约 2 分钟，常态约 190ms。
    const values = [190, 182, 188, 195, 185, 185, 1219, 1217, 220, 184, 701, 175, 1232, 181, 202, 186, 190, 184]
    const samples: SpikeSample[] = values.map((value, index) => ({ timestamp: START + index * 2 * 60_000, value }))
    const mask = detectSpikes(samples)
    expect(mask.flatMap((hidden, index) => (hidden ? [index] : []))).toEqual([6, 7, 10, 12])
    const visible = values.filter((_, index) => !mask[index])
    expect(Math.max(...visible)).toBe(220)
  })
})
