/*
 * 延迟大图「隐藏尖峰」的检测。
 *
 * 这不是异常证明：被命中的点仍是节点真实上报的数值，只是在**绘图副本**里被遮蔽，
 * 让常态区间在纵轴上舒展开。原始数据、统计值、首页口径一概不经过这里。
 *
 * 处理的形态是**两侧都有正常基线证据的短时高值**：可以是单个孤立高点，也可以是
 * 连续若干个采样的短促高值段。持续高延迟、阶跃抬升、缓慢爬升一律保留：宁可让一个
 * 尖峰留在图上，也不能把一段真实故障画成平稳。
 *
 * 规则逐条：
 * 1. 按线路独立判断，调用方每条线单独调用；不同线路之间没有公共阈值。
 * 2. **第一遍**：按原始邻域标出「疑似高点」。取候选点左右各最多 `neighbors` 个有效样本，
 *    遇到没有数值的格子（超时、未配置、缺列、离线缺口标记）立即停止，时间差超过
 *    「中位采样间隔 × gapFactor」也立即停止——不跨缺口借证据。任一侧不足 `minPerSide`
 *    个通常不算疑似；若不足是因为已经走到所选窗口边缘，则允许用边缘侧现有的一个正常点
 *    与另一侧的充分证据交叉核对。疑似只用于第二遍避开它们，本身不决定遮蔽。
 * 3. **第二遍**：把相邻的疑似高点合并成「高值段」（中间不能夹缺口或超出时间步长）。
 *    段长超过 `maxRunPoints` 个采样（即连续三个及以上），或跨越时长超过 `maxRunMs`，
 *    都按持续高延迟保留。
 *    单点不受时长限制：那是这条线在该时间分辨率下能表达的最短事件。
 * 4. 为高值段取参考邻域时**跳过其它疑似高点**，每侧最多跳过 `maxSkip` 个，仍然在缺口
 *    与时间步长处停止。这样近旁的另一处尖峰不会把某一侧的中位数抬高，导致误判为阶跃。
 * 5. 任一侧安静邻居少于 `minPerSide` 个，且不是所选窗口的自然边缘，证据不足，保留。
 *    窗口最外侧可以只靠内侧证据；倒数第二 / 第二个点还必须让边缘侧现有样本与内侧基线一致。
 * 6. 以两侧安静邻居合并后的中位数为基线，MAD 估计噪声；噪声有下限，避免完全平稳的线路
 *    （MAD 为 0）因为一两毫秒抖动就被判高。
 * 7. 段内**每个**采样都要同时满足三项才算「高」：比基线高出至少 `minRiseMs` 毫秒；
 *    至少是基线的 `1 + minRiseRatio` 倍；高出量至少是噪声的 `madScale` 倍。
 * 8. 左右两侧各自的中位数必须相近，否则是阶跃或爬升，不隐藏。
 * 9. 兜底：若一条原本有数据的线会被全部遮蔽，整条线回退为完整显示。
 *
 * 阈值集中在 `SPIKE_PARAMS`，不是从截图里猜的；固定样本与线上真实样本见
 * `tests/spike-mask.test.ts`。
 */

export interface SpikeSample {
  /** 毫秒时间戳。 */
  timestamp: number
  /** 有效数值；null 表示这一格没有可用数值（超时、未配置、缺列或离线缺口）。 */
  value: number | null
}

export interface SpikeParams {
  /** 每侧最多取几个有效邻居作为基线样本。 */
  neighbors: number
  /** 每侧至少要有几个有效邻居，才允许下结论。 */
  minPerSide: number
  /** 相邻有效样本的时间差超过「中位采样间隔 × 该倍数」即视为断开。 */
  gapFactor: number
  /** 高出基线的绝对下限（毫秒）。 */
  minRiseMs: number
  /** 高出基线的相对下限：数值 ≥ 基线 × (1 + minRiseRatio)。 */
  minRiseRatio: number
  /** 稳健阈值：高出量 ≥ madScale × 噪声。 */
  madScale: number
  /** 噪声下限（毫秒）。 */
  noiseFloorMs: number
  /** 噪声下限相对基线的比例。 */
  noiseFloorRatio: number
  /** 左右两侧中位数允许的差距：max(minRiseMs, 基线) × 该比例。 */
  sideAgreement: number
  /** 一段高值最多包含几个连续采样，超过按持续高延迟保留（连续三个及以上即保留）。 */
  maxRunPoints: number
  /** 多点高值段允许跨越的最长真实时长（毫秒），超过按持续高延迟保留。 */
  maxRunMs: number
  /** 取参考邻域时，每侧最多跳过几个疑似高点。 */
  maxSkip: number
}

export const SPIKE_PARAMS: Readonly<SpikeParams> = Object.freeze({
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

/** MAD 换算为正态分布下的标准差估计。 */
const MAD_TO_SIGMA = 1.4826

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  if (sorted.length % 2 === 1) return upper
  return ((sorted[middle - 1] ?? upper) + upper) / 2
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

interface SideEvidence {
  values: number[]
  /** 走到序列尽头才停：证据少是因为窗口边界，而不是缺口。 */
  atEdge: boolean
}

interface Neighbourhood {
  left: number[]
  right: number[]
  baseline: number
  noise: number
  /** 两侧至少各有一个值，可以比较左右中位数。 */
  comparable: boolean
}

/**
 * 返回与输入等长的布尔数组：true 表示这一格应在绘图时被遮蔽。
 * 输入不会被修改；没有数值的格子永远是 false。
 */
export function detectSpikes(
  samples: readonly SpikeSample[],
  params: Readonly<SpikeParams> = SPIKE_PARAMS,
): boolean[] {
  const mask = samples.map(() => false)
  const valid = samples.flatMap((sample, index) => (
    isNumber(sample.value) ? [{ index, timestamp: sample.timestamp, value: sample.value }] : []
  ))
  if (valid.length < params.minPerSide * 2 + 1) return mask

  const deltas: number[] = []
  for (let position = 1; position < valid.length; position += 1) {
    const current = valid[position]
    const previous = valid[position - 1]
    if (!current || !previous) continue
    const delta = current.timestamp - previous.timestamp
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta)
  }
  const maxStep = deltas.length > 0 ? median(deltas) * params.gapFactor : Number.POSITIVE_INFINITY

  /**
   * 从 `from` 向一侧收集参考值。遇到缺口或超出时间步长立即停止；
   * `skip` 里的下标是疑似高点，最多跳过 `maxSkip` 个，跳过的点不进入参考值。
   */
  function side(from: number, origin: number, direction: -1 | 1, skip: ReadonlySet<number>): SideEvidence {
    const values: number[] = []
    let previous = origin
    let skipped = 0
    let index = from + direction
    for (; index >= 0 && index < samples.length; index += direction) {
      if (values.length >= params.neighbors) return { values, atEdge: false }
      const sample = samples[index]
      if (!sample || !isNumber(sample.value)) return { values, atEdge: false }
      if (Math.abs(sample.timestamp - previous) > maxStep) return { values, atEdge: false }
      previous = sample.timestamp
      if (skip.has(index)) {
        skipped += 1
        if (skipped > params.maxSkip) return { values, atEdge: false }
        continue
      }
      values.push(sample.value)
    }
    // 一路走到序列尽头：这一侧之所以证据少，是因为窗口就到这里了，不是遇到缺口。
    return { values, atEdge: true }
  }

  function neighbourhood(
    firstIndex: number,
    lastIndex: number,
    firstTimestamp: number,
    lastTimestamp: number,
    skip: ReadonlySet<number>,
  ): Neighbourhood | null {
    const left = side(firstIndex, firstTimestamp, -1, skip)
    const right = side(lastIndex, lastTimestamp, 1, skip)
    const leftEnough = left.values.length >= params.minPerSide
    const rightEnough = right.values.length >= params.minPerSide
    /*
     * 所选窗口边缘不是数据断档：尖峰位于倒数第二个点时，右侧通常只来得及积累一个
     * 正常样本。旧规则把这种真实的短时高值永久判成「证据不足」，直到下一桶历史出现才
     * 突然开始隐藏。自然边缘允许使用现有的少量样本，但另一侧仍须有充分证据；由 null、
     * 离线占位或异常时间间隔截断的邻域仍然不放行。
     */
    const leftIsEdge = left.atEdge
    const rightIsEdge = right.atEdge
    if (!leftEnough && !(leftIsEdge && rightEnough)) return null
    if (!rightEnough && !(rightIsEdge && leftEnough)) return null
    const pool = [...left.values, ...right.values]
    const baseline = median(pool)
    const mad = median(pool.map((item) => Math.abs(item - baseline)))
    const noise = Math.max(MAD_TO_SIGMA * mad, params.noiseFloorMs, baseline * params.noiseFloorRatio)
    // 边缘侧只要已有一个值，就必须与另一侧基线相符；这能挡住窗口边缘处的真实阶跃。
    return {
      left: left.values,
      right: right.values,
      baseline,
      noise,
      comparable: left.values.length > 0 && right.values.length > 0,
    }
  }

  function elevated(value: number, context: Neighbourhood): boolean {
    return value - context.baseline >= params.minRiseMs
      && value >= context.baseline * (1 + params.minRiseRatio)
      && value - context.baseline >= params.madScale * context.noise
  }

  // 第一遍：按原始邻域标出疑似高点，只用于第二遍避开它们。
  const empty: ReadonlySet<number> = new Set()
  const suspects = new Set<number>()
  for (const candidate of valid) {
    const context = neighbourhood(candidate.index, candidate.index, candidate.timestamp, candidate.timestamp, empty)
    if (context && elevated(candidate.value, context)) suspects.add(candidate.index)
  }

  // 第二遍：把相邻的疑似高点合成段，用跳过疑似点后的安静邻域重新判定。
  for (let position = 0; position < valid.length; position += 1) {
    const start = valid[position]
    if (!start || !suspects.has(start.index)) continue

    const run = [start]
    while (position + 1 < valid.length) {
      const next = valid[position + 1]
      const previous = run[run.length - 1]
      if (!next || !previous || !suspects.has(next.index)) break
      // 段内不能夹着缺口：相邻疑似点之间必须是连续有效样本，且时间步长正常。
      if (next.index !== previous.index + 1) break
      if (next.timestamp - previous.timestamp > maxStep) break
      run.push(next)
      position += 1
    }

    const first = run[0]
    const last = run[run.length - 1]
    if (!first || !last) continue
    if (run.length > params.maxRunPoints) continue
    // 多点段还要看真实跨度：采样间隔大的窗口里，几个点就可能是很长一段时间。
    if (run.length > 1 && last.timestamp - first.timestamp > params.maxRunMs) continue

    const context = neighbourhood(first.index, last.index, first.timestamp, last.timestamp, suspects)
    if (!context) continue
    if (!run.every((item) => elevated(item.value, context))) continue
    // 两侧基线不一致：阶跃或爬升，保留。靠窗口边界的那一段没有两侧可比，跳过这一条。
    if (context.comparable) {
      const tolerance = Math.max(params.minRiseMs, context.baseline) * params.sideAgreement
      if (Math.abs(median(context.left) - median(context.right)) > tolerance) continue
    }

    for (const item of run) mask[item.index] = true
  }

  // 兜底：不能让一条原本有数据的线整条消失。
  if (valid.every((candidate) => mask[candidate.index])) return samples.map(() => false)
  return mask
}

/** 遮蔽数组里被隐藏的格子数。 */
export function countMasked(mask: readonly boolean[] | undefined): number {
  return mask ? mask.reduce((total, hidden) => total + (hidden ? 1 : 0), 0) : 0
}
