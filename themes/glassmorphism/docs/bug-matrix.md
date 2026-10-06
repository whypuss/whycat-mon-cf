# 功能 Bug 审计矩阵（第 14 轮）

> 涉及历史部署的节点名已用字母代称，数值与裁决结论仍记录当时的只读核验。

基线：`v1.1.0-test.4` / `8fec94b5c80c8a69374904d19e05e4496beb6e18`
数据契约来源：`docs/cfsm-source-audit.md`（CFSM Worker `2.8.5 Beta5` + Agent `1.3.8` + 真实部署响应）

状态取值：`PASS` / `BUG-CONFIRMED` / `UPSTREAM-LIMITATION` / `NECESSARY-CFSM-DIFFERENCE` /
`DEFERRED-UI-CONFLICT` / `NOT-A-BUG` / `NEEDS-EVIDENCE`。

## 已确认并修复的 Bug

| ID | 页面 / 链路 | 现象 | 证据 | 根因 | 分类 | 修复位置 | 测试 | UI 影响 | 状态 |
|---|---|---|---|---|---|---|---|---|---|
| BUG-001 | 首页 NodeCard 延迟 / 丢包柱 | 柱子数量随缺口变化、与标题标注的线路对不上、时间轴错位 | 真实契约下 20 桶 × 4 线路 → 浏览器实测渲染出 **68 根**柱子；上游 `useNodePingDisplay.buildPingBars` 是 `points.map`，一桶一柱 | `toGlassServer` 把 `20 × 4` 拍平成一维数组并过滤掉 `null`/`false`，产物既不是时间序列也丢失了空洞位置 | BUG-CONFIRMED | `glassmorphism-adapter.ts`（按目标分组）+ `ServerCard.vue`（逐桶渲染）+ `main.css`（`.is-gap`） | `tests/cfsm-data-contract.test.ts`「首页窗口按探测目标分组」 | 柱数由 68 → 20，空洞保留原位；柱高与色阶不变 | 已修复 |
| BUG-002 | 首页 NodeCard / NodeList 探测目标 | CFSM 2.8.5 起的 `node_1`～`node_4` 在首页从不显示（详情页正常） | `GlassServer.latency` 被限定为 `LatencyCarrier`（仅 4 项）；`latencyCarrierKeys()` 只返回旧四线路；而 CFSM `mergeMetricsIntoServer` 写入全部 8 项 | 类型与遍历都只覆盖旧四线路 | BUG-CONFIRMED | `types/glassmorphism.ts` + `glassmorphism-adapter.ts`（改用 `PROBE_TARGETS`） | 同上「首页保留 node_1～node_4」 | 只配置了 node 探测点的节点首页不再空白 | 已修复 |
| BUG-003 | 首页 + 详情页价格 / 到期 / 流量可见性 | 站点设置 `show_price=false` 等完全不生效 | 真实响应：`/api/servers` 顶层 `sysConfig` 有这三个开关，`/api/config` 与 `/api/server` 都没有；浏览器实测关掉后价格芯片、剩余天数、流量配额仍然显示 | 集合级 `systemConfig` 解析后**零消费者**；`toGlassServer` 读的是每台节点上的 `systemConfig`（列表里恒为 undefined） | BUG-CONFIRMED | `adapters.ts`（集合开关下发到每台节点）+ `stores/servers.ts`（`siteVisibility(base)`）+ `ServerDetailView.vue` | 同上「站点级展示开关下发到每台节点」 | 关掉后首页与详情页均正确隐藏；未设置时保持可见 | 已修复 |
| BUG-004 | 首页总览卡片 | 长数值被截断，如 `455.0` 显示成 `45…`，`GB / 1.56 TB` 也被截 | 768px 实测：CFSM 主数值 `w36/sw63`，同宽度 Komari `w38/sw63`；CFSM 单位 `flex:none` + `max-width:60%`，上游只有 `truncate` | 自创的 `flex: none` + `max-width: 60%` 把单位钉死并硬占六成宽度，主数值只能拿剩下的 | BUG-CONFIRMED | `main.css` `.overview-card__unit` | `tests/cfsm-data-contract.test.ts`「总览卡片单位不再抢占主数值的宽度」 | 390 / 768 实测空间分配与上游一致 | 已修复 |
| BUG-005 | 首页总览卡片数值行 | 单位与"已用 / 总量"说明相对主数值上浮并贴死主数值 | 1440×900 实测：`document.querySelectorAll('.overview-card__value').length === 0`；数值行实际是 `.app-tooltip`（`display:flex`、`align-items:normal`、`column-gap:normal`），单位盒被拉伸到 24px，单位基线比主数值高 9px、间距 0；同机 Komari `bf83765` 为基线差 0、间距 4px | `overview-card__value` 是写在 `<AppTooltip>` 上的透传属性，而 `AppTooltip` 的根节点 `TooltipProvider` 只渲染插槽（片段根），Vue 把该属性静默丢弃 | BUG-CONFIRMED | `OverviewCards.vue`（数值行移入 Tooltip 内部）+ `AppTooltip.vue`（`inheritAttrs: false` + 触发器 `v-bind="$attrs"`）+ `main.css`（`.overview-card__value-slot`、单位与标题行高） | `tests/overview-value-row.test.ts` | 单位回到基线并恢复 4px 间距，其余几何不变 | 已修复 |

## 复核后不构成 Bug

| ID | 现象 | 结论 | 依据 |
|---|---|---|---|
| N-01 | 详情页探针卡显示 `Loss 0.0%`，同页 24 小时丢包历史里却有丢包 | NOT-A-BUG | 两者口径不同：卡片标量来自 `getLatestMetrics()` = `ORDER BY id DESC LIMIT 1`（**最新一条上报**），历史来自 `/api/history/all` 的逐桶采样。用户真实节点实测：标量 `loss_ct = 0`，同节点 24 小时 180 行历史中 170 行为 0、10 行 >0、最大 16%、无 null。两者同时成立 |
| N-02 | WebSocket 增量可能清空只有列表接口才有的 `ping`/`loss` 窗口 | NOT-A-BUG | `mergeRealtimeSample` 从不写 `latencyWindow`/`packetLossWindow`；真实 `latestReportUpdates[].samples[].data` 里也确实没有 `ping`/`loss` 数组。已加回归测试锁定 |
| N-03 | 节点名、地区名被省略号截断 | NOT-A-BUG | 上游 `NodeCard` / `InstanceDetail` 同样使用 `truncate`；实测两版行为一致 |
| N-04 | 卡片旗帜 `<img>` 的 `scrollHeight` 大于 `clientHeight` | NOT-A-BUG | `object-fit: cover` 的正常表现，不是裁切缺陷；上游用 `size-5` 直接拉伸，本主题为 cover + 圆角，属第 11 轮已验收选择 |

## 上游限制与必要差异

| ID | 项 | 分类 | 说明 |
|---|---|---|---|
| U-01 | 首页 Ping / Loss 窗口只有 20 点 / 2 小时 | UPSTREAM-LIMITATION | 服务端常量 `DASHBOARD_LATENCY_WINDOW_POINTS = 20`、`DASHBOARD_LATENCY_WINDOW_HOURS = 2` 写死，且 `/api/config` 的 `latency_window` 只是把它们暴露出来。主题如实展示现有点数，不补点、不复制末点 |
| U-02 | 旧库未迁移时窗口只有 `ct/cu/cm/bd` 四个 key | UPSTREAM-LIMITATION | 服务端 `no such column` 时回退 `LEGACY_DASHBOARD_LATENCY_COLUMNS`。真实 Beta2 部署实测即为此形态。主题把缺席 key 当作「未配置」，不伪造 |
| U-03 | 探针尚未完成首轮探测时上报空串，服务端 `Number("")` → `0` | UPSTREAM-LIMITATION | 「尚未测量」在服务端就变成了真实的 `0 ms / 0%`，主题无法区分。见 `docs/cfsm-source-audit.md` 的未确认项 |
| U-04 | 详情端点在 `loss=null` 时连同 `ping` 一起删除字段 | NECESSARY-CFSM-DIFFERENCE | `omitNullLossProbeFields` 只作用于 `/api/server`。主题把字段缺席视为「未配置 / 无可用样本」，与服务端注释一致 |
| U-05 | 详情页深链接时拿不到站点级 `show_*` 开关 | UPSTREAM-LIMITATION | 这三个开关只在 `/api/servers` 顶层出现。从首页进入详情时开关正确生效（store 已有数据）；直接粘贴详情链接冷启动时无从得知，此时保持可见。要覆盖这种情况必须在详情页额外发一次 `/api/servers`，本轮不引入新的请求形态 |
| U-06 | 系统温度 | NECESSARY-CFSM-DIFFERENCE | `/api/server` 与历史列集合都没有温度字段（实读服务端 `1dc0dc4`），第 13 轮已按此隐藏温度卡 |

## UI 冲突终态

| ID | 项 | 数据事实 | Komari 表现 | 冲突位置 | 影响范围 | 候选方案 | 状态 |
|---|---|---|---|---|---|---|---|
| D-01 | 延迟 / 丢包面板主数值的口径 | CFSM 标量是**最新一条上报**（`ORDER BY id DESC LIMIT 1`），窗口是过去 2 小时 20 个桶 | Komari `useNodePingDisplay` 显示的是窗口**平均值**（`avgLatency` / `avgLoss`） | 首页 NodeCard 的延迟/丢包面板标题数值；详情页探针卡同理 | 用户已实际反馈：卡片 `Loss 0.0%` 与历史图有丢包看起来矛盾（实为口径不同，见 N-01）。改成平均值可消除这种反差并更贴近上游 | 已按 SET-008 改为对 `/api/servers` 已返回窗口取平均；窗口为空时回落最新值，不新增请求 | RESOLVED（SET-008） |
| D-02 | 总览卡片长数值在 768px 档仍会截断 | 6 列栅格下单卡内容宽度约 90px，`455.0` + `GB / 1.56 TB` 放不下 | 上游同宽度同样截断（实测 `258.6` → `w38/sw63`） | 首页总览卡片 | 修完 BUG-004 后两版空间分配已一致，残余截断属上游同等行为 | 要让长值完整可见必须改动已验收的 6 列几何或缩小字号，两者都会破坏已验收的视觉基线 | DEFERRED-UI-CONFLICT |

---

# 第二阶段 Test 1

基线：`v1.1.0` / `bec06b9`　候选：`v1.1.1-test.1`　详细过程见 [`phase2-test1.md`](phase2-test1.md)

状态口径：FIXED-LOCAL / CANDIDATE-VERIFIED / DEPLOYED-VERIFIED / NOT-REPRODUCED / DEFERRED / UPSTREAM-LIMITATION / NEEDS-EVIDENCE。

## v1.1.0 线上验收（只读实测）

| 项 | 线上结果 | 状态 |
|---|---|---|
| CHART-001 / CHART-002 | 8 张图 0 张黑线；轴与图例文字 `rgba(0,0,0,α≤140)` | DEPLOYED-VERIFIED |
| F-01～F-06 | 字重、字体栈、`font-synthesis` / `text-rendering` 逐项为修复后取值 | DEPLOYED-VERIFIED |
| U-05 | 冷启动直达详情：`/api/servers` 恰 1 次，节点选择器 5 项，指标卡按站点开关显示 | DEPLOYED-VERIFIED |
| 第 14 轮窗口契约 | 20 点 × 8 key，`false` 未显示成 0，首页 20 根柱 | DEPLOYED-VERIFIED |
| 资产溯源 | 线上 CSS / JS 与 v1.1.0 发布包**逐字节一致** | DEPLOYED-VERIFIED |

## 本轮新问题与处置

| ID | 现象 | 根因 | 状态 | 修复位置 | 测试 |
|---|---|---|---|---|---|
| S2-T1-001 | 历史图序列颜色与上游同名序列对不上（内存 RAM、磁盘、网络、流量、GPU、负载） | 上游内联图用的是 `getLoadChartPalette()` 角色板，第 15 轮只移植了 8 色序列板 | CANDIDATE-VERIFIED | `utils/chart-palette.ts` + `domain/server-detail.ts` | `tests/chart-colors.test.ts`「逐序列对照上游 LoadChart」 |
| S2-T1-002 | 面积填充与线宽一刀切 | 第 15 轮把内联图概括为「带渐变填充」，实际只有 CPU / RAM / 磁盘已用 / 进程数有，网络图没有；线宽分 1.5+round 与 1.6 两族 | CANDIDATE-VERIFIED | 同上 + `HistoryChart.vue` | 同上 |
| S2-T1-003 | 节点卡行盒偏小、再由卡片内边距抵消 | 12px / 11px 文本行高写成 `normal`，卡片用 14px 内边距近似上游的头部与主体分层 | CANDIDATE-VERIFIED | `styles/main.css` | `tests/typography-contract.test.ts`「节点卡盒模型照抄上游」 |

## 遗留项本轮结论

| ID | 状态 | 说明 |
|---|---|---|
| CHART-003 | **NOT-REPRODUCED** | 真实指针覆盖 1440 深浅两色、悬浮与移出、图例隐藏与恢复，曲线均正常绘制。相关事实：tooltip 为 `confine: true`，气泡遮挡绘图区 11%～21%。未覆盖移动端真实触摸与长时实时更新，交 Test 2，不改判 NOT-A-BUG |
| DEFERRED-CHART-01 | **已修复** | 见 S2-T1-001 / S2-T1-002 |
| DEFERRED-TYPO-01 | **主卡片已修复** | 节点卡 333.75 → 331.69（上游 331.81）。`comfortable` / `large` 档与详情页其余组件未动，交 Test 2 |
| D-01 | DEFERRED | 维持最新上报值；来源已复核正确，但口径歧义未消除 |
| 探针首轮空串转 0 | NEEDS-EVIDENCE | 线上 `ping_*` 标量为 0 的出现次数 = 0，但稳态无现象不等于首轮无问题 |
| node_1..4 长窗口聚合 | NEEDS-EVIDENCE | 线上 8 个 key 全为 `false`，只证明 schema 兼容 |

## 证据缺口

| 项 | 状态 |
|---|---|
| 真实页面截图 | **部分补齐**：面板可见时正常；**页面滚动后截图返回纯背景色**，图表截图改用详情分区 Tab 置于首屏取得；面板隐藏时绘制类动作超时 |
| Rendered Fonts | **未补齐**：仍为同浏览器 Range 宽度指纹，结论限本机 |
| 图例真实点击 | **已补齐**：真实指针双向切换，有截图与像素证据 |

---

# 第 15 轮（第二正式版收口）

基线：`v1.1.0-test.5` / `961a4edb1683e72b6bd615e3d0b8c69783d4eccc`
Komari 基准：`bf8376587c720de915ac48789a8a180357c762d6`
真实部署本轮实测版本：Worker **`2.8.5 Beta5`**（第 14 轮时是 Beta2，数据库已完成迁移）

## 本轮确认并修复

| ID | 页面 / 链路 | 现象 | 证据 | 根因 | 分类 | 修复位置 | 测试 | 状态 |
|---|---|---|---|---|---|---|---|---|
| CHART-001 | 详情页全部历史图 | 多条折线呈黑色，与 tooltip 色点、底部摘要色点不一致 | 画布像素采样：9 张图绘图区**只有** `0,0,0`；修复后为 `#FF6B6B` / `#4ECDC4` / `#A78BFA` / `#60A5FA` / `#FFB347`，与 HTML 色点逐一相等；上游同位取样同色 | 序列颜色写成 `var(--emerald)` 等 CSS 变量，而 ECharts 走 CanvasRenderer，**canvas 不解析 CSS 变量**，赋值被丢弃 | BUG-CONFIRMED | 新增 `utils/chart-palette.ts`（移植上游 `chartPalette.ts`）+ `domain/server-detail.ts` 改按调色板取色 + `ServerDetailView` 按色觉设置派生调色板 | `tests/chart-colors.test.ts` | 已修复 |
| CHART-002 | 详情页全部历史图 | 浅色模式下图内图例文字偏白、可读性不足 | 图例条带修复前为不透明 `255,255,255`；修复后浅色 `rgba(0,0,0,0.55)`、深色 `rgba(255,255,255,0.55)`，与上游同位取样一致 | 同 CHART-001：图例 / 坐标轴 / 网格线颜色同样是 CSS 变量 | BUG-CONFIRMED | `HistoryChart.vue` 改用移植自上游 `chartThemeColors` 的 `getChartThemeColors(dark)` | 同上 | 已修复 |
| F-01 | 首页节点卡指标数值 | 数值比上游粗一档 | 该字族只有 Regular / Bold 两档，500 落 Regular、600 落 Bold；12px「17.0%」36.8px 对 34.68px | `.node-metric__value` 写 600，上游是 `font-medium`（500） | BUG-CONFIRMED | `main.css` | `tests/typography-contract.test.ts` | 已修复 |
| F-02 | 首页延迟 / 丢包面板数值 | 同上 | 11px「21.0 ms」43.01px 对 40.66px | `.node-probe__value` 写 600 + 上游没有的 `tabular-nums` | BUG-CONFIRMED | `main.css` | 同上 | 已修复 |
| F-03 | 详情页徽章 | 比上游更小更粗，高度也差 0.5px | 「在线」22px（11px/Bold）对 24px（12px/Regular）；徽章高 20.5 → **20**，与上游 `h-5` 相等 | `.app-badge` 写 11px / 600 / lh 1.5，上游是 `text-xs font-medium` = 12px / 500 / 16px | BUG-CONFIRMED | `main.css` | 同上 | 已修复 |
| F-04 / F-05 | 站点名、详情分区标题 | 声明字重高于上游，并多了负字距 | 本机同落 Bold 故无渲染差异，但带 Semibold 字面的系统会粗一档；字距差 −0.27px / −0.4px | 自造的 720 / `h2` 默认 700 + `-0.015em` / `-0.025em` | BUG-CONFIRMED | `main.css` | 同上 | 已修复 |
| F-06 | 历史图表 tooltip | 字号比上游小 1px | 上游 `MetricSeriesChartCard` 是 `fontSize: 12` | 写成 11 | BUG-CONFIRMED | `HistoryChart.vue` | 同上 | 已修复 |
| U-05→FIXED | 详情页冷启动的站点开关 | 直接粘贴详情链接时 `show_price` / `show_expire` / `show_tf` 完全失效 | 实测 `showPrice=0&showExpire=0&showTf=0` 直达详情：修复前 8 张指标卡全在；修复后只剩「累计流量 / 运行时间 / 连接数」，`/api/servers` 恰好 1 次 | store 为空时取不到顶层 `sysConfig`；第 14 轮以「不引入新请求形态」记为上游限制 | BUG-CONFIRMED（推翻第 14 轮结论） | `ServerDetailView`：store 为空时补一次**已有的** `serverStore.load()`；开关未知时先隐藏 | `tests/cfsm-data-contract.test.ts` 新增两条 | 已修复 |
| D-02→FIXED | 总览卡片长数值 | 768px 下 `455.0` 被截成 `45…`，完整值无从读取 | CFSM 主数值 43/63、单位 48/71；上游 `258.6` 38/63、单位 48/80，**截得更狠且这三张卡根本没有 tooltip** | 上游在该位置未提供任何可访问路径 | BUG-CONFIRMED（不按「上游同等行为」放行） | `theme-presentation.ts`：内存 / 硬盘 / 交换内存的 tooltip 改为「完整已用 / 总量 + 占比」；系统分布 / 地区分布改用上游 `formatDistributionTooltip` 的完整列表 | `tests/typography-contract.test.ts` | 已修复 |

## 本轮复核后的既有遗留项

| ID | 项 | 本轮结论 |
|---|---|---|
| D-01 | 延迟 / 丢包面板主数值口径（当前值 vs 窗口平均） | **维持当前值**。已复核：标量确实来自 `getLatestMetrics()` 的最新一条上报，历史来自逐桶采样，来源与时间范围都正确，无 stale value、无错 source，`null` / `false` / 缺失均未变成 0。上游显示的是窗口平均，属展示语义差异；改口径需要先定义窗口、采样与加权规则，且会改动第 11 / 13 轮已验收的数值，本轮不实施。发布说明已写明该语义差异。面板已有原生 `title` 提示，但**未新增占布局空间的固定说明文字**，也未新增上游没有的交互——因此「口径歧义已消除」这一点**不成立**，作为未解决的展示冲突继续登记。 |
| D-02 | 768px 长数值截断 | 截断本身与上游同等（本主题分给主数值的宽度反而更多：43 对 38），保留；**完整值不可读**这一半已按上述修复。 |
| U-03 | 探针首轮空串经 `Number("")` 变成真实 0 | 真实部署（Beta5）全量 `/api/servers` 响应中 **`ping_*` 标量为 0 的出现次数 = 0**，没有观察到该污染。结论仍只能由源码推导，影响范围限于「节点或探测目标刚配置好、尚未完成首轮探测」的那一个上报窗口。非阻塞，保留记录。 |
| U-01 / U-02 / U-04 / U-06 | 窗口 20 点 2 小时、旧库 4 key、详情端点删字段、无温度 | 维持第 14 轮结论。其中 U-02 在本轮真实部署上已不再触发（见下）。 |

## NEEDS-EVIDENCE 三项的本轮结论

| 项 | 结论 |
|---|---|
| 探针 `""` → `0` | **仍无实机证据**，但真实部署未观察到任何 `ping_*: 0`。非阻塞。 |
| `node_1..4` 在已迁移数据库上的窗口表现 | **已解决**。真实部署升级到 Beta5 且已迁移，`/api/servers` 的窗口点现在是完整 8 个 key：`{ts, ct, cu, cm, bd, node_1..node_4}`，未配置目标取值 `false`。第 14 轮 BUG-002 的修复据此在真实数据上得到验证。 |
| History 对 `node_1..4` 的聚合策略 | **仍未确认**：该部署的 node_1..4 全部未配置（`false`），无法观察聚合行为。非阻塞，继续记录。 |

## 本轮新增的已记录差异（不计为 PASS）

| ID | 项 | 数据事实 | 为什么本轮不改 |
|---|---|---|---|
| DEFERRED-TYPO-01 | `line-height` 广泛使用 `normal`，上游是 Tailwind 具体值（12px→16、14px→20、11px→15.7143、16px→24、18px→28） | 本主题文字行盒每行小 1~2.5px，但被更大的 padding / gap 抵消：1440 节点卡高 Komari `331.81`、CFSM `333.77`；**把上游行高逐项注入后卡高变 `335.34`**，误差反而从 1.96px 扩大到 3.53px | 单独对齐行高会让容器几何离上游更远；正确做法是连同 padding / gap 从上游重新推导整张卡的盒模型，等于重做第 11 / 13 轮已验收几何 |
| DEFERRED-CHART-01 | 上游 `LoadChart` 内联的 CPU / 内存 / 磁盘 / 网络 / GPU 图带 `areaStyle` 渐变填充且线宽 1.5 + `cap: round`；本主题统一走 `MetricSeriesChartCard` 形态（纯折线、1.6） | 见 `docs/chart-parity.md` 的逐图对照表 | 属「一个组件覆盖全部分族」的既有结构选择，改动会波及第 13 轮已验收的详情几何 |
| CHART-003 | 悬浮网络图曲线消失 | **未复现**：1440 / 375、浅色、三个横向悬浮位置 + 移出，两条序列像素数恒为 `#4ECDC4`×649 / `#60A5FA`×528。相关事实：tooltip 为 `confine: true`（上游 `LoadChart` 是 `false`），气泡覆盖绘图区 1440 约 11%、375 约 21% | 无法复现即无法确认根因；颜色修复已消除「赋值无效 → 重绘沿用上一次样式」这一不确定来源。等待实际应用反馈 |

## 证据缺口（单列，不计为已验证）

- DevTools「Rendered Fonts」面板不可用，实际字形归属用同浏览器 Range 宽度指纹判定。
- Browser 面板隐藏导致截图返回空白，视觉证据一律改用 `getImageData` 直接读画布像素。
- 图表**图例点击开关**未能用合成指针事件驱动，仅做结构性验证。

## 第 15 轮终态

- **P0 = 0 ｜ P1 = 0 ｜ 未解决的发布阻塞项 = 0**
- BUG-CONFIRMED 10 项，全部已修复并有回归测试
- DEFERRED 3 项（TYPO-01 / CHART-01 / CHART-003），均写明数据事实与不改的理由
- NEEDS-EVIDENCE 由 3 项减为 2 项
- 证据缺口 3 项，逐条单列

---

## 第 14 轮终态

- **P0 = 0 ｜ P1 = 0 ｜ FAIL = 0**
- BUG-CONFIRMED 4 项，全部已修复并有对应回归测试
- NOT-A-BUG 4 项，均给出真实数据或源码依据
- UPSTREAM-LIMITATION / NECESSARY-CFSM-DIFFERENCE 6 项
- DEFERRED-UI-CONFLICT 2 项，均写明数据事实、上游表现、影响范围与候选方案，留待下一版本裁决
- NEEDS-EVIDENCE 3 项，记录在 `docs/cfsm-source-audit.md` 的「仍未确认」一节

---

## 第二阶段 Test 2

逐项证据见 [`phase2-test2.md`](phase2-test2.md)。所有数值取自上游 Komari 页面与本主题页面的同机实测（1440×900，浅色与深色）。

| ID | 类型 | 项 | 根因 / 数据事实 | 处理 |
|---|---|---|---|---|
| CARD-CLIP-02 | BUG-CONFIRMED | 「剩余 N 天」在行边缘被裁切 | `.node-box__row` 多了一层 `overflow: hidden`，上游只在盒子上裁切 | `249483d` 改为盒子级裁切 |
| DETAIL-001 | BUG-CONFIRMED | 详情页下半部与上游结构不同 | 四个自有分区，对应上游 `LoadChart` + `PingChart` | 按上游重建，几何逐项相同 |
| DETAIL-002 | BUG-CONFIRMED | 信息卡比上游高 2px | 链接行高 20 对 16.5，分级行 15 对 16.5，存储格被拉伸 | 已修复，信息区 351 = 上游 |
| TOKEN-001 | BUG-CONFIRMED | 次要文字色偏浅偏蓝 | 预设文字色写进全局 `--ink` / `--muted`；上游只在玻璃卡片内覆盖 | 分层：基础色全局，预设色只在节点卡内 |
| HOME-001 | BUG-CONFIRMED | mini 档 CPU / 内存标签被截成「C...」「内.」 | 四项挤成 `3fr 3fr 4fr` 三列；上游是 `3fr 2fr` 且只放图标 | 改为上游结构 |
| HOME-002 | BUG-CONFIRMED | 指标标签文字被染成指标色 | 上游文字是次要色，只有图标用 Tailwind 500 档着色 | 已修复 |
| HOME-003 | BUG-CONFIRMED | 进度条颜色与阈值不同 | 自拟渐变 + 「高负载阈值」；上游是纯色 + 60 / 80 | 已修复，列表视图同步 |
| HOME-004 | BUG-CONFIRMED | 离线遮罩越界、离线卡多出红圈 | `inset: -14px` 是 Test 1 改盒模型前的遗留；上游红圈被玻璃样式覆盖，实际页面没有 | 已修复 |
| HOME-005 | BUG-CONFIRMED | 提示行、网速、流量百分比、盒子表面与上游不同 | 均为自拟色 | 已按上游实测值修复 |
| HOME-006 | BUG-CONFIRMED | 配色预设文字色与上游不同 | 预设色值自拟，与 `glassTheme.ts` 不符 | 文字色逐字对齐上游 |
| DEFERRED-CHART-01 | 已解决 | 内联图的填充与线形 | Test 2 按上游 `LoadChart` 逐图移植 | 关闭 |
| D-01 | 已裁决 | 首页丢包口径 | 本主题显示最新一桶；上游是窗口加权平均（真实部署：节点 B 1.60%、节点 C 0.80%、节点 D 3.20%） | Test 3 按上游口径改为窗口平均，见 SET-008 |
| DEFERRED-PRESET-01 | DEFERRED | 配色预设的表面色 | 驱动顶栏、提示框等上游无一一对应的界面 | 单列，另行处理 |

### Test 2 终态

- **P0 = 0 ｜ P1 = 0 ｜ 未解决的发布阻塞项 = 0**
- BUG-CONFIRMED 10 项，全部已修复并有回归测试
- 待裁决 1 项（D-01），DEFERRED 1 项（PRESET-01），CHART-003 仍未复现

> **后续补记（v1.1.7）**：DEFERRED-PRESET-01 已逐项收口。节点卡在 v1.1.1 对齐；激活态快捷筛选胶囊在 v1.1.3 接入；加载失败时的「重新加载」在 v1.1.7 接入。上游其余消费者本主题没有对应界面，清单见 `docs/todo.md` TODO-03。上表保留 Test 2 当时的原文。

---

## 第二阶段 Test 3

范围是 `/settings` 的后端对接与前端呈现。证据取自 CFSM 后端源码与 `theme-develop.md`、上游 `komari-theme.json`，以及 1440×900 与 375×812 的同机实测。

| ID | 类型 | 项 | 根因 / 数据事实 | 处理 |
|---|---|---|---|---|
| SET-001 | BUG-CONFIRMED | 设置页只渲染 44 项、并成 5 组 | 上游 48 项分 8 组写在 `komari-theme.json` 的 managed configuration 里，由 Komari 后台渲染；CFSM 无等价机制，本主题页面自拟分组并漏掉 4 项 | 字段表移入 `domain/theme-settings-form.ts`，分组标题、顺序与组内字段顺序逐条对应上游；实测 8 组 48 控件 |
| SET-002 | BUG-CONFIRMED | `dataUpdateInterval` 是死配置 | 审计表写「控制 REST 补偿刷新」，实际回退间隔在 `dashboard-realtime.ts` 写死 60 秒、下限 30 秒，该设置在 `theme/settings.ts` 之外零消费 | 改为取值函数驱动首页与详情页的回退轮询，下限取与服务端推送批次同频的 5 秒 |
| SET-003 | BUG-CONFIRMED | `diskPredictionEnabled` / `diskPredictionThresholdDays` 是死配置 | 两项同样零消费 | 移植上游最小二乘回归为 `domain/disk-prediction.ts`，接到详情页负载图磁盘卡副标题；阈值控制预警色 |
| SET-004 | BUG-CONFIRMED | `nodeDetailSectionTabsEnabled` 有实现无入口 | 详情页分区标签页已实现，设置页没有对应控件 | 06 组补上开关 |
| SIZE-001 | BUG-CONFIRMED | 舒适档比上游高 4px、宽松档矮 36px | `--compact` / `--mini` 已改成上游盒模型，注释写明「其余尺寸档留待 Test 2」却未处理；宽松档那条规则针对的 `.node-card--card` 类名从不渲染，一直空转 | 两档补齐上游盒模型（头部 44 / 52、主体 `0 16 16` / `0 24 24`、行距 12 / 16、面板 48 / 56） |
| SET-005 | NOT-A-BUG | `rpcTransportMode`、`visitorInfoEnabled` | 复核后端源码与 `theme-develop.md`：没有 RPC 传输层，也没有任何把访客 IP 或审计数据交给主题的接口 | 设置页不呈现这两项；仍保留在 48 项 schema 与保存快照中，是否从 schema 移除见 `docs/todo.md` TODO-02 |
| SET-006 | NECESSARY-CFSM-DIFFERENCE | 首页健康面板的磁盘风险榜 | 上游按逐节点历史排名；CFSM 首页没有逐节点历史，复刻需为每台节点各发一次 `/api/history/all` | 不复刻，磁盘预测只落在详情页 |
| SET-007 | NOT-A-BUG（记录更正） | `.node-box` 的分档内边距 | 源码在 v1.1.1-test.3 时就已有 mini 4px 与 compact 6px，基础档 `6px 8px` 对应上游舒适 / 宽松；最初"统一 8px"的记录来自被截断的 grep 输出 | 无需修改样式；`837864b` 误加的重复 compact 声明已清理，真实渲染值并入 TODO-05 实测 |
| SET-008 | 已裁决（D-01） | 首页延迟 / 丢包显示口径 | 上游 `useNodePingDisplay` 显示 `pingStats.avgLatency` / `avgLoss`（窗口平均），本主题显示最近一次采样 | 改为对 `/api/servers` 已返回的窗口（最近 2 小时、最多 20 个真实采样）取平均；不额外请求，窗口为空时回落最新值并在标题写明口径 |

### Test 3 终态

- **P0 = 0 ｜ P1 = 0**
- BUG-CONFIRMED 5 项，全部已修复并有回归测试（新增 `theme-settings-form.test.ts`、`disk-prediction.test.ts`，扩写 `dashboard-realtime.test.ts`）
- NOT-A-BUG 1 项、NECESSARY-CFSM-DIFFERENCE 1 项、P2 1 项
- 上一轮的 D-01（首页丢包口径）已按上游口径裁决并落地，见 SET-008
