import type { ThemeSettings } from '@/theme/settings'

/*
 * 设置页的字段注册表。
 *
 * Komari 自己没有设置页：它把 48 项写在 `komari-theme.json` 的
 * `configuration.type = "managed"` 里，由 Komari 后台渲染成表单。CFSM 没有这套
 * managed 表单机制（第三方主题只能读 `/api/config.theme_options`、写
 * `POST /api/theme_options`），所以这张表就是本主题对那份清单的复刻：
 * 分组标题、分组顺序、每项的中文名与项内顺序逐条对应上游 `configuration.data`。
 *
 * 说明文字（`help`）以上游同名条目为底稿，只在 CFSM 与 Komari 事实不同的地方改写，
 * 并在 `note` 里写明差异。
 *
 * CFSM 公开接口确实不提供的两项（`rpcTransportMode`、`visitorInfoEnabled`）不在这张表里：
 * 设置页不渲染它们，避免出现点了没反应的控件。两项仍留在 `theme/settings.ts` 的 48 项
 * schema 与保存快照中（保存协议要求发送完整对象）；最终稳定版决定保留，见 `docs/todo.md` TODO-02。
 */

export type ThemeFieldKind = 'select' | 'switch' | 'text' | 'password' | 'number' | 'textarea'

export interface ThemeFieldOption {
  value: string
  label: string
}

export interface ThemeField {
  key: keyof ThemeSettings
  /** 上游 `komari-theme.json` 的 `name`。 */
  label: string
  kind: ThemeFieldKind
  help: string
  options?: readonly ThemeFieldOption[]
  min?: number
  max?: number
  /** 数字输入框右侧的单位。 */
  unit?: string
  rows?: number
  /** 占满整行的宽字段（长文本、key 列表）。 */
  wide?: boolean
  /** 与上游行为不同的地方，显示在说明后面。 */
  note?: string
  /** 依赖其它设置；返回 false 时控件禁用。 */
  enabled?: (settings: ThemeSettings) => boolean
}

export interface ThemeFieldGroup {
  /** 上游的分组标题（`type: "title"` 那几条）。 */
  title: string
  fields: readonly ThemeField[]
}

const THEME_MODE_OPTIONS: readonly ThemeFieldOption[] = [
  { value: 'beijing', label: '北京时间自动' },
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const VIEW_MODE_OPTIONS: readonly ThemeFieldOption[] = [
  { value: 'card', label: '卡片' },
  { value: 'list', label: '列表' },
]

const CARD_SIZE_OPTIONS: readonly ThemeFieldOption[] = [
  { value: 'mini', label: '迷你' },
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '舒适' },
  { value: 'large', label: '宽松' },
]

const EARTH_RENDERER_OPTIONS: readonly ThemeFieldOption[] = [
  { value: 'realistic', label: '贴图地球' },
  { value: 'cobe', label: '点阵地球' },
  { value: 'tiled', label: '平铺地图' },
]

const GLASS_PRESET_OPTIONS: readonly ThemeFieldOption[] = [
  { value: '翡翠', label: '翡翠' },
  { value: '柔和', label: '柔和' },
  { value: '高对比', label: '高对比' },
  { value: '午夜', label: '午夜' },
  { value: '自定义', label: '自定义' },
]

const COLOR_VISION_OPTIONS: readonly ThemeFieldOption[] = [
  { value: '标准', label: '标准' },
  { value: '色觉友好', label: '色觉友好' },
]

function presetOptions(values: readonly string[]): readonly ThemeFieldOption[] {
  return values.map((value) => ({ value, label: value }))
}

const BACKGROUND_TYPE_OPTIONS: readonly ThemeFieldOption[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

export const THEME_SETTINGS_FORM: readonly ThemeFieldGroup[] = [
  {
    title: '01 · 基础与外观',
    fields: [
      {
        key: 'themeMode',
        label: '默认主题模式',
        kind: 'select',
        options: THEME_MODE_OPTIONS,
        help: '「北京时间自动」在北京时间 07:00–18:59 使用浅色、其余时段使用深色；「跟随系统」跟随浏览器的深浅色偏好。',
        note: '四个取值原样写入 theme_options.themeMode，「跟随系统」存的就是 system；读取时兼容历史值 auto，按 system 处理。',
      },
      {
        key: 'dataUpdateInterval',
        label: '数据更新间隔',
        kind: 'number',
        min: 5,
        max: 60,
        unit: '秒',
        help: '只在实时连接不可用时生效：页面改为按这个间隔定时刷新数据。',
        note: '实时数据由 CFSM 主动推送，频率取决于站点自己的上报设置，主题无法修改，本项也不影响它。每次定时刷新都要重新读取站点配置与节点列表，因此最短 5 秒。',
      },
      {
        key: 'defaultViewMode',
        label: '默认视图模式',
        kind: 'select',
        options: VIEW_MODE_OPTIONS,
        help: '节点列表的默认显示模式。',
      },
      {
        key: 'nodeCardSize',
        label: '节点卡片尺寸',
        kind: 'select',
        options: CARD_SIZE_OPTIONS,
        help: '从高密度迷你到宽松，默认紧凑。',
        enabled: (settings) => settings.defaultViewMode !== 'list',
      },
    ],
  },
  {
    title: '02 · 首页布局',
    fields: [
      {
        key: 'alertEnabled',
        label: '启用公告',
        kind: 'switch',
        help: '在首页显示自定义公告。',
      },
      {
        key: 'alertTitle',
        label: '公告标题',
        kind: 'text',
        help: '公告的标题内容。',
        enabled: (settings) => settings.alertEnabled,
      },
      {
        key: 'alertContent',
        label: '公告内容',
        kind: 'textarea',
        rows: 4,
        wide: true,
        help: '公告的详细内容，支持受限 Markdown：粗体、斜体、行内代码、链接、图片与换行；不执行 HTML。',
        note: '链接只允许 http(s)、mailto、tel 与站内地址，图片只允许 http(s)、data 与站内地址，其它地址不会生成链接或图片。外站图片还要站点的内容安全策略放行才能显示。',
        enabled: (settings) => settings.alertEnabled,
      },
      {
        key: 'stopEarth',
        label: '停止地球旋转',
        kind: 'switch',
        help: '开启后地球默认不自动旋转，仍可手动拖拽查看；平铺地图本身不旋转。',
        enabled: (settings) => !settings.hideEarth && settings.earthRenderer !== 'tiled',
      },
      {
        key: 'earthRenderer',
        label: '地球样式',
        kind: 'select',
        options: EARTH_RENDERER_OPTIONS,
        help: '三种渲染都只使用地区的国家 / 地区中心坐标。',
        note: 'CFSM 公开数据只有 region，没有城市或机房坐标。',
        enabled: (settings) => !settings.hideEarth,
      },
      {
        key: 'hideEarth',
        label: '隐藏地球',
        kind: 'switch',
        help: '隐藏地球后仅显示总览卡片。',
      },
      {
        key: 'hideGeneralCard',
        label: '隐藏头部',
        kind: 'switch',
        help: '隐藏首页总览卡片；地球由「隐藏地球」单独控制，两项同时开启时整个头部区域消失。',
      },
      {
        key: 'glassColorPreset',
        label: '毛玻璃配色方案',
        kind: 'select',
        options: GLASS_PRESET_OPTIONS,
        help: '选择「自定义」后读取下方 JSON。',
        note: '作用范围是节点卡的表面色、边框、阴影与文字色，以及激活态的快捷筛选胶囊和加载失败时的「重新加载」按钮（对应下方 JSON 里的控制条颜色）；顶栏、面板、提示框与弹层不受影响。',
      },
      {
        key: 'colorVisionMode',
        label: '色觉辅助配色',
        kind: 'select',
        options: COLOR_VISION_OPTIONS,
        help: '色觉友好使用蓝、蓝绿、橙、朱红、紫红，并为图表和状态增加线型与文字区分。',
      },
      {
        key: 'glassCustomColors',
        label: '自定义毛玻璃颜色 JSON',
        kind: 'textarea',
        rows: 6,
        wide: true,
        help: 'lightCard/darkCard=卡片；lightControl/darkControl=控制条；lightText/darkText=主文字；lightMutedText/darkMutedText=次文字；lightBorder/darkBorder=边框。支持 #RRGGBB 与 #RRGGBBAA，共 10 个键。',
        enabled: (settings) => settings.glassColorPreset === '自定义',
      },
    ],
  },
  {
    title: '03 · 首页总览卡片',
    fields: [
      {
        key: 'generalCardPreset',
        label: '头部卡片方案',
        kind: 'select',
        options: presetOptions(['官方', '基础', '运维', '资源', '财务', '流量', 'GPU', '资产', '完整', '自定义']),
        help: '「完整」展示全部可用卡片；「自定义」时读取下方 keys，顺序就是显示顺序。',
      },
      {
        key: 'generalCardKeys',
        label: '自定义头部卡片 keys',
        kind: 'textarea',
        rows: 4,
        wide: true,
        help: '逗号、空格或换行分隔。可用：currentTime、memory、disk、remainingValue、monthlyCost、totalTraffic、uploadSpeed、downloadSpeed、onlineNodes、offlineNodes、avgCpu、avgGpu、avgLoad、swap、processes、connections、cpuCores、gpuNodes、gpuPeakNode、trafficQuota、trafficPeak、uploadPeakNode、downloadPeakNode、highLoadNodes、expiringNodes、trafficWarnings、connectionPeakNode、regionDistribution、systemDistribution、yearlyCost。',
        note: 'remainingValue、monthlyCost、yearlyCost 按财务显示币种合计，币种与汇率在剩余价值卡的明细里设置。trafficQuota 合计设了流量上限的节点。虚拟化分布需要 CFSM 未提供的虚拟化类型，写进去会被忽略，不以估算值补位。',
        enabled: (settings) => settings.generalCardPreset === '自定义',
      },
    ],
  },
  {
    title: '04 · 高级工具与隐私',
    fields: [
      {
        key: 'homeToolsEnabled',
        label: '登录后显示高级工具',
        kind: 'switch',
        help: '显示健康、分币种性价比、快照导出与分类拓扑。',
        note: 'CFSM 第三方主题接口不提供审计日志，工具栏里的 Audit Log 保持隐藏。',
      },
      {
        key: 'hideAdminEntryWhenLoggedOut',
        label: '隐藏后台入口',
        kind: 'switch',
        help: '未登录时隐藏顶部后台管理入口；登录后仍指向 /admin#admin。',
      },
      {
        key: 'hidePriceWhenLoggedOut',
        label: '未登录隐藏价格',
        kind: 'switch',
        help: '未登录时隐藏首页节点卡片与列表里的价格、剩余价值，以及详情页的节点价格、月均支出、剩余价值三张卡；首页顶部的剩余价值、月费用、年费用卡显示为 ***，也不能打开明细。到期时间与在线天数仍会显示。',
        note: '这是前端展示开关，不改变 CFSM 服务端的权限过滤。',
      },
      {
        key: 'providerAliases',
        label: '厂商自定义别名',
        kind: 'text',
        wide: true,
        help: '格式：Provider:alias1,alias2;Provider2:alias。',
        note: '只匹配节点名称、分组、标签、地区里的真实文本，不通过 IP 猜测厂商。',
      },
      {
        key: 'exportSecondaryPassword',
        label: '导出二级密码',
        kind: 'password',
        wide: true,
        help: '可选。设置后，快照导出在已登录基础上还需要输入该密码；留空则只校验登录。',
        note: '仅浏览器端确认，不替代 CFSM 的权限控制。',
        enabled: (settings) => settings.homeToolsEnabled,
      },
      {
        key: 'disablePageAnimation',
        label: '减弱过渡动画',
        kind: 'switch',
        help: '减少页面过渡动画，同时继续尊重系统的 reduced-motion 偏好。',
      },
    ],
  },
  {
    title: '05 · 节点卡片、列表与快捷控制',
    fields: [
      {
        key: 'homeQuickControlsEnabled',
        label: '显示主页快捷控制',
        kind: 'switch',
        help: '在节点分组旁显示收藏、总流量、峰值、离线、高负载、即将到期等快捷按钮。',
      },
      {
        key: 'homeQuickControlPreset',
        label: '快捷控制方案',
        kind: 'select',
        options: presetOptions(['基础', '流量', '运维', '完整', '自定义']),
        help: '「自定义」时读取下方 keys。',
        enabled: (settings) => settings.homeQuickControlsEnabled,
      },
      {
        key: 'homeQuickControlKeys',
        label: '自定义快捷按钮 keys',
        kind: 'textarea',
        rows: 3,
        wide: true,
        help: '逗号、空格或换行分隔。可用：favorite=收藏；totalTraffic=总流量；upload=上行；download=下行；peak=实时峰值；offline=离线；highLoad=高负载；expiring=即将到期。',
        note: 'monthlyCost 需要跨币种换算，CFSM 不提供。',
        enabled: (settings) => settings.homeQuickControlsEnabled && settings.homeQuickControlPreset === '自定义',
      },
      {
        key: 'nodeListMetadataEnabled',
        label: '列表信息栏',
        kind: 'switch',
        help: '在列表视图显示节点信息栏；关闭后隐藏厂商、地区和标签信息列。',
      },
      {
        key: 'nodeListMetadataFields',
        label: '列表信息字段 keys',
        kind: 'textarea',
        rows: 3,
        wide: true,
        help: '逗号、空格或换行分隔。可用：region=地区；group=分组；tags=自定义标签；provider=厂商（与详情页相同：按节点名称、标签、自定义别名与 asn / org 标签识别，识别不到时不显示）。',
        note: 'city 依赖 IP 查询，CFSM 不提供；asn 能从节点标签取到，但列表信息栏没有这一列，只在详情页的厂商格显示。两者写进去都会被忽略，默认值里的 asn 同理。',
        enabled: (settings) => settings.nodeListMetadataEnabled,
      },
      {
        key: 'nodeListCustomTagsVisible',
        label: '列表显示自定义标签',
        kind: 'switch',
        help: '列表信息字段包含 tags 时，是否显示节点自定义标签；无标签的节点不会显示空标签。',
        enabled: (settings) => settings.nodeListMetadataEnabled,
      },
      {
        key: 'offlineNodesLast',
        label: '离线节点置底',
        kind: 'switch',
        help: '筛选或排序时把离线节点排在最后。超过 5 分钟没有上报的节点视为离线。',
      },
      {
        key: 'homeHighLoadThreshold',
        label: '高负载阈值',
        kind: 'number',
        min: 1,
        max: 100,
        unit: '%',
        help: 'CPU、内存或硬盘占用达到该百分比时归为高负载节点。',
      },
      {
        key: 'homeTrafficWarningThreshold',
        label: '流量预警阈值',
        kind: 'number',
        min: 1,
        max: 100,
        unit: '%',
        help: '节点流量配额使用率达到该百分比时归为流量预警。',
        note: '只在 traffic_limit 能被可靠解析时生效。',
      },
      {
        key: 'homeExpiringDays',
        label: '即将到期天数',
        kind: 'number',
        min: 1,
        max: 3650,
        unit: '天',
        help: '节点剩余天数小于等于该值时归为即将到期，使用 CFSM 的 expire_date。',
      },
      {
        key: 'diskPredictionEnabled',
        label: '启用磁盘耗尽预测',
        kind: 'switch',
        help: '按历史里的磁盘用量趋势预测耗尽时间，显示在详情页负载图的磁盘卡上；样本少于 2 天或未增长时不显示。',
        note: 'CFSM 没有独立的负载记录接口，预测直接复用详情页已取回的历史，不额外请求；因此需要把时间范围选到 2 天以上，未登录时最多只能取 24 小时。首页健康面板的磁盘风险榜需要为每台节点各取一次历史，本主题不做。',
      },
      {
        key: 'diskPredictionThresholdDays',
        label: '磁盘预测预警天数',
        kind: 'number',
        min: 1,
        max: 3650,
        unit: '天',
        help: '预计剩余天数小于等于该值时，详情页负载图的磁盘卡用预警色提示。',
        enabled: (settings) => settings.diskPredictionEnabled,
      },
    ],
  },
  {
    title: '06 · 节点详情概览卡片',
    fields: [
      {
        key: 'nodeDetailSectionTabsEnabled',
        label: '详情页分区标签页',
        kind: 'switch',
        help: '默认关闭，保持节点详情页纵向连续展示；开启后按概览、负载、延迟分区显示。',
      },
      {
        key: 'detailMetricCardPreset',
        label: '详情概览卡片方案',
        kind: 'select',
        options: presetOptions(['财务', '状态', '资源', '网络', 'GPU', '综合', '自定义']),
        help: '宽屏每行 4 张，中屏 3 张，移动端 2 张；「自定义」时读取下方 keys。',
      },
      {
        key: 'detailMetricCardKeys',
        label: '自定义详情卡片 keys',
        kind: 'textarea',
        rows: 4,
        wide: true,
        help: '逗号、空格或换行分隔。可用：nodePrice、monthlyCost、remainingTime、remainingValue、cpuUsage、gpuUsage、memoryUsage、swapUsage、diskUsage、load、processes、connections、uptime、uploadSpeed、downloadSpeed、totalTraffic、trafficQuota。',
        note: 'temperature 需要温度字段，CFSM 的详情接口与历史列里都没有；缺数据的卡片会自动收起，不显示为 0。',
        enabled: (settings) => settings.detailMetricCardPreset === '自定义',
      },
    ],
  },
  {
    title: '07 · 节点详情图表',
    fields: [
      {
        key: 'gpuChartEnabled',
        label: '显示 GPU 指标图',
        kind: 'switch',
        help: '控制 GPU 利用率序列；节点没有真实 gpu_info 时自动隐藏。',
        note: 'CFSM 历史里没有显存与 GPU 温度列，这两条序列不生成。',
      },
      {
        key: 'chartDashboardPreset',
        label: '详情负载图方案',
        kind: 'select',
        options: presetOptions(['默认', '精简', '资源', '网络', 'GPU', '延迟', '运维', '完整', '自定义']),
        help: '按指标族组合；「自定义」时读取下方 keys。',
      },
      {
        key: 'chartDashboardTemplate',
        label: '自定义详情图表 keys',
        kind: 'textarea',
        rows: 4,
        wide: true,
        help: '逗号、空格或换行分隔。可用：cpu、memory、disk、network、traffic、gpu、connections、process、diskIo、ping、pingLoss，也可写中文名：CPU、内存、硬盘、网络、流量、GPU、连接、进程、磁盘IO、延迟、丢包。',
        note: 'gpuMemory 与 temperature 需要 CFSM 历史中不存在的列；缺失序列不会合成。',
        enabled: (settings) => settings.chartDashboardPreset === '自定义',
      },
    ],
  },
  {
    title: '08 · 自定义背景',
    fields: [
      {
        key: 'backgroundEnabled',
        label: '启用自定义背景',
        kind: 'switch',
        help: '启用后可设置自定义图片或视频作为页面背景；无有效地址时回落到内置动态背景。',
      },
      {
        key: 'backgroundType',
        label: '背景类型',
        kind: 'select',
        options: BACKGROUND_TYPE_OPTIONS,
        help: '图片或视频。',
        enabled: (settings) => settings.backgroundEnabled,
      },
      {
        key: 'lightBackgroundUrl',
        label: '亮色模式背景地址',
        kind: 'text',
        help: '支持 http(s) 地址、站内 / 路径；本地文件填 local:文件名，映射到 /themes/user-assets/。',
        enabled: (settings) => settings.backgroundEnabled,
      },
      {
        key: 'darkBackgroundUrl',
        label: '暗色模式背景地址',
        kind: 'text',
        help: '与亮色地址同一规则；留空时该模式使用内置背景。',
        enabled: (settings) => settings.backgroundEnabled,
      },
      {
        key: 'backgroundBlur',
        label: '背景模糊半径',
        kind: 'number',
        min: 0,
        max: 80,
        unit: 'px',
        help: '背景的高斯模糊半径，0 表示不模糊。',
        enabled: (settings) => settings.backgroundEnabled,
      },
      {
        key: 'backgroundOverlay',
        label: '背景遮罩强度',
        kind: 'number',
        min: -100,
        max: 100,
        unit: '%',
        help: '范围 -100 到 100；0 关闭，正数加深，负数提亮。',
        enabled: (settings) => settings.backgroundEnabled,
      },
    ],
  },
]

export const THEME_FORM_FIELDS: readonly ThemeField[] = THEME_SETTINGS_FORM.flatMap((group) => group.fields)

export function isFieldEnabled(field: ThemeField, settings: ThemeSettings): boolean {
  return field.enabled ? field.enabled(settings) : true
}
