# CFSM / 探针源码审计与数据契约（第 14 轮）

> 本轮的权威分工：
>
> - **CFSM 服务端 / 探针源码与真实响应** = 数据、接口与状态语义的权威基准。
> - **原 Komari Glassmorphism** = 页面 UI / UX 的唯一权威基准。
>
> 第 11 轮首页与第 13 轮详情页的复刻成果不回退。

## 审读范围与版本

| 对象 | 版本 | 位置 |
|---|---|---|
| CF-Server-Monitor Worker | `2.8.5 Beta5` / `8e840b1` | `work/upstreams/CF-Server-Monitor`（只读，按 `origin/main` 读取） |
| CFSM 探针 Agent | `1.3.8`（内嵌在 `public/install.sh` 的 `PROBE_EOF` heredoc 里） | 同上 |
| 真实部署（运行时证据） | Worker `2.8.5 Beta2` | 用户提供的公开站点，只读 `/api/config`、`/api/servers`、`/api/server`、`/api/history/all` |

已完整审读的服务端文件：`src/index.js`、`src/handlers/dashboard.js`、`src/handlers/update.js`、
`src/utils/metrics.js`、`src/utils/historyFields.js`、`src/utils/config.js`、
`src/utils/latestReportCache.js`、`src/database/schema.js`、`src/database/historySampling.js`。
探针侧完整审读 `install.sh` 内嵌的采集、探测与上报逻辑。

> 说明：本地只读克隆停在 `90d0d21`（2.8.5 Beta3）。本轮不修改克隆工作区，
> 统一用 `git show origin/main:<path>` 读取当前版本。落后的 12 个提交里
> `924e71d`（统一 Ping/丢包字段处理）与 `fba07dc`（修复原皮三网延迟历史数据错位）
> 与本轮直接相关，均已按当前版本审读。

## 数据链总图

```text
探针 get_probe()  ──► "RTT LOSS" 写入 /dev/shm/.cf_probe_*
        │
        ▼  json_probe_value()：未配置 → false；否则输出字符串
POST /update  ──► coerceNumericMetricFields()
        │            false/'false' → false
        │            null/undefined → 原样保留
        │            其它 → Number()；非有限值 → null
        ▼
metrics_history 表（ping_* INTEGER DEFAULT 0；loss_* INTEGER DEFAULT NULL）
        │
        ├─► getLatestMetrics()   ORDER BY id DESC LIMIT 1  ─► /api/server 标量
        ├─► getLatestMetricsForAllServers()                ─► /api/servers 标量
        ├─► getDashboardLatencyHistory()                   ─► /api/servers 的 ping[] / loss[]
        └─► buildSparseHistoryQuery()                      ─► /api/history/all
        │
        ▼
Durable Object MetricsBroadcaster ─► /api/ws batchUpdate ─► latestReportUpdates[].samples[].data
        │
        ▼
本主题 adapters.ts ─► normalized model ─► glassmorphism-adapter ─► UI
```

## 关键端点契约

### `GET /api/config`

- 返回 `latency_window: { points, hours }`。真实响应实测 `{ points: 20, hours: 2 }`，
  与源码常量 `DASHBOARD_LATENCY_WINDOW_POINTS = 20`、`DASHBOARD_LATENCY_WINDOW_HOURS = 2` 一致。
- **不返回** `show_price` / `show_expire` / `show_tf` / `show_three_net_details`。真实响应已确认。
- `custom_*_name` 与 `node_*_name` 在旧版本部署上可能是 `null`，主题必须自带回退。

### `GET /api/servers`

- `sysConfig` 在**响应顶层**，不是每台节点上。真实响应：
  `{"show_price":true,"show_expire":true,"show_tf":true,"show_three_net_details":true,"display_mode":"bar","latency_window":{...}}`。
- `servers[].ping` / `servers[].loss` 由 `getDashboardLatencyHistory()` 产生：
  - 固定 `points`(20) 个点，覆盖 `hours`(2) 小时，`ts` 为**毫秒桶时间戳**，服务端已 `sort` 升序；
  - 每个点覆盖 `LATENCY_NODE_FIELDS = ['ct','cu','cm','bd','node_1'..'node_4']` 全部 8 个目标；
  - 旧库未迁移新列时走 `LEGACY_DASHBOARD_LATENCY_COLUMNS`，此时点里**只有 4 个 key**，
    其余 key 直接缺席——真实 Beta2 部署实测就是 `{ts,ct,cu,cm,bd}`；
  - 值三态：数值 / `null`（该桶无采样）/ `false`（该探测点未配置）。真实响应实测含 `bd: false`。
- `show_three_net_details !== 'true'` 时 `ping` / `loss` 一律为 `[]`。
- `latestReportUpdates[]` 形状 `{serverId, reportTs, samples:[{ts, data}], reportAgeMs}`；
  `data` 里**只有标量探针字段，没有 `ping`/`loss` 数组**（真实响应已确认）。

### `GET /api/server`

- `sysConfig` **只有** `{ long_history_points }`。真实响应实测 `{"long_history_points":180}`。
- 标量来自 `getLatestMetrics()` = `ORDER BY id DESC LIMIT 1`，即**最新一条上报**。
- `omitNullLossProbeFields()`：`loss_X === null` 时**同时删除** `loss_X` 与 `ping_X`。
  这条只作用于详情端点，列表端点不做，因此两个端点的空值表达方式不同。
- 详情响应**没有** `ping` / `loss` 窗口数组。

### `GET /api/history/all`

- 列集合 `HISTORY_ALL_QUERY_COLUMNS` 含全部 8 个 `ping_*` 与 8 个 `loss_*`。
- 每个时间桶取一条代表样本（`buildSampleJsonExpression ... LIMIT 1`），不是聚合平均。
- `timestamp` 为毫秒，升序。真实响应实测 180 行、升序。
- 点数上限按窗口分两档：`queryHours > 1` 用站点设置 `long_history_points`（实测 180），
  否则用服务端常量 `DEFAULT_HISTORY_MAX_POINTS = 160`。桶宽 `max(10 秒, 窗口跨度 / 上限)`，
  两档都走 `ROW_NUMBER() ... WHERE rn = 1`，**短窗口同样分桶**，不存在「1 小时返回全部上报」的档位。
  实读克隆版本 `90d0d21` 的 `src/database/schema.js` `getMetricsHistory`。

## 字段契约表

`P` = 探针，`S` = 服务端。空值语义列写明 `0` / `false` / `null` / 缺席各自代表什么。

| UI 字段 | 探针来源 | 上报字段 | 服务端处理 | REST | WS | History | 单位 | 空值语义 |
|---|---|---|---|---|---|---|---|---|
| server id / source | — | URL 绑定 | 按 apiBase 隔离 | 两端一致 | `serverId` | `server_id` | — | 主题按 owning source 绑定，禁止跨源按 id 合并 |
| online | — | — | `now - timestamp < 300000` | 列表计算 | `is_online` | — | — | 五分钟阈值，服务端与主题同口径 |
| cpu | `/proc/stat` | `cpu` | `metrics.cpu \|\| 0` | number | number | `cpu` | % | 缺失 → 0（服务端行为） |
| ram / swap / disk | `free`/`df` | `ram_*`/`swap_*`/`disk_*` | `\|\| 0` | number | number | 同名列 | MiB | 缺失 → 0 |
| net in/out speed | `/proc/net/dev` 差分 | `net_in_speed`/`net_out_speed` | `\|\| 0` | number | number | 同名列 | B/s | 缺失 → 0 |
| total traffic | 同上累计 | `net_rx`/`net_tx` | `\|\| 0` | number | number | 同名列 | B | 缺失 → 0 |
| monthly traffic | 同上 | `net_rx_monthly`/`net_tx_monthly` | `\|\| 0` | number | number | — | B | 缺失 → 0 |
| load | `/proc/loadavg` | `load_avg` 字符串 | `?? '0 0 0'` | string | string | `load_avg` | — | 主题拆成三个数 |
| processes / tcp / udp | `ps`/`ss` | `processes`/`tcp_conn`/`udp_conn` | `\|\| 0` | number | number | 同名列 | 个 | 缺失 → 0 |
| uptime | `/proc/uptime` | `boot_time` | `\|\| ''` | 秒级时间戳 | 同 | `boot_time` | s | 空串 → 主题显示占位符 |
| temperature | — | — | — | **不返回** | — | **无此列** | °C | 详情端点与 `HISTORY_ALL_QUERY_COLUMNS` 均无此字段（实读 `1dc0dc4`），主题不做温度卡 |
| GPU | `nvidia-smi` 等 | `gpu_info` | `\|\| ''` | 数组或 JSON string | 同 | `gpu_info` | — | 空 → 隐藏 GPU 区块 |
| disk I/O | `/proc/diskstats` | `disk{read_bps,...}` | `hasDiskMetricsPayload()`：六项全 0 或缺失即视为无 | 有则为对象 | 同 | 六个平铺列 | B/s、IOPS、ms、% | 六项全 0 → 服务端**删除** `disk`，主题隐藏 |
| ip_v4 / ip_v6 | `cdn-cgi/trace` | `ip_v4`/`ip_v6` | `toPublicIpReachability()` → `'1'`/`'0'` | `'1'`/`'0'` | 同 | 同名列 | — | **只是可达性标志，不是 IP 地址** |
| price / billing / expire | — | 后台配置 | 原样 | string | 部分 | — | — | `''`/`0`/`-1` 表示免费或未设置 |
| ping_* | `get_probe()` 中位 RTT | `"<int>"` / `"null"` / `""` / `false` | `Number()`；非有限 → `null` | number\|null\|false | 同 | `INTEGER DEFAULT 0` | ms | `false`=未配置；`null`=本轮超时；数值有效 |
| loss_* | `(count-ok)*100/count` | 同上 | 同上 | number\|null\|false | 同 | `INTEGER DEFAULT NULL` | % | 同上；**真实 0 是有效值** |
| ping[] / loss[] 窗口 | — | — | `getDashboardLatencyHistory()` | 20 点 × 8 目标 | **不出现** | — | ms / % | `null`=该桶无采样；`false`=未配置；key 缺席=旧库未迁移 |
| ping_mode | 探针探测方式 | `ping_mode`（`"tcp"`/ICMP 回退） | 透传 | string | 同 | — | — | 元数据，本主题未使用 |

## 与旧 adapter 假设的差异

被源码与真实响应**推翻**的既有假设：

1. ~~窗口点只有 `{ts, ct, cu, cm, bd}`~~ → 服务端写入全部 8 个目标，旧库才退回 4 个。
2. ~~窗口可以拍平成一串数值~~ → 点是时间桶，必须逐桶保留，`null` 是空洞不是可丢弃项。
3. ~~`sysConfig` 挂在每台节点上~~ → 在 `/api/servers` 响应顶层。
4. ~~`/api/config` 能拿到 `show_price` 等开关~~ → 不能，只有 `/api/servers` 有。
5. ~~详情端点的 `loss=null` 会以 `null` 出现~~ → 详情端点会连同 `ping_X` 一起删除该字段。

被源码**确认成立**的既有假设：

- WebSocket 增量不含 `ping`/`loss` 数组，因此 partial merge 不会清掉列表窗口（真实响应已验证）。
- probe 的 `false` / `null` / 数值三态在 REST、WS、History 三条链路上一致。
- `frontend_ws_timeout_minutes`、`long_history_points`、`latency_window` 均由 `/api/config` 提供。

## 仍未确认 / 需要更多证据

| 项 | 现状 | 需要什么证据 |
|---|---|---|
| 探针 `""`（探测文件尚未生成）经 `Number("")` 变成 `0` | 源码可推导：`coerceNumericMetricFields` 会把空串转成 `0`，于是「尚未测量」在服务端变成真实的 `0 ms / 0%`。**第 15 轮复核**：真实部署（Beta5）全量 `/api/servers` 响应里 `ping_*` 标量为 `0` 的出现次数 = 0，未观察到该污染 | 需要一台刚启动、探针尚未完成首轮探测的节点的真实响应 |
| ~~`node_1..4` 在已迁移数据库上的窗口表现~~ | **第 15 轮已解决**：真实部署升级到 `2.8.5 Beta5` 且已迁移，`/api/servers` 的窗口点现在是完整 8 个 key——实测 `{"ts":…,"ct":152,"cu":154,"cm":149,"bd":false,"node_1":false,"node_2":false,"node_3":false,"node_4":false}`，未配置目标取值 `false`。`/api/config` 也返回了 `node_1_name`～`node_4_name` | — |
| History 对 `node_1..4` 的聚合策略 | `HISTORY_METRIC_AGGREGATION_POLICY` 只列了 ct/cu/cm/bd 的 avg，node_1..4 未列入。该部署的 node_1..4 全部未配置，无法观察 | 需要长时间窗口 + 已配置 node 探测点的真实历史 |

## 真实部署版本记录

| 轮次 | 观测到的 Worker 版本 | 窗口形态 | 备注 |
|---|---|---|---|
| 第 14 轮 | `2.8.5 Beta2` | 4 个 key（`ts/ct/cu/cm/bd`） | 旧库未迁移，走 `LEGACY_DASHBOARD_LATENCY_COLUMNS` |
| 第 15 轮 | `2.8.5 Beta5` | 8 个 key | 已迁移；顶层 `sysConfig` 仍含三个 `show_*` 与 `latency_window {points:20,hours:2}` |
