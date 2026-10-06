# 功能兼容矩阵

> 本文记录截至 2026-09-09 的上游能力审计结论。状态表示在 CFSM 官方公开主题接口上的最终可行性，不等同于当前实现进度。

## 审计基线

| 项目 | 分支 | 审计提交 | 审计重点 |
|---|---|---|---|
| 目标仓库 allury/CFSM-Glassmorphism | main | d5b4b7f0bd0e45792659d119749a9ee9cf6f10a1 | 第 9.95 轮完成基线；第 10 轮在其上做最终浏览器审计与发布 |
| huilang-me/CF-Server-Monitor | main | 924e71d32e5a0b5493cb52fdb2c184a9d6bd71e3 | 最新 theme-develop.md Ping/Node 契约与公开 config handler |
| sanrokamlan-prog/komari-theme-Glassmorphism | main | bf8376587c720de915ac48789a8a180357c762d6 | v3.3.7 manifest、services、stores、router、views、组件与样式 |
| volcano-1025/CFSM-Theme-LuminaPlus | main | 6ae19289c3788a55fbc18cec9b3c1b2a62ecce34 | CFSM transport、adapter、JWT、Turnstile 与 theme_options |

权限边界采用：CFSM `theme-develop.md` 高于 CFSM 内部前端实现；LuminaPlus 只作为成熟适配参考；Komari 只提供视觉与交互基线。上游克隆位于忽略目录 `work/upstreams/`，保持只读。

状态统计：**✅ 一致 31 项、🟢 等价实现 20 项、🟡 降级实现 5 项、🔴 CFSM API 暂不支持 4 项，共 60 项。**

## 第 7 轮实现进度

第 6 轮的完整 48 项 schema、defaults → backend → local 三层解析和保存协议维持不变。第 7 轮将可由当前公开 CFSM 数据真实兑现的展示配置全部接入 `src/domain/theme-presentation.ts`：总览、八个快捷控制、provider aliases、metadata、三类阈值、详情卡片和 History 图表族均从统一 runtime 驱动。

预设与自定义 key 都保持声明顺序并去重；不受支持的 key 以及当前实体缺失的数据自动隐藏。流量预警兼容 CFSM 数字 GiB 与显式单位文本，并服从 dl/ul/max/total；到期判断使用受校验的 `expire_date`。RPC 与访客信息明确禁用；Earth/Map、磁盘预测和高级工具仅保留迁移值，不提前展示。

## 第 8 轮实现进度

第 8 轮在既有 normalized model 与主题 store 上启用 realistic、cobe、tiled 三种 Earth/Map 视觉。定位只接受可可靠归一化的 `region` 国家/地区代码或名称，并聚合到国家/地区中心；无法定位的节点会明确计数并排除，不用节点名、标签、IP、ASN、城市或外部 Geo 服务猜测位置。

登录态首页高级工具只复用已经加载的真实 CFSM 快照：健康摘要综合在线状态、CPU、RAM、Swap、Disk、Load/Core、GPU、流量配额、到期、当前 Ping/Loss 及 `/api/servers` 真实 Ping/Loss 窗口，离线节点只报离线，不拿最后一次上报的实时指标与探测评级；性价比按可识别账期折算月价（与详情页月均支出同口径：价格 ÷ 周期天数 × 30）、免费/未知价格不参与排行、币种绝不混算（`$` 与 `USD` 这类同一币种的写法归为一组）；快照导出保留 probe 的 `unconfigured / timeout / number` 三态；拓扑明确是 region → group → server/tags 的分类视图而非网络链路。Audit Log 因没有公开主题 API 而隐藏。

## 第 9 轮实现进度

第 9 轮不新增功能、不改动上表任何状态，只在既有实现上做性能、稳定性、异常与测试收敛：统一 server ID 白名单校验并在请求前拦截非法 id；错误分类补齐 `forbidden`(403) 与 `server-error`(5xx)；WebSocket 重连退避改为连接稳定 10 秒后才归零，抑制 open→立即断开的重连风暴；首页大规模节点改用 `shallowRef` 与 WeakMap 缓存的 `GlassServer` 映射、列表行 `v-memo`、预计算动画延迟，降低 50+ 节点实时更新的重算开销；dist 校验新增 JS/CSS/总资源体积预算。历史陈旧响应/并发切换经核验由控件禁用 + `revision`/AbortController 保护，未改动代码。上述改动均不影响数据真实性边界与视觉结构。

## 第 9.95 轮实现进度

第 9.95 轮清零剩余 P1，同样不改变任何 CFSM 数据能力，下表状态全部不变。实现方式变化：History 图表由手写 SVG 改为上游同款 `echarts` + `vue-echarts`（三态与不插值规则原样保留）；详情页顶部改为 Komari 的导航条并补上「上一台 / 下一台」（复用首页索引，详情仍只订阅单节点）；Tooltip / Tabs / Badge 改用 `reka-ui`，瞬时提示改用 `vue-sonner`。逐项终态见 `docs/fidelity-audit.md`。

## 第 10 轮实现进度

第 10 轮首次实际并排运行 Komari localhost 与 CFSM 生产构建 localhost，覆盖六档视口以及主题、Earth renderer、卡片密度、list、空/稠密/错误和 History 状态。由浏览器输出发现并修复 Header、首页控制条、视觉分组包装、卡片网格/密度、详情信息层级和 768/1024 断点差异；高级工具保持第 8 轮能力但默认收起。此次修正只改变表现层，不新增或降级任何 API 能力，60 项功能状态统计不变。

CFSM 仍只按可靠 `region` 做地球定位，后台仍外链 `/admin#admin`，访客/审计仍因缺少公开 API 而隐藏；这些必要差异没有被视觉收敛掩盖。最终版本 1.0.0 的发布资产继续只包含 `index.html` 与 `assets/`，tag workflow 会在完整质量门通过后生成稳定命名 ZIP。

## v1.1.7 财务追加（已发布）

功能可行性状态不变，60 项统计不变。实现方式的变化：

- 首页恢复上游的剩余价值、月费用估算、年费用估算三张卡，按显示币种合计；剩余价值卡可打开「价值与费用明细」（固定账单与汇率设置，按量估算不移植）。
- 详情页剩余价值改按显示币种显示，节点价格与月均支出保留原币。
- 新增一个不经过 CFSM 的请求来源：访客浏览器每天向公开日汇率服务取一次汇率（`docs/api-mapping.md`「第三方汇率数据源」）。CFSM 端点与请求次数不变。
- 不修改 Worker / Agent / D1，不新增 `theme_options` 键。无法识别的币种、缺失的到期日、无法识别的价格都不计入合计，并在界面上注明。

## 第 13 轮实现进度（v1.1.0-test.4）

第 13 轮只做详情页表现层收敛，**没有改动数据适配层**，下表功能可行性状态全部不变。
实现方式的变化：

- 详情指标卡改为上游的 value + unit 两段式，去掉进度条，说明文字降级为 tooltip。
- 详情预设内容与顺序按上游 `DETAIL_METRIC_CARD_PRESETS` 重排；
  允许的 key 集合独立于「综合」预设。新增剩余价值卡（按节点自身币种，单节点无需汇率；v1.1.7 起改按显示币种换算，见下方 v1.1.7 一节）。
- 详情页与首页共用同一套字节 / 价格显示规则（函数由 `formatHome*` 改名为 `formatDisplay*`，
  行为不变）；运行时间三处精度各自独立。
- 硬件卡补齐上游的 CPU 全宽块（PassMark 外链 + 近似分级条），四张信息卡逐项补图标。
- 网络卡补齐配额进度背景与解析后的「已用 / 配额」文本。
- `nodeDetailSectionTabsEnabled` 从空设置变为真实的 概览 / 负载 / 延迟 分区。
- 详情页全部卡片改用上游详情卡表面，自创 `glass-panel` 退出详情页。

因 CFSM 公开 API 不提供而继续隐藏的详情内容：真实 IP、物理核心数、虚拟机类型、
厂商（城市 / ASN）、系统温度、近一天网速峰值。逐条原因见 `docs/detail-fidelity-audit.md`。

## 第 11 轮实现进度（v1.1.0-test.3）

第 11 轮只做首页表现层收敛，**没有改动数据适配层**，因此下表的功能可行性状态全部不变。
实现方式的变化：

- 总览卡片改为上游的 value + unit 两段式；说明文字从单位栏移入 tooltip。
- 首页新增一组只服务卡片与列表的显示格式函数（KB/MB/GB/TB、`在线 N 天`、中文计费周期），
  详情页格式不变。计费周期只本地化 CFSM 官方枚举，未知自由文本原样保留。
- 总览与快捷控制的预设内容与顺序按上游 `stores/app.ts` 重排；
  允许的 key 集合独立于「完整」预设，自定义模式仍可选 upload / download。
- 默认背景改用上游正式资产（`src/assets/`，随构建进入 `dist/assets/`）；
  自定义图片 / 视频、blur、overlay 能力不变。
- 卡片表面、圆角、边框、阴影与栅格几何按两版浏览器计算值逐项修正。

`remainingValue` / `monthlyCost` / `yearlyCost` / `trafficQuota` 等汇总卡片继续不提供：
它们需要跨币种换算或站点级配额，CFSM 没有可靠来源，不猜汇率、不为凑满六卡伪造数值。
（后续：v1.1.7 恢复了 `remainingValue` / `monthlyCost` / `yearlyCost`，汇率由浏览器取公开日汇率并如实标注来源；`trafficQuota` 仍不提供。）

## 第 9.9 轮实现进度

第 9.9 轮同样只做表现层收敛，不改变任何 CFSM 数据能力，下表功能可行性状态全部不变。实现方式的变化：总览卡片、节点卡片与节点列表的 DOM 结构改为 Komari 解剖；字符占位图标替换为与 Komari 同名的 Tabler / IconPark 图标（路径构建期内联，运行时不访问图标 CDN）；OS 图标改用 CFSM 默认皮肤的 `/os-icons/<filename>`，与旗帜一样不打包进主题。价格可见性新增每台节点的 `showPrice` 门控，与详情页保持一致——这属于更严格地遵守服务端已有的可见性设置，不改变字段可用性。逐项终态见 `docs/fidelity-audit.md`。

## 第 9.5 轮实现进度

第 9.5 轮为高保真收敛，不改变任何 CFSM 数据能力，因此下表功能可行性状态不变；但两项状态的**实现方式**已向 Komari 对齐：

- 「三种地球渲染器」由手绘 SVG 仿制改为 Komari 真实实现（globe.gl + three / cobe / 真实贴图等距地图），仍为 ✅ 一致。
- 「地球节点定位」仍是 🟡 降级实现：CFSM 只有 `region`，仅做国家/地区级定位，不猜测城市、不查外部 IP Geo。
- 节点卡片与列表点击恢复为 Komari 的直达详情路径，`ServerQuickView` 中间层已移除。

逐项高保真差异与未完成的 P1/P2 见 `docs/fidelity-audit.md`。

## 矩阵

| 功能 | 原 Komari 实现 | CFSM 数据/API | 处理方式 | 状态 |
|---|---|---|---|---|
| 首页路由 | `/` HomeView | hash 首页 `/#/` | 保留首页入口 | ✅ 一致 |
| 节点详情路由 | `/instance/:uuid` | `/#/server/:id` | 路由参数改为 CFSM id | 🟢 等价实现 |
| 管理入口 | 主题内登录/管理能力 | `/admin#admin` | 外链官方管理端，不复制私有 API | 🟢 等价实现 |
| 卡片视图 | NodeCard 网格 | `/api/servers` | 数据经 adapter 注入原布局 | ✅ 一致 |
| 列表视图 | NodeList | `/api/servers` | 保留响应式列表 | ✅ 一致 |
| 卡片尺寸 | mini/compact/comfortable/large | 前端设置 | 原样保留视觉密度 | ✅ 一致 |
| 节点分组 | group 聚合 | `server_group` | 按真实分组聚合 | ✅ 一致 |
| 搜索 | 名称、标签、元数据 | name、tags、group、region | 只检索实际存在字段 | ✅ 一致 |
| 收藏 | 浏览器本地收藏 | localStorage | 以 source+id 避免多源冲突 | ✅ 一致 |
| 离线置底 | 客户端排序 | 在线状态 | 保留排序规则 | ✅ 一致 |
| 首页快捷筛选 | 收藏、流量、峰值、离线等 | 列表真实指标 | 有数据的筛选保持原交互 | ✅ 一致 |
| 总览卡片 | Komari 节点聚合 | `/api/servers` stats 与本地聚合 | 指标名映射并隐藏缺失项 | 🟢 等价实现 |
| 自定义公告 | manifest 文本设置 | `theme_options` | 配置驱动显示 | ✅ 一致 |
| 主题模式 | beijing/light/dark | preferred_theme + theme_options | 保留北京时间模式，兼容 auto/light/dark | 🟢 等价实现 |
| 毛玻璃配色 | 预设与自定义 JSON | `theme_options` | CSS 变量保留 | ✅ 一致 |
| 色觉辅助 | 调色板、线型和标签 | 前端渲染 | 保留非颜色区分 | ✅ 一致 |
| 自定义背景 | 图片/视频、明暗双 URL | `theme_options` 与静态资源 URL | 统一 URL 安全解析 | 🟢 等价实现 |
| 响应式布局 | 桌面/平板/移动 | 前端渲染 | 保留断点体验 | ✅ 一致 |
| 减少动画 | 手动开关和系统偏好 | 前端渲染 | 同时尊重 prefers-reduced-motion | ✅ 一致 |
| CPU/RAM/Swap/Disk/Load | 节点实时指标 | 同名 CFSM 指标 | 直接字段映射 | ✅ 一致 |
| 实时网速与累计流量 | 网络指标 | net_in/out_speed、net_rx/tx | 单位在 adapter 后统一；全站累计流量仅合计双向完整的节点，缺失节点数在提示中标为「部分」，全缺失时隐藏该卡，单节点仍严格保持未知 | ✅ 一致 |
| 进程与连接 | processes、connections | processes、tcp_conn、udp_conn | 直接字段映射 | ✅ 一致 |
| 运行时长 | uptime | boot_time | 使用当前时间减真实启动时间 | 🟢 等价实现 |
| OS/架构/内核/地区 | 节点元数据 | os、arch、kernel_version、region | 直接映射 | ✅ 一致 |
| 服务器真实 IP | ipv4/ipv6 字符串 | 仅 ip_v4/ip_v6 可达性标志 | 不把标志伪装成地址，不显示地址 | 🔴 CFSM API 暂不支持 |
| ASN/城市/IP 地理信息 | IP Geo 查询 | 公开主题 API 不返回地址、ASN、城市 | 不发外部猜测请求，不造数据 | 🔴 CFSM API 暂不支持 |
| 厂商识别 | 元数据、IP Geo、别名字典 | name、group、tags、region | 仅对已有文本做可解释匹配，无证据则不显示 | 🟡 降级实现 |
| 价格与到期 | 财务卡片 | price、billing_cycle、currency、expire_date | 遵守 show_price/show_expire 与未登录隐藏价格；卡片用严格日期显示剩余天数，剩余价值只识别 CFSM 官方周期；v1.1.7 起首页财务合计与详情页剩余价值按显示币种换算，汇率由浏览器每日取公开数据源，缺失时用 CFSM 内置参考表并标明（`docs/finance-parity.md`） | ✅ 一致 |
| 流量配额 | 配额数值与使用率 | traffic_limit 为格式化字符串 | 能可靠解析时计算，否则只展示原值 | 🟡 降级实现 |
| GPU 利用率 | GPU 指标卡 | gpu_info id/name/info | 兼容数组和 JSON 字符串 | ✅ 一致 |
| 磁盘 IO | 吞吐、IOPS、await、util | disk 对象 | 缺失或全零时隐藏 | ✅ 一致 |
| 八目标即时延迟/丢包 | Ping 指标 | ping/loss 的 CT/CU/CM/BD 与 Node 1–4 字段 | 三态映射；首页保留旧四线路，详情完整显示旧四线路和 Node 1–4 | ✅ 一致 |
| 延迟窗口小图 | 历史延迟序列 | `/api/servers` ping/loss 窗口 | 使用真实稀疏时间戳，不补点 | ✅ 一致 |
| 在线状态 | Komari online 字段 | is_online 或 last_updated/timestamp | 遵循五分钟在线阈值 | 🟢 等价实现 |
| 多 API Base | 原主题单后端 | apiBase meta 可配置多个 origin | 每个节点保存 source ownership | 🟢 等价实现 |
| 定时刷新间隔 | dataUpdateInterval/RPC | REST 回退 + Agent 配置的 WSS 上报节奏 | 设置只控制 WebSocket 不可用时的 REST 补偿轮询；WSS 按 `wss_report_interval` 推送，前端不强制为 5 秒或 10 秒 | 🟡 降级实现 |
| 实时订阅 | `/api/clients` | `/api/ws` | 每个 base 独立连接、订阅其自身 IDs、增量合并 | 🟢 等价实现 |
| 单节点详情初始数据 | Komari node RPC | `/api/server?id=` | 已实现详情只拉单节点；owning base 已知时不探测其他来源 | 🟢 等价实现 |
| 历史指标 | load/ping records | `/api/history/all?id=&hours=` | 已实现官方九种周期、稀疏点 ECharts 图表与真实空/错误状态 | 🟢 等价实现 |
| 超过 24 小时历史 | Komari 鉴权历史 | hours 48/96/168 需 JWT | 保留登录门槛并显示 401 | ✅ 一致 |
| 磁盘耗尽预测 | 历史回归 | history disk_used/disk_total | 只在足够真实样本时计算 | 🟢 等价实现 |
| 详情指标面板 | 预设与自定义 keys | 详情/历史公开字段 | 建立指标注册表并按可用性隐藏 | 🟢 等价实现 |
| GPU 历史图 | GPU 序列 | history gpu_info | 有真实 GPU 序列时展示 | ✅ 一致 |
| Ping 历史图 | Ping/丢包序列 | history 行相关字段 | 使用真实数据绘图 | ✅ 一致 |
| 快照导出 | 客户端导出 | 已加载真实数据 | 保留格式并标注来源/时间 | 🟢 等价实现 |
| 健康工具 | 多指标规则 | CFSM 公开指标 | 规则映射到可用指标 | 🟢 等价实现 |
| 性价比工具 | 价格/资源计算 | CFSM 财务与资源字段 | 使用可解析真实字段计算 | 🟢 等价实现 |
| 拓扑工具 | 节点关系视图 | 无真实网络拓扑关系 | 仅按分组/地区可视化，不声称链路关系 | 🟡 降级实现 |
| 访客信息与审计 | 访客 IP、指纹与审计 API | 无对应公开主题接口 | 整体关闭，不调用私有或外部接口 | 🔴 CFSM API 暂不支持 |
| 主题设置读取 | Komari managed config | `/api/config.theme_options` | defaults 与后端快照合并 | 🟢 等价实现 |
| 主题设置跨设备保存 | Komari 管理配置 | `POST /api/theme_options` | JWT + Turnstile，提交完整快照 | 🟢 等价实现 |
| 本地覆盖 | localStorage 设置 | 本地层 | 与后端层分离并可清除 | ✅ 一致 |
| JWT 鉴权 | Komari session | Authorization Bearer jwt_token | 沿用 CFSM 官方存储键和失效规则 | ✅ 一致 |
| Turnstile | Komari 无同构流程 | config + Token/Verified headers + Cloudflare 官方组件 | 按 CFSM 默认前端流程：开启全局 Turnstile 且未验证时在加载遮罩中渲染官方组件（此时隐藏转圈与 Loading 文字，组件放在弹窗面板里；中途过期时遮罩改用 AppDialog 的遮罩）取得令牌，经 `/api/config` 换取约 1 小时的凭据；凭据过期导致 403 时重新验证。issue #3 修复前主题只复用已有凭据、从不渲染组件，访客没有凭据时所有数据请求被拒绝 | 🟢 等价实现 |
| Komari RPC transport | `/rpc2` common/public/admin namespace | CFSM 无兼容 RPC | 完全移除，不移植 runtime | 🔴 CFSM API 暂不支持 |
| 隐藏节点与权限过滤 | Komari 权限过滤 | `/api/servers` 服务端按身份过滤 | 信任服务端边界，不探测隐藏节点 | ✅ 一致 |
| 缓存与延迟加载 | service cache、worker、deferred UI | 浏览器缓存与 store | 按 CFSM 请求语义重建缓存 | 🟢 等价实现 |
| 三种地球渲染器 | realistic/cobe/tiled | 前端视觉能力 | 保留渲染器与交互 | ✅ 一致 |
| 地球节点定位 | IP Geo/region 坐标 | 只有 region，且可能不精确 | 仅可可靠归一化时定位，否则不放点 | 🟡 降级实现 |
| Powered by 页脚 | Komari 品牌页脚 | CFSM 开源项目链接 | 更新为 CF-Server-Monitor | ✅ 一致 |

## 关键审计结论

- v1.1.13 稳定版不改变本表的能力边界：保留 Agent `wss_report_interval`、历史点位、probe 三态和配置含义；Issue #1 继续作为上游限制记录，不采用主题端绕过方案。稳定安装使用 `theme-v1.1.13`；`preview-main` 仅用于临时验证，发布后维护改为每次以租约保护替换一个无父产物提交，应固定最新完整 SHA 安装，不用滚动分支地址。

- CFSM 的 dashboard 公共接口不返回管理端 `note`，也不返回服务器实际 IP、ASN 或城市；这些能力不得由占位值补齐。
- `gpu` 已废弃，适配只读取 `gpu_info`。REST 可能返回 JSON 字符串，WebSocket 新数据返回数组。
- `disk` 只有六个指标中至少一个非零时才有意义；缺失、格式错误或全零都视为不可用。
- `/api/servers` 才包含 ping/loss 窗口；`/api/server` 不包含。窗口点稀疏且保留真实时间戳。
- Ping/Loss 的 `false`、`null`、`0` 不可互换：分别表示未配置/缺失、明确超时、有效零值。Node 1–4 的名称与 probe 字段已由公开 config、详情、历史及 WebSocket 契约提供；旧版本缺失时只回退名称和 `false` 状态。
- LuminaPlus 最新实现确实通过 `POST /api/theme_options` 保存完整配置。其仍存在“只读/本地保存”的旧注释和一个拒绝保存的兼容 stub；本项目以实际调用链与最新 CFSM 文档为准，不复制陈旧注释。
