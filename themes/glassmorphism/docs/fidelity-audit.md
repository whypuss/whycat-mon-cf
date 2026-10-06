# 高保真审计

> **最高原则：原 Komari Glassmorphism 当前默认分支的真实代码、组件、样式、布局、动画、图标、弹层、页面层级与浏览器表现，是正式版 UI/UX 的唯一权威基准。当前 CFSM-Glassmorphism 的既有实现代表"已经实现的 CFSM 功能"，不代表最终视觉真相；与 Komari 不一致时默认向 Komari 对齐。**

目标是"把 Komari Glassmorphism 移植到 CFSM 后端"，而不是"参考 Komari 再设计一个类似主题"。用户从 Komari 切换到本主题后，应当明显感觉"这是同一个主题换了监控后端"。

## 审计基线

| 项目 | 分支 | 提交 | 用途 |
|---|---|---|---|
| sanrokamlan-prog/komari-theme-Glassmorphism | main | `bf83765`（v3.3.7） | UI/UX 唯一权威基准 |
| allury/CFSM-Glassmorphism | main | `d5b4b7f`（第 9.95 轮完成） | 第 10 轮起点 |
| huilang-me/CF-Server-Monitor | main | `924e71d` | 第三方主题 API 权限与协议上限 |

上游克隆位于被 Git 忽略的 `work/upstreams/`，只读。第 9.5～9.95 轮的结论主要来自真实源码对照与契约测试；第 10 轮已补做 Komari localhost 与 CFSM 生产构建 localhost 的双版本浏览器对照，以实时视觉观察、计算后几何、交互结果和控制台为最终判据。详细矩阵见 `docs/visual-validation.md`。

## 优先级定义

- **P0**：页面层级 / 导航路径 / renderer / 核心布局明显不一致。
- **P1**：重要视觉结构 / 尺寸 / 响应式 / 动画明显不一致。
- **P2**：轻微样式 / 文案 / 边距差异。

## 允许存在的 CFSM 必要差异

仅以下平台差异被允许，其余一律向 Komari 对齐：

1. Komari API → CFSM REST（`/api/config`、`/api/servers`、`/api/server`）。
2. Komari 实时数据 → CFSM `/api/ws`。
3. Komari 历史数据 → CFSM `/api/history/all`。
4. Komari Settings → CFSM `theme_options`（唯一写接口 `POST /api/theme_options`）。
5. CFSM multi-apiBase 的 source ownership。
6. CFSM JWT / Turnstile。
7. CFSM 第三方主题安装 / 构建 / `dist` 规则（根目录只允许 `index.html` 与 `assets/`）。
8. CFSM 确实没有的数据字段（真实 IP、ASN、ISP、Provider、精确城市与经纬度、访客 IP、Audit Log）。
9. 路由技术差异：详情使用 `/#/server/:id`。
10. 为保持数据真实性而做的字段隐藏或明确降级。

## 审计矩阵

| # | 区域 | Komari 原行为 | 当前 CFSM 行为（本轮前） | 一致性 | CFSM 必要差异 | 正式版修正方案 | 优先级 | 本轮状态 |
|---:|---|---|---|---|---|---|---|---|
| 1 | Earth renderer 分发 | `NodeEarthGlobe.vue` 用 `defineAsyncComponent` 分发到三套独立渲染器 | 单一 `EarthMap.vue` 手绘 SVG 世界地图 + 绝对定位标记 + 地区侧栏 | 不一致 | 否 | 重建分发器，恢复三套真实渲染器 | **P0** | PASS |
| 2 | realistic 渲染器 | `globe.gl` + `three` 真实 3D 地球：原主题贴图、bump、specular、atmosphere、点/环、四光源、自转、resize、可见性暂停 | 无（SVG 剪影 + CSS 渐变模拟） | 不一致 | 否 | 按原实现移植，仅替换数据源与纹理引用方式 | **P0** | PASS |
| 3 | cobe 渲染器 | 真实 `cobe` 点阵地球，RAF 驱动、指针拖拽、静态重绘窗口、标签球面投影 | 无（CSS 点阵背景模拟） | 不一致 | 否 | 按原实现移植真实 cobe | **P0** | PASS |
| 4 | tiled 渲染器 | 独立组件：真实地球贴图等距投影、图例密度四级、移动端横向滚动 | 无（同一 SVG 复用，仅改宽高比） | 不一致 | 否 | 按原实现移植为独立渲染器 | **P0** | PASS |
| 5 | Earth 定位数据 | 允许外部 IP Geo 查询得到城市级坐标，回退国家中心 | 只用 region → 国家中心 | 部分一致 | **是**（§4/§8：CFSM 无真实 IP/ASN/城市，`ip_v4`/`ip_v6` 仅为可达性标志） | 保持只用可靠 region，无法定位不打点 | — | NECESSARY-CFSM-DIFFERENCE |
| 6 | 旗帜资源 | `/images/flags/<code>.svg`（主题自带） | 无旗帜 | 不一致 | **是**（`theme-develop.md` 要求用默认皮肤静态文件且不打包） | 改用 CFSM 官方 `/flags/<code>.svg`（小写） | P1 | PASS |
| 7 | Earth 与总览的关系 | Earth 嵌在 `NodeGeneralCards` 同一栅格：桌面球体占右半、卡片占左半同一行；移动端卡片负边距上移叠加；tiled 则卡片在上、地图在下 | Earth 与总览是两个独立兄弟区块，各自带面板外壳 | 不一致 | 否 | 建立 `general-stage` 统一栅格复刻该契约 | **P0** | PASS |
| 8 | 节点卡片主点击路径 | `NodeCard` 点击直接进入 `InstanceDetail` | 卡片点击 → `ServerQuickView` 弹层 → 再点"打开完整详情与历史"才进详情 | 不一致 | 否 | 移除强制中间层，卡片点击直达 `/#/server/:id` | **P0** | PASS |
| 9 | 列表行主点击路径 | `NodeList` 行点击直接进入详情 | 同样先弹 QuickView | 不一致 | 否 | 行点击直达详情 | **P0** | PASS |
| 10 | 卡片内独立控件 | 收藏等独立按钮 `stopPropagation`，不触发导航 | 已有 `@click.stop` | 一致 | 否 | 保持并加回归测试锁定 | — | PASS |
| 11 | 首页往返状态 | 返回首页保持滚动位置、分组、搜索、视图与筛选，无需刷新 | 搜索/分组/排序/快捷筛选是组件局部 ref，离开即丢失；路由无 `scrollBehavior` | 不一致 | 否 | 会话级 `dashboard-view` store + 路由 `savedPosition` 恢复 | **P0** | PASS |
| 12 | 总览卡片结构 | 无独立标题区，卡片本身是 12 栅格中的 `col-span-4` 单元，含图标与 hover 态；可点击卡片打开财务明细弹窗 | 带"节点总览"标题区的面板，卡片为自有网格；无财务明细弹窗 | 部分一致 | 否 | 第 9.9 轮：删除自创标题区，卡片改为 12 栅格 `span 4`，标签左上 / 图标右上 / 数值与单位基线对齐。当时认为财务明细弹窗依赖汇率而不提供；v1.1.7 财务追加改为浏览器取公开日汇率，恢复剩余价值 / 月费用 / 年费用三张卡，剩余价值卡可打开「价值与费用明细」（固定账单与汇率设置，按量估算不移植），差异见 `docs/finance-parity.md` | P1 | PASS（按量估算为有意不移植） |
| 13 | NodeCard 内部结构 | 544 行：状态点 + `animate-ping` 脉冲、收藏、tag chips、`grid-cols-[3fr_2fr]` 指标布局、`TrafficProgress`、`NodePingListCell` | 260 行，自有结构与指标排列 | 部分一致 | 否 | 第 9.9 轮：按 Komari 区块顺序重写为 状态点+名称 / 收藏+OS+旗帜 / 运行与价格芯片 / CPU·内存·硬盘·流量四项进度 / 网速·总流量·剩余或负载三列指标盒 / 延迟与丢包双面板 / 自定义标签 / 离线遮罩 | P1 | PASS |
| 14 | NodeList 结构 | 667 行，含 `NodePingListCell` 等独立单元 | 159 行表格 | 部分一致 | 否 | 第 9.9 轮：改为 Komari 的栅格行与十列契约（状态/系统/节点/信息/运行时间/CPU/内存/硬盘/流量/速率），「信息」列受 `nodeListMetadataEnabled` 控制，保留 `v-memo` | P1 | PASS |
| 15 | 图表实现 | `echarts` + `vue-echarts`，`MetricSeriesChartCard` / `LoadChart` / `PingChart` 三个组件 | 手写轻量 SVG `HistoryChart.vue` | 不一致 | 否（CFSM 历史数据可满足） | 第 9.95 轮：History 图表改用上游同款 `echarts` + `vue-echarts`，沿用 Komari 的 tooltip(axis) / legend / grid / time 轴 / `autoresize`，并按 `utils/echarts.ts` 只注册用到的组件。`connectNulls: false` 保证缺口保持缺口，超时与缺失不进入数值 series | P1 | PASS |
| 16 | 详情页结构 | `InstanceDetail.vue` 的共享 Header、顶部导航、资源卡与 2×2 信息卡层级；768/1024 的信息区分别为 1/2 列 | 第 9.95 轮已有导航条，但 Header 独立实现、信息卡内容和 768px 断点仍与真实浏览器不同 | 部分一致 | 部分（路由、字段与 CFSM 独有真实指标） | 第 10 轮：复用共享 `AppHeader`，按硬件/系统/存储/网络顺序收敛卡片；资源区 2→3→4 列、信息区 1→2 列断点与 Komari 一致；CFSM 独有且有真实数据的 probe/GPU/disk/history 区继续保留 | P1 | PASS |
| 17 | 图标体系 | `@iconify/vue` 图标 | 文本 / emoji 占位 | 不一致 | 否 | 第 9.9 轮：以同名 Tabler / IconPark 图标替换全部字符占位；图标路径在构建期内联，运行时不访问图标 CDN（自托管与严格 CSP 环境的必要交付方式差异） | P1 | PASS（交付方式为 NECESSARY-CFSM-DIFFERENCE） |
| 18 | UI 基元与弹层 | `reka-ui` 基元、`vue-sonner` 提示、Dialog/Drawer/Tooltip 组件族 | 自写弹层与提示 | 部分一致 | 否 | 第 9.95 轮：Tooltip / Tabs / Badge 改用上游同源的 `reka-ui` 基元（Portal、碰撞翻转、roving focus、`data-state` 与 aria 均由基元提供），瞬时提示改用 `vue-sonner`。Dialog / Drawer / Popover / Select / Switch / Slider 在上游仅服务于 CFSM 不具备的功能（汇率换算财务弹窗、Ping 监控弹窗）与已按规范移除的 QuickView，因此本主题没有对应弹层面，不制造空壳组件。v1.1.7 移植财务明细弹窗时接入了 reka Dialog（`AppDialog`） | P1 | PASS（其余弹层无对应面，为 NECESSARY-CFSM-DIFFERENCE） |
| 19 | 样式体系 | Tailwind 4 + `tw-animate-css` | 4700+ 行手写 CSS | 部分一致 | 否（属实现方式差异） | 第 9.9 轮已按 Komari 尺度校准主要 token：卡片 `rounded-xl`(12px)、列表行与指标盒 `rounded-lg`(8px)、指标网格 16/10px、芯片 11px、行高 64px。余下细粒度差异（逐处 shadow / blur 强度）接受为 P2 | P2 | P2-ACCEPTED |
| 20 | 公告 | `MarkdownRenderer` 受限 Markdown | 按纯文本渲染（此前误记为已实现，2026-10-03 复核时发现从未实现） | 不一致 | 否 | 移植 `MarkdownRenderer`：解析与地址白名单放在 `domain/announcement-markdown.ts`，组件按记号渲染、不用 `v-html`；上游文字先转义再插值会把 `<`、`&` 显示成实体，这一运行时缺陷不复制 | P1 | PASS |
| 21 | 分组 / 搜索 / 排序 / Quick Controls | 按真实字段过滤与排序 | 已实现且行为等价 | 一致 | 否 | — | — | PASS |
| 22 | Ping / Loss 三态 | `number \| null \| false` 三态 | 已在 adapter 边界统一，旧四线路 + Node 1–4 全覆盖 | 一致 | 否 | — | — | PASS |
| 23 | Footer | Komari 品牌页脚 | `Powered by CF-Server-Monitor vX.Y.Z` + Glassmorphism Theme | 不一致 | **是**（§82 要求指向 CFSM） | 保持 CFSM 页脚 | — | NECESSARY-CFSM-DIFFERENCE |
| 24 | 管理后台入口 | 主题内含登录/管理能力 | 外链 `/admin#admin` | 不一致 | **是**（第三方主题不得实现 CFSM 管理后台） | 保持外链 | — | NECESSARY-CFSM-DIFFERENCE |
| 25 | 访客信息 / 审计日志 | `VisitorInfo`、`AuditLogPanel` | 关闭并隐藏 | 不一致 | **是**（无对应公开主题 API，禁止私有接口与外部猜测） | 保持隐藏 | — | NECESSARY-CFSM-DIFFERENCE |
| 26 | 高级工具 | Komari 自有面板族 | 健康 / 性价比 / 快照 / 分类拓扑（登录态） | 部分一致 | 部分 | 高级工具是第 8 轮已落地且用户要求保留的 CFSM 能力；第 10 轮改为默认收起并由 Header 工具按钮显式展开，避免改变默认首页层级 | P2 | P2-ACCEPTED |
| 27 | Light / Dark | `.dark` 类切换 | `:root[data-theme='dark']` | 一致（机制不同） | 否（等价实现） | 渲染器暗色样式已按此适配 | — | PASS |
| 28 | 响应式断点 | 375 / 430 / 768 / 1024 / 1440 / 1920 无横向溢出 | 第 9.95 轮只有源码契约，尚未做双版本浏览器实测 | 未充分验证 | 否 | 第 10 轮逐档并排实测首页、列表和详情；修复详情 768/1024 列数后六档均无页面级溢出、无控制台错误 | P1 | PASS |
| 29 | 死代码残留 | — | 旧 SVG 地图 CSS 已清理；`.quick-view*` 样式仍残留（无组件引用，不可见） | — | 否 | 第 9.9 轮：已清除全部 `.quick-view*` 与旧手绘 SVG 地图残留规则，并新增回归断言防止再次进入产物 | P2 | PASS |
| 30 | Header | 57px 高、32px logo、桌面状态区与紧凑动作按钮；移动端隐藏次要信息 | 第 9.95 轮 Header 高度、logo、状态与动作层级和真实输出有明显差异 | 不一致 | 否 | 第 10 轮按六档 localhost 几何收敛 Header，首页与详情共用同一组件 | P1 | PASS |
| 31 | 首页节点层级与密度 | 控制区后直接渲染扁平 NodeCard/NodeList；mini/compact/comfortable/large 有固定最小列宽和密度 | 节点按分组再包一层标题/容器，控制区和四种卡片密度与浏览器输出不一致 | 不一致 | 否 | 第 10 轮移除视觉分组包装（分组筛选仍保留），收敛控制区、300/270/360/420px 栅格与 mini/large 卡片尺度 | P1 | PASS |
| 32 | 累计流量部分数据的说明位置 | 总览卡面只有数值与纯单位 | 第二轮候选把「部分」塞进单位，窄屏挤掉主数值 | 卡面恢复一致；提示气泡不同 | **是**（CFSM 节点可能缺少双向累计流量，不能将部分合计冒充完整数据） | 卡面按上游保留纯 `GB` / `TB`，仅完整节点参与合计，提示气泡注明「部分 · N 台缺少流量数据，未计入」，全缺失时隐藏卡片 | P2 | P2-ACCEPTED |
| 33 | 背景媒体与容器 | `Background.vue` 图片预加载、视频透明加载/回退层、四层 0.8 秒 fade、正数黑遮罩/负数容器透明、无容器底色且 `z-index:-1` | 原实现图片/视频硬切、失败空白、负遮罩叠白、容器自带渐变且 `z-index:-2` | 已按上游对齐；仅保留下述 CFSM 交付/隐私/冷启动差异 | **是**（主题 ZIP 资源约束、`local:` 解析、无 Referer 与只缓存布尔值的冷启动请求门） | 第四轮 O 移植上游媒体状态机和计算样式；差异逐项见下节 | P2 | PASS |
| 34 | 缺失值占位符 | 界面上所有缺失值都是 ASCII 短横 `-`（NodeCard 剩余天数、`formatDateTime`、`getExpireText`、图表提示等），长破折号只见于代码注释 | 全站 33 处写成长破折号 `—` | 不一致 | 否 | v1.1.15 全部改为 `src/utils/format.ts` 的 `MISSING_TEXT = '-'`，组件不再各写字面量 | P2 | PASS |
| 35 | 节点卡 / 列表的不限流量 | NodeCard 没有上限时右上角 `∞`，下方显示真实的 `已用 / ∞` | 没有上限时把已用量整个当成未知，显示 `— / ∞` | 不一致 | 否 | v1.1.15 `trafficDisplay` 按 CFSM 月度收发与 `traffic_calc_type` 显示真实已用量；上限沿用 CFSM `parseFloat(traffic_limit) \|\| 0` 语义 | P2 | PASS |
| 36 | 流量关闭或已用量缺失 | 上游没有 `show_tf` 开关；有上限但计数缺失时按 0 显示 `0.0%` 与 `0 B / 上限` | 两种情况都显示 `∞`，等于宣称不限流量，且丢掉了已知的上限 | 不一致 | **是**（第 10 条：站点隐藏的数据不呈现；未知不写成 0） | v1.1.15 关闭时显示 `-` 与 `- / -`；有上限但计数缺失时显示 `-` 与 `- / 上限`；节点卡与列表同一口径 | P2 | NECESSARY-CFSM-DIFFERENCE |
| 37 | 无到期日付费节点的剩余信息 | 两行：`-` 与剩余价值；未知到期的剩余价值算成 0，显示「€0」 | v1.1.14 只画一行 `—` | 结构不一致 | **是**（第 10 条：未知剩余价值不写成 0） | v1.1.15 恢复两行结构：日历 `-`、硬币 `-` | P2 | NECESSARY-CFSM-DIFFERENCE |
| 38 | Footer 样式 | `Footer.vue`：`p-4`，`text-xs`（12px / 16px）、`text-muted-foreground`，链接 `font-medium text-foreground`，悬停降低不透明度 | `.app-footer` 为 9px、`--faint` 色、`18px 2px 24px` 内边距，链接 680 字重、悬停变绿。9px 来自 2026-09-07 的早期改版，对照上游的 `3bb1501` 没有改动它 | 不一致 | 否（文字内容仍按矩阵 23 保留 CFSM 归因） | 按上游计算样式对齐：12px / 16px、`--muted`（即上游 `--muted-foreground`）、链接 500 字重的 `--ink`、`p-4` 与 `gap-4`、悬停不透明度 0.8，并删除三条移动端规则。唯一适配：CFSM 归因带版本号，比上游文字长，所以外层允许换行。手机宽度下右段整体移到下一行并左对齐，不在「Powered by」等词组中间折行；宽屏与上游完全一致。回归测试：`tests/footer-fidelity.test.ts` | P2 | PASS |
| 39 | CFSM Turnstile 人机验证 | 上游没有人机验证流程。`LoadingCover.vue` 只显示加载动画与 Loading 文字；弹窗使用 AppDialog 的遮罩与面板 | v1.1.15 从不显示验证组件，开启全局 Turnstile 时所有数据请求被 CFSM 以 403 拒绝，页面无法加载 | 上游无对应功能 | **是**（第 6 条：CFSM JWT / Turnstile） | v1.1.16 在加载遮罩中渲染 Cloudflare 官方组件：<br>• 验证期间隐藏加载动画与文字，冷启动的遮罩保持上游样式<br>• 验证内容放在使用 AppDialog 面板 token 的面板中：`--dialog-surface`、`--dialog-border`、`--radius`、阴影与 24px 模糊<br>• 浏览中途重新验证时，遮罩改用 `.app-dialog__overlay` 的原值：`oklab(0 0 0 / 45%)` 与 `blur(2px)`<br>回归测试：`tests/turnstile.test.ts`、`tests/loading-cover.test.ts` | P2 | NECESSARY-CFSM-DIFFERENCE |
| 40 | 首页保留、换页过渡与卡片进场 | `App.vue`：`RouterView` 外包 out-in 的 `Transition`（进入 300ms ease-out，自 opacity 0、`translate-y-2`；离开 150ms ease-in 至 opacity 0），内含 `KeepAlive(HomeView)`，`onActivated` 恢复首页滚动位置。卡片用 `TransitionGroup` 的 appear/enter，错开 35ms、上限 12 张；关闭页面动画或超过 30 张时不播 | v1.1.16 没有 `KeepAlive` 与换页过渡：<br>• 返回首页时整页重建，卡片重播 460ms 的 CSS 进场动画。手机手势返回时，浏览器截图之后卡片消失再浮现，形成抖动<br>• 同时重拉 REST、重建实时连接<br>• 关闭页面动画时卡片仍按 34ms 错开逐张出现<br>• 页面内的返回按钮回到页面顶部 | 不一致 | 否 | v1.1.17 按上游移植 `KeepAlive`、换页过渡数值与 `TransitionGroup` 的 enter 数值；页面内返回首页时恢复原位置。本主题的顶栏与页脚在页面组件内：顶栏不参与过渡，与上游一致；页脚紧跟内容，随页面主体一起淡出淡入，避免内容透明时页脚单独露出（上游页脚排在至少一屏高的主体之后，换页时不在屏幕内）。回归测试：`tests/page-motion.test.ts` | P1 | PASS |
| 41 | 浏览器历史导航的换页过渡 | 所有路由切换都播放换页过渡，包括手势返回、返回键和前进 | 同矩阵 40 | 不一致 | 否（用户决定） | 浏览器历史导航不播换页过渡。手机浏览器在手势返回时已经用页面截图播放了自己的返回动画，页面再淡出淡入一次，会在截图之后多闪一下。页面内的点击导航照上游播放 | P2 | P2-ACCEPTED |
| 42 | 切换分组或快捷筛选时的卡片动画 | 每个分组一个 `TabsContent`：切换分组时旧分组的网格整个卸载、新分组的网格重新挂载，旧卡片当帧消失，新卡片按 35ms 间隔依次淡入。`getNodeItemTransitionKey` 的 key 含快捷筛选：切换快捷筛选时旧卡片按离场过渡约 200ms 淡出，新卡片同时开始进场 | v1.1.17 的卡片 key 只含节点：切换时不属于新分组的卡片直接消失、留下的卡片跳到新位置，只有新加入的卡片播放进场 | 不一致 | 否 | 下一版照上游修正：网格按分组加 key，切换分组时整个重新挂载；卡片 key 含分组与快捷筛选；离场过渡照搬上游。本地与上游逐帧对比：切换分组时两边旧卡片都当帧消失，没有新旧共存的帧（10→4、4→10），随后依次进场；切换快捷筛选时两边旧卡片都约 200ms 淡出（85ms 时 0.60、96ms 时 0.47），淡出结束后移除。回归测试：`tests/page-motion.test.ts` | P2 | PASS |
| 43 | 页脚与首屏 | `App.vue`：页脚排在 `<main class="min-h-screen">` 之后，总在一屏之后 | `.app-shell` 至少一屏高，详情页与设置页的主体 `flex: 1` 撑满剩余高度，页脚贴在首屏底部。内容较短时（详情仍在加载、只有骨架，或 404）页脚先于内容映入眼帘 | 不一致 | 否 | v1.1.17 加 `.app-shell > main { min-height: 100vh }`，页脚总在首屏之外。回归测试：`tests/page-motion.test.ts` | P2 | PASS |
| 44 | 按实时指标排序时的卡片换位 | `.node-card-switch-move` 定义了 220ms 的位移过渡：同一分组内按实时网速等指标排序、卡片换位时滑到新位置 | v1.1.17 位移不做动画，卡片直接出现在新位置 | 不一致 | 否 | 下一版照搬上游 `node-card-switch-move`（用户决定完整对齐）。本地注入一条实时样本使卡片换位：10 张卡片进入位移过渡，第二张从 -315px 平滑回到原位，约 230ms 完成，计算值为 `transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)`，与上游一致。超过 30 张卡片或关闭页面动画时与上游一样不做过渡。回归测试：`tests/page-motion.test.ts` | P2 | PASS |
| 45 | 列表视图的行切换动画 | `NodeList` 的 `node-row-switch`：首次渲染时行按 35ms 间隔依次淡入；切换分组时列表随 `TabsContent` 整个重新挂载；行 key 只含分组，切换快捷筛选时离开的行约 170ms 淡出、留下的行保持原元素、新增的行依次进场，换位时滑动 210ms；超过 30 行改用虚拟列表，不做行过渡 | v1.1.17 列表行没有任何过渡 | 不一致 | 否 | 下一版照搬上游（用户决定完整对齐）：列表随分组 key 重新挂载，行 key 含分组，过渡值照搬上游，超过 30 行或关闭页面动画时不做过渡。本地与上游逐帧对比：首次加载两边都依次淡入；切换分组两边旧行当帧消失、新行依次进场；切换快捷筛选两边离开的行逐帧透明度一致（0.57、0.44、0.33、0.24），留下的行滑到新位置；从详情返回首页时行仍是原元素，不重播进场。回归测试：`tests/page-motion.test.ts` | P2 | PASS |
| 46 | 总览卡片的统计口径与 tooltip | `NodeGeneralCards`：高负载只统计在线节点（`getHighLoadMetrics` 对离线节点返回空）；即将到期含已过期、排除免费，阈值至少 1 天；实时峰值取上下行合计最高的节点；平均 GPU 按节点平均；平均 GPU、GPU 节点、离线、高负载、即将到期、流量预警 6 张卡的 tooltip 用 `formatNodeNames` 列出最多 8 台节点与指标；实时上下行、在线节点、平均 CPU、进程、核心没有 tooltip | v1.1.17 高负载把离线节点按最后一次上报计入，分母却是在线数；内存 / 硬盘 / 交换的已用与总量分别求和；即将到期不含已过期、不排除免费；实时峰值取单向最大；平均 GPU 按卡加权；这些卡的 tooltip 是一句说明文字，GPU 节点卡写着内部字段名 | 不一致 | 否 | 下一版照上游修正：高负载判定内置在线检查，总览与快捷筛选同时生效；即将到期、实时峰值、平均 GPU 的口径照搬上游；tooltip 移植 `formatNodeNames`。资源合计只取已用与总量成对的节点，数据完整时与上游结果相同，缺一侧时不把未知当 0。回归测试：`tests/theme-presentation.test.ts` | P1 | PASS |
| 47 | 列表视图「信息」栏的厂商 | `NodeList` 取 `resolveProvider` 的 `displayName`、图标与识别依据，与详情页同一个识别函数；另有 city / asn 两项来自 IP 地理查询 | v1.1.17 列表只认自定义别名、只按分号分组，同一台节点在列表与详情页可能显示不同的厂商 | 不一致 | 部分（city / asn 依赖 IP 地理查询，CFSM 不公开 IP） | 下一版列表改用与详情页相同的 `resolveNodeProvider`，带图标与识别依据；city / asn 不提供。回归测试：`tests/list-provider.test.ts` | P2 | PASS |
| 48 | 总览卡片集合 | `ALL_GENERAL_CARD_KEYS` 31 张，含上行 / 下行 / 连接数 / GPU 峰值节点、流量配额、虚拟化分布；财务与流量预设含流量配额，GPU 预设含 GPU 峰值节点 | v1.1.17 只有 25 张，缺这 6 张；`docs/theme-settings.md` 记为「CFSM 未提供字段」 | 不一致 | 部分（虚拟化分布：CFSM 没有虚拟化类型字段） | 下一版照上游补上 5 张（用户决定）：上行最高、下行最高、连接峰值、GPU 峰值与流量配额，由实时网速、连接数、GPU 利用率、流量上限与月度流量真实计算，并补回财务、流量、GPU、完整预设里的位置。峰值节点只在在线节点里取，第一台先入选、之后严格更大才替换；流量配额只合计设了上限的节点，缺月度数据的节点单独说明、不当作 0。虚拟化分布不提供。回归测试：`tests/theme-presentation.test.ts`、`tests/homepage-fidelity.test.ts` | P2 | PASS |
| 49 | 快捷控制按钮上的计数 | `quickControlCounts` / `getQuickControlCount`：在当前分组与搜索范围内计数，不受正在使用的快捷筛选影响；排序类控制（总流量、上行、下行、峰值）显示范围内的节点数 | v1.1.17 在全部节点范围内计数，排序类控制一律显示 0 | 不一致 | 否 | 下一版照上游修正。回归测试：`tests/homepage-fidelity.test.ts` | P2 | PASS |
| 50 | 首页公告外框 | `HomeView` 的 `.alert.px-4` + shadcn `Alert`（`border-none bg-background/60 backdrop-blur-xs rounded-md`）：只有正文非空才出现，标题可选、没有默认标题与图标，`role="alert"`；实测内边距 12px 16px、圆角 8px、4px 模糊、14px/20px、标题字重 500、行距 2px、下方无外边距 | 自绘毛玻璃面板：左侧圆形信息图标、默认标题「站点公告」、只有标题也显示、`role="status"`；内边距 15px 17px、圆角 10px、正文 12px、标题粗体、下方 18px 外边距 | 不一致 | 否 | 结构与取值照上游重做。2026-10-03 与 Komari 本地预览并排实测（浅色 / 深色 1440、浅色 390，含不填标题），外框、标题、正文、链接与代码块的计算值和几何全部一致；唯一差异是上游把 `<`、`&` 显示成实体导致字数变长，属第 20 项记录的不复制缺陷。回归测试：`tests/announcement-markdown.test.ts` | P1 | PASS |

## 第 13 轮：详情页专项审计

矩阵 16（详情页结构）在第 10 轮标记为 PASS，依据是当时的资源卡 / 信息卡列数与断点。
第 13 轮用两版 localhost 的 `getComputedStyle` 重新逐项复核后发现，**当时通过的只是列数与断点，
卡片表面、指标卡信息结构、四张信息卡的内部构成与分区 Tab 都还没有对齐**：

- 指标卡走的是自创的 `glass-panel`，而上游是 `--background/50` + 无边框 + 8px + 无阴影 + 无 backdrop。
- 指标卡是单串数值 + 常驻说明行 + 进度条，而上游是 value / unit 两段式、无进度条、说明走 tooltip。
- `nodeDetailSectionTabsEnabled` 是一个没有任何实现的空设置。

这些已在第 13 轮修正，逐项终态见 `docs/detail-fidelity-audit.md`（P0 = 0、P1 = 0、FAIL = 0，
P2-ACCEPTED 2、NECESSARY-CFSM-DIFFERENCE 6）。矩阵 16 的结论相应更新为：
**页面层级与断点自第 10 轮起一致，卡片表面与信息结构自第 13 轮起一致。**

这也再次印证第 11 轮记下的方法论：源码结构契约通过不等于渲染结果一致，
只有真实浏览器的计算值能判定哪条规则最终生效。

## 第 10 轮最终浏览器审计与收敛

本轮首次在同一台机器上同时运行 Komari v3.3.7 localhost 与当前 CFSM 生产构建 localhost，并让两者消费等价的本地监控场景。审计覆盖 375×812、430×932、768×1024、1024×768、1440×900、1920×1080；逐档检查 Header、Earth/总览、筛选控制、卡片/列表、详情、滚动边界、交互状态与控制台。

浏览器实测暴露并修复了此前源码契约没有覆盖的差异：Header 57px/32px logo；1280px 总宽与 16px 内容内边距；首页控制条；扁平节点层级；四种卡片网格和 mini/large 密度；高级工具默认层级；详情页共享 Header、四类信息卡和 768/1024 断点。修复后六档首页宏观几何与列数一致，卡片高度差控制在 0～3px 的 P2 范围；列表保持 Komari 的 64px 行高与十列横向滚动契约；详情资源/信息列数逐档一致。所有验证状态均无页面级横向溢出、无浏览器 console error。

除常规在线数据外，还实际验证 light/dark/beijing、realistic/cobe/tiled、mini/compact/comfortable/large/list、0/10/64 节点、登录态高级工具、partial source failure、全部离线、详情 401/403/503、History 成功/空/401/409/503，以及旧四线路 + Node 1～4 的 `false`/`null`/number 三态。没有发现需要改写 REST、WebSocket、History、theme settings 或 normalized model 的问题。

对应回归护栏已补入 `tests/fidelity-contract.test.ts` 与 `tests/responsive-contract.test.ts`，锁定扁平节点层级、工具默认收起、共享详情 Header、信息卡顺序、首页栅格宽度和详情断点。

## 第 9.5 轮已修复（P0 全部 + 部分 P1）

1. **Earth 三套真实渲染器恢复**（矩阵 1–4，P0）
   - `EarthMap.vue` 重写为与 Komari `NodeEarthGlobe.vue` 一致的懒加载分发器。
   - `NodeEarthRealisticGlobe.vue`：`globe.gl` + `three`，保留原贴图、bump/specular、atmosphere、点与环、四光源、自转与阻尼、resize、`visibilitychange` 与元素可见性暂停、`pointOfView` 复位。
   - `NodeEarthCobeGlobe.vue`：真实 `cobe`，保留 RAF 驱动、指针拖拽与 theta 钳制、静态重绘窗口、标签球面投影与可见性淡出。
   - `NodeEarthTiledMap.vue`：独立渲染器，真实地球贴图三层叠加、等距投影、图例四级密度、移动端横向滚动。
   - 三者互不退化，且由 `fidelity-contract` 测试锁定。
2. **Earth 与总览统一栅格**（矩阵 7，P0）：新增 `general-stage`，复刻 Komari 的球体右半 / 卡片左半、移动端负边距叠加、tiled 上下分区。
3. **卡片与列表直达详情**（矩阵 8–10，P0）：移除 `ServerQuickView` 强制中间层并删除组件；主点击直达 `/#/server/:id` 且携带 owning `source`；独立控件保持 `stopPropagation`。
4. **首页往返状态恢复**（矩阵 11，P0）：新增会话级 `dashboard-view` store 承载搜索 / 分组 / 排序 / 快捷筛选；路由新增 `scrollBehavior` 恢复 `savedPosition`。
5. **旗帜改用 CFSM 官方静态资源**（矩阵 6，P1）：`/flags/<code>.svg` 小写，缺失时静默隐藏，不打包进主题。
6. **发布护栏按真实构成重设**：`validate:dist` 体积预算改为 JS 2816 KiB / CSS 128 KiB / 总资源 6144 KiB；Komari RPC 残留扫描由裸 `common:` 收紧为字符串字面量正则，消除 three.js shader chunk 的误报。

## 第 9.9 轮已修复

1. **总览卡片结构**（矩阵 12，P1）：删除 CFSM 自创的"节点总览"标题区；卡片改为 12 栅格中的 `span 4` 单元，标签左上、图标右上（淡色、hover 变深）、数值与单位基线对齐在底部，与 `NodeGeneralCards` 的卡片解剖一致。
2. **NodeCard 内部结构**（矩阵 13，P1）：按 Komari 区块顺序重写——状态点 + 名称 / 收藏 + OS 图标 + 地区旗帜 / 运行与价格芯片 / CPU·内存·硬盘·流量四项进度 / 网速·总流量·剩余或负载三列指标盒 / 延迟与丢包双面板 / 自定义标签 / 离线遮罩。
3. **NodeList 结构**（矩阵 14，P1）：由语义化表格改为 Komari 的栅格行与十列契约（状态 / 系统 / 节点 / 信息 / 运行时间 / CPU / 内存 / 硬盘 / 流量 / 速率）；「信息」列受 `nodeListMetadataEnabled` 控制；`v-memo` 等性能优化保留。
4. **图标体系**（矩阵 17，P1）：`★ ☆ ↑ ↓ ◷ ◉` 等字符占位全部替换为与 Komari 同名的 Tabler / IconPark 图标，由 `AppIcon` 渲染。图标路径在构建期内联到 `src/constants/icons.ts`，运行时不访问 `api.iconify.design`。
5. **视觉 token 校准**（矩阵 19，P2）：卡片 `rounded-xl`(12px)、列表行与指标盒 `rounded-lg`(8px)、指标网格 16/10px、芯片 11px、列表行高 64px。
6. **死代码清理**（矩阵 29，P2）：清除全部 `.quick-view*` 与旧手绘 SVG 地图残留规则（含媒体查询内的残留），并新增回归断言。
7. **价格隐私修正**：新增 `GlassServer.showPrice`，卡片与列表的价格同时受主题级 `hidePriceWhenLoggedOut` 与每台节点的 `showPrice` 控制，与详情页口径一致；节点关闭 `showTraffic` 时不展示流量配额。

## 第 9.95 轮已修复（剩余 P1 清零）

1. **History 图表体系**（矩阵 15，P1 → PASS）：`HistoryChart.vue` 改用上游同款 `echarts` + `vue-echarts`。`src/utils/echarts.ts` 对齐 Komari `utils/echarts.ts`，只注册 `LineChart` 与 Grid / Tooltip / Legend / Title / DataZoom / CanvasRenderer，走 tree-shaking 入口。图表沿用上游的 `tooltip(trigger:'axis', confine)`、滚动 legend、`grid`、time 轴与 `autoresize`。
   数据真实性未因换图表而放宽：`connectNulls: false` 使缺口保持缺口；probe 的 `false`（未配置/缺失）与 `null`（超时）都不进入数值 series，绝不写成 0，也不插值；稀疏历史点按真实时间戳落点。九种 `hours`、401 / 409 / 503 / 空 / 网络状态与第 9 轮的 revision + AbortController 并发保护全部保持不变。
2. **详情页信息层级**（矩阵 16，P1 → PASS）：顶部改为 Komari `InstanceDetail` 的导航条——返回按钮、地区旗帜 + 节点名、在线状态徽章、自定义标签徽章、以及收藏 / 上一台 / 节点选择 / 下一台工具条，替换掉 CFSM 自创的 hero 面板。上一台与下一台复用首页已加载的轻量索引（CODEX_SPEC §79），详情页本身仍只订阅当前单节点，不会为导航而订阅全量 WebSocket；跨源导航继续携带 owning `source`。原 hero 承载的分组、数据源、运行时间与最后更新并入系统信息区，真实数据零丢失。
3. **UI 基元与弹层体系**（矩阵 18，P1 → PASS）：Tooltip、Tabs、Badge 改用与上游同源的 `reka-ui` 基元——Portal 渲染、碰撞翻转、roving focus、方向键导航、`data-state` 与 aria 属性均由基元提供，不再自写 absolute 气泡与 `role="tablist"`。瞬时反馈改用 `vue-sonner`（`AppToaster` 在应用根挂载一次，`utils/message.ts` 对齐上游同名模块），设置页的保存成功 / 失败 / 回读警告 / 复制结果都走 toast；需要持续可见的草稿校验问题仍留在页面内。
   Dialog / Drawer / Popover / Select / Switch / Slider 在上游只服务于 CFSM 不具备的功能（依赖汇率换算的财务弹窗、Ping 监控弹窗）与已按规范移除的 `ServerQuickView`，本主题没有对应弹层面，因此不制造空壳组件——这一项属于 NECESSARY-CFSM-DIFFERENCE，而不是缺口。
4. **依赖与体积**：新增 `echarts`、`vue-echarts`、`reka-ui`、`vue-sonner`，版本与上游一致，全部经 Bun 安装并写入 `bun.lock`，运行时不引入任何外部 CDN。`validate:dist` 预算相应上调为 JS 3328 KiB / CSS 128 KiB / 总资源 6656 KiB，并在脚本内注明构成理由；预算仍是硬门槛，超出即失败。
5. **死代码清理**（§12）：移除旧的手写 SVG 折线实现与其 `history-chart__grid / __line / __time` 样式、旧的 `app-tooltip__bubble--*` 定位样式、`detail-hero*` 全部样式与已无引用的 `.settings-save-alert.is-success`。

## 第 12 轮（Test 3）：设置页与卡片密度

1. **设置页字段覆盖**（P1 → PASS）：上游 48 项设置由 Komari 后台从 `komari-theme.json` 的 managed configuration 渲染，Komari 主题自身没有设置页；CFSM 没有等价机制，第三方主题只能自建页面。此前本主题只渲染 44 项并自拟 5 组，现按上游 8 组的标题与顺序渲染全部 48 项，字段表集中在 `domain/theme-settings-form.ts` 并由 `tests/theme-settings-form.test.ts` 锁定。页面顶栏改用与首页、详情页同一个 `AppHeader`（设置页没有节点数据，状态条关闭而不是显示 0/0）。
2. **四处配置无行为**（P1 → PASS）：`dataUpdateInterval`、`diskPredictionEnabled`、`diskPredictionThresholdDays` 此前在 schema 之外零消费，`nodeDetailSectionTabsEnabled` 有实现无入口，本轮全部接线。
3. **卡片密度盒模型**（P1 → PASS）：舒适与宽松两档此前沿用旧盒模型，1440 实测分别比上游高 4px、矮 36px。补齐后四档在 1440 与 375 下与上游逐项相同，包含头部高度、主体内边距、内容行距与延迟面板高度。
4. **NECESSARY-CFSM-DIFFERENCE**：上游的磁盘预测还用于首页健康面板的磁盘风险榜，需要逐节点历史；CFSM 首页不具备该数据，不复刻该榜单。
5. **首页延迟 / 丢包口径**（D-01 → PASS）：上游首页卡片显示的是窗口平均——`useNodePingDisplay` 的 `latencyDisplay` / `lossDisplay` 取自 `pingStats.avgLatency` / `avgLoss`，而不是最近一次采样。本主题据此改为对 `/api/servers` 已返回的窗口（最近 2 小时、最多 20 个真实采样）取平均，`null`（该桶无采样）与 `false`（未配置）都不参与；不产生额外请求。上游按每个任务的探测次数加权，CFSM 不返回探测次数，因此落在上游没有 metric stats 时的同一形态。站点关闭三网详情时窗口为空数组，回落到最新一次上报并在标题写明口径。
6. **「平滑峰值」改称「曲线平滑」**（有意偏离上游文案）：上游同名开关执行 `cutPeakValues`——EWMA 削峰并填补空洞，而本主题只改折线曲率、不触碰采样值。沿用上游名称会让用户以为尖峰已被处理，因此改名并在提示中写明「只改变点与点之间的画法」。极高值本身的可读性方案见 `docs/todo.md` TODO-01。
7. **配色预设的表面色**（P2 → 部分 PASS）：上游预设的 16 个值只由三组选择器消费——卡片、`header` 与顶部统计栏。本轮把节点卡这一组接到独立变量 `--node-card-surface` / `-hover` / `--node-card-border` / `--node-card-shadow`，取值逐字移植上游 `PRESET_TOKENS`；同时停止把预设整表写进全局 `--glass*`，避免差异扩散到上游没有对应规则的提示框、面板与弹层。顶栏与顶部统计栏两处仍未对齐（本主题顶栏是滚动后才上玻璃，结构与上游不同），逐项记录在 `docs/todo.md` TODO-03，不笼统宣称预设已全部对应。（**第 16 轮实测更正**：上游 `header` 规则匹配不到任何元素，顶部统计卡也不消费 control 令牌，"两处未对齐"的前提不成立；本条保留原文以存档，新结论见"第 16 轮"一节。）

## 第 16 轮（v1.1.2）：顶部区域专项

同机、同浏览器、同视口与同一组展示数据，对照固定版本的 Komari `bf83765`。

1. **配色预设的消费者（矩阵 7 结论更正，P2 → PASS）**：此前按选择器推断"上游预设由卡片、`header` 与顶部统计栏三处消费"。
   实测推翻了后两条：上游 `src/` 内没有任何 `<header>` 元素（运行时 `querySelectorAll('header').length === 0`），
   `header { … --glass-*-header … }` 是死代码；顶部统计卡的类是 `bg-background/50` 与 `hover:bg-background`，
   与 `.bg-background` 选择器不是同一个类名，CardX 的 tailwind-merge 还会把默认的 `bg-card` 合并掉，
   因此统计卡既不吃 card 也不吃 control 令牌。本主题的统计卡表面色本来就与上游逐项相同（含 hover 与深色），
   预设只驱动节点卡这一组变量，与上游行为一致。不再存在"两处未对齐"。

2. **滚动后的站点顶栏（新增，P1 → PASS）**：上游顶栏滚动时只追加 `!border-slate-500/10 backdrop-blur-lg`，
   背景保持透明、无阴影。本主题此前会刷上 `--glass-strong` 88% 的背景、`blur(20px) saturate(155%)` 与一层投影。
   已按上游实测值对齐：透明背景 + `blur(16px)` + slate-500/10 边框 + 无阴影，明暗两套取值相同；
   顶栏高度 57px、内容宽 1280、Logo 与按钮位置不变。共享该组件的首页、详情页、设置页均已回归。

3. **总览卡片数值行（新增，P1 → PASS）**：见 `docs/bug-matrix.md` BUG-005 与 `docs/todo.md` TODO-07。
   修复前单位基线比主数值高 9px、间距 0；修复后基线差 0、间距 4px，与上游同位取值一致。

4. **统计卡图标配色（新增，P2 → PASS）**：上游是固定的 `text-slate-500/20` + `group-hover:text-slate-500`，
   没有明暗变体，也不走 `--muted`。已按上游原样移植。

5. **仍未对齐（有意保留）**：上游 control 令牌的真实消费者是选中态控制胶囊、对话框输入框、outline 按钮与 Alert，
   本主题这些元素没有接入该令牌。它们不在顶部区域，v1.1.2 是顶部专项，不顺带改动，记录在 TODO-03。
   （后续：v1.1.3 接入激活态快捷筛选胶囊；v1.1.7 逐项核对后接入「重新加载」，并确认其余消费者在本主题没有对应元素，见下文。）

## v1.1.7（已发布）：隐藏尖峰、控件配色与财务币种

同机、同浏览器，对照固定版本的 Komari `bf83765`。

1. **延迟大图「隐藏尖峰」**（用户批准的体验扩展，不是移植）：「曲线平滑」后面新增独立开关，两者共用一个「图表显示说明」入口。命中的孤立高点只在绘图副本里写成 null，原始数据、统计与首页口径不变，隐藏处保留断口，纵轴按可见数据收缩。上游没有同类开关，它的「平滑峰值」会改写数值并插值，本主题不照搬，也不宣称与上游一致。规则与限制见 `docs/todo.md` TODO-01，验证见 `docs/chart-parity.md`。（v1.1.8 起：检测扩展到短时高值段并跳过邻域里的其它尖峰；只改曲率的「曲线平滑」开关已删除。）
2. **控制色的消费者**（PASS）：按真实 DOM 逐个核对了上游带 `bg-background` 的元素。本主题有对应物的只有两处：激活态快捷筛选胶囊（v1.1.3 已接入），以及首次加载节点失败时的「重新加载」（本轮接入，对应上游连接失败提示里的描边「重试」，默认方案下浅色、深色取值与上游逐项相同）。
   - 财务明细弹窗的「显示币种」下拉框与「恢复今日汇率」描边按钮随同一候选的财务追加接入（见第 4 项）；
   - 自定义时间范围、健康 / 拓扑 / 对比工具里的选中态，本主题没有对应界面；
   - 搜索框、视图切换、工具开关、快照导出的密码框与导出按钮、详情页节点选择器，在上游用的是 `bg-background/60`、`bg-transparent`、`!bg-background` 等不同类名，本来就不消费方案，本主题五套方案 × 明暗实测也都不变。
   - 逐项表格见 `docs/todo.md` TODO-03。v1.1.2 至 v1.1.6 发布说明里「对话框输入框与描边按钮不随配色方案变化」这条已知限制据此不再成立。
3. **毛玻璃模糊双写**（PASS）：上游构建产物里，配色方案的 5 条规则（卡片、`header`、`.bg-background` 及两条关闭覆盖）只剩 `-webkit-backdrop-filter`，Chrome 152 不认这个写法，所以这些表面在 Chromium 里实测没有模糊。本主题按源码意图保留模糊，源码里每条模糊规则都同时写标准与前缀两种形式，构建产物 27 条全部双写，由 `tests/backdrop-filter-pairs.test.ts` 守住。节点卡、激活态胶囊、「重新加载」在 Chromium 下因此有模糊而上游没有，这是有意保留的差异。
4. **财务币种与汇率**（PASS，有意差异逐项列出）：首页恢复上游的剩余价值、月费用估算、年费用估算三张卡，剩余价值卡可打开「价值与费用明细」；详情页剩余价值按显示币种显示。弹窗外壳、汇总、页签、下拉框、描边按钮、表格与汇率网格的计算样式在浅色与深色下与上游实测逐项相同，下拉框与描边按钮随配色方案变化。与上游不同的地方：
   - 页签按源码意图上下排列（上游运行时并排，375 下内容被挤出）；
   - 不移植按量估算；
   - 无法识别的币种与缺失的到期日不计入合计，并在界面上注明；
   - 备用汇率地址改为 frankfurter.dev。

   逐项见 `docs/finance-parity.md`。

## v1.1.13 候选第四轮：背景层 O

`src/components/dashboard/DynamicBackground.vue` 与 `src/composables/use-background-media.ts` 按上游 `Background.vue` 恢复图片预加载、视频 `loadeddata` / `canplay` / `error`、四种图层、失败回退、0.8 秒 fade、媒体 blur 与正负遮罩。浏览器计算值对照及请求时间线见 `docs/v1.1.13-round4-audit.md`。原来容器自带的浅/深渐变已移除，`z-index` 从 -2 调整为上游 -1；无图层时露出与上游同值的 `html --background`，不是另造一层底色。骨架屏与毛玻璃面板仍可读，不需要保留原渐变。

保留的 CFSM 差异逐项记录：

1. 默认图片经 Vite 从 `src/assets/` 输出到 `dist/assets/`，上游从 `public/images/` 直取；这是 CFSM ZIP 根目录只允许 `index.html` 与 `assets/` 的必要差异。
2. `local:` 继续按 CFSM 主题资产规则解析为 `/themes/user-assets/…`，不改变上游媒体状态机。
3. 冷启动只暂存后端 `backgroundEnabled` 布尔值，不存地址：已知自定义背景时，配置前和首张媒体加载期间不请求默认图；首张图片失败才挂默认图，暂存过期则配置确定后立即挂默认图。首访无暂存时则按上游始终保留默认图直到图片加载完成。该请求门是用户要求的 CFSM 冷启动差异；视频期间显示上游的加载层。
4. 图片预加载器设置 `referrerPolicy='no-referrer'`，最终媒体用带 `referrerpolicy="no-referrer"` 的 `<img>` 而非上游 `div + background-image`，避免向第三方图床泄露状态页地址。其 `object-fit:cover` / `object-position:center` 与上游 `background-size:cover` / `background-position:center` 视觉等价。

## v1.1.13 候选第五轮：背景层 P

`DynamicBackground` 与上游一样只由 `App.vue` 在路由外挂载一次，首页、详情、设置页不再各自创建背景实例。自定义背景切页不再重新预加载或重放 0.8 秒淡入；默认背景切页表现不变。`#app` 建立独立层叠上下文，保留媒体容器 `z-index:-1`，三个页面根容器仍透明。源码回归测试与两种站点的 localhost 切页实测见 `docs/v1.1.13-round5-audit.md`；第四轮状态机及四项 CFSM 必要差异均未改动。

## v1.1.13 候选第六轮：顶栏 Q、加载遮罩 R、启动请求 S

- Q：顶栏首屏站点名在可证明为同源 CFSM 注入值时直接使用 HTML `<title>`，favicon 在组件 setup 中同步解析；配置返回后仍以 `/api/config` 为准。默认构建标题、CFSM 默认标题、空值、跨 API Base 与多源归属未明时保留骨架条。相对 Komari 的必要差异是**不在加载期间先显示一个假默认站点名**；注入标题只用于显示，不伪装成后端配置。状态：PASS。
- R：冷启动首屏由 Komari 的全屏 `LoadingCover` 代替可透见的页面骨架屏。明暗／自定义背景四种遮罩、28/20px 转圈、2px 边框、文字、指示器及进入／离开过渡按上游实际计算样式移植；遮罩盖住顶栏，主体在首次数据确定前不渲染，只出现一次。配置、列表或详情请求失败时仍退出并显示原错误态；关闭页面动画时不做遮罩过渡。状态：PASS。
- S：`App.vue` 启动时与路由代码块并行请求配置；首页和详情入口并行请求列表，设置入口不请求列表。各页面复用在途请求或首批已完成的结果，不增加冷启动端点请求数，也不改变后续刷新、WebSocket、详情与 History 的时序。状态：PASS。

两版浏览器计算样式、三种入口和失败态时间线、请求数、旧基线同环境对比及回归测试见 `docs/v1.1.13-round6-audit.md`。本轮仍只是 1.1.13 的候选审计：`package.json` 保持 1.1.12，未写发布说明、打标签或发版。

## v1.1.15：占位符、流量格与剩余信息

- 矩阵 34：上游界面没有长破折号，缺失值一律是 `-`。本主题此前统一用 `—` 属于自定义写法，不在允许差异之内，现全站改用共享常量 `MISSING_TEXT`。回归：`tests/node-traffic-display.test.ts` 钉住常量取值；原有 5 个测试文件中断言旧占位的用例同步改为 `-`。
- 矩阵 35：不限流量的节点按上游显示真实已用量，例如 `4.0 GB / ∞`。已用量与 CFSM 自己的 `getTrafficUsageBytes` 同口径：月度收发按 `dl` / `ul` / `max` / 合计计算。
- 矩阵 36：CFSM 的 `show_tf` 关闭时，CFSM 默认皮肤整行隐藏流量；本主题保留上游的卡片结构但不呈现任何数值。有上限但月度计数缺失时保留上限、已用量为 `-`。两种情况都不再显示「∞」。
- 矩阵 37：无到期日的付费节点，第三个信息盒按上游保留两行；第二行是硬币图标加 `-`，不照搬上游把未知剩余价值算成 0 的「€0」。

## v1.1.16：CFSM Turnstile 人机验证

矩阵 39：Turnstile 属于允许的第 6 类差异，上游没有对应界面。实现只复用已移植的上游样式，不引入新的视觉语言：

- 冷启动沿用上游加载遮罩，验证组件替换其中的加载动画与文字。
- 面板与浏览中途重新验证时的遮罩，直接使用主题中已移植的 AppDialog 样式值。
- 验证组件由 Cloudflare 渲染。主题只传入当前解析出的明暗模式，并在移除前调用 `turnstile.remove()`。

未开启 Turnstile 的站点，加载遮罩与 v1.1.15 完全相同。验证记录见 `docs/v1.1.16-verification.md`。

## v1.1.17：首页保留与换页过渡

- **矩阵 40**：手机从详情页手势返回首页时，浏览器先显示首页截图，随后首页被重建，卡片从透明重播进场动画，看上去是抖动。修复按上游移植：
  - 首页由 `KeepAlive` 保留，返回时不重建，不重拉数据，也不重建实时连接；
  - 卡片进场改为 `TransitionGroup` 的过渡，重新插回页面时不会重播；
  - 页面内导航播放 out-in 换页过渡，滚动等旧页面淡出后再执行。

  本地逐帧测量（390 宽、触屏模拟）：
  - 浏览器返回后，卡片从第一帧起就是原元素，透明度为 1，也没有位移，滚动位置同帧恢复；
  - 首页的 `subscribe=all` 连接在往返详情期间一直保持；
  - 关闭页面动画时，卡片从出现的第一帧起完全可见。
- **矩阵 41**：用户决定浏览器历史导航不播换页过渡，理由见表格。
- **矩阵 43**：页脚照上游排在至少一屏高的主体之后。本地测量：从首页点进详情、数据仍在加载时，主体正好一屏高，页脚顶部在首屏之外（390 宽 901 > 844，1440 宽 957 > 900）。

## v1.2.0：切换动效、总览卡片与公告

- **矩阵 42 / 44 / 45**：分组与快捷筛选切换、按实时指标排序换位、列表视图行切换的动画差异在 v1.1.17 复核时发现，本版照上游修正：卡片网格与列表随分组重新挂载，离场淡出与换位滑动照搬上游 CSS，KeepAlive 返回首页时仍不重播进场。与本地上游构建逐帧对照：切换分组时没有新旧卡片同屏的帧，快捷筛选的淡出曲线一致，实时排序换位为 220ms 滑动；列表视图在首次加载、切换分组与「离线」快捷控制下一致。
- **矩阵 46 / 47 / 48 / 49**：总览卡片、快捷控制与列表视图在代码审查中逐项对照上游 `NodeGeneralCards` / `HomeView` / `NodeList`；49 是线上核对首页截图时发现的快捷控制计数差异，已照上游修正。46、47 已照上游修正；48 由用户决定补上缺少的 5 张总览卡片，虚拟化分布因 CFSM 没有数据不提供。
- **矩阵 20 / 50**：公告移植上游 `MarkdownRenderer` 的受限 Markdown：解析与地址白名单在 `domain/announcement-markdown.ts`，组件按模板绑定渲染，不使用 `v-html`。外框照上游 shadcn Alert：仅内容非空时显示，标题可选，无默认标题与图标。与 Komari 预览并排测量，浅色与深色 1440、浅色 390 下均无差异；唯一保留的差异是上游对正文二次转义（显示为 `&lt;`），本主题不复制。

## 保留的 P2

- **矩阵 19（P2-ACCEPTED）**：主要 token 已按 Komari 尺度校准，余下逐处 shadow / blur 强度的细粒度差异源于 Tailwind 与手写 CSS 的实现方式不同，视觉影响极小，接受保留。
- **矩阵 26（P2-ACCEPTED）**：高级工具是第 8 轮已落地、用户明确要求保留的 CFSM 能力，只让其沿用统一视觉 token，不重新设计 Komari 首页结构。
- **矩阵 32（P2-ACCEPTED）**：累计流量卡面与上游一致；CFSM 数据缺失时仅在提示气泡里如实说明部分合计，保证手机窄卡的数值可见。
- **矩阵 41（P2-ACCEPTED）**：浏览器历史导航不播换页过渡，由用户决定。手机浏览器已经用页面截图播放了返回动画，再播一次会在截图之后闪烁。

## 当前终态

**P0 = 0 ｜ P1 = 0 ｜ FAIL = 0 ｜ P2-ACCEPTED = 4。**
50 项审计的终态分布：PASS 39、NECESSARY-CFSM-DIFFERENCE 7、P2-ACCEPTED 4、FAIL 0。

## 数据真实性边界（不因保真而放宽）

无论视觉如何对齐，都不得伪造真实 IP、ASN、ISP、Provider、精确城市、精确经纬度、访客 IP 或 Audit Log。数据缺失时按"能隐藏则隐藏 → 能明确降级则降级 → 不能可靠实现则不显示"处理；但数据缺失只允许影响数据内容，不构成重新设计 UI 结构的理由。
