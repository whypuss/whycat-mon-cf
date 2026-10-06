# 详情页复刻审计（第 13 轮）

> **最高原则：原 Komari Glassmorphism 当前默认分支的 `InstanceDetail.vue` 及其真实浏览器
> 运行结果，是详情页 UI/UX 的唯一权威基准。**
>
> CFSM 只决定数据真实性边界，不决定重新设计详情页。数据缺失只允许隐藏或降级对应内容，
> 不构成改变页面层级、组件结构、视觉 token、交互或响应式的理由。

## 基线

| 项目 | 提交 | 用途 |
|---|---|---|
| sanrokamlan-prog/komari-theme-Glassmorphism | `bf83765`（当前默认分支） | 详情页 UI/UX 唯一权威基准 |
| allury/CFSM-Glassmorphism | `72b9cce`（v1.1.0-test.3） | 本轮起点 |

对照的上游文件：`views/InstanceDetail.vue`、`components/ui/card-x/CardX.vue`、
`components/ui/tabs`、`components/LoadChart.vue`、`components/PingChart.vue`、
`stores/app.ts`、`utils/helper.ts`、`utils/tagHelper.ts`、`utils/cpuBenchmark.ts`、
`utils/osImageHelper.ts`、`styles/main.css`。

## 验证方式

两套 localhost 同时运行，逐项用 `getComputedStyle` 与 `getBoundingClientRect` 对照：

| 角色 | 地址 |
|---|---|
| Komari mock API | `127.0.0.1:25774` |
| Komari 前端（`work/round10-komari` dev server） | `127.0.0.1:4173` |
| CFSM 生产 `dist` | `127.0.0.1:4181` |

第 11 轮记录的两个量测陷阱在本轮继续适用：resize 之后必须重新加载再读值；
量测几何前先 `document.getAnimations().forEach(a => a.finish())`。
本轮新增一个：**Vite 产物的 `index.html` 会被浏览器缓存**，
改完样式后要用 hash 之前的查询参数（`/?cb=xxx#/server/...`）强制取新页面，
否则会量到上一版 CSS。

## 状态与优先级

状态只允许：`PASS` / `NECESSARY-CFSM-DIFFERENCE` / `P2-ACCEPTED` / `KNOWN-BUG` / `FAIL`。

- **P0**：页面层级 / renderer / 点击路径 / 核心结构明显错误。
- **P1**：重要 DOM / 布局 / 交互 / 动画 / 响应式明显不同。
- **P2**：亚像素舍入、字体栅格造成的极轻微高度差、实现机制不同但视觉与交互等价。

## 审计矩阵

| 编号 | Komari 原实现与实测 | CFSM 本轮前 | 差异 | 等级 | 处理 | 状态 |
|---|---|---|---|---|---|---|
| D01 | 页面根 `space-y-4`：顶部导航 → 指标卡栅格 → 四张信息卡 → LoadChart → PingChart，每段 `px-4` | 顶部导航 → 指标概览 → 信息卡 → 探针 → 磁盘 IO → GPU → 历史，段间 16px | 段落顺序等价，CFSM 多出的三段是其真实独有数据 | P1 | 保持段序；三段独有区块沿用同一卡片语言，并在开启分区 Tab 时归入对应分区 | PASS |
| D02 | 顶部导航实测 1440 高 32px：返回按钮 32、身份 24、状态徽章、标签、右侧工具组 `h-8` | 高 34px（返回按钮 34） | 2px，且下方所有区块整体下移 2px | P1 | 返回按钮改 32×32、工具组圆角与表面按上游修正 | PASS |
| D03 | 工具组 `rounded-md bg-background/50 p-0.5 backdrop-blur-xs`，按钮 `size-7 rounded-sm` | 圆角 10px、表面用 `--glass` 的 50%、按钮带边框与阴影 | 表面与圆角不同 | P1 | 改为 `--background/50` + `var(--radius-md)`，按钮无边框无阴影、`var(--radius-sm)` | PASS |
| D04 | 指标卡实测：`--background/50`、`0px none`、`8px`、`box-shadow: none`、`backdrop-filter: none`、内容 padding 12px | `glass-panel` 派生：`--glass` 的 50%、6px 圆角、`0 8px 28px` + inset 阴影、`blur(8px)` | 表面、圆角、阴影、blur 全不同 | **P0** | 移植上游详情卡片表面，新增 `--radius-md: 8px` | PASS |
| D05 | 指标卡是 value + unit 两段式，**没有进度条**，说明文字走原生 `title` | 单串 value + 常驻 `small` 说明行 + 进度条 | 信息结构不同 | **P1** | `buildDetailCards` 按上游 `splitMetricValue` / `splitMeasurement` 拆分，进度条移除，`hint` 改为 tooltip | PASS |
| D06 | 指标卡内容高 `min-h-10 md:min-h-18`，值 `text-base sm:text-2xl`、单位 `text-[11px] sm:text-xs` | 固定 80/96px 高、值 22px、无单位层 | 尺寸与字号不同 | P1 | 改为 min-height 64 / 96，值 16→24px（≥640），单位 11→12px | PASS |
| D07 | `DETAIL_METRIC_CARD_PRESETS` 六个预设 + custom，默认 `finance` 八张卡 | 自成一套，默认七张（缺剩余价值） | 顺序与成员不同 | P1 | 逐项对齐上游顺序，只删 `temperature` | PASS |
| D08 | `ALL_DETAIL_METRIC_CARD_KEYS` 决定自定义模式的允许集合 | 由「综合」预设推导，导致 uptime / trafficQuota 在自定义模式不可选 | 允许集合来源错误 | P1 | 新建独立的 `ALL_DETAIL_CARD_KEYS` | PASS |
| D09 | 剩余价值卡按财务显示币种显示（上游 `InstanceDetail`） | 不提供 | 需要汇率 | P1 | 按节点自身 `price` / `billing_cycle` / `expire_date` 计算原币金额，免费节点显示「无」；v1.1.7 起按显示币种换算，提示里给出原币金额与汇率来源，币种无法识别或汇率缺失时显示「—」并说明 | PASS |
| D10 | 月均支出 `${金额} / 月`，未知周期「不适用」，免费「免费」 | `${金额} / month`，未知周期整卡消失 | 文案与降级方式不同 | P1 | 按官方周期天数折算 30 天口径，未知周期显示「不适用」 | PASS |
| D11 | 剩余时间用 `getExpireText`：`-` / 已过期 / 长期 / `N 天`，数值按 5 / 10 / 36500 天阈值着色 | `已过期 N 天` / `N 天`，tooltip 是原始 ISO 字符串 | 文案与着色不同 | P1 | 移植 `formatDetailExpireText` 与四档着色 | PASS |
| D12 | 详情字节与首页同规则（KB/MB/GB/TB），速率加 `/s` | 详情仍是 KiB/MiB/GiB | 单位体系不同 | P1 | 第 11 轮的 `formatHome*` 改名 `formatDisplay*` 并在详情复用（行为不变） | PASS |
| D13 | 详情运行时间 `formatUptimeWithFormat(_, 'minute')`：到分钟且省略为零的单位 | `N 天 0 小时` | 精度与省略规则不同 | P1 | 新增详情专用 `formatDetailUptime`；首页与列表格式保持冻结 | PASS |
| D14 | 信息卡 CardX：头部 `px-3 py-2` + 16px/500 标题（实测 40px 高），内容 `p-3 pt-0` | 头部 40px 但标题 700 且带负字距 | 字重与字距不同 | P2 | 标题改 500、去负字距、`line-height: 1.5` | PASS |
| D15 | 信息格实测 `rgb(255 255 255 / .15)`（暗色 `/ .05`）、`rounded-sm`(6px)、`p-2`、`gap-1`（CPU 格 `gap-2`） | `--muted` 6%、4px 圆角、`gap: 4px` | 表面与圆角不同 | P1 | 按上游对 `.bg-slate-500/5` 的覆盖值移植 | PASS |
| D16 | 信息格文本 `text-xs sm:text-sm`（12→14px，行高 16→20px） | 恒 11/12px | 字号与行高不同 | P1 | 按断点对齐；实测小格高度由 54 → 60，与上游一致 | PASS |
| D17 | 硬件卡：CPU 全宽块（图标 + `CPU` + PassMark 外链 + `型号 (N vCPU)` + 近似分级条）+ 小格栅格（≤2 项两列，否则三列） | CPU 全宽块只有型号，小格固定四列 | 结构与列数不同 | P1 | 移植 CPU 块全部元素与 `cpuBenchmark`（纯型号字符串函数），小格改为二/三列自适应 | PASS |
| D18 | 硬件小格：IP（登录后）或架构 / 物理核心 / 虚拟机类型 / GPU | 核心 / 架构 / Agent / 进程 | CFSM 无 IP、无物理核心数、无虚拟机类型字段 | — | 只保留架构，补 CFSM 真实提供的 Agent 版本，GPU 按存在与否显示；核心数已在 CPU 行的 `(N vCPU)` 里 | NECESSARY-CFSM-DIFFERENCE |
| D19 | 系统卡：操作系统（带 OS 图标）/ 内核版本 / 运行时间 / 厂商 | 操作系统 / 内核 / 运行时间 / 数据源，均无图标 | 缺 OS 图标与逐项图标；厂商需要 IP Geo | P1 + 必要差异 | 补 OS 图标与四个 IconPark 图标；「厂商」需要精确城市 / ASN，CFSM 不提供，位置改放真实的数据源 | PASS（厂商为 NECESSARY-CFSM-DIFFERENCE） |
| D20 | 存储卡三列：内存 / 内存交换 / 硬盘，均带图标 | 内存 / Swap / 磁盘，无图标 | 文案与图标不同 | P1 | 文案与图标按上游对齐 | PASS |
| D21 | 网络卡两格：总流量（配额进度背景 + IP 支持徽章 + 上下行总量 + 用量文本）/ 网络速率（↑↓） | 总流量无进度背景、用量文本是 `累计 / 原始 traffic_limit 字符串`；速率用字符箭头 | 结构与数据口径不同 | P1 | 移植配额进度背景与三档着色，用量文本改为解析后的 `已用 / 配额`，速率改用 chevron 图标 | PASS |
| D22 | 总流量格右侧上下行总量 `hidden sm:block` | 一直显示且 `nowrap` | 窄屏多占一行 | P1 | 640px 以下隐藏，并允许自然折行 | PASS |
| D23 | `nodeDetailSectionTabsEnabled` 打开时页面切成 概览 / 负载 / 延迟（`h-8 bg-background/50 rounded-md`，触发器带图标） | 设置项存在但没有任何实现 | 功能缺失 | **P1** | 实现分区 Tab：概览＝指标卡+信息卡+磁盘 IO+GPU，负载＝指标历史图，延迟＝探针卡+Ping/丢包历史图 | PASS |
| D24 | 历史图表卡片与指标卡同源（`bg-background/50 border-none rounded-md`），范围选择器是 `h-8 bg-background/50 rounded-md` + `h-6.5 rounded-sm` 触发器 | 图表卡用 `glass-panel`，范围选择器是胶囊按钮 | 表面与控件形态不同 | P1 | 两者都改为上游表面；激活态改用 `--selection` | PASS |
| D25 | 探针 / GPU / 磁盘 IO 区没有对应上游区块 | 已有，使用 `glass-panel` | CFSM 独有的真实数据 | — | 区块保留（真实数据不隐藏），但表面、圆角统一到详情卡语言 | NECESSARY-CFSM-DIFFERENCE |
| D26 | 厂商标识浮层（城市 · 厂商 · ASN） | 不提供 | 需要 IP Geo 与 ASN | — | CFSM 公开 API 无这些字段，禁止伪造 | NECESSARY-CFSM-DIFFERENCE |
| D27 | 系统温度指标卡 | 不提供 | `/api/server` 与历史列集合都没有温度字段 | — | 不制造一张永远显示 `-` 的卡片 | NECESSARY-CFSM-DIFFERENCE |
| D28 | 近一天网速峰值行（依赖登录后的逐节点负载记录） | 不提供 | 需要 Komari 私有历史接口 | — | CFSM 无等价公开端点，不用当前值伪造峰值 | NECESSARY-CFSM-DIFFERENCE |
| D29 | 路由 `/instance/:id` | `/#/server/:id?source=` | 路由技术差异 + 多 apiBase 归属 | — | 见 `docs/fidelity-audit.md` 必要差异 §9 | NECESSARY-CFSM-DIFFERENCE |
| D30 | 顶部导航：返回 / 旗帜 + 名称 / 在线徽章 / 标签 / 收藏 / 上一台 / 选择器 / 下一台 | 已一致 | — | — | 回归验证：next → prev → select 均正确携带 owning `source` | PASS |
| D31 | 空节点态 `Empty` + 返回首页按钮 | 已有等价错误态（401 / 403 / 404 / 409 / 503 / 网络） | CFSM 错误分类更细 | — | 保留真实分类文案，视觉沿用同一卡片语言 | PASS |
| D32 | 1440 硬件 / 系统卡实测 221px | 223px | 2px，来自 CPU 块内 PassMark 链接的行盒差 | P2 | 接受 | P2-ACCEPTED |
| D33 | 375 指标卡实测 80px | 82px | 2px，来自单位行基线对齐的行盒差 | P2 | 接受 | P2-ACCEPTED |
| D34 | probe 的 `false` / `null` / 数值三态 | 已在 adapter 与详情全链路保持 | — | — | 回归验证：`sparse=1` 时面板隐藏而不是显示 0 | PASS |
| D35 | History 九档时间范围与 401 / 409 / 503 / 空态 | 已有 | — | — | 回归验证 409 与 503 真实文案，不用 mock 顶替 | PASS |
| D36 | 负载图「实时」档位没有时段（`selectedHours ?? 4`）：坐标轴 `HH:mm`，tooltip 到秒 | 沿用上一次选中的历史窗口；先选 1 天及以上再切到实时，10 分钟窗口带日期、tooltip 不到秒 | 时间格式随上一档位变化 | P2 | `loadChartHours` 让实时档位固定按 10 分钟窗口（`LIVE_SEED_HOURS`）格式化，历史档位不变 | PASS |
| D37 | 进入「实时」时先清空 `error`（`fetchRecentData`），实时图不受此前历史请求失败影响 | 历史失败后切到实时仍显示该失败：匿名访客先选「2 天」（CFSM 401）再切「实时」，负载图停在 401 提示，实时数据被挡住（2026-10-03 线上实测） | 旧的历史错误挡住实时档位 | P1 | 历史失败的提示只在历史档位显示；延迟区仍按自己的窗口如实显示它的 401。本地模拟服务新增 `historyAuth=1`（匿名超过 24 小时返回 401）用于复现 | PASS |

## 终态

**P0 = 0 ｜ P1 = 0 ｜ FAIL = 0 ｜ P2-ACCEPTED = 2 ｜ KNOWN-BUG = 0**

37 项分布：PASS 29、NECESSARY-CFSM-DIFFERENCE 6、P2-ACCEPTED 2、KNOWN-BUG 0。

本轮没有发现需要记录为 KNOWN-BUG 的新问题；`docs/known-bugs.md` 中已有的两条与详情页
无关（BUG-001 是首页 Ping 窗口来源，BUG-002 是首页丢包面板的三态表达）。

## 六档视口实测几何

`nodes=10`、`theme=light`、`财务` 预设。坐标为 `[x, y, w, h]`，动画已 finish。

| 视口 | 项目 | Komari | CFSM |
|---|---|---|---|
| 375×812 | 顶部导航 / 指标栅格 / 单卡 / 信息栅格 | `h=72` / `163.5×2` / `163.5×80` / 单列 343 | 同 / 同 / `163.5×82` / 同 |
| 430×932 | 同上 | `h=72` / `191×2` / `191×80` / 单列 398 | 同 / 同 / `191×82` / 同 |
| 768×1024 | 同上 | `h=32` / `231.33×3` / `231.33×96` / 单列 726 | 同 / 同 / 同 / 同 |
| 1024×768 | 同上 | `h=32` / `316.66×3` / `316.66×96` / `483×2` | 同 / 同 / 同 / 同 |
| 1440×900 | 同上 | `h=32` / `300×4` / `[91,105,300,96]` / `616×2` | 同 / 同 / 同 / 同 |
| 1920×1080 | 同上 | `h=32` / `300×4` / `[331,105,300,96]` / `616×2` | 同 / 同 / 同 / 同 |

信息卡高度（硬件 / 系统 / 存储 / 网络）：

| 视口 | Komari | CFSM |
|---|---|---|
| 375 | 209 / 300 / 104 / 110 | 207 / 296 / 104 / 110 |
| 768 | 221 / 184 / 112 / 114 | 223 / 184 / 112 / 114 |
| 1440 | 221 / 221 / 114 / 114 | 223 / 223 / 114 / 114 |

六档下 `documentElement.clientWidth === scrollWidth`，没有横向溢出，也没有 console error。

> 1024 档 Komari 的存储 / 网络卡为 134px、CFSM 为 114px：这是 **fixture 数据差异**——
> Komari 的样例节点是双栈（IPv4 + IPv6 两个徽章）导致总流量格标题行折行，
> CFSM 的样例节点只有 IPv6。同一数据下两版行为一致，不计为布局差异。

## 表面与令牌实测对照

| 元素 | 属性 | Komari | CFSM |
|---|---|---|---|
| 指标卡 / 信息卡 | background | `--background` 50%（亮 `oklab(0.935 …/0.5)`，暗 `oklab(0.141 …/0.5)`） | 同 |
| 指标卡 / 信息卡 | border / radius / shadow / backdrop | `0px none` / `8px` / `none` / `none` | 同 |
| 信息格 | background / radius / padding | `rgb(255 255 255 /.15)`（暗 `/.05`） / `6px` / `8px` | 同 |
| 卡片头部 | padding / 标题 | `8px 12px` / 16px / 500 | 同 |
| 历史图表卡 | 表面 | 与指标卡同源 | 同 |

## 交互与状态回归

| 场景 | 结果 |
|---|---|
| 首页点击卡片进入详情 | `#/server/<id>?source=<owning base>` ✅ |
| 上一台 / 下一台 / 节点选择器 | 均切换到正确节点并保留 `source` ✅ |
| 收藏 | 星标切换生效，与首页共用同一 key ✅ |
| 分区 Tab | 概览 / 负载 / 延迟 各自只渲染对应区块，返回概览恢复 ✅ |
| 详情 → 首页 | 分组、快捷筛选、视图模式与滚动位置（555 → 0 → 555）全部恢复 ✅ |
| `detailStatus=503` / 非法 id / `historyStatus=409` | 分别显示真实降级文案，无白屏、无 mock ✅ |
| `sparse=1` | 探针字段整体缺失时面板隐藏，不渲染 0 值 ✅ |
| 暗色 | 指标卡 / 信息卡 / 信息格三层表面均与上游逐字一致 ✅ |

## 数据真实性边界（不因保真而放宽）

详情页任何位置都不得伪造 IP、ASN、ISP、Provider、精确城市、精确经纬度、访客 IP、
Audit Log、汇率、历史点、Ping 或 Loss。GPU、磁盘 IO、交换分区、流量配额缺失时隐藏，
不写成 0；probe 的 `false` / `null` / 数值三态在 adapter、卡片、列表与详情全链路保持。
CPU 近似分级只读取 CPU 型号字符串，不请求任何接口，也不产生 CFSM 之外的数据。
