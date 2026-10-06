# 主题设置审计

> 基线：Komari Glassmorphism v3.3.7 的 `komari-theme.json`，提交 bf8376587c720de915ac48789a8a180357c762d6。状态描述在 CFSM 上的最终适配可行性，不等同于当前实现进度。

共审计 **48** 个设置：**✅ 一致 28 个、🟢 等价 11 个、🟡 降级 7 个、🔴 不支持 2 个**。

## 第 7 至 8 轮落地范围

第 6 轮建立的 48 项版本化 schema、defaults → backend → local 三层架构与唯一 store 保持不变。第 7 轮新增 `src/domain/theme-presentation.ts`，把总览卡片、快捷控制、列表厂商别名、预警条件、详情卡片和图表族选择集中为纯领域选择器；组件仍只消费 normalized model，不读取 CFSM wire 字段。

设置页提供即时预览、保存到当前浏览器、清除本地覆盖并使用后端、保存到 CFSM、完整 JSON 复制/查看。后端保存只调用 `POST /api/theme_options`，发送 48 个已知项加保留的未知后端项；JWT、Turnstile 和收藏等本地专属键会被剔除。成功时先采用响应中的 `theme_options`，清除 local，再回读 `/api/config`；若请求期间继续编辑，则保留新草稿供重试，而非用首次回包覆盖。400、401、403 与网络错误也保留草稿。

冷启动配置未返回前只显示设置骨架屏，避免先展示默认草稿再切换。相同草稿的重复后端保存只写一次；若上一笔尚未结束而草稿已变化，第二次提交会明确提示“上一次保存尚未完成”，不会伪报成功，新草稿保留待用户再次保存。

第 1.1.13 候选的冷启动暂存仍使用独立键 `cfsm-glassmorphism.site-theme-hint.v1`，只保存上一次成功回读 `/api/config` 后由后端决定的站点明暗模式与 `backgroundEnabled` 布尔值，不保存背景地址。旧 v1 记录缺少背景字段时视为未启用。配置尚未确定时，明暗优先级为访客本地覆盖 → 暂存 → 未配置站点的 `preferred_theme=auto`（即跟随系统）；背景开关优先级为访客本地覆盖 → 暂存 → 未启用。成功后以后端与本地覆盖为准；失败后回到未配置站点的解析结果与本地覆盖，但不删除暂存。暂存值不属于下方三层设置，不进入设置页草稿、配置来源统计、本地覆盖计数、复制 JSON 或 `POST /api/theme_options` 快照；存储异常时直接忽略。

背景层在无暂存值或暂存为未启用时立即挂载默认图；自定义图片先预加载，完成后以 0.8 秒过渡显示媒体层并卸下默认图，失败则始终保留默认图。视频加载期间显示上游的明暗加载层，媒体透明，`loadeddata` / `canplay` 后淡入，失败时显示回退层。暂存或本地覆盖表明启用自定义背景时，配置返回前和首张图片加载期间不挂载默认图，避免多请求马上被替换的图；首张图失败才挂载默认图，暂存过期而配置未启用自定义背景则立即显示默认图。首次访问自定义背景站点（无暂存值）仍会先加载默认图，这是不保存背景地址时的预期代价；不增加后端字段。图片预加载与最终展示均不带 Referer。

设置页现已开放并真实兑现总览卡片预设 / 自定义 keys、五套快捷控制方案、列表 metadata 与 provider aliases、高负载 / 流量 / 到期阈值、详情卡片预设 / 自定义 keys、图表预设 / 自定义指标族以及 GPU 图表开关。不可用 key 在领域注册表边界被忽略；字段存在但当前节点没有数据时对应卡片或序列自动收起。

第 8 轮继续复用同一 48 项 schema 与保存协议，并启用 `earthRenderer`、`stopEarth`、`hideEarth`、`homeToolsEnabled` 和 `exportSecondaryPassword` 的实际界面。Earth 只按显式 region 的国家/地区中心放点；高级工具只在 `/api/config.authorization === true` 时显示，并消费首页已加载的 normalized snapshot。导出二次口令只提供客户端确认，不宣称后端安全边界。磁盘耗尽预测仍等待独立轮次；`rpcTransportMode` 固定为 `http`（语义为官方 REST + WebSocket），`visitorInfoEnabled` 强制为 `false`。`remainingValue`、精确换汇、ASN、城市与外部 IP Geo 等缺失能力不会为了填满预设而合成。（后续：v1.1.7 起剩余价值与费用合计按浏览器取得的公开日汇率换算，来源如实标注，见 `docs/finance-parity.md`。）

首页快捷控制八个 key 均有实际行为：`favorite`、`offline`、`highLoad`、`expiring` 过滤当前结果；`totalTraffic`、`upload`、`download`、`peak` 使用真实指标排序。流量预警只接受数字（按 CFSM 当前管理端语义视为 GiB）或带 B/KiB/MiB/GiB/TiB 单位的可靠上限，并按 `traffic_calc_type` 的 dl/ul/max/total 语义计算；无法解析时不计入预警。

原 `cfsm-glassmorphism.dashboard.v1` 中的主题、视图和离线排序会一次性迁移到 `cfsm-glassmorphism.theme-options.v1`；旧 key 此后只保留 source+id 收藏。本地覆盖使用带 `version: 1` 的独立快照，即使清空也保留空层标记，避免再次迁移旧外观值。

第 10 轮 v1.0.0 没有修改 48 项 schema、默认值、保存 body 或三层合并顺序。双版本浏览器审计中的 light/dark/beijing、realistic/cobe/tiled、四种卡片密度和 list 均通过现有 runtime 即时切换；新增的“高级工具是否展开”仅是 `dashboard-view` 会话状态，默认关闭，明确不属于第 48 项设置，也不写入 localStorage 或后端 `theme_options`。

## 第 12 轮（Test 3）设置页重建

48 项 schema、默认值、保存协议与三层合并顺序不变，改的是页面呈现与四处接线。

设置页此前只渲染了 44 项、并成 5 组，且分组与上游不同。第 12 轮起字段表集中在
`src/domain/theme-settings-form.ts`：分组标题、分组顺序与组内字段顺序逐条对应
`komari-theme.json` 的 `configuration.data`（8 组，01 基础与外观 … 08 自定义背景），
页面按这张表渲染，`tests/theme-settings-form.test.ts` 锁定"48 项每项有且只有一个控件"。
页面顶栏改用与首页、详情页同一个 `AppHeader`（设置页没有节点数据，状态条关闭而不是显示 0/0）。

四处此前"有配置无行为"的项已接线：`dataUpdateInterval` 驱动首页与详情页的 REST 回退
轮询间隔（下限 5 秒）；`diskPredictionEnabled` / `diskPredictionThresholdDays` 落地为详情页
负载图磁盘卡的耗尽预测与预警色；`nodeDetailSectionTabsEnabled` 补上设置页开关。

`rpcTransportMode` 与 `visitorInfoEnabled` 经复核确属 CFSM 不提供（后端源码与
`theme-develop.md` 中既没有 RPC 传输层，也没有任何把访客 IP 或审计数据交给主题的接口），
因此设置页**不呈现**这两项，避免出现点了没反应的控件。两项仍保留在 48 项 schema 与
`POST /api/theme_options` 的完整快照中——保存协议要求发送完整对象；是否连同 schema 一并
移除，作为正式版待办记录在 `docs/todo.md` TODO-02。设置页因此渲染 46 个控件。

## 状态定义

- ✅ 一致：配置含义和用户体验可以原样保留。
- 🟢 等价：数据结构或底层机制改变，但可达到等价体验。
- 🟡 降级：只对 CFSM 确实提供的字段生效；不可用子项必须隐藏或说明。
- 🔴 不支持：缺少 CFSM 公开主题能力，禁用并说明，不能接入私有 API 或 mock。

## 逐项矩阵

| # | key | 类型 / 原默认值 | CFSM 处理 | 状态 |
|---:|---|---|---|---|
| 1 | `themeMode` | select / `beijing` | 保留 beijing 定时明暗；同时映射 config 的 auto/light/dark 偏好 | 🟢 等价 |
| 2 | `dataUpdateInterval` | number / `5` | 第 12 轮接入首页与详情页的 REST 回退轮询间隔（取值 5–60 秒，下限来自回退轮询自身的开销，与服务端推送节奏无关）；服务端 WS 批次由 CFSM 决定，主题改不了 | 🟡 降级 |
| 3 | `rpcTransportMode` | select / `http` | CFSM 无 Komari HTTP/WebSocket RPC 二选一；固定使用官方 REST + WS | 🔴 不支持 |
| 4 | `defaultViewMode` | select / `card` | 保留 card/list | ✅ 一致 |
| 5 | `nodeCardSize` | select / `compact` | 保留 mini/compact/comfortable/large | ✅ 一致 |
| 6 | `alertEnabled` | switch / `false` | 存于 theme_options，控制首页公告 | ✅ 一致 |
| 7 | `alertTitle` | string / 空 | 存于 theme_options | ✅ 一致 |
| 8 | `alertContent` | richtext / 空 | 受限 Markdown（粗体、斜体、行内代码、链接、图片、换行），移植自上游 `MarkdownRenderer`；不生成 HTML 字符串、不用 `v-html`，链接只放行 http(s) / mailto / tel / 站内地址，图片只放行 http(s) / data / 站内地址；与上游一样，正文为空时整个公告不出现，标题可选 | ✅ 一致 |
| 9 | `stopEarth` | switch / `false` | 控制 realistic/cobe 动画；tiled 本身不旋转 | ✅ 一致 |
| 10 | `earthRenderer` | select / `realistic` | 已实现 realistic/cobe/tiled 三种可区分渲染 | ✅ 一致 |
| 11 | `hideEarth` | switch / `false` | 控制首页 Earth/Map 视觉区 | ✅ 一致 |
| 12 | `hideGeneralCard` | switch / `false` | 只隐藏总览卡片；地球由 `hideEarth` 单独控制，两项同时开启头部才整体消失 | 🟢 等价 |
| 13 | `visitorInfoEnabled` | switch / `true` | CFSM 公开主题 API 不提供访客 IP 或审计能力；强制关闭 | 🔴 不支持 |
| 14 | `glassColorPreset` | select / `翡翠` | 保留翡翠/柔和/高对比/午夜/自定义，16 个取值逐字取自上游 `glassTheme.ts`。作用于节点卡，以及上游同一规则在本主题里有对应元素的两处控件：激活态快捷筛选胶囊、加载失败时的「重新加载」。上游其余消费者（财务对话框等）本主题尚无对应界面，逐项清单见 `docs/todo.md` TODO-03 | 🟡 部分 |
| 15 | `colorVisionMode` | select / `标准` | 保留标准/色觉友好及非颜色编码 | ✅ 一致 |
| 16 | `glassCustomColors` | richtext / 10 个颜色键 JSON | 校验颜色 schema 后映射 CSS 变量 | ✅ 一致 |
| 17 | `generalCardPreset` | select / `基础` | 指标注册表改为 CFSM 领域字段，保留预设交互 | 🟢 等价 |
| 18 | `generalCardKeys` | richtext / memory、disk、remainingValue、totalTraffic、uploadSpeed、downloadSpeed | 第 11 轮起 key 集合与顺序按上游 `ALL_GENERAL_CARD_KEYS` 排列。v1.1.7 起 remainingValue / monthlyCost / yearlyCost 恢复，按财务显示币种合计，剩余价值卡可打开明细，显示币种与汇率在明细里设置（浏览器本地偏好，不新增后台键）；峰值节点（上行 / 下行 / 连接 / GPU）与流量配额由 CFSM 的实时网速、连接数、GPU 利用率、流量上限与月度流量真实计算；只有虚拟化分布因 CFSM 没有虚拟化类型而隐藏，不以估算值补位 | 🟡 降级 |
| 19 | `homeToolsEnabled` | switch / `true` | 登录态显示真实健康、分币种价值、快照与分类拓扑；Audit Log 隐藏 | 🟡 降级 |
| 20 | `hideAdminEntryWhenLoggedOut` | switch / `false` | 根据 authorization 控制 `/admin#admin` 链接 | ✅ 一致 |
| 21 | `hidePriceWhenLoggedOut` | switch / `false` | 根据 authorization 隐藏财务字段：首页卡片与列表的价格、剩余价值，以及详情页的节点价格 / 月均支出 / 剩余价值；v1.1.7 起首页顶部的剩余价值 / 月费用 / 年费用卡显示 `***`，不能打开明细，也不请求汇率 | ✅ 一致 |
| 22 | `providerAliases` | string / 空 | 仅匹配 name/group/tags/region 中真实文本，不做 IP Geo 猜测 | 🟢 等价 |
| 23 | `exportSecondaryPassword` | string / 空 | 已用于客户端导出二次确认；不宣称后端安全边界 | ✅ 一致 |
| 24 | `disablePageAnimation` | switch / `false` | 保留并叠加系统 reduced-motion 偏好 | ✅ 一致 |
| 25 | `homeQuickControlsEnabled` | switch / `true` | 保留快捷控制区 | ✅ 一致 |
| 26 | `homeQuickControlPreset` | select / `完整` | 保留基础/流量/运维/完整/自定义 | ✅ 一致 |
| 27 | `homeQuickControlKeys` | richtext / favorite、totalTraffic、peak、offline | 第 11 轮起允许的 key 集合独立于「完整」预设，与上游 `ALL_HOME_QUICK_CONTROL_KEYS` 一致（默认六项 + upload + download）；`monthlyCost` 需跨币种换算，CFSM 不提供 | 🟢 等价 |
| 28 | `nodeListMetadataEnabled` | switch / `true` | 信息栏保留，但 CFSM 不提供 ASN/城市/实际 IP | 🟡 降级 |
| 29 | `nodeListMetadataFields` | richtext / provider、region、asn | region/tags/group 可用；provider 仅文本匹配；city 无数据源，asn 有数据（取自节点标签、详情页在用）但列表未实现该列 | 🟡 降级 |
| 30 | `nodeListCustomTagsVisible` | switch / `true` | 映射 CFSM 逗号分隔 tags | ✅ 一致 |
| 31 | `offlineNodesLast` | switch / `false` | 使用统一五分钟在线判定排序 | ✅ 一致 |
| 32 | `homeHighLoadThreshold` | number / `80` | 对 CPU、内存、磁盘真实百分比生效，限制 1–100 | ✅ 一致 |
| 33 | `homeTrafficWarningThreshold` | number / `80` | 只在 traffic_limit 可可靠解析时生效，限制 1–100 | ✅ 一致 |
| 34 | `homeExpiringDays` | number / `30` | 使用 expire_date，限制 1–3650 | ✅ 一致 |
| 35 | `diskPredictionEnabled` | switch / `false` | 第 12 轮落地：对详情页已取回的 `disk_used` / `disk_total` 序列做最小二乘回归，显示在负载图磁盘卡副标题；不为预测追加请求，因此需要把时间范围选到 2 天以上（未登录最多 24 小时）。上游另有首页健康面板的磁盘风险榜，那需要逐节点历史，CFSM 不做 | 🟢 等价 |
| 36 | `diskPredictionThresholdDays` | number / `30` | 预计天数小于等于该值时，详情页负载图磁盘卡副标题转预警色；样本不足两天或未增长时不显示预测；限制 1–3650 的整数，越界在设置页提示，不随保存悄悄回退 | ✅ 一致 |
| 37 | `nodeDetailSectionTabsEnabled` | switch / `false` | 保留连续布局/分区标签页切换；第 12 轮补上设置页开关（此前功能已实现但页面上没有入口） | ✅ 一致 |
| 38 | `detailMetricCardPreset` | select / `财务` | 预设映射到 CFSM 详情领域模型，保持响应式卡片数量 | 🟢 等价 |
| 39 | `detailMetricCardKeys` | richtext / nodePrice、monthlyCost、remainingTime、remainingValue、totalTraffic、trafficQuota、uptime、connections | 支持有真实字段的 keys；节点价格与月均支出保留原币，剩余价值按财务显示币种换算（v1.1.7）；系统温度、精确配额等按可用性隐藏 | 🟡 降级 |
| 40 | `gpuChartEnabled` | switch / `false` | 使用 gpu_info 的 id/name/info；无序列自动隐藏 | 🟢 等价 |
| 41 | `chartDashboardPreset` | select / `默认` | 将预设映射到 CFSM history 可用指标族 | 🟢 等价 |
| 42 | `chartDashboardTemplate` | richtext / cpu、memory、disk、network、gpu、connections、process | GPU 显存、GPU 温度和缺失指标不生成假序列；旧 JSON 可迁移 | 🟡 降级 |
| 43 | `backgroundEnabled` | switch / `false` | 存入 theme_options，控制统一背景组件 | 🟢 等价 |
| 44 | `backgroundType` | select / `image` | 保留 image/video，采用浏览器安全加载策略 | 🟢 等价 |
| 45 | `lightBackgroundUrl` | string / 空 | 支持 http(s) 与站内路径；local: 迁移为主题可访问静态路径 | 🟢 等价 |
| 46 | `darkBackgroundUrl` | string / 空 | 与亮色 URL 同一规则 | 🟢 等价 |
| 47 | `backgroundBlur` | number / `0` | 媒体层 `filter: blur(Npx)`；0 时为 `none`，不附加缩放；非负校验 | ✅ 一致 |
| 48 | `backgroundOverlay` | number / `0` | 正数在默认/自定义背景之上叠 `rgba(0,0,0,N/100)`；负数将整个背景容器透明度设为 `1-|N|/100`，不叠白层；0 时两者都不启用 | ✅ 一致 |

## 配置分层与保存

配置中心必须保留三个互不混淆的层：

1. **Defaults**：上述 48 项的版本化 schema 和默认值。
2. **Backend**：`GET /api/config` 返回的 `theme_options`，用于跨设备共享。
3. **Local**：当前浏览器覆盖；清除本地后回落到 backend，再回落到 defaults。

有效值按 `defaults <- backend <- local` 合并。设置界面的“保存到 CFSM”必须把当前允许后端持久化的完整有效配置作为单个非数组对象发送到 `POST /api/theme_options`，而不是只发本次改动字段。保存成功以后端返回的完整 `theme_options` 重建 backend 层；400、401、403 时保留未保存草稿并给出可操作错误。

`jwt_token`、`turnstile_token`、`turnstile_verified`、临时对话框状态和一次性选择不得进入 theme_options。

## 迁移规则

- 未知 key 要保留在后端快照中，避免新旧版本往返保存时破坏前向兼容。
- 已知 key 在读取时做类型、枚举与范围校验；无效值回落而非强制写回。
- 原多行 keys 支持逗号、空格或换行分隔，保存时规范化并去重但保持顺序。
- `glassCustomColors` 和旧的 `chartDashboardTemplate` JSON 必须先安全解析，失败时显示错误，不执行字符串。
- 红色设置保留迁移说明，但不向用户展示一个看似可用、实际依赖 mock 的开关。
- 后端保存前会从当前有效草稿生成全部 48 个已知键；未知后端键原样往返，但鉴权凭证和本地专属键永不进入 payload。
