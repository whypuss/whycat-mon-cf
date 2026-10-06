# CFSM API 映射

## 唯一运行时协议

本主题只调用 CF-Server-Monitor 官方第三方主题接口；唯一的例外是 v1.1.7 起的公开日汇率（见下方「第三方汇率数据源」），它不经过 CFSM。Komari 的 `/api/public`、`/api/nodes`、`/api/clients`、`/rpc2` 以及 `common:*`、`public:*`、`admin:*` RPC 命名空间不得进入生产包。

apiBase 的来源是 HTML 中可选的 `<meta name="apiBase" content="https://a.example,https://b.example">`；未配置时使用当前页面 origin。每个值只保留 HTTP(S) origin，去重后独立请求。不存在额外的 `config.json`。

## 端点与代码责任

| 能力 | theme-develop.md | CFSM 官方 frontend 参考 | 本主题实现 | 当前状态 |
|---|---|---|---|---|
| Config | `GET /api/config` | `src/frontend/main.js`、`utils/api.js`、`utils/turnstile.js` | `fetchSiteConfig` → `normalizeSiteConfig` | 已用于真实首页并测试 |
| Servers | `GET /api/servers` | `src/frontend/utils/server.js`、`views/dashboard` | `fetchServers` / `fetchAllServerSources` → `normalizeServerCollection` → `toGlassServer` | 已用于真实首页并测试，支持多来源部分失败 |
| Detail | `GET /api/server?id=<id>` | `src/frontend/utils/server.js`、`views/ServerDetail.vue` | `fetchServer` / `fetchServerFromSources` → `normalizeServer` → `server-detail` store | 已用于 `/#/server/:id` 并测试 |
| History | `GET /api/history/all?id=<id>&hours=<hours>` | `src/frontend/utils/api.js`、`views/ServerDetail.vue` | `fetchHistory` → `normalizeHistory` → 详情 ECharts 图表模型 | 已用于真实详情图表并测试 |
| WebSocket | `GET /api/ws?subscribe=<all\|id>` | Dashboard 与 `utils/api.js` 的订阅逻辑 | `createCfsmSocket` → `normalizeSocketBatch` → `mergeRealtimeSample` | 首页与单节点详情均已实现 |
| Theme Save | `POST /api/theme_options` | 第三方主题规范；LuminaPlus `services/api.ts` | `theme-settings` store → `saveThemeOptions` → `normalizeThemeOptionsSave` → `/api/config` 回读 | 已用于设置页完整快照保存并测试 |

Transport 位于 `src/services/cfsm/http.ts`，endpoint orchestration 位于 `src/services/cfsm/api.ts`，所有 wire payload 都在 `src/services/cfsm/adapters.ts` 从 `unknown` 转为领域类型。Vue 组件不直接调用 `fetch`。

v1.1.12 维护预览只收敛请求生命周期：默认 15 秒超时和调用方取消持续到响应体读取完成，响应流中断使用既有 `networkError` 分类。端点、鉴权、状态码、请求参数与 probe 三态不变；没有新增轮询或写接口。

## 第三方汇率数据源（v1.1.7）

财务合计与详情页剩余价值需要把节点原币换算成显示币种。CFSM 没有汇率接口，本主题沿用上游的做法，由访客浏览器直接读取公开日汇率，不经过 Worker，也不新增 CFSM 请求。

| 顺序 | 地址 | 响应校验 | 数据日期 |
|---|---|---|---|
| 1 | `GET https://open.er-api.com/v6/latest/CNY` | `result === "success"`，`base_code === "CNY"`；只保留有限正数的汇率 | `time_last_update_unix` |
| 2 | `GET https://api.frankfurter.dev/v1/latest?base=CNY` | `base === "CNY"`；只保留有限正数的汇率 | `date`（上一交易日） |

- 请求与解析在 `src/services/exchange-rates.ts`，响应一律按 `unknown` 校验；状态与共享请求在 `src/stores/finance.ts`。
- `credentials: 'omit'`、`referrerPolicy: 'no-referrer'`，单源超时 5 秒；地址固定，不带任何节点数据。
- 只有价格可见且确实需要换算时才请求；每个浏览器每天成功一次后复用缓存，失败后本页不再重试，没有轮询。
- 数据源缺的币种、离线时的兜底值取自 CFSM 2.8.5 Stable 的内置参考表，并在界面上标为「内置参考汇率」。
- 规则、请求次数与验证记录见 `docs/finance-parity.md`。

第 8 轮 Earth/Map、健康、性价比、快照与分类拓扑没有增加端点。它们只消费首页已经通过 `/api/config`、`/api/servers` 和 adapter 得到的 normalized snapshot；健康历史覆盖只来自 `/api/servers` 的真实 Ping/Loss 窗口，不在首页批量请求 `/api/history/all`。CFSM 没有公开 Audit Log 主题端点，因此该工具不渲染，也不回退到管理端私有 API。

第 10 轮 v1.0.0 最终浏览器审计只收敛 UI 结构，没有增加、删除或改写任何请求。localhost 状态复验覆盖 `/api/config`、`/api/servers`、`/api/server`、`/api/history/all` 与 `/api/ws` 的成功、空、部分失败及 401/403/409/503 分支；owning apiBase、server ID 校验、partial merge、History revision/AbortController、旧四线路 + Node 1～4 和 `false`/`null`/number 三态均保持既有契约。高级工具的 Header 展开按钮只控制会话 UI 状态，不发请求，也不进入 `theme_options`。

## 第 14 轮：按源码与真实响应校准的契约补充

第 14 轮完整审读 CFSM `2.8.5 Beta5` 服务端与 Agent `1.3.8` 探针源码，并用真实部署响应交叉验证。
完整数据链与字段契约表见 `docs/cfsm-source-audit.md`。与本主题直接相关的三条修正：

1. **`/api/servers` 的 `sysConfig` 在响应顶层，不在每台节点上。**
   `show_price` / `show_expire` / `show_tf` 只出现在这里：`/api/config` 没有，
   `/api/server` 的 `sysConfig` 只有 `long_history_points`（真实响应实测 `{"long_history_points":180}`）。
   主题在 `normalizeServerCollection` 把站点级开关下发到每台节点，
   详情页通过 `useServersStore.siteVisibility(base)` 按 owning source 取回。
2. **`servers[].ping` / `servers[].loss` 是时间桶序列，不是一串数值。**
   服务端 `getDashboardLatencyHistory` 固定输出 `latency_window.points`(20) 个点、
   覆盖 `latency_window.hours`(2) 小时，`ts` 为毫秒且升序，每个点覆盖全部 8 个探测目标，
   取值为 数值 / `null`（该桶无采样）/ `false`（未配置）；旧库未迁移时只返回 4 个 key。
   主题按目标分组保留整段序列，不再拍平或过滤空洞。
3. **`/api/server` 在 `loss_X === null` 时会连同 `ping_X` 一起删除该字段**
   （`omitNullLossProbeFields`），列表端点不做这件事。主题把字段缺席视为「未配置 / 无可用样本」。

WebSocket 侧已确认：`latestReportUpdates[].samples[].data` 只含标量探针字段，
**不含** `ping` / `loss` 数组，因此 partial merge 不会清掉列表窗口
（真实响应验证 + `tests/cfsm-data-contract.test.ts` 锁定）。

## 请求契约

### GET /api/config

- 可带 `Authorization: Bearer <jwt>`。
- 该端点在不带 Turnstile header 时可直接读取验证配置；带 `X-Turnstile-Token` 或 `X-Turnstile-Verified` 时会执行验证。
- 读取 `theme_options`、站点标题、外观/语言偏好、Turnstile 状态、WebSocket 超时、长历史点数及 latency window。
- 旧四线路名称读取 `custom_ct_name`、`custom_cu_name`、`custom_cm_name`、`custom_bd_name`；字段缺失或空白时统一回退为“电信 / 联通 / 移动 / BGP”。新增探测点名称读取 `node_1_name` 至 `node_4_name`，缺失或空白时回退为 `Node 1` 至 `Node 4`。八个默认名集中在 `src/constants/probes.ts`，config 暂不可用时同样使用这一来源。
- 响应体中的 `turnstile_verified` 写入同名本地键，并清除已经消费的一次性 token。
- 本地凭据过期时，带着它请求会得到 403；`fetchSiteConfig` 此时不带验证头重取一次公开配置，与 CFSM `fetchAllTurnstileConfigs` 一致。
- 开启全局 Turnstile（`turnstile_enabled`）且 `verified` 不为 true 时，主题在加载遮罩中渲染 Cloudflare 官方组件（`https://challenges.cloudflare.com/turnstile/v0/api.js`，CFSM CSP 已放行）。取得令牌后由 `verifyTurnstileToken` 带 `X-Turnstile-Token` 请求本端点换取凭据，再重新读取配置并让各页面重载数据。
- 此端点不使用外部静态配置文件作为替代。

### GET /api/servers

- 返回 `servers`、`stats`，每个服务器可能带 `sysConfig`。
- 多 apiBase 时，每个响应单独适配，并把 `source.base` 固化在每个服务器对象上。
- 列表响应中的 `ping` / `loss` 是最多约 20 个真实稀疏点；关闭三网详情时数组为空。
- `disk` 缺失、无效或六项全零时不展示磁盘 IO。
- `gpu_info` 兼容数组与 JSON 字符串，只使用新版字段，不读取废弃的 `gpu`。
- 公共 REST 中的 `ip_v4` / `ip_v6` 只是 `0` / `1` 可达性，不是 IP 地址。

### GET /api/server?id=<id>

- 仅拉取指定节点；详情页不得先拉 `/api/servers` 再前端过滤。
- 请求必须发往该节点的 `source.base`。
- `src/services/cfsm/identifiers.ts` 的 `normalizeServerId` 是统一的 server ID 白名单校验（`/^[A-Za-z0-9._:-]{1,64}$/`）。`fetchServer`、`fetchServerFromSources` 与 `fetchHistory` 在发出任何请求前先校验；非法 id 直接抛 `CfsmRequestError(status 400, code invalidServerId)`，不产生无效网络请求。WebSocket 的 `sanitizeSubscriptionIds` 复用同一校验器，避免各处重复定义订阅 ID 规则。
- 首页进入详情时通过 URL query 携带已经归一化的 owning base；直接打开详情链接且未携带来源时，只对配置的 apiBases 调用单节点接口来解析归属，不会调用 `/api/servers`。解析成功后 Config、History 与 WebSocket 全部固定回到同一 base。
- 404 原样表现为节点不存在；不创建演示节点。
- 详情响应不提供列表页的 ping/loss 窗口数组。
- 当前探测字段包含旧线路 `ping/loss_{ct,cu,cm,bd}` 和新增 `ping/loss_node_1..4`，全部在 adapter 后进入同一八目标领域映射。
- 每项保留 `number | null | false`：`false` 表示未配置、未上报或字段缺失，`null` 表示本轮探测超时，数值（包括 `0`）表示有效结果。旧版本缺少的新字段统一归一化为 `false`。

### GET /api/history/all?id=<id>&hours=<hours>

- hours 只能是 `0.167`、`0.5`、`1`、`6`、`12`、`24`、`48`、`96` 或 `168`。
- 未登录查询超过 24 小时可返回 401；数据库需要升级可返回 409 `databaseUpgradeRequired`。
- 长历史点数由后端配置决定，不在前端填点。
- 历史 `disk` 优先读取对象；兼容旧的六个 `disk_*` 平铺字段，但缺失时不绘制。
- 503 是后端额度/暂不可用状态，只能显示真实降级提示，不能用 mock 历史替代。
- 每个真实历史点归一化旧四线路和 Node 1–4 的全部 Ping/Loss 字段，并保持与详情一致的 `false / null / number` 三态；缺字段是 `false`，不插值、不补点、不把超时或缺失改写为 0。
- `gpu_info` 在 History 中同样兼容数组与 JSON string；图表只为实际出现过有效数字的 CPU/load、RAM/Swap、Disk、Network、Disk IO、GPU、Ping/Loss 序列创建组件。只有 `false`/`null` 而没有数值的趋势隐藏。

### GET /api/ws

首页实时链路已经实现并遵守以下契约：

1. 首页先按 base 读取列表，再为每个有节点的 base 建立独立 `subscribe=all` 连接。
2. 连接成功后发送 `{ type: "subscribe", scope: "all", ids }`，ids 去重、校验且只属于当前 base；不发送订阅消息不会收到更新。
3. `batchUpdate.updates[].samples[]` 从第一个有效的 `data || payload || metrics` 增量对象读取，按 sample、update、message 的真实时间戳顺序回退，再按字段合并到现有 REST 实体。缺失字段不会被覆盖为 null、0 或空值。
   旧四线路和 Node 1–4 的 Ping/Loss 都走同一 presence-based merge；payload 中明确出现的 `false`、`null`、`0` 和普通数字都会覆盖对应旧值，未出现的 probe 字段保持不变。
4. 首页把同一轮内分批抵达的节点消息收齐后跨 base 一次性写入 store。收集窗口由最快 `wss_report_interval` 推导且短于下一轮上报；原始样本不丢弃、不平均，首页总上行/总下行因此每轮只重算一次。
5. 页面隐藏时主动关闭全部连接；重新可见时先执行 REST revalidate，再按最新节点集合恢复订阅。
6. `frontend_ws_timeout_minutes` 只接受 0–1440 的整数。正数时限到达后停止连接，由用户明确选择继续新连接或保持暂停。
7. 网络或策略失败采用 1–30 秒有界指数退避，并确保每条连接只有一个待执行重试；不可用期间启用单个 60 秒 REST 补偿循环。REST 503 保留已有来源快照并显示来源错误，不生成替代数据。
8. 同源非公开站点依赖 CFSM cookie；跨源才把 JWT 放入 `token` 查询参数。Turnstile 不参与 WebSocket 验证。
9. 详情使用 owning base 的 `subscribe=<id>`，并在 open 后发送同 ID scope 的订阅帧来激活实时上报；该帧的 `ids` 为空，既不使用 all-scope，也不订阅其他节点。隐藏时关闭，可见时先补单节点 REST 再恢复；失败时只有一个低频 `/api/server` 补偿循环。
10. 详情负载图的「实时」档位先复用已加载 History 的最近 10 分钟，必要时才补取 10 分钟 History，再逐条消费 `batchUpdate.samples[]`：样本时间兼容秒/毫秒，指标继续按 partial update 合并，每条真实样本都进入最近 10 分钟缓冲。前端不对 Agent 配置的 `wss_report_interval` 做 10 秒降采样；不同密度只按时间轴排列，超过 1 分钟没有真实样本才画断点。

CFSM `main` 的 `theme-develop.md` 类型定义与末尾展示约定已公开 Node 1–4 probe 字段和三态语义。其 `/api/config` 示例与 `SiteConfig` 示例目前漏列 `node_1_name..node_4_name`，但同一文档明确指定这些名称，且官方公开 `/api/config` handler 与官方前端都已返回/读取它们；本主题据此按公开接口兼容，并保留旧版本 fallback。

### POST /api/theme_options

- 这是主题唯一允许的写接口，必须携带 JWT；启用全局 Turnstile 时还需要 Token 或 Verified。
- body 只能是 `{ "theme_options": { ...完整快照 } }`。数组、字符串和 null 会得到 400 `invalidThemeOptionsFormat`。
- 保存只修改后端 `appearance_options.theme_options`，不写 `site_options`，也不覆盖标题、背景、CSP 或自定义脚本等其他外观设置。
- 401 清除无效 JWT；403 清除 Turnstile token/verified 并要求重新验证。任何失败都留在当前主题界面，不自动跳转。
- LuminaPlus 的真实调用链已经使用此接口；其“read-only/local-only”旧注释不是协议依据。
- `src/theme/settings.ts` 先把 draft 归一化为全部 48 个已知字段，并保留 backend 中未知的前向兼容字段；`jwt_token`、Turnstile、收藏和临时 UI 状态在序列化边界排除。
- `src/stores/theme-settings.ts` 在 200 后立即采用响应快照、清空浏览器覆盖、更新 runtime 并重置表单，随后真实请求 `GET /api/config` 回读；回读失败不会把已经成功的保存误报为失败。
- 400 `invalidThemeOptionsFormat`、401、403 和网络失败均不重置 draft。401 / 403 的凭证清理由公共 HTTP transport 统一负责，设置 UI 不直接操作 token。

## 鉴权与错误策略

| 状态 | 含义 | 客户端动作 |
|---|---|---|
| 400 | 参数或 theme_options 格式错误 | 展示服务端 code/message，保留用户草稿 |
| 401 | JWT 缺失、过期或权限不足 | 清除 `jwt_token`，显示需要登录；不自动重定向 |
| 403 | Turnstile 验证失败 | 清除 `turnstile_token` 与 `turnstile_verified` 并通知订阅方；站点开启全局 Turnstile 时，主题在遮罩中重新发起人机验证 |
| 404 | 节点不存在 | 显示真实空/不存在状态 |
| 409 | 数据库需要升级 | 显示 `databaseUpgradeRequired` 引导 |
| 500–599（非 503） | 服务端请求失败 | 归类为 `server-error`，明示真实 HTTP 状态并保留最后一份真实快照，不生成替代数据 |
| 503 | 暂不可用或额度限制 | 明示服务端状态，可提供用户触发的重试 |

`src/services/cfsm/errors.ts` 的 issue 分类现覆盖 `unauthorized`(401)、`forbidden`(403)、`not-found`(404)、`upgrade-required`(409/`databaseUpgradeRequired`)、`unavailable`(503)、`server-error`(5xx)、`network`、`invalid-request`(400) 与 `unknown`。第 9 轮补齐了 `forbidden` 与 `server-error` 两类：此前它们落入 `unknown`，现由详情视图给出专属可操作文案，且失败一律保留当前真实快照与草稿，不自动跳转、不 mock。

存储键与 CFSM 官方前端保持一致：

| 键 | 用途 |
|---|---|
| `jwt_token` | Bearer JWT |
| `turnstile_token` | Turnstile 一次性 token |
| `turnstile_verified` | 可复用约一小时的验证凭证 |

## 数据真实性边界

公开 API 不提供实际服务器 IP、ASN、城市、精确坐标或管理端 note。本主题不会从可达性标志推断地址，不会在生产代码中填假数据，也不会为填满组件而生成历史点、价格、厂商或地理位置。
