# 首页复刻审计（第 11 轮）

> **最高原则：原 Komari Glassmorphism 当前默认分支的首页代码、DOM、组件结构、CSS、图标、
> 动画、renderer、交互、布局与浏览器表现，是本轮首页 UI/UX 的唯一权威基准。**
>
> 当前 CFSM 首页只是功能基线，不是视觉真相。本轮从「先读 Komari，再检查 CFSM，逐项 diff」
> 出发，而不是从「当前已经做得不错」出发验证。

## 基线

| 项目 | 提交 | 用途 |
|---|---|---|
| sanrokamlan-prog/komari-theme-Glassmorphism | `bf83765`（当前默认分支） | 首页 UI/UX 唯一权威基准 |
| allury/CFSM-Glassmorphism | `f63740b`（v1.1.0-test.2） | 本轮起点 |

对照的上游文件：`views/HomeView.vue`、`components/Header.vue`、`components/Footer.vue`、
`components/NodeGeneralCards.vue`、`components/NodeCard.vue`、`components/NodeList.vue`、
`components/Background.vue`、`components/ui/card-x/CardX.vue`、`stores/app.ts`、
`utils/helper.ts`、`utils/tagHelper.ts`、`utils/glassTheme.ts`、
`composables/useNodePingDisplay.ts`、`styles/main.css`。

### 本轮的验证方式

本轮所有视觉结论都来自**两套 localhost 同时运行**时的真实浏览器输出：

- Komari：`work/round10-komari` 的 Vite dev server（`127.0.0.1:4173`）+ mock API（`127.0.0.1:25774`）
- CFSM：本仓库 `bun run build` 产物（`127.0.0.1:4181`）

逐项用 `getComputedStyle` 与 `getBoundingClientRect` 对比，而不是读 Tailwind 类名。
两个必须记住的量测陷阱：

1. **改窗口宽度后不要立刻读值。** 上游卡片带 `transition-all`，resize 之后 `backdrop-filter`
   会停在旧值；必须在目标宽度下重新加载页面再量。第一次量到"桌面也有 blur(8px)"就是这么来的。
2. **浏览器面板隐藏时动画不会推进。** CFSM 节点卡的入场动画是 `animation-fill-mode: backwards`，
   页面不可见时停在 `from`（`scale(0.988) translateY(10px)`），量出来会比真实布局小 ~2px、低 10px。
   量测前先 `document.getAnimations().forEach(a => a.finish())`。

## 状态与优先级

状态只允许：`PASS` / `NECESSARY-CFSM-DIFFERENCE` / `P2-ACCEPTED` / `KNOWN-BUG` / `FAIL`。

- **P0**：页面层级、点击路径、renderer、核心组件结构明显不同。
- **P1**：重要 DOM、布局、交互、响应式、动画明显不同。
- **P2**：轻微尺寸、间距、shadow、blur、颜色差异。

`KNOWN-BUG` 表示确认存在但不阻塞本轮 UI 对标，**不等于 PASS**。

## 本轮方法论修正（重要）

前几轮的做法是「读上游源码 → 提取结构契约 → **用本主题既有令牌重新实现** → 源码断言锁定」。
这保住了 DOM 骨架，却在渲染结果上持续偏离，原因很直接：**等价映射本质上就是重新设计**。
源码契约测试只能证明「结构存在」，不能证明「看起来一样」，所以它们全绿的同时，
页面截图一对比仍然明显不像。

三个被实测截图暴露的典型例子：

1. **延迟/丢包柱**：上游 `useNodePingDisplay` 用 `signal-1..5` 五级色阶给**满高**柱着色；
   本主题此前自行发明了「按数值缩放柱高的单色柱」，导致丢包 0% 时面板几乎空白。
2. **卡片表面**：上游 `[data-slot='card']` 有一条 `!important` 规则，把**命中它的**卡片
   统一成 74% 不透明的浅色块加 1px 边框；本主题把 Tailwind 的 `bg-background/50` 直译成了
   `--glass` 的 50%，而 `--glass` 本身已是 72% 半透明，叠加后只剩约 36%，卡片边界消失。
   *第 11 轮补充*：这条规则并非对所有卡片生效。CardX 用 `cn()`（tailwind-merge）合并类名，
   总览卡片传入的 `bg-background/50` 与 `border-none` 会把 `bg-card`、`border` 直接删掉，
   于是它根本不匹配那条 `!important`。上一轮把两种卡片当成同一种表面处理，是新的过度归纳。
   **只有真实浏览器的计算值能判定哪条规则最终生效。**
3. **全局令牌**：`--radius` 上游是 10px、本主题是 18px；字体栈上游系统字体优先、
   本主题 Inter 优先；激活态上游用 `--selection`、本主题用 `--emerald`。

结论与后续要求：**凡是上游已有的设计令牌（色阶、圆角、字体、表面、强调色），
一律原样移植，不再映射到本主题既有变量**；只有 CFSM 平台差异才允许偏离。

## 审计矩阵

| 编号 | Komari 原实现 | 当前 CFSM（本轮前） | 差异 | 等级 | 处理 | 状态 |
|---|---|---|---|---|---|---|
| H01 | 延迟/丢包柱：满高柱 + `signal-1..5` 色阶（延迟 ≤60/100/160/200ms，丢包 ≤1/3/6/9%），色觉友好叠加 `ping-signal-pattern` 纹理 | 按数值缩放柱高的单色柱（延迟蓝、丢包橙） | 编码方式完全不同，丢包 0% 时几乎空白 | **P0** | 移植上游阈值、色阶与纹理，柱子改为满高 | PASS |
| H02 | 无采样时渲染 20 根中性占位柱（`EMPTY_PING_BAR_COUNT`） | 无数据时整块不渲染 | 空状态表现不同 | P1 | 按上游补 20 根 `muted/10` 占位柱 | PASS |
| H03 | `signal-1..5` 色阶含亮色、暗色与两套色觉友好变体 | 无 signal 色阶，用主题既有语义色 | 缺少整套设计令牌 | P1 | 四套色阶原样移植到 `:root` / `[data-theme]` / `[data-color-vision]` | PASS |
| H04 | 视图切换只有卡片与列表两个图标按钮（`tabler:layout-grid` / `tabler:table`） | 四个按钮，把卡片密度混进了视图模式 | 控件数量与语义不同 | **P0** | `DashboardViewMode` 收敛为 `card \| list`，密度回归主题设置 | PASS |
| H05 | 卡片密度 `nodeCardSize` 是主题设置，不出现在首页控制区 | 密度按钮出现在首页控制区 | 层级不同 | P1 | 移出控制区，网格类改由 `nodeCardSize` 驱动 | PASS |
| H06 | 首页控制区没有排序下拉（列表排序由表头承担） | 有排序 select 与结果计数 | 多出上游没有的控件 | P1 | 移除排序下拉与结果计数及其死样式 | PASS |
| H07 | 搜索框折叠：默认仅图标宽度，聚焦或有内容才展开，带清空按钮与 ESC | 常驻输入框 | 交互与占位不同 | P1 | 改为折叠式，补清空按钮与 ESC | PASS |
| H08 | 节点网格单列起步，`sm`(640px) 以上才 auto-fill；宽度 270/300/360/420，gap 12/12/16/20 | 宽度一致但 gap 与断点不同 | 间距与断点不同 | P1 | 按上游对齐 gap 与 640px 断点 | PASS |
| H09 | 分组 Tabs 与快捷控制同处一个横向滚动容器 | 分组与快捷控制分别布局 | 滚动行为不同 | P1 | 合并为 `dashboard-controls__scroll` | PASS |
| H10 | 快捷控制为 图标 + 文案 + 计数徽章 | 字符图标 + 文案 + 计数 | 图标体系不同 | P1 | 改用同名 Tabler 图标 | PASS |
| H11 | 高级工具开关位于控制区右侧的工具组 | 位于 Header | 位置不同 | P1 | 移到控制区，Header 只保留站点身份与全局动作 | PASS |
| H12 | 公告位于总览与节点区之前，是首页第一块内容 | 位于多条运行状态提示之后 | 顺序不同 | P1 | 提到 `main` 顶部 | PASS |
| H13 | 节点扁平渲染，不按分组包一层容器 | 已于第 10 轮对齐 | — | — | 保持并由契约锁定 | PASS |
| H14 | 卡片/列表主点击直达详情，独立控件 `stopPropagation` | 已对齐 | — | — | 保持并由契约锁定 | PASS |
| H15 | Earth 三 renderer：globe.gl+three / cobe / 独立 tiled | 已对齐 | — | — | 回归验证，未改动 | PASS |
| H16 | NodeList 十列栅格契约、64px 行高 | 已对齐 | — | — | 回归验证，未改动 | PASS |
| H17 | Overview 卡片 12 栅格 span-4、标签左上图标右上 | 已对齐 | — | — | 回归验证，未改动 | PASS |
| H18 | Header：`h-14`(56px)、32px logo、18px 图标、滚动后加 backdrop-blur | 57px 高度，其余一致 | 1px | P2 | 差异小于一个像素舍入，接受 | P2-ACCEPTED |
| H19 | Footer 双栏：左 Powered by、右 Theme by，1280px 居中 | 左 Powered by CF-Server-Monitor、右主题与实时状态 | 归因目标不同 | — | CFSM 必须归因到 CF-Server-Monitor | NECESSARY-CFSM-DIFFERENCE |
| H20 | 首页 Ping 面板点击打开 `PingMonitorDialog` | 无该弹窗 | 缺少弹窗 | — | CFSM 无对应公开端点，不伪造 | NECESSARY-CFSM-DIFFERENCE |
| H21 | 访客信息浮层 `VisitorInfo` | 关闭并隐藏 | 缺少组件 | — | 无公开访客 API，禁止伪造 | NECESSARY-CFSM-DIFFERENCE |
| H22 | 首页 Ping 柱来自逐节点 ping 记录接口，窗口更长 | 只能用 `/api/servers` 的稀疏窗口 | 样本条数少 | — | 见 `docs/known-bugs.md` BUG-001 | KNOWN-BUG |
| H23 | 丢包面板聚合值 | 三态在数据层保留，但面板数字看不出未配置/超时/真实 0 的区别 | 信息表达 | — | 见 `docs/known-bugs.md` BUG-002 | KNOWN-BUG |
| H24 | 节点入场 `TransitionGroup` + `DeferredRender` 延迟渲染 | 有入场动画与 dense 延迟绘制策略 | 实现机制不同，观感等价 | P2 | 保留现有性能策略 | P2-ACCEPTED |
| H25 | **节点卡片**实际生效值为 `rgba(241,245,249,.74)` + 1px 边框 + `blur(14px) saturate(145%)` + `0 8px 28px` 阴影（`.node-card` 命中 `[data-slot='card']` 的 `!important` 规则） | 总览卡片仅约 36% 不透明且无边框，在浅色背景上几乎没有卡片感 | 节点卡片表面完全不同 | **P0** | 移植上游节点卡片表面令牌 | PASS |
| H26 | `--radius: 0.625rem`（10px） | `--radius: 18px` | 全站圆角偏大 8px | P1 | 令牌改为 10px，`--radius-sm` 改为 6px | PASS |
| H27 | `--font-sans` 以 `system-ui` 优先 | 以 `Inter` 优先 | 字形与字重观感不同 | P1 | 字体栈按上游改为系统字体优先 | PASS |
| H28 | 激活态使用 `--selection`（亮 `oklch(.55 .15 155)` / 暗 `oklch(.74 .17 162)`） | 用本主题的 `--emerald` | 强调色不同 | P1 | 移植 `--selection` 并接到分组标签、视图切换与工具开关 | PASS |
| H29 | 隐藏 Earth 时总览区为 `p-4` 独立网格：移动端 3 列、`md` 起 6 列，每卡片 `span 1` | 单列父网格中子区仍跨 12 列，浏览器生成隐式列 | 总览卡片宽度与右侧留白失真 | P1 | 原样移植 3 / 6 列、`span 1`、72 / 112px 最小高度 | PASS |
| H30 | NodeCard 底部始终保持三列；每行图标与可截断文本独立，第三列显示简短剩余天数与金额 | 直接显示完整 ISO 日期，文本没有独立截断层；mini 窄屏还改为两列 | 手机窄屏文字被硬裁切 | P1 | 移植 `calendar-stats` / `coins`、剩余状态与文本层，恢复全密度三列 | PASS |

| H31 | 总览卡片**不**走 `[data-slot='card']` 的 `!important`：CardX 用 `cn()`（tailwind-merge），`bg-background/50` 与 `border-none` 把 `bg-card`、`border` 合并掉。实测桌面态 `--background/50` + 无边框 + 10px 圆角 + 无阴影 + `backdrop-filter: none`，窄屏 `blur(8px)`，hover 变不透明 | 总览卡片沿用了节点卡片的 74% 表面 + 1px 边框 + 12px 圆角 + 阴影 | 表面、圆角、阴影、blur 全部不同 | **P0** | 移植 `--background`，总览卡改用 `color-mix(… 50%)`、无边框、`var(--radius)`、无阴影，窄屏 blur(8px) | PASS |
| H32 | 总览卡片是 value + unit 两段式：内存/硬盘为「已用值 + 已用单位 / 总量 单位」，流量与速率为「值 + 单位」，计数类为「值 + `/ 总数`、`台`、`个`」，说明文字走 tooltip | 内存/硬盘用百分比当主值，「接收 + 发送」「在线节点合计」等长提示占据单位栏，手机端明显省略错位 | 信息结构不同 | **P1** | `buildGeneralCards` 增加 `unit`，`OverviewCards` 渲染 unit 并把 `hint` 交给 `AppTooltip` | PASS |
| H33 | 首页字节显示为 B/KB/MB/GB/TB/PB，基数 1024，精度 B 0、KB 0、MB 1、GB 1、TB 2，速度加 `/s` | 使用 KiB/MiB/GiB/TiB 且精度按数量级动态变化 | 单位与精度不同 | P1 | 新增仅供首页使用的 `formatHome*` 系列，详情页格式化器不动 | PASS |
| H34 | NodeCard 运行芯片是 `在线 N 天`（`getUptimeDays`，只到天） | `运行 2 天 0 小时` | 文案与精度不同 | P1 | `formatHomeUptimeDays`；列表列仍是天+小时，与上游 `formatUptimeWithFormat(_, 'hour')` 一致 | PASS |
| H35 | 中文界面下计费周期显示为 月 / 季 / 半年 / 年 / 两年 / 三年 / 五年 | 直接显示 CFSM 原始枚举 `year`、`month`、`five_years` | 未本地化 | P1 | `formatHomeBillingCycle` 覆盖 CFSM 八个官方枚举（含 `four_years` → 四年）；未知自由文本原样保留，不猜测 | PASS |
| H36 | `HOME_QUICK_CONTROL_PRESETS`：基础 4 项、流量 3 项、运维 5 项、完整 7 项；`ALL_HOME_QUICK_CONTROL_KEYS` 是默认顺序 + upload + download | 「完整」8 项且含上行/下行，`QUICK_KEYS` 由「完整」生成 | 预设内容与来源都不同 | P1 | 按上游重排并去掉 CFSM 没有的 `monthlyCost`（完整 6 项）；另建 `ALL_QUICK_CONTROL_KEYS`，自定义仍可选 upload/download | PASS |
| H37 | `GENERAL_CARD_PRESETS` 与 `ALL_GENERAL_CARD_KEYS` 的固定顺序 | 预设内容与顺序自成一套 | 顺序与成员不同 | P1 | 逐项对齐上游九个预设，只删 CFSM 无法真实计算的条目 | PASS |
| H38 | 默认背景是 `public/images/default-background-v2.webp`（32436 bytes），cover / center bottom / `saturate(1.12) contrast(1.02)` / `scale(1.01)`，暗色 `brightness(.38) saturate(.82) contrast(1.08)`，≤768px `50% 78%` + `scale(1.02)`；`Background.vue` 还负责媒体预加载、默认/加载/回退/媒体层、fade 与遮罩 | 自创的 wash + 三个动态 orb + grid + grain；后来虽然换回默认图，自定义背景仍硬切、失败空白、负遮罩语义错误 | 默认图及媒体状态机均曾与上游不同 | P1 | 默认资产放 `src/assets/` 由 Vite 输出；第四轮 O 再按上游移植预加载/失败回退/视频加载层/0.8 秒 fade/模糊与遮罩，并保留 CFSM 冷启动与无 Referer 差异（见 `docs/fidelity-audit.md` #33） | PASS |
| H39 | NodeCard 运行时边框 `rgba(203,213,225,.6)`、圆角 14px（`rounded-xl`），hover 阴影与常态相同；暗色 `rgba(13,17,26,.85)` / hover `rgba(17,24,39,.91)` | 边框 `rgb(226 232 240 / 68%)`、圆角 12px、hover 阴影更大；暗色表面数值也不同 | 取的是 CSS 默认值而不是运行时 `glassTheme` 预设值 | P1 | 按默认 `emerald` 预设的真实运行值修正全部 `--card-surface-*`，圆角改 14px | PASS |
| H40 | 球体版前六张总览卡按**列**排布（`col-start` 1/1/5/5/9/9，`row-start` 1/2/1/2/1/2），第七张起退回自动排布 | 按行排布 | 卡片顺序与视觉分组不同 | P1 | 用 `:nth-child` 移植上游的显式栅格定位，超过六张时回到自动流 | PASS |
| H41 | tiled 版卡片 `col-span-6 sm:col-span-3`、行高 `4.75/5/5.8rem`、外框 `p-3 sm:p-4 gap-2 sm:gap-3`，地图高度是下限而非固定值（因此会随容器拉伸） | 卡片恒为 span 4、gap 恒 8px、padding 恒 16px，地图被写死 `height` 且被组件 scoped 的 `height:100%` 覆盖，窄屏底部空出约 50px、宽屏矮 100px | 布局与尺寸都不同 | P1 | 移植 span/行高/gap/padding，地图改为 `min-height` 并提高选择器特异度；实测 375 与 1920 下两版几何完全一致 | PASS |
| H42 | 总览卡片在所有断点都是 `gap-2`（8px）+ `!p-3`（12px），字号 16px→`md` 24px | 窄屏自创 gap 6px、padding 9/11px、字号 17px 等多档覆盖 | 间距与字号漂移 | P1 | 删除窄屏覆盖，行高改由上游的 `auto-rows` 规则决定 | PASS |
| H43 | 剩余价值 / 月费用估算 / 年费用估算 / 流量配额四张汇总卡 | v1.1.7 起提供前三张；流量配额仍不提供 | 前三张需要跨币种换算；流量配额需要站点级配额 | — | 前三张按浏览器取得的公开日汇率换算，来源与未计入的节点如实标注（`docs/finance-parity.md`）；CFSM 没有站点级流量配额，不为凑满六卡伪造汇总值 | NECESSARY-CFSM-DIFFERENCE（仅剩流量配额；前三张 v1.1.7 起已提供） |
| H44 | `cpuCores` 卡片图标为 `tabler:chip` | 使用 `tabler:cpu` | 图标名不同 | P2 | `tabler:chip` 已不在 Iconify Tabler 图标集内（API 返回 `not_found`），上游自身也取不到该图标；改用同族 `tabler:cpu` | P2-ACCEPTED |
| H45 | compact 节点卡首卡高 331.81px（1440×900，10 节点） | 333.75px | 1.94px | P2 | 内部行高累计差，肉眼不可辨；卡片宽度、坐标与网格列在六档视口下均完全一致 | P2-ACCEPTED |

## 终态

**P0 = 0 ｜ P1 = 0 ｜ FAIL = 0 ｜ P2-ACCEPTED = 4 ｜ KNOWN-BUG = 2**

45 项分布：PASS 35、NECESSARY-CFSM-DIFFERENCE 4、P2-ACCEPTED 4、KNOWN-BUG 2。

两条 KNOWN-BUG 均不阻塞首页视觉与交互对标，且已在 `docs/known-bugs.md` 中单独记录，
不计入 PASS。

## 六档视口实测几何（两版同时运行）

`nodes=10`、`theme=light`、`renderer=realistic`、compact 卡片密度。
坐标为 `getBoundingClientRect()` 的 `[x, y, w, h]`，动画已 finish。

| 视口 | 项目 | Komari | CFSM |
|---|---|---|---|
| 375×812 | 总览区 / 地球 / 总览卡 / 首卡 | `[0,57,375,391]` / `[16,81,343,343]` / `109×80` / `[16,536,343,331.81]` | 同 / 同 / 同 / `[16,536,343,333.75]` |
| 430×932 | 同上 | `[0,57,430,446]` / `[16,81,398,398]` / `127.33×80` / `[16,591,398,331.81]` | 同 / 同 / 同 / `[16,591,398,333.75]` |
| 768×1024 | 同上 | `[0,57,758,232]` / `[383,69,359,359]` / `114.33×96` / `[16,377,357,331.81]` | 同 / 同 / 同 / `[16,377,357,333.75]` |
| 1024×768 | 同上 | `[0,57,1014,232]` / `[531,69,448,448]` / `157×96` / `[16,377,319.33,331.81]` | 同 / 同 / 同 / `[16,377,319.33,333.75]` |
| 1440×900 | 同上 | `[75,57,1280,232]` / `[805,69,448,448]` / `201.33×96` / `[91,337,303,331.81]` | 同 / 同 / 同 / `[91,337,303,333.75]` |
| 1920×1080 | 同上 | `[315,57,1280,232]` / `[1045,69,448,448]` / `201.33×96` / `[331,337,303,331.81]` | 同 / 同 / 同 / `[331,337,303,333.75]` |

tiled 渲染器：375 下两版 `stage [0,57,375,640]`、`earth [12,358,351,327]`、卡片 `171.5×76`（两张一行）；
1920 下两版 `stage [315,57,1280,689.59]`、`earth [331,283,1248,448]`、卡片 `303×92.8`（四张一行）。

六档下 `documentElement.clientWidth === scrollWidth`，没有横向溢出；
375 与 430 下节点卡底部三个信息框各为 100px / 119px，`scrollWidth === clientWidth`，
框内文本层同样没有溢出。

## 第 13 轮回归结论（不重新定义第 11 轮结果）

第 13 轮只改详情页。首页在本轮做了回归验证，**第 11 轮的终态不变**：

- 第 11 轮引入的 `formatHome*` 显示格式函数改名为 `formatDisplay*` 并与详情页共用。
  这只是改名，首页的字节单位、精度、价格与计费周期输出**完全不变**，由既有测试锁定。
- 首页节点卡的运行芯片仍是 `formatHomeUptimeDays`（`在线 N 天`），
  节点列表运行时间列仍是 `formatUptime`（天 + 小时），两者都未被详情页格式影响。
- 实测回归：分组切换、快捷筛选、视图模式与滚动位置（555 → 详情 0 → 返回 555）全部恢复。
- 总览卡片仍是 `--radius`(10px) 圆角、节点卡仍是 14px，Ping / Loss 满高柱与五级色阶未改动。

## 数据真实性边界（不因保真而放宽）

首页任何位置都不得伪造 IP、ASN、ISP、Provider、精确城市、精确经纬度、访客 IP 或 Audit Log。
Earth 只按明确 region 做国家/地区级定位。probe 的 `false` / `null` / 数值三态在
adapter、卡片、列表与详情全链路保持，不得把未配置或超时写成 0。
