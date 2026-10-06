# 架构

## 目标

CFSM-Glassmorphism 是 CF-Server-Monitor 的静态第三方主题。运行包只包含 `index.html` 与 `assets/`；它保留 Komari Glassmorphism 的视觉与交互语言，但所有数据、鉴权、实时协议和配置持久化都服从 CFSM 官方主题协议。

优先级固定为：数据真实性 > API 兼容性 > 功能完整度 > 视觉相似度 > 开发便利性。

## 分层数据流

~~~text
CFSM public API
      |
      v
Transport (URL, JWT, Turnstile, timeout, errors)
      |
      v
Service (endpoint intent and source ownership)
      |
      v
Adapter (unknown wire data -> strict CFSM and Glass UI models)
      |
      v
Store (state, lifecycle, selection, derived values)
      |
      v
UI (render and user intent only)
~~~

响应严格向下经过 adapter；写操作按相反方向由 UI 意图进入 store/service。组件不得跨层直接调用 `fetch`、读取 wire snake_case 字段或解释错误码。

## 各层职责

### Transport

位置：`src/services/cfsm/http.ts`。

- 只处理 URL、method、JSON、credentials、15 秒默认超时和可取消 signal。
- 超时和调用方取消覆盖响应头及响应体读取全过程；流中断统一归类为网络错误，完成后释放计时器与取消监听。
- 从 CFSM 兼容存储键附加 JWT 与 Turnstile header；Verified 与 Token 都有时都带，与 CFSM 默认前端一致。
- 把非 2xx 统一转换为带 status、path、code、details 的 `CfsmRequestError`。
- 401 清 JWT，403 清 Turnstile 并经 `onTurnstileRejected` 通知订阅方；不自动导航，不吞掉 409/503。
- Turnstile 人机验证（issue #3）：app store 按配置判断是否需要验证。`App.vue` 在加载遮罩中渲染 `TurnstileChallenge`，冷启动与中途凭据过期共用这条路径。验证期间遮罩隐藏转圈与 Loading 文字，验证内容放在与 AppDialog 相同的面板里（预留官方组件 300×65 的位置，出现时不跳动）。中途过期时遮罩盖在已加载的页面上，改用 AppDialog 的遮罩（`loading-cover--modal`）。组件配色按主题解析出的明暗传入，不跟随系统设置。重试或卸载前按 CFSM 管理端的做法先调用 `turnstile.remove()`，避免 Turnstile 找不到已移除的容器而在控制台警告。组件只加载官方脚本、渲染组件，令牌交给 store 换取凭据。成功后 store 递增 `credentialRevision`，首页与详情页各自按原有加载路径重取数据，不整页刷新。
- 不了解服务器、历史或主题设置的领域含义。

### Service

位置：`src/services/cfsm/api.ts`、`src/services/cfsm/websocket.ts`、`src/services/cfsm/dashboard-realtime.ts` 与 `src/services/cfsm/detail-realtime.ts`。

- 用语义方法封装 `/api/config`、`/api/servers`、`/api/server`、`/api/history/all` 和 `/api/theme_options`。
- 在发出请求前确定 base、id 和受支持的 history hours。
- 多源请求保留数组边界；详情和历史明确接收 owning base。
- `websocket.ts` 只负责单一 base 的 URL、订阅帧、消息适配、连接时限、keepalive 和有界退避。
- `dashboard-realtime.ts` 负责首页多 base 协调、visibility 生命周期、REST 补偿与用户超时决策；不会跨来源拼接订阅 ID。
- `detail-realtime.ts` 只建立 owning base 的 `subscribe=<serverId>` 连接；页面恢复可见时先刷新单节点 REST，失败时以单个低频 REST 循环补偿。
- 首页与详情的可见性恢复共享正在进行的 REST 刷新；快速隐藏/显示时只允许最新 visibility revision 在刷新结束后恢复连接，卸载后不再重连。WebSocket 订阅、心跳或 error 失败统一关闭旧连接并进入原有退避流程。
- `errors.ts` 把 400/401/403/404/409/5xx（含 503）、网络错误与未知错误转换为稳定 issue（含 `forbidden` 与 `server-error`）；UI 只选择对应文案，不解析响应体。
- `identifiers.ts` 提供统一的 `normalizeServerId` 白名单校验，`api.ts` 详情/历史请求与 `websocket.ts` 订阅 ID 清洗共用；非法 id 在发请求前即被拒绝（400 `invalidServerId`）。

### Adapter

v1.1.12 维护预览没有更改 adapter、normalized model 或 wire 契约。详情 `open` 持有本次请求的局部 AbortController，避免 `close` 清空 store 控制器后，延迟返回的成功/失败分支访问空引用。

位置：`src/services/cfsm/adapters.ts`。

- 唯一允许理解 CFSM wire 字段名的层。
- 输入总是 `unknown`；先验证对象/数组和关键 id，再做有限的字符串、数值、布尔归一化。
- 把 snake_case 映射到 `src/types/cfsm.ts` 的稳定领域模型。
- Ping/Loss 在边界统一映射为 `ProbeValue = number | null | false`。`CfsmServer` 与 `HistoryPoint` 都持有旧四线路加 Node 1–4 的八目标完整映射：缺字段为 `false`，显式 `null` 和有效 `0` 均原样保留。
- `/api/config` 的八个 probe 显示名进入 `SiteConfig.probeLabels`；`src/constants/probes.ts` 是旧版本与 config 不可用场景的唯一默认名来源，避免 adapter 和 UI 各自定义 fallback。
- 兼容 `gpu_info` 的数组/JSON 字符串和历史磁盘 IO 两种形状。
- Server 与 History 都在 adapter 边界解析 `gpu_info`；History 图表模型只读取归一化后的 `HistoryPoint.gpus`。
- 不补历史点，不伪造 IP/ASN/城市/厂商，不把错误格式变成看似真实的数据。
- `src/services/cfsm/glassmorphism-adapter.ts` 再把稳定 CFSM 模型映射为首页展示模型；可达性仍是状态，不成为地址字符串。

### 汇率（v1.1.7）

位置：`src/services/exchange-rates.ts`。

- 这是唯一不经过 CFSM transport 的请求：浏览器直接读取公开日汇率（`open.er-api.com`，失败时 `api.frankfurter.dev`），不带凭据与 Referer，单源超时 5 秒。
- 响应按 `unknown` 校验，只保留有限正数的汇率；缓存按本地日期保存数据源实际返回的值。
- 金额口径（价格、币种、周期、到期、换算、合计）集中在纯函数模块 `src/domain/finance.ts`，首页、详情页与明细弹窗共用。

### Store

位置：`src/stores/`。

- `app.ts` 管理 apiBases、站点 config、加载状态与官方管理端地址。并发消费者共享同一个配置请求；revision 阻止旧初始化覆盖保存后的回读，暂时失败时保留最后一份真实配置。
- `servers.ts` 管理按来源分开的集合，以 `base::id` 作为稳定键，避免不同站点 UUID 冲突。
- `servers.ts` 也按来源合并实时 partial sample，未知节点不会由 WebSocket 凭空创建；REST 暂时失败时保留该来源上一份真实快照。首页与详情共享进行中的列表请求；请求期间实际应用的 WSS 样本按收到顺序重放到新 REST 节点上，字段归属只由 `mergeRealtimeSample` 决定，因此新 REST 名称、标签等静态字段不会被整台旧对象挡住。`clear()` 会使在途响应失效。
- `realtime.ts` 管理首页实时协调器的生命周期、每个来源的连接状态、五分钟离线过期、降级提示和超时后的继续/暂停动作。
- `dashboard-preferences.ts` 只保存以 source+id 标识的收藏。旧快照中的主题、视图与离线排序由 theme settings 层一次性迁移，避免同一外观状态有两个写入者。
- `theme-settings.ts` 管理 48 项 schema 的 defaults、原始 backend 快照、版本化 local override、未保存 draft 与实际 runtime。它集中完成规范化、即时预览、本地保存/清除、完整后端保存和 `/api/config` 回读；组件不读取 localStorage 或 wire `theme_options`。同一草稿的重复保存共享一个 Promise；在途期间提交不同草稿会明确拒绝并提示等待，新的编辑保留供重试，不会冒充首次保存成功。
- `finance.ts`（v1.1.7）管理财务偏好（显示币种、排除免费节点、手动汇率）与汇率状态：当日缓存、单个进行中的请求、失败后退回旧缓存或参考表。偏好只存浏览器本地，不进入 `theme_options`。
- `server-detail.ts` 管理单节点 REST、所属 source config、History、single-server WebSocket、错误/空状态和页面生命周期。首页传入 owning base；刷新直达链接时可在已配置 bases 上用 `/api/server` 解析归属，但绝不拉取全量列表。配置、单节点、可见性列表与 History 并发启动；owning config 有独立 pending/ready/error 状态，慢配置不阻塞数据请求，但 UI 在配置确定前保持骨架屏，避免设置驱动的指标卡按默认值闪现。History 切换范围会清除上一范围，原范围 revalidate 失败则保留最后真实快照；revision 与局部 AbortController 共同阻止旧请求、卸载后请求和慢 REST 覆盖新 WSS。
- store 对异步过程提供 idle/loading/ready/partial/error，而不是让 UI 猜测；多来源之一失败时保留其他来源的真实结果与失败原因。

### UI

位置：`src/App.vue`、`src/views/`、`src/components/dashboard/` 与 `src/components/detail/`。

- 只渲染领域模型和显式状态。
- `App.vue` 的 setup 在懒加载路由组件完成前启动 `/api/config`；首页和详情直达入口也同时启动 `/api/servers`，设置直达入口只启动配置。各页面首次挂载复用 store 中的在途 Promise；若预取已经完成，则不为首次挂载重复请求。之后的手动刷新、切页与 WebSocket 时机不变。
- 冷启动时，`App.vue` 在唯一的 `DynamicBackground` 之后挂载一次 Komari `LoadingCover`：它盖住仍然挂载的顶栏，而首页、详情、设置的主体与 Footer 暂不渲染。主后端 `/api/config` 已成功或明确失败，且入口首页的首次列表、详情页的首次 `/api/server`（以及原有详情配置门禁）或设置页的配置已确定后，遮罩一次性淡出；关闭页面动画则无过渡。请求失败也会解除遮罩并呈现既有错误态。冷启动之后的切页或刷新不再显示遮罩，原骨架屏只服务于此后的加载状态。已有真实配置的手动刷新继续显示旧快照；详情标题、版本和授权状态仍归节点所属后端，主题设置仍归主后端，不增加配置请求。
- CFSM 注入到 HTML 的 `<title>` 只在启动时、路由标题写入之前读取一次；值真实且页面与主 API Base 同源时用作配置返回前的顶栏站点名。默认构建标题、CFSM 默认标题、空值和跨源情况仍用骨架条；多来源详情只在节点归属主后端时采用注入值。配置成功后始终以所属后端的真实配置为准。图标在顶栏组件 setup 中同步读取 HTML favicon，加载失败仍走原有回退。注入值只用于显示，不进入主题设置、存储或后端状态。
- 缺数据时隐藏依赖组件或显示“不可用”，不展示 0 值占位来冒充采样。
- 用户动作调用 store/service，鉴权失败保留当前页面和编辑内容。
- 原 Glassmorphism 的组件、布局、动效和响应式策略优先复用；Komari transport 代码不能随组件一起移植。
- 首页筛选、排序、分组和汇总位于 `src/domain/dashboard.ts`，不会在组件内重新解释 wire payload。
- 第 7 轮的配置驱动展示注册表位于 `src/domain/theme-presentation.ts`：它从统一 runtime 和 normalized `GlassServer` / `CfsmServer` 生成总览卡片、快捷控制、provider alias、阈值、详情卡片及 History 图表族。预设只决定 key 和顺序，不拥有网络请求或 wire 解析。
- v1.1.7 的财务明细弹窗位于 `src/components/finance/FinanceDetailsDialog.vue`，外壳是 `src/components/ui/AppDialog.vue`（reka Dialog）。组件只调用 finance store 的动作，不直接请求汇率。
- 第 8 轮的 Earth 与高级工具领域模型位于 `src/domain/advanced-tools.ts`：`EarthMap` 和 `AdvancedTools` 只接收已经归一化的 `GlassServer`，不新增请求、不读取 wire payload。国家/地区中心、健康规则、月价折算、快照序列化和分类拓扑均为可单测的纯函数。
- 节点卡片与列表行的主点击直达 `/#/server/:id`（与 Komari 一致），中间不再插入任何快速查看或二次确认层。
- 首页节点区直接遍历同一份 `visibleServers` 渲染 NodeCard 或 NodeList；分组仍作为真实字段筛选条件，但不再包一层偏离 Komari 的视觉分组容器。高级工具展开状态属于 `dashboard-view` 会话状态，默认关闭，不进入 theme settings 或后端快照。
- 首页与详情共用 `AppHeader`。详情主层级为顶部节点导航、资源卡、硬件/系统/存储/网络信息卡，再接 CFSM 真实可用的 probe、GPU、磁盘 IO 与 History；共享视觉结构不改变详情只消费 normalized model 的边界。
- `src/domain/site-title.ts` 是站点标题的唯一状态机：配置 pending 时 Header 使用固定尺寸占位且不猜站点名；请求明确失败后才使用既有 fallback；详情只组合 owning source 的标题，切换 source 时不会泄漏上一来源标题、版本或授权状态。
- `ServerDetailView` 只消费 `CfsmServer`、`HistoryPoint` 与纯 domain 图表模型。ECharts 折线图按真实时间戳绘制，`connectNulls: false` 使缺失/超时形成断点，不补点；probe 图例额外保留有效/超时/缺失计数。

## Theme Options

最终主题设置由三个明确层组成：

~~~text
schema defaults
    <- backend /api/config.theme_options
        <- local browser overrides
~~~

- **Defaults** 是版本控制中的完整 schema 默认值。
- **Backend** 是跨设备共享的完整配置快照。
- **Local** 只覆盖当前浏览器，必须可单独清除，不能显示成“已经保存到后端”。
- `src/theme/site-theme-hint.ts` 另存非权威的上次站点明暗模式与自定义背景开关，不存背景地址；旧 v1 记录缺少背景字段时按未启用处理。它不参与三层合并，也不进入草稿、统计、复制 JSON 或保存快照。store 初始化即读取并应用；无暂存的明暗猜测恢复为未配置站点的 `preferred_theme=auto`，即跟随系统。确认配置后只以成功回读的后端模式及背景开关更新；冷启动失败时本次回到未配置站点的解析结果（旧暂存保留供下次访问），本地覆盖始终优先。
- `DynamicBackground` 只在 `App.vue` 的 `RouterView` 外挂载一次；首页、详情与设置页切换不重建媒体状态机。`#app` 是背景 `z-index:-1` 的层叠上下文，各页面根容器保持透明。组件通过 `useBackgroundMedia` 执行 Komari `Background.vue` 的图片预加载、视频 `loadeddata` / `canplay` / `error`、默认/加载/回退/媒体四层显示条件与 0.8 秒淡入淡出。图片预加载及最终 `<img>` 都不发送 Referer。配置未确定且背景开关猜测为未启用时立即挂载默认图；猜测为启用时配置前及首张图加载期间留空，不请求默认图，图片失败才回退。首次访问无暂存的自定义背景站点则在图片加载期间保持默认图；配置明确失败或暂存过期也回退默认图。明暗切换换地址会重置预加载并在等待时显示默认图。遮罩和容器透明度作用于默认与自定义两种背景；没有新增 `/api` 请求。
- 保存后端时先把 defaults、当前 backend 和允许持久化的用户编辑合并为完整对象，再调用 `POST /api/theme_options`。
- 本地专属状态（例如一次性 UI 展开状态、JWT、Turnstile 凭证）绝不混入后端快照。
- 保存成功后以后端响应替换 backend 层；401/403/400 时保留草稿并显示准确动作。
- backend 快照中的未知 key 会保留以支持前向兼容；已知 key 按类型、枚举和范围校验。JWT、Turnstile、收藏及一次性 UI 状态在序列化边界排除。
- 第 6 轮已落地完整 48 项 schema 和 `/#/settings`：即时预览、本地覆盖、回落后端、完整 JSON、JWT + Turnstile 后端保存与成功后 config 回读。第 7、8 轮没有改造该架构，只把配置驱动展示、Earth/Map 与高级工具接到同一 runtime。

## WebSocket

首页实时层位于 `src/services/cfsm/websocket.ts`、`dashboard-realtime.ts` 与 `src/stores/realtime.ts`，当前实现如下：

- 一条首页连接只对应一个 apiBase；它的订阅 IDs 只来自同一 base。
- 首页连接 URL 固定为 `/api/ws?subscribe=all`，open 后发送包含本 base 真实节点 IDs 的 all-scope subscription。
- 收到 `batchUpdate` 后提取 sample 的 `data`、`payload` 或 `metrics`，按字段合并进已有实体。
- 同一轮上报里的节点消息可能在约数百毫秒内分批抵达。首页按当前最快 `wss_report_interval` 的一半（限制为 250～1000ms）收齐这一轮消息，再跨 apiBase 原子提交一次；每条 sample 仍按原顺序 partial merge，不降采样、不平均，也不把 Agent 的 1～5 秒上报周期改成前端固定值。
- 高频增量缺失字段是正常情况，不得覆盖已有值；显式存在的 probe `false`、`null`、`0` 与普通数字则必须更新对应单一字段。
- 列表 ping/loss 窗口由 REST 补齐，详情实时字段与历史序列分别管理。
- document 隐藏时主动关闭，可见时先 REST revalidate 再连接；unmount 时释放连接与计时器。首页由 `KeepAlive` 保留：进入详情或设置页时首页连接不关闭（详情另开 single-server 连接），返回首页时不重连、不重拉 REST，只有应用卸载时才释放。
- 配置的连接时限到达后由用户选择继续或暂停；网络恢复采用单计时器指数退避，不会并发重连。
- 连接不可用时以单个低频 REST 循环补偿；任何失败都继续展示最后一份真实快照及来源错误。
- 五分钟在线阈值在 adapter/domain 层保持一致。
- 详情连接使用 `/api/ws?subscribe=<id>`，open 后发送 `{ type: "subscribe", scope: <id>, ids: [] }` 激活 CFSM 的 Agent 实时提示，但绝不使用 all-scope，也不订阅其他节点；只合并同 ID sample。隐藏时关闭、可见时先请求 `/api/server` 再建立新连接，连接时限仍要求用户明确选择。
- 详情负载图的「实时」档位复用这条 single-server 连接：优先从已经加载的 History 立即取最近 10 分钟垫底，确实没有近点时才单独请求 10 分钟 History；此后把 `batchUpdate.samples[]` 按采样时间逐条 partial merge 并逐条入图，完整保留 Agent 的 `wss_report_interval` 节奏，前端不改成固定 10 秒。历史桶与 WSS 密度可以不同；实时图只在相邻真实采样超过 1 分钟时插入断点，因此刷新、节点切换或时间档位切换不会把密度变化误画成大段空白。缓冲只保留最近 10 分钟且最多 600 点，切到历史档位不会清空它。

## Multi API Base

apiBase 解析位于 `src/services/cfsm/config.ts`。

~~~text
meta content
  +-- base A -> config/list/ws A -> server { source: A }
  +-- base B -> config/list/ws B -> server { source: B }

server click -> its source -> detail/history/ws
~~~

每个 base 是独立的鉴权与错误域。一个来源失败不能使另一个来源的数据改换归属。汇总 UI 可以合并显示，但数据结构始终保留 collection 与 `server.source`。跨源 Turnstile 若 site key 不一致，后续 UI 必须明确阻断共享验证流程，而不是静默选择其中一个。

## 路由与管理边界

正式路由采用 hash 模式，与 CFSM 保持一致：

- 首页 `/#/`
- 详情 `/#/server/:id`
- 主题设置 `/#/settings`
- 管理 `/admin#admin`，由 CFSM 官方前端负责

`vue-router` 使用 Hash History，详情刷新可恢复。主题不实现管理员私有接口、不复制登录管理逻辑、不调用 `save_settings`。

## 质量与发布

- Bun 锁定依赖；TypeScript strict、ESLint、Vitest 和 Vite 是同一质量门。
- 单元测试覆盖 apiBase、wire adapter、JWT/Turnstile transport、错误语义和完整 theme_options body。
- `bun run build` 先 typecheck 再构建。
- `bun run validate:dist` 验证根目录只有 `index.html` 与 `assets/`、assets 非空，并扫描禁止的 Komari runtime 标记。
- GitHub Actions 对 push main、版本 tag、pull request 和手动触发执行 frozen install、lint、typecheck、test、build、dist validation，并上传根结构正确的 ZIP。
- `v<package version>` tag 只有通过同一 verify job 后才进入 release job；tag 与 `package.json` 必须一致，正式资产使用稳定名称 `CFSM-Glassmorphism-<version>.zip` 并由 GitHub Actions 发布。
- `dist/` 是生成物，不进入版本控制。

## 第 7 轮完成边界

第 7 轮在既有主题 store 和 normalized data model 上完成配置驱动展示：总览和快捷控制不再是固定结构，列表 provider 只匹配用户声明的真实元数据文本，流量/到期/负载阈值有统一谓词，详情概览和 History 由预设或自定义 key 选择。响应式继续采用 CSS 网格与移动端抽屉，375/430/768/1024/1440/1920 六档均验证无页面横向溢出；长名称使用截断/换行策略，大量 tags 受有界容器保护。Earth/Map、磁盘预测与高级工具不属于本轮，没有显示无效开关。

## 第 8 轮完成边界

第 8 轮只在当前首页数据流上增加 Earth/Map 和高级工具。`EarthMap.vue` 提供 realistic、cobe、tiled 三种纯前端视觉，并以真实 `region` 聚合、选择节点；`AdvancedTools.vue` 提供健康摘要、分币种性价比、当前快照 JSON/CSV 和分类拓扑。健康历史只使用列表端已加载的真实 Ping/Loss 窗口，不调用逐节点 History；快照不包含 JWT、Turnstile 或管理数据；客户端导出二次口令是确认步骤而非安全边界；Audit Log 没有公开端点，保持隐藏。设置层仍为原 48 项三层架构，没有引入新的持久化协议。

## 第 9 轮完成边界

第 9 轮只做性能、稳定性、异常与测试收敛，不改动首页布局、Header/Footer、节点卡片结构、Card/List 点击路径、详情视觉结构、Earth/Map 渲染方式、弹窗/抽屉与主要交互动画；渲染输出保持不变。

- **稳定性 / 异常**：`errors.ts` 新增 `forbidden`(403) 与 `server-error`(5xx) 两类稳定 issue，详情视图给出专属可操作文案并保留真实快照；`identifiers.ts` 集中 server ID 白名单校验，详情、历史与 WebSocket 订阅共用，非法 id 在请求前即被拒绝（400 `invalidServerId`）。
- **WebSocket 重连稳定性**：`websocket.ts` 的重连退避仅在连接稳定保持 10 秒（`STABLE_CONNECTION_MS`）后才把 `reconnectAttempt` 归零，避免 open→立即断开的抖动风暴反复重置退避；退避区间与"单条连接仅一个待执行重试"约束不变。
- **渲染性能**：`stores/servers.ts` 与 `stores/server-detail.ts` 对大体积归一化集合改用 `shallowRef`；`glassmorphism-adapter.ts` 新增 `createGlassServerMapper()`，以 `CfsmServer` 引用 + `config` 身份的 WeakMap 缓存复用未变化的 `GlassServer`，50+ 节点实时更新时仅重算发生变化的节点；`ServerList.vue` 行级 `v-memo`；`HomeView.vue` 用预计算的节点动画延迟数组替代每次渲染新建样式对象。这些优化只减少重算与响应式开销，不改变可见结构或数据语义。
- **发布体积门槛**：`scripts/validate-dist.mjs` 增加 JS 512 KiB、CSS 128 KiB、总资源 768 KiB 的硬性预算，超出即让 dist 校验失败。
- **历史陈旧响应 / 并发切换**：详情 hours 切换控件在 `historyState === 'loading'` 时禁用，配合 store 内 `revision` 版本号与 AbortController，保证同一节点上不会并发触发历史请求、详情切换会取消在途请求，乱序陈旧响应不会写回。本轮经核验此前已妥善处理，未改动相关代码。

与原 Komari Glassmorphism 的高保真视觉差异如在本轮发现，仅记录、留待第 9.5 轮，不在第 9 轮修改。

## 第 10 轮完成边界

第 10 轮不重写数据/协议层，而是用 Komari 与 CFSM 两套 localhost 浏览器输出完成最终验证并收敛表现层：Header、首页控制条、扁平节点区、四种卡片密度、详情共享 Header/信息卡与响应式断点均按 Komari 真实几何调整。高级工具仍复用 `src/domain/advanced-tools.ts` 和 normalized `GlassServer`，只把会话展开状态默认设为关闭；REST、WebSocket、History、theme settings、多 apiBase 与三态 probe 契约没有变化。

浏览器矩阵覆盖六档视口、三种主题、三种 Earth renderer、四种卡片密度与 list、空/稠密/部分失败/全部离线、详情及 History 401/403/409/503/空/成功状态。实测结果和必要 CFSM 差异分别记录在 `docs/visual-validation.md` 与 `docs/fidelity-audit.md`，相关结构由 fidelity/responsive contract tests 固化。

正式版本为 1.0.0。main 推送通过 CI 后创建 annotated `v1.0.0` tag；tag workflow 重新执行完整质量门并发布 `CFSM-Glassmorphism-1.0.0.zip`。本地与仓库均不保留生成的 dist 或 ZIP。

## 第 14 轮 · v1.1.0-test.5 数据契约与真实 Bug 修复

本轮先读 CF-Server-Monitor `2.8.5 Beta5` 服务端与 Agent `1.3.8` 探针源码，
建立端到端数据契约（`docs/cfsm-source-audit.md`），再按契约审计并修复当前实现里的真实 Bug
（`docs/bug-matrix.md`）。架构分层没有变化，改动集中在 adapter 与其下游模型：

- **窗口模型**：`LatencyWindowSample` 由旧四线路扩展为全部 8 个探测目标；
  `GlassHistorySummary` 由两个扁平数值数组改为**按探测目标分组的时间序列**
  （`latencySeries` / `packetLossSeries`），`null`（该桶无采样）与 `false`（未配置）都保留。
  新增 `src/domain/probe-window.ts` 承载读取与聚合工具：柱状图按时间桶逐格取值，
  健康度这类**聚合统计**才把窗口压成纯数值样本。
- **探测目标**：`GlassLatencyMetric.carrier` 改名 `target` 并扩展到 `ProbeTarget`，
  首页不再静默丢掉 `node_1`～`node_4`。
- **站点级可见性**：`normalizeServerCollection` 把响应顶层 `sysConfig` 的
  `show_price` / `show_expire` / `show_tf` 下发到每台节点；
  `useServersStore.siteVisibility(base)` 让详情页按 owning source 取回同一组开关。
  这三个开关只在 `/api/servers` 顶层出现，`/api/config` 与 `/api/server` 都没有。

REST、WebSocket partial merge、History、`theme_options`、JWT / Turnstile、多 apiBase 归属、
probe 三态与 50+ 节点性能优化的既有契约全部保持不变；
本轮没有为解决显示问题去改数据适配层的语义。

## 第 13 轮 · v1.1.0-test.4 详情页表现层收口

本轮同样只动展示层，**没有触碰数据适配层**：REST、WebSocket partial merge、History
（九档 hours + revision + AbortController）、probe 的 `false` / `null` / 数值三态、
`theme_options`、JWT / Turnstile、多 apiBase 归属、server ID 校验、403 / 5xx 分类与
50+ 节点性能优化全部原样保留。normalized data model 未改动。

- **显示格式函数改名**：第 11 轮引入的 `formatHome*` 实测与上游详情页同规则，
  改名为 `formatDisplay*` 并在两页共用。**只是改名，输出完全不变**。
  运行时间是两页唯一不同的地方，因此保持三个独立函数：
  首页节点卡 `formatHomeUptimeDays`（到天）、节点列表 `formatUptime`（到小时）、
  详情页 `formatDetailUptime`（到分钟且省略为零的单位）。
- **详情指标卡模型**：`PresentationCard` 增加 `unit` 与 `tone`；
  `buildDetailCards` 按上游 `splitMetricValue` / `splitMeasurement` 拆分 value / unit，
  说明文字降级为 tooltip，进度条移除。
- **预设来源分离**：新增独立的 `ALL_DETAIL_CARD_KEYS`，
  自定义模式的允许集合不再由「综合」预设推导。
- **新增 `src/utils/cpu-benchmark.ts`**：逐字移植上游 `utils/cpuBenchmark.ts`。
  它只读取 CPU 型号字符串，不请求任何接口，也不产生 CFSM 之外的数据。
- **详情卡片表面**：指标卡、信息卡、探针卡、GPU 卡、磁盘 IO 卡、历史图表卡
  统一改用上游详情卡的 `--background/50` + 无边框 + `--radius-md`(8px) + 无阴影 + 无 backdrop；
  信息格改用上游对 `.bg-slate-500/5` 的覆盖值。自创的 `glass-panel` 退出详情页。
- **分区 Tab**：`nodeDetailSectionTabsEnabled` 此前只是一个空设置，本轮真正实现为
  概览 / 负载 / 延迟三段，与上游一致（默认关闭，关闭时全部堆叠）。

CFSM 与上游的详情页差异全部记录在 `docs/detail-fidelity-audit.md`：
IP、物理核心数、虚拟机类型、厂商（城市 / ASN）、系统温度、近一天网速峰值
六项因 CFSM 公开 API 不提供而隐藏，不以估算值补位。

## 第 11 轮 · v1.1.0-test.3 首页表现层收口

本轮全部改动都在展示层，**没有触碰数据适配层**：REST、WebSocket partial merge、
10 秒稳定后重置退避、History revision 与 AbortController、probe 的
`false` / `null` / 数值三态、`theme_options`、JWT / Turnstile、多 apiBase 归属、
server ID 校验、403 / 5xx 分类与 50+ 节点性能优化全部原样保留。
normalized data model 未改动；纯显示问题一律在格式化与样式层解决。

- **首页专用显示格式**：`src/utils/format.ts` 新增 `formatHome*` 一组函数
  （字节 B/KB/MB/GB/TB/PB，基数 1024，精度 0/0/1/1/2；速度加 `/s`；
  运行时间只到天；CFSM 官方计费周期本地化，未知自由文本原样保留）。
  这些函数**只服务首页总览卡片、节点卡片与节点列表**；
  详情页已于上一轮冻结，继续使用原有的 `formatBytes` / `formatUptime` / `formatPrice`。
- **总览卡片模型**：`PresentationCard` 增加可选 `unit`。总览走上游的 value + unit
  两段式，说明文字降级为 tooltip；详情页仍把 `hint` 当可见副文本，结构不变。
- **预设来源分离**：`ALL_GENERAL_CARD_KEYS` 与 `ALL_QUICK_CONTROL_KEYS` 成为独立常量，
  不再由「完整」预设推导。这样删掉默认预设里的项，不会连带让自定义模式失去它们。
- **默认背景**：`src/assets/background/default-background-v2.webp` 是上游同一份资产
  （32436 bytes，SHA-256 `4237796…c551b`）。放在 `src/assets/` 由 Vite 输出到
  `dist/assets/`，不放 `public/`——主题 ZIP 根目录只允许 `index.html` 与 `assets/`。
  第四轮背景专项将容器恢复为上游的 `z-index:-1`、无自带渐变底色；所有层不显示时露出的是与上游相同的 `html --background`，`body` 仍透明。自定义媒体使用 `img`（而非上游的 CSS `background-image`），是为保留 `referrerpolicy="no-referrer"`；`object-fit:cover` / `object-position:center` 对齐上游 cover / center。
- **表面令牌按运行时取值**：总览卡片与节点卡片在上游是**两套**表面。
  前者是 `--background` 的 50%、无边框、`--radius`、无阴影；
  后者才命中 `[data-slot='card']` 的 `!important`。逐项以浏览器计算值为准，
  记录在 `docs/homepage-fidelity-audit.md` H31 / H39 与 `docs/visual-validation.md`。

### 第 11 轮前期（v1.1.0-test.2）补充收口

截图回归只修正首页两处渲染偏差。Earth 隐藏时，`general-stage--cards-only` 成为与
Komari 一致的独立 3 / 6 列网格，不再让 `general-stage__cards` 在单列父网格中跨
12 列并触发隐式列。NodeCard 底部继续是三列；每行由固定图标和可截断文本层组成，
第三列只显示经严格日期解析得到的剩余状态与金额。剩余价值只识别 CFSM 官方
`month` / `quarter` / `half_year` / `year` / `two_years` / `three_years` / `four_years` /
`five_years` 周期；未知周期与无效日期保持不可用，不猜测。

修复只涉及表现层和既有 normalized model 上的纯计算；REST、WebSocket、History、
probe 三态、多 API Base、主题设置、Earth 三 renderer 与点击路径不变。

## 第 9.95 轮完成边界

第 9.95 轮清零剩余三个 P1，仍然只动表现层，数据与协议底座（REST、WebSocket partial merge、10 秒稳定后重置退避、History revision 与 AbortController、probe 三态、旧四线路 + Node 1–4、`theme_options`、JWT / Turnstile、多 apiBase 归属、server ID 校验、403 / 5xx 分类、50+ 节点性能优化）保持不变，UI 继续只消费 normalized model。

- **History 图表**：`src/utils/echarts.ts` 对齐 Komari 同名模块，只注册 `LineChart` 与 Grid / Tooltip / Legend / Title / DataZoom / CanvasRenderer；`HistoryChart.vue` 改用 `vue-echarts` 的 `VChart`（`autoresize`），沿用上游的 axis tooltip、滚动 legend、grid 与 time 轴。`connectNulls: false` 保证缺口保持缺口，probe 的 `false` / `null` 不进入数值 series，不补点、不插值。
- **详情页**：顶部改为 Komari `InstanceDetail` 的导航条（返回 / 旗帜 + 名称 / 状态徽章 / 标签 / 收藏与上一台·选择·下一台）。节点导航复用首页已加载的轻量索引，详情页仍只订阅单节点并携带 owning `source`；原 hero 的分组、数据源、运行时间与最后更新并入系统信息区。
- **UI 基元**：`src/components/ui/` 下的 `AppTooltip`、`AppTabs`、`AppBadge` 建立在 `reka-ui` 上（Portal、碰撞翻转、roving focus、`data-state`/aria 由基元提供），`AppToaster` + `src/utils/message.ts` 建立在 `vue-sonner` 上并在 `App.vue` 挂载一次。上游的 Dialog / Drawer / Popover / Select / Switch / Slider 只服务于 CFSM 不具备的功能与已移除的 QuickView，本主题没有对应弹层面，因此不创建空壳组件。
- **发布护栏**：`validate:dist` 预算上调为 JS 3328 KiB / CSS 128 KiB / 总资源 6656 KiB，脚本内注明构成理由；预算仍是硬门槛。

## 第 9.9 轮完成边界

第 9.9 轮继续把表现层向 Komari 收敛，不新增功能，也不触碰数据 / 协议底座（REST、WebSocket partial merge、10 秒稳定后重置退避、History revision 与 AbortController、probe 三态、`theme_options`、JWT / Turnstile、多 apiBase 归属、server ID 校验、403 / 5xx 分类、50+ 节点性能优化）。

- **总览卡片**：去掉 CFSM 自创标题区，`OverviewCards` 的根即 `general-stage__cards` 所在的 12 栅格；卡片为 `span 4` 单元，标签左上 / 图标右上 / 数值与单位基线对齐。
- **节点卡片与列表**：`ServerCard` 按 Komari 区块顺序重建；`ServerList` 由语义化表格改为栅格行与十列契约，「信息」列受 `nodeListMetadataEnabled` 控制。两者继续只消费 `GlassServer`，不解析 wire payload。
- **图标体系**：新增 `src/constants/icons.ts`（构建期内联的 Tabler / IconPark 路径）与 `src/components/ui/AppIcon.vue`。`PresentationCard.icon` 由字符占位改为 `IconName`。运行时不访问外部图标 CDN——这是自托管与严格 CSP 环境下必要的交付方式差异。
- **静态资源约定**：`src/utils/os-icon.ts` 对照 CFSM 官方 `osIcon.js` 的关键字映射，OS 图标使用默认皮肤的 `/os-icons/<filename>`；旗帜沿用 `/flags/<code>.svg`。两者都不打包进主题。
- **价格与流量可见性**：`GlassServer` 新增 `showPrice`；卡片与列表同时遵守主题级 `hidePriceWhenLoggedOut` 与每台节点的 `showPrice` / `showTraffic`，与详情页口径一致。

仍未对齐的 P1（历史图表 echarts 组件族、详情页信息层级、UI 基元与弹层族）在 `docs/fidelity-audit.md` 中标记为 FAIL，不得被当作已对齐。

## 第 9.5 轮完成边界

第 9.5 轮把表现层向原 Komari Glassmorphism 收敛，不推翻既有 CFSM 数据层、适配层、实时层、History、Theme Settings、多 API Base 与构建体系；UI 继续只消费 normalized model，不重新解析 wire payload。Komari 是正式版 UI/UX 唯一权威基准，逐项差异见 `docs/fidelity-audit.md`。

- **Earth 恢复三套真实渲染器**：`EarthMap.vue` 变为与 Komari `NodeEarthGlobe.vue` 等价的懒加载分发器，分发到 `NodeEarthRealisticGlobe.vue`（globe.gl + three）、`NodeEarthCobeGlobe.vue`（cobe）与 `NodeEarthTiledMap.vue`（真实贴图等距地图）。三者互不退化为 SVG 仿制。`three` 与 `globe.gl` 只在选用 realistic 时动态 import，不进首屏包。
- **定位来源仍受数据真实性约束**：新增 `src/composables/useServerGeoClusters.ts` 复用 `buildEarthPoints`，只接受可可靠归一化的 `region` 并聚合到国家/地区中心；不做外部 IP Geo 查询，无法定位的节点不打点。旗帜按 `theme-develop.md` 使用 CFSM 默认皮肤的 `/flags/<code>.svg`，不打包进主题。
- **Earth 与总览合为一个栅格**：`general-stage` 复刻 Komari `NodeGeneralCards` 的布局契约——球体渲染器在桌面端占右半、总览卡片占左半同一行，移动端卡片负边距上移叠加；tiled 改为卡片在上、整幅地图在下。
- **主点击路径直达详情**：移除 `ServerQuickView` 强制中间层（组件已删除），节点卡片与列表行点击直接进入 `/#/server/:id` 并携带 owning `source`；收藏等独立控件保持 `stopPropagation`，多 apiBase 归属不变。
- **首页往返状态**：新增会话级 `src/stores/dashboard-view.ts` 承载搜索、分组、排序与快捷筛选，`首页 → 详情 → 返回首页`不再重置；路由新增 `scrollBehavior` 以 `savedPosition` 恢复滚动位置。视图模式仍由主题设置层单独拥有，避免同一外观状态有两个写入者。
- **首页保留与换页过渡**（Komari `App.vue`）：`RouterView` 外包 out-in 的 `Transition` 与 `KeepAlive(HomeView)`。
  - 首页返回时不重建，卡片不重播进场，也不重连、不重拉数据；`onActivated` 恢复被详情页改写的网页标题。
  - 卡片进场改为 `TransitionGroup` 的 enter 过渡，按上游数值移植；只在首次渲染和新卡片加入时播放，关闭页面动画或卡片超过 30 张时不播。
  - `src/router/navigation-motion.ts` 区分导航来源：
    - 浏览器历史导航（手势返回、返回键、前进）不播换页过渡，由浏览器自己的动画与页面截图接管；
    - 页面内导航照上游播放，且滚动等旧页面淡出后再执行；
    - 页面内导航回到首页时，恢复离开首页时的位置。
  - 本主题的顶栏与页脚在页面组件内：顶栏不参与过渡，效果与上游顶栏在路由外一致；页脚随页面主体一起淡出淡入，避免内容透明时单独露出。
- **发布护栏按真实构成重设**：`validate:dist` 体积预算改为 JS 2816 KiB / CSS 128 KiB / 总资源 6144 KiB；Komari RPC 残留扫描由裸 `common:` 收紧为字符串字面量正则，避免误判 three.js shader chunk 等第三方内部结构。

本轮未完成的 P1/P2（总览卡片结构、NodeCard/NodeList 内部结构、echarts 图表族、详情页层级、图标与 UI 基元、间距校准、死 CSS 清理）在 `docs/fidelity-audit.md` 中逐条列出，不得视为已对齐。
