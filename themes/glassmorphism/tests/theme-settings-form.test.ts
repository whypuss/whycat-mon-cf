import { describe, expect, it } from 'vitest'
import {
  isFieldEnabled,
  THEME_FORM_FIELDS,
  THEME_SETTINGS_FORM,
} from '@/domain/theme-settings-form'
import {
  cloneThemeSettings,
  DEFAULT_THEME_SETTINGS,
  resolveThemeMode,
  THEME_SETTING_KEYS,
  validateThemeSettingsDraft,
} from '@/theme/settings'

/*
 * 基线是 Komari Glassmorphism v3.3.7 的 `komari-theme.json`：它的
 * `configuration.data` 里 8 条 `type: "title"` 就是分组，分组之间的条目就是字段顺序。
 * CFSM 没有 managed 表单机制，设置页由主题自己渲染，因此这份注册表必须逐条对上，
 * 否则页面又会像第 2 轮那样漏项、并组。
 */
const UPSTREAM_GROUPS: ReadonlyArray<{ title: string, keys: readonly string[] }> = [
  {
    title: '01 · 基础与外观',
    keys: ['themeMode', 'dataUpdateInterval', 'defaultViewMode', 'nodeCardSize'],
  },
  {
    title: '02 · 首页布局',
    keys: [
      'alertEnabled', 'alertTitle', 'alertContent', 'stopEarth', 'earthRenderer',
      'hideEarth', 'hideGeneralCard', 'glassColorPreset',
      'colorVisionMode', 'glassCustomColors',
    ],
  },
  {
    title: '03 · 首页总览卡片',
    keys: ['generalCardPreset', 'generalCardKeys'],
  },
  {
    title: '04 · 高级工具与隐私',
    keys: [
      'homeToolsEnabled', 'hideAdminEntryWhenLoggedOut', 'hidePriceWhenLoggedOut',
      'providerAliases', 'exportSecondaryPassword', 'disablePageAnimation',
    ],
  },
  {
    title: '05 · 节点卡片、列表与快捷控制',
    keys: [
      'homeQuickControlsEnabled', 'homeQuickControlPreset', 'homeQuickControlKeys',
      'nodeListMetadataEnabled', 'nodeListMetadataFields', 'nodeListCustomTagsVisible',
      'offlineNodesLast', 'homeHighLoadThreshold', 'homeTrafficWarningThreshold',
      'homeExpiringDays', 'diskPredictionEnabled', 'diskPredictionThresholdDays',
    ],
  },
  {
    title: '06 · 节点详情概览卡片',
    keys: ['nodeDetailSectionTabsEnabled', 'detailMetricCardPreset', 'detailMetricCardKeys'],
  },
  {
    title: '07 · 节点详情图表',
    keys: ['gpuChartEnabled', 'chartDashboardPreset', 'chartDashboardTemplate'],
  },
  {
    title: '08 · 自定义背景',
    keys: [
      'backgroundEnabled', 'backgroundType', 'lightBackgroundUrl', 'darkBackgroundUrl',
      'backgroundBlur', 'backgroundOverlay',
    ],
  },
]

/*
 * CFSM 公开接口确实不提供的两项：设置页不渲染，避免出现点了没反应的控件。
 * 它们仍留在 48 项 schema 与保存快照中——保存协议要求发送完整对象。
 * 正式版待办见 `docs/todo.md` TODO-02。
 */
const BACKLOG_KEYS: readonly string[] = ['rpcTransportMode', 'visitorInfoEnabled']

describe('设置页字段注册表与上游清单一致', () => {
  it('分组标题与顺序逐条对应 komari-theme.json', () => {
    expect(THEME_SETTINGS_FORM.map((group) => group.title)).toEqual(
      UPSTREAM_GROUPS.map((group) => group.title),
    )
  })

  it('每个分组内的字段顺序与上游一致', () => {
    for (const [index, group] of UPSTREAM_GROUPS.entries()) {
      expect(THEME_SETTINGS_FORM[index]?.fields.map((field) => field.key)).toEqual(group.keys)
    }
  })

  it('除两项待办外，每项设置都有且只有一个控件', () => {
    const keys: string[] = THEME_FORM_FIELDS.map((field) => field.key)
    expect(keys).toHaveLength(THEME_SETTING_KEYS.length - BACKLOG_KEYS.length)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of THEME_SETTING_KEYS) {
      if (BACKLOG_KEYS.includes(key)) expect(keys).not.toContain(key)
      else expect(keys).toContain(key)
    }
  })

  it('两项待办仍留在 schema 里，保存快照不会因此缺项', () => {
    for (const key of BACKLOG_KEYS) expect(THEME_SETTING_KEYS).toContain(key)
  })

  it('每一项都写了说明，不留空白控件', () => {
    for (const field of THEME_FORM_FIELDS) {
      expect(field.help.length).toBeGreaterThan(0)
      if (field.kind === 'select') expect(field.options?.length).toBeGreaterThan(0)
      if (field.kind === 'number') {
        expect(typeof field.min).toBe('number')
        expect(typeof field.max).toBe('number')
      }
    }
  })

  it('主题模式保留 CFSM 的「跟随系统」，对应 preferred_theme 的 auto', () => {
    const themeMode = THEME_FORM_FIELDS.find((field) => field.key === 'themeMode')
    expect(themeMode?.options?.map((option) => option.value)).toEqual(['beijing', 'system', 'light', 'dark'])
    expect(themeMode?.note).toContain('auto')
  })

  it('依赖项在前置开关关闭时禁用', () => {
    const settings = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    const field = (key: string) => {
      const match = THEME_FORM_FIELDS.find((item) => item.key === key)
      if (!match) throw new Error(`missing field ${key}`)
      return match
    }

    expect(isFieldEnabled(field('alertTitle'), settings)).toBe(false)
    settings.alertEnabled = true
    expect(isFieldEnabled(field('alertTitle'), settings)).toBe(true)

    expect(isFieldEnabled(field('nodeCardSize'), settings)).toBe(true)
    settings.defaultViewMode = 'list'
    expect(isFieldEnabled(field('nodeCardSize'), settings)).toBe(false)

    expect(isFieldEnabled(field('diskPredictionThresholdDays'), settings)).toBe(false)
    settings.diskPredictionEnabled = true
    expect(isFieldEnabled(field('diskPredictionThresholdDays'), settings)).toBe(true)

    expect(isFieldEnabled(field('chartDashboardTemplate'), settings)).toBe(false)
    settings.chartDashboardPreset = '自定义'
    expect(isFieldEnabled(field('chartDashboardTemplate'), settings)).toBe(true)

    settings.hideEarth = true
    expect(isFieldEnabled(field('earthRenderer'), settings)).toBe(false)
    expect(isFieldEnabled(field('stopEarth'), settings)).toBe(false)
  })

  /*
   * 这条说明此前写着「服务端约 5 秒合并一批」，来源是 POST 上报路径的合并窗口常量。
   * 真实站点走 WSS，实测推送节奏跟随站点自己的上报配置（实测每节点约 2 秒一次），
   * 与那个 5 秒无关。下限 5 秒的真实理由是回退轮询每跳要重取配置与节点列表。
   */
  it('数据更新间隔说明写明生效条件与下限，且不再声称服务端的推送批次', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'dataUpdateInterval')
    expect(field?.help).toContain('实时连接不可用')
    expect(field?.note).toContain('5 秒')
    expect(field?.note).not.toContain('一批')
    expect(field?.note).not.toMatch(/约 ?5 ?秒/)
  })

  it('数据更新间隔的输入下限与运行时钳制一致', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'dataUpdateInterval')
    expect(field?.min).toBe(5)
    expect(field?.max).toBe(60)
  })

  /*
   * 读取时的规范化会把越界值悄悄换回原值，所以越界必须在草稿校验里拦下并提示；
   * 否则设置页提示已保存，实际写回的却是旧值。
   */
  it('每个数值字段越界都会被草稿校验拦下', () => {
    for (const field of THEME_FORM_FIELDS.filter((item) => item.kind === 'number')) {
      if (field.min === undefined || field.max === undefined) throw new Error(`missing range for ${field.key}`)
      for (const value of [field.max + 1, field.min - 1]) {
        const draft = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
        Object.assign(draft, { [field.key]: value })
        expect(validateThemeSettingsDraft(draft).map((issue) => issue.key), `${field.key} = ${value}`).toContain(field.key)
      }
    }
    const fractional = cloneThemeSettings(DEFAULT_THEME_SETTINGS)
    fractional.diskPredictionThresholdDays = 7.5
    expect(validateThemeSettingsDraft(fractional).map((issue) => issue.key)).toContain('diskPredictionThresholdDays')
    expect(validateThemeSettingsDraft(cloneThemeSettings(DEFAULT_THEME_SETTINGS))).toEqual([])
  })
})

/*
 * 说明文字与实现的一致性回归。
 *
 * 这两条此前都写错了，而且错的方向不同：一条把写回后端的取值说少了（还把
 * 「跟随系统」说成会转存为 auto，实测线上 `theme_options.themeMode` 存的是
 * system），一条把生效范围说窄了（只提首页，实际详情页那三张财务卡也一起隐藏）。
 * 说明一旦与实现脱节，使用者就会照着错的描述做决定，所以这里把两条钉住。
 */
describe('field copy matches behaviour', () => {
  const field = (key: string) => THEME_FORM_FIELDS.find((item) => item.key === key)

  it('默认主题模式不再声称写回后端时会转成 auto', () => {
    const note = field('themeMode')?.note ?? ''
    expect(note).toContain('system')
    expect(note).not.toMatch(/只有 ?beijing/)
    expect(note).not.toMatch(/对应 CFSM 外观设置里的 auto/)
  })

  it('默认主题模式的时段说明与 resolveThemeMode 的判断一致', () => {
    const help = field('themeMode')?.help ?? ''
    expect(help).toContain('07:00–18:59')
    // 判断是 beijingHour >= 7 && beijingHour < 19，即 07:00–18:59 为浅色。
    expect(resolveThemeMode('beijing', false, new Date(Date.UTC(2026, 0, 1, 23, 0)))).toBe('light')
    expect(resolveThemeMode('beijing', false, new Date(Date.UTC(2026, 0, 1, 10, 59)))).toBe('light')
    expect(resolveThemeMode('beijing', false, new Date(Date.UTC(2026, 0, 1, 11, 0)))).toBe('dark')
    expect(resolveThemeMode('beijing', false, new Date(Date.UTC(2026, 0, 1, 22, 59)))).toBe('dark')
  })

  it('未登录隐藏价格写明详情页也在范围内', () => {
    const help = field('hidePriceWhenLoggedOut')?.help ?? ''
    expect(help).toContain('详情页')
    expect(help).toContain('月均支出')
    expect(help).toContain('在线天数仍会显示')
    // 「费用类卡片」是早期含糊的说法，不再使用；v1.1.7 起总览确实有三张财务卡，说明要点名它们的遮蔽方式。
    expect(help).not.toContain('费用类卡片')
    expect(help).toContain('剩余价值、月费用、年费用卡显示为 ***')
  })

  it('自定义头部卡片列出可换算的三张财务卡，并说明币种在哪里设置', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'generalCardKeys')
    for (const key of ['remainingValue', 'monthlyCost', 'yearlyCost']) expect(field?.help).toContain(key)
    expect(field?.note).toContain('财务显示币种')
    expect(field?.note).not.toMatch(/remainingValue[^。]*会被忽略/)
  })
})

/*
 * 配色方案的作用范围。
 *
 * v1.1.3 起激活态的快捷筛选胶囊也吃 `--control-surface` 与 `--glass-text`
 * （`main.css` 的 `.quick-controls button.is-active`），但这条说明仍写着
 * 「只作用于节点卡」，与同组 `glassCustomColors` 自己写的「lightControl/
 * darkControl=控制条」互相矛盾。两处必须指向同一件事。
 */
describe('colour preset scope copy', () => {
  it('承认控制条也在作用范围内，且不与自定义颜色说明矛盾', () => {
    const preset = THEME_FORM_FIELDS.find((item) => item.key === 'glassColorPreset')
    const custom = THEME_FORM_FIELDS.find((item) => item.key === 'glassCustomColors')

    expect(preset?.note).not.toMatch(/只作用于节点卡/)
    expect(preset?.note).toContain('快捷筛选胶囊')
    // v1.1.7 起加载失败时的「重新加载」也跟随方案，说明要一并写明。
    expect(preset?.note).toContain('重新加载')
    expect(preset?.note).toContain('顶栏、面板、提示框与弹层不受影响')
    // 自定义 JSON 说明里确实有控制条这一项，两边口径一致。
    expect(custom?.help).toContain('控制条')
  })
})

/*
 * 隐藏头部的说明此前写着「隐藏地球和总览卡片」，但实现里
 * `hideGeneralCard` 与 `hideEarth` 是两个并列的 `v-if`，前者只收走总览卡片。
 * 保留这种拆分（多出「只藏卡片、保留地球」一种组合），说明按实际行为写。
 */
describe('hide header copy', () => {
  it('说明与两个独立开关的实现一致', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'hideGeneralCard')
    expect(field?.help).toContain('总览卡片')
    expect(field?.help).toContain('隐藏地球')
    expect(field?.help).not.toBe('隐藏地球和总览卡片。')
  })

  it('设置页文案不点名任何上游主题', () => {
    for (const field of THEME_FORM_FIELDS) {
      expect(`${field.help} ${field.note ?? ''}`).not.toMatch(/上游|Komari/)
    }
  })
})

/*
 * 列表信息字段的说明此前把 city 与 asn 归为同一个原因（依赖 IP 查询、CFSM 不提供）。
 * asn 不是这么回事：它随节点标签下发，详情页的厂商格就在显示（实测形如 `AS3258`），
 * 被忽略的真正原因是列表信息栏只实现了 provider / region / group / tags 四列。
 * 原因写错会让人以为是服务端缺数据，于是去改探针配置——所以这里钉住。
 */
describe('list metadata copy', () => {
  it('分别说明 city 与 asn 被忽略的原因', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'nodeListMetadataFields')
    const note = field?.note ?? ''
    expect(note).toContain('city 依赖 IP 查询')
    expect(note).toContain('节点标签')
    expect(note).not.toMatch(/city 与 asn 依赖 IP 查询/)
  })
})

/*
 * 温度字段的说法。
 *
 * 此前源码注释写着「/api/server 不返回温度字段（只有历史行里有）」，设置页说明也只
 * 点名详情接口。实读服务端 2.8.5 正式版（`1dc0dc4`）的 `historyFields.js`：
 * `HISTORY_ALL_QUERY_COLUMNS` 里没有任何温度列，整个文件都没有 temp 字样，
 * 数据库 schema 同样没有。也就是说公开接口里压根没有温度，不是「在别处」。
 * 说成「详情接口不返回」会让人去历史里找。
 */
describe('temperature copy', () => {
  it('说明写明详情接口与历史里都没有温度', () => {
    const field = THEME_FORM_FIELDS.find((item) => item.key === 'detailMetricCardKeys')
    const note = field?.note ?? ''
    expect(note).toContain('历史列')
    expect(note).not.toBe('temperature 需要 CFSM 详情接口不返回的温度字段；缺数据的卡片会自动收起，不显示为 0。')
  })
})
