> **第 9.5 轮追加的最高 UI/UX 原则（由项目所有者下达）：**
>
> 原 Komari Glassmorphism 当前默认分支中的真实代码、组件、样式、布局、动画、路由行为与浏览器表现，是正式版 UI/UX 的**唯一权威基准**。
>
> 当前 CFSM-Glassmorphism 的既有实现只代表"已经实现的 CFSM 功能"，**不代表最终视觉设计真相**，也不是不可修改的兼容基线。二者不一致时，除本文件与 `docs/fidelity-audit.md` 列出的 CFSM 必要平台差异外，一律向 Komari 对齐。
>
> 不得以"UX 更好""更适合 CFSM""代码更简单""减少依赖"或"为了通过测试"为由偏离原主题，也不得把 Komari 真实使用的 renderer 替换为 SVG/CSS 仿制。
>
> 逐项差异审计记录在 `docs/fidelity-audit.md`。

# CFSM-Glassmorphism 完整移植任务

## 0. 目标仓库

唯一需要开发和修改的目标仓库：

https://github.com/allury/CFSM-Glassmorphism

这是最终项目仓库。

当前仓库可能为空或只有少量初始化文件，因此请按实际情况从零建立完整工程。

**不要修改任何参考仓库。**

所有实际源码、测试、文档、GitHub Actions 工作流都写入：

```text
allury/CFSM-Glassmorphism
```

---

# 1. 最终目标

将 Komari 主题：

https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism

尽可能完整地移植成适用于：

https://github.com/huilang-me/CF-Server-Monitor

的第三方主题。

最终项目名称：

```text
CFSM-Glassmorphism
```

目标不是简单模仿外观，也不是制作静态 Demo。

要求：

> 尽可能保留 Komari Glassmorphism 当前版本的视觉设计、页面结构、交互方式、主题设置、节点卡片、详情页、历史图表、高级工具、性能优化和响应式体验，同时彻底替换 Komari 数据层，将整个项目正确适配到 CF-Server-Monitor 官方第三方主题 API、WebSocket、历史数据、鉴权和 theme_options 配置体系。

最终产物必须能够作为真正的 CF-Server-Monitor 第三方主题长期运行。

---

# 2. GitHub 操作硬性限制

## 禁止使用浏览器操作 GitHub

整个开发过程中：

**不得使用浏览器、浏览器自动化、Computer Use、Playwright、Selenium 或任何网页 GUI 操作 GitHub。**

包括但不限于禁止通过 GitHub 网页：

- 创建文件
- 修改文件
- Commit
- Push
- 创建 PR
- Merge PR
- 创建 Release
- 上传附件
- 查看并手工操作 Actions
- 修改仓库设置
- 编辑 Workflow
- 创建 Tag
- 操作 Branch
- 编辑 Issue
- 通过 GitHub Web IDE 修改代码

不要打开 GitHub 网页进行仓库管理。

## 允许的开发方式

仓库开发只使用：

```text
本地文件系统
终端
git
bun / node
测试工具
构建工具
```

允许通过：

```bash
git clone
git fetch
git pull
git diff
git status
git log
git show
```

读取参考仓库。

如环境允许，也可以使用命令行读取公开源码。

参考仓库只允许读取。

## GitHub 写入原则

代码修改全部首先发生在当前本地工作区。

不要通过 GitHub 网页修改仓库。

如果当前 Codex 环境已经提供正常 Git 工作区，则：

- 直接修改本地文件
- 运行测试
- 运行构建
- 检查 git diff

除非运行环境明确要求，否则不要自行设计 GitHub 网页工作流。

GitHub Actions 应由代码 Push 后自动执行。

---

# 3. GitHub Actions 是正式构建方式

本项目必须使用：

```text
.github/workflows/
```

中的 GitHub Actions 自动完成正式构建。

**不要把人工本地打包作为正式发布流程。**

本地：

```bash
bun run build
```

主要用于开发验证。

正式构建产物由 GitHub Actions 生成。

---

# 4. 不提交自动构建产物

除非 CFSM Theme Store 后续明确要求，否则源码仓库不要把每次生成的：

```text
dist/
*.zip
```

长期提交进源码历史。

它们应由 GitHub Actions 自动产生。

源码仓库主要保存：

```text
src/
public/
tests/
scripts/
package.json
bun.lock
vite.config.*
tsconfig.*
README.md
LICENSE
.github/workflows/
```

以及其它开发所需文件。

---

# 5. Actions 自动构建要求

至少建立：

```text
.github/workflows/build.yml
```

触发条件：

```text
push -> main
pull_request
workflow_dispatch
```

Actions 中必须依次执行：

```text
checkout
setup bun
bun install --frozen-lockfile
lint
typecheck
test
build
validate dist
package artifact
upload artifact
```

如果某一步项目确实不需要，例如没有独立 typecheck 命令，可调整，但必须在 README 中说明。

---

# 6. Actions 构建环境

优先使用与原 Glassmorphism 相近的技术栈：

```text
Vue 3
TypeScript
Vite
Bun
```

不要因为 CFSM 是另一个项目就无意义地重写成 React。

原 Glassmorphism 的表现层应尽量保留。

Actions 使用稳定版本 Bun，并锁定依赖。

必须提交：

```text
bun.lock
```

Actions 使用：

```bash
bun install --frozen-lockfile
```

避免构建时依赖漂移。

---

# 7. Actions 构建产物

CF-Server-Monitor 正式主题产物最终只能包含：

```text
index.html
assets/
```

因此：

```text
dist/
├── index.html
└── assets/
```

是标准正式构建目录。

不得在正式主题包根目录产生其它运行时必须文件。

例如不要依赖：

```text
config.json
src/
package.json
node_modules/
README.md
.env
```

才能运行。

---

# 8. Actions 必须验证产物结构

在上传 Artifact 前执行自动校验。

至少确认：

```text
dist/index.html
dist/assets/
```

存在。

并检查正式主题运行不依赖：

```text
config.json
```

还应扫描构建结果，防止遗留 Komari 专属运行时 API，例如：

```text
/api/rpc
common:getRecords
public:getPublicPingTasks
Komari RPC
/manage/
Komari 专属 WebSocket
```

来源说明、README、License 中出现 `Komari` 字样不算错误。

重点禁止的是：

**运行时代码继续依赖 Komari 后端。**

---

# 9. Actions Artifact

每次成功构建后生成：

```text
CFSM-Glassmorphism-build-<short-sha>.zip
```

ZIP 内部直接包含：

```text
index.html
assets/
```

不要变成：

```text
CFSM-Glassmorphism/
  index.html
  assets/
```

也不要变成：

```text
dist/
  index.html
  assets/
```

用户解压 ZIP 后应直接看到：

```text
index.html
assets/
```

然后使用：

```text
actions/upload-artifact
```

上传构建结果。

---

# 10. Actions 失败原则

以下任意一项失败：

```text
lint
typecheck
test
build
dist validation
```

整个 Workflow 必须失败。

禁止：

```bash
command || true
```

禁止静默忽略测试失败。

禁止构建失败仍上传一个不完整主题。

---

# 11. Release 暂不依赖人工网页操作

如果项目需要 Release 自动化，可以额外建立：

```text
.github/workflows/release.yml
```

采用 Tag 或版本号触发。

Release 创建必须完全由 GitHub Actions 完成。

Codex 不得打开 GitHub 网页手工创建 Release。

但第一阶段优先确保：

```text
push main
↓
Actions
↓
测试
↓
构建
↓
Artifact
```

稳定工作。

不要为了 Release 系统拖延核心主题开发。

---

# 12. 参考资料与优先级

开发开始前必须系统阅读以下四类参考源。

不能只看 README。

## 第一优先级：CFSM 第三方主题开发文档

https://github.com/huilang-me/CF-Server-Monitor/blob/main/theme-develop.md

这是：

> 第三方主题允许使用哪些接口、字段、鉴权方式、WebSocket、路由和配置能力的最高约束。

它决定：

```text
第三方主题“能不能做”
```

任何其它源码、示例或参考项目都不能突破它定义的权限边界。

如果其它参考代码与 `theme-develop.md` 冲突：

**必须以 `theme-develop.md` 为准。**

---

## 第二优先级：CFSM 官方前端源码

CF-Server-Monitor 作者明确建议同时参考：

https://github.com/huilang-me/CF-Server-Monitor/tree/main/src/frontend

开发开始时必须获取 CF-Server-Monitor 当前 `main` 最新源码，并系统阅读：

```text
src/frontend/
├── App.vue
├── components/
├── composables/
├── main.js
├── router/
├── styles/
├── utils/
└── views/
```

其中重点研究：

```text
src/frontend/main.js

src/frontend/utils/api.js
src/frontend/utils/config.js
src/frontend/utils/http.js
src/frontend/utils/server.js
src/frontend/utils/themeOptions.js
src/frontend/utils/turnstile.js
src/frontend/utils/osIcon.js
src/frontend/utils/finance.js
src/frontend/utils/pingNode.js

src/frontend/router/
src/frontend/views/
src/frontend/components/
src/frontend/composables/
```

用途是：

> 了解 CF-Server-Monitor 官方前端实际上如何初始化、请求 API、处理服务器数据、维护实时状态、处理鉴权、Turnstile、多 API Base、主题配置、路由和异常状态。

不要机械复制这些文件。

### 极其重要：官方前端源码不是第三方主题权限说明

`src/frontend/` 属于 CF-Server-Monitor 官方项目自身前端。

因此：

**不能因为官方前端调用了某个接口，就自动认为第三方主题也有权调用该接口。**

判断规则必须是：

```text
theme-develop.md 明确允许
        ↓
才可以在第三方主题中使用
```

如果：

```text
src/frontend/
```

存在某个：

```text
管理 API
内部 API
后台写接口
系统配置接口
未写入 theme-develop.md 的接口
```

不得直接搬进 CFSM-Glassmorphism。

先检查：

```text
theme-develop.md
```

是否将该能力公开给第三方主题。

如果没有公开：

```text
禁止使用
```

不要尝试：

- 猜接口
- 扫描内部 API
- 调管理后台接口
- 使用隐藏 Worker API
- 模拟后台请求
- 绕过第三方主题限制

对于 `theme-develop.md` 已明确允许、但实现细节较少的能力：

> 优先参考 `src/frontend/` 当前实际实现，而不是自行猜测协议细节。

---

## 第三优先级：LuminaPlus

第三方主题参考：

https://github.com/volcano-1025/CFSM-Theme-LuminaPlus

重点研究：

```text
src/services/
src/services/cfsm/
src/pages/ThemeManage.tsx
Theme Settings Store
HTTP Wrapper
Theme Options Save
JWT
Turnstile
Multi API Base
Error Handling
```

其中尤其参考：

```text
POST /api/theme_options
```

的成熟实现。

LuminaPlus 只用于学习：

> CFSM 第三方主题如何工程化接入 CFSM。

不要复制：

- LuminaPlus UI
- LuminaPlus 布局
- LuminaPlus 视觉
- LuminaPlus 卡片设计
- LuminaPlus 主题风格

---

## 第四优先级：Komari Glassmorphism

原始视觉和功能来源：

https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism

它决定：

```text
最终主题应该“长什么样”和“有哪些功能”
```

必须系统阅读当前最新源码：

```text
komari-theme.json

src/
src/components/
src/composables/
src/constants/
src/hooks/
src/lib/
src/router/
src/services/
src/stores/
src/styles/
src/types/
src/utils/
src/views/

AGENTS.md
src/AGENTS.md
AIAGENTREADME.md
CLAUDE.md
README.md
docs/
```

不要只参考截图重新做一个相似页面。

优先：

```text
保留 Glassmorphism 表现层
↓
替换 Komari 数据层
↓
适配 CFSM Store
↓
逐项恢复功能
```

---

# 13. 四个参考源的职责必须分开

严格按照下面的职责理解四个项目：

```text
Glassmorphism
    ↓
视觉 / UX / 功能设计来源

theme-develop.md
    ↓
第三方主题 API 权限与协议最高规范

CFSM src/frontend/
    ↓
官方 API 的真实使用与数据处理参考

LuminaPlus
    ↓
成熟第三方主题工程封装参考
```

禁止把四者混为一谈。

---

# 14. 出现差异时的判断流程

遇到任何实现不确定时，严格按下面顺序调查：

```text
1. 查看 Glassmorphism 原功能到底如何工作

2. 查看 theme-develop.md
   CFSM 第三方主题是否提供对应数据/API

3. 查看 CFSM src/frontend/
   官方前端如何处理相同数据或功能

4. 查看 LuminaPlus
   第三方主题是否已有可靠适配模式

5. 设计 CFSM-Glassmorphism Adapter

6. 仍无法实现时再降级
```

禁止跳过前四步后直接删功能。

---

# 15. 官方源码版本漂移处理

不要把当前看到的：

```text
src/frontend/
```

某一版实现永久写死到项目假设里。

每次大的适配工作开始前：

```bash
git fetch
```

检查：

```text
huilang-me/CF-Server-Monitor main
```

当前实现。

如果：

```text
theme-develop.md
src/frontend/
```

近期同时发生变化：

重新检查两者。

再次强调：

```text
文档权限边界 > 官方内部实现
```

---

# 16. 开发顺序：先分析，再移植

第一阶段先完成代码审计。

生成：

```text
docs/compatibility-matrix.md
```

列出原 Glassmorphism 主要功能。

格式：

| 功能 | 原 Komari 实现 | CFSM 数据/API | 处理方式 | 状态 |
|---|---|---|---|---|
| 示例 | Komari RPC | /api/... | 等价适配 | 🟢 |

状态只能使用：

```text
✅ 一致
🟢 等价实现
🟡 降级实现
🔴 CFSM API 暂不支持
```

---

# 17. 四种功能处理等级

## A. 复刻对照

CFSM 有完整对应数据。

保留原功能、原逻辑和原 UI。

## B. 等价实现

后端数据结构不同，但能够实现同等用户体验。

应改数据层，而不是重做 UI。

## C. 降级实现

CFSM 数据有限。

使用真实可用数据完成能力较弱版本。

必须说明差异。

## D. 不支持

CFSM 官方第三方主题 API 没有任何可靠办法实现。

记录原因。

不得使用私有管理 API 绕过限制。

---

# 18. 禁止假数据

为了让页面“看起来完整”，绝对禁止：

- 编造 IP
- 编造 ASN
- 编造 ISP
- 编造 Provider
- 编造城市
- 编造经纬度
- 编造历史数据
- 重复当前 Ping 值生成假历史
- 随机生成资源数据
- Random Demo Node
- 正式环境 Mock 数据
- 根据节点名称猜运营商
- 根据标签猜真实网络信息

Mock 只能用于：

```text
tests/
dev mock
visual regression
```

不能进入 Production Runtime。

---

# 19. 核心架构

不要让 Vue Components 到处直接 fetch CFSM。

建立明确层级：

```text
CFSM REST / WebSocket
          ↓
CFSM Transport Layer
          ↓
CFSM Service Layer
          ↓
CFSM → Glassmorphism Adapter
          ↓
Normalized Store
          ↓
Glassmorphism UI Components
```

建议结构：

```text
src/
├── services/
│   └── cfsm/
│       ├── config.ts
│       ├── http.ts
│       ├── api.ts
│       ├── websocket.ts
│       ├── history.ts
│       └── adapters.ts
├── stores/
├── types/
├── components/
├── views/
└── ...
```

具体文件名允许根据实际设计调整。

原则不变：

> CFSM 数据转换集中处理，不让表现层散落大量后端兼容判断。

---

# 20. TypeScript 数据模型

为 CFSM 官方 API 建立严格 TypeScript 类型。

需要覆盖：

```text
SiteConfig
Server
DiskIoMetrics
LatencyWindowPoint
HistoryMetricRow
SysConfig
ThemeOptionsSaveResponse
WsMessage
```

对外部 JSON 数据必须做好：

```text
null
false
string number
missing fields
旧 Agent 数据
异常字段
```

的防御性处理。

不能简单使用：

```ts
any
```

贯穿整个数据层。

---

# 21. `/api/config`

必须正确读取：

```text
version
last_workers_version
last_agent_version
is_public
authorization
turnstile_enabled
turnstile_login_enabled
turnstile_site_key
custom_ct_name
custom_cu_name
custom_cm_name
custom_bd_name
node_1_name
node_2_name
node_3_name
node_4_name
site_title
preferred_theme
default_language
theme_options
verified
turnstile_verified
frontend_ws_timeout_minutes
long_history_points
latency_window
```

优先参考：

```text
theme-develop.md
+
src/frontend/main.js
```

不要自己发明默认值语义。

有官方前端已有 normalization 时：

优先研究官方实现。

---

# 22. `config.json` 已废弃

禁止创建依赖：

```text
config.json
```

的运行时架构。

Worker/主题同域：

```ts
window.location.origin
```

作为默认 API Base。

纯静态部署时按 CFSM 官方：

```html
<meta name="apiBase" content="...">
```

规则处理。

---

# 23. HTTP 层

重点研究：

```text
src/frontend/utils/http.js
src/frontend/utils/config.js
```

确认：

- API Base
- Authorization
- Turnstile Header
- 请求错误
- 多 API Base
- 跨域
- Token 生命周期

然后在 CFSM-Glassmorphism 内建立自己的：

```text
src/services/cfsm/
```

适配层。

不要直接从 Vue Component 到处调用 `fetch()`。

---

# 24. 多 API Base

如果 CFSM 官方主题文档支持多个 API Base：

架构上不要破坏这个能力。

每个后端：

- 单独获取服务器
- 记录 server ID 所属后端
- REST 详情请求发到正确后端
- WS 发到正确后端
- 订阅只发送该后端所属 server IDs

禁止把其它 Worker 的节点 ID 发送给错误的 Worker。

---

# 25. 服务器基础字段

至少映射：

```text
name
server_group
tags
price
billing_cycle
auto_renewal
currency
expire_date
traffic_limit
traffic_calc_type
reset_day
report_interval
wss_report_interval
is_hidden
sort_order
```

---

# 26. 系统信息

映射：

```text
cpu_cores
cpu_info
arch
os
kernel_version
region
agent_version
boot_time
last_updated
```

---

# 27. 实时指标

映射：

```text
cpu
load_avg

ram_total
ram_used

swap_total
swap_used

disk_total
disk_used

net_in_speed
net_out_speed

net_rx
net_tx

net_rx_monthly
net_tx_monthly

processes
tcp_conn
udp_conn
```

---

# 28. Server 数据处理

重点研究：

```text
src/frontend/utils/server.js
src/frontend/utils/api.js
```

用于确认 CFSM 官方对以下内容的实际处理：

```text
在线状态
服务器字段
资源指标
价格
流量
Ping
Loss
时间
空字段
旧数据兼容
```

但最终字段定义仍以：

```text
theme-develop.md
```

公开给第三方主题的类型为准。

---

# 29. Disk IO

读取：

```text
disk.read_bps
disk.write_bps
disk.read_iops
disk.write_iops
disk.await_ms
disk.util
```

只有真实存在：

```text
disk
```

时才显示 Disk IO 模块。

字段缺失：

```text
隐藏
```

而不是：

```text
0
```

---

# 30. GPU

使用：

```text
gpu_info
```

不要使用已废弃：

```text
gpu
```

必须兼容：

```text
Array
JSON string
```

不存在有效 GPU：

隐藏 GPU 相关：

- 卡片
- 图表
- 高级指标

---

# 31. Ping / Loss

正确使用：

```text
ping_ct
ping_cu
ping_cm
ping_bd

loss_ct
loss_cu
loss_cm
loss_bd

ping_node_1
ping_node_2
ping_node_3
ping_node_4

loss_node_1
loss_node_2
loss_node_3
loss_node_4
```

名称来自：

```text
custom_ct_name
custom_cu_name
custom_cm_name
custom_bd_name
```

旧四线路配置缺失或空白时统一 fallback：

```text
电信
联通
移动
BGP
```

Node 名称来自 `node_1_name` 至 `node_4_name`，缺失或空白时使用 `Node 1` 至 `Node 4`。

所有 Ping/Loss 字段必须保留 `number | null | false` 三态：字段缺失或未配置为 `false`，明确探测超时为 `null`，数值（包括 `0`）为有效结果。REST、History 与 WebSocket partial merge 不得把三者混淆。

同时研究：

```text
src/frontend/utils/pingNode.js
src/frontend/utils/api.js
```

---

# 32. Ping 历史小图

仅使用真实：

```text
servers[].ping
servers[].loss
```

如果后端返回：

```text
[]
```

则隐藏对应趋势图。

禁止：

> 把一个当前 Ping 数值复制 20 次画成假趋势线。

---

# 33. 首页服务器接口

首页初始加载使用：

```text
GET /api/servers
```

不要首页逐节点调用：

```text
/api/server
```

不要为了每张卡单独请求历史。

---

# 34. 详情接口

详情页：

```text
GET /api/server?id=<uuid>
```

不要先请求整个：

```text
/api/servers
```

再过滤目标节点。

---

# 35. 历史数据

详情历史使用：

```text
GET /api/history/all?id=<uuid>&hours=<number>
```

严格限制在 CFSM 官方支持的时间范围。

必须处理：

```text
0.167
0.5
1
6
12
24
48
96
168
```

如果官方后续更新范围：

以最新文档为准。

---

# 36. 历史异常

必须处理：

```text
401
409
empty []
network error
```

401：

未登录超出权限。

409：

数据库需要升级。

空数组：

显示真实空状态。

不要自动 Mock。

---

# 37. WebSocket：首页

首页使用：

```text
/api/ws?subscribe=all
```

连接后发送：

```json
{
  "type": "subscribe",
  "scope": "all",
  "ids": ["真实服务器ID"]
}
```

禁止建立连接后忘记发送 IDs。

---

# 38. WebSocket：详情

节点详情必须：

```text
/api/ws?subscribe=<serverId>
```

不要：

```text
subscribe=all
```

之后再在浏览器内过滤。

---

# 39. WebSocket 增量数据

消息：

```text
batchUpdate
```

每个 sample 指标按：

```ts
sample.data || sample.payload || sample.metrics
```

读取。

这是：

```text
Partial Server Update
```

必须：

```text
merge
```

到已有节点状态。

禁止使用一个只有：

```text
cpu
ram_used
net_in_speed
```

的高频 sample 覆盖掉整个 Server 对象。

---

# 40. 页面隐藏时关闭 WS

监听：

```text
document.visibilitychange
```

隐藏：

```text
关闭 WS
```

重新显示：

```text
REST refresh
↓
重新连接 WS
```

同时实现：

```text
frontend_ws_timeout_minutes
```

官方要求。

---

# 41. WS 503

WebSocket 不可用时：

允许合理降级到低频 REST 刷新。

不能：

- 白屏
- 无限高速重连
- 产生请求风暴

必须采用 backoff。

---

# 42. Theme Options

重点研究：

```text
src/frontend/utils/themeOptions.js
```

了解官方主题配置：

```text
读取
归一化
默认值
运行时应用
```

CFSM-Glassmorphism 自己的主题设置必须集中管理。

不得让组件散落读取：

```text
config.theme_options
localStorage
```

---

# 43. Turnstile

重点研究：

```text
src/frontend/utils/turnstile.js
src/frontend/main.js
```

不要重新设计一套验证机制。

应正确复用 CFSM 当前：

```text
X-Turnstile-Token
X-Turnstile-Verified
```

流程。

同时严格遵守 `theme-develop.md` 对第三方主题的要求。

---

# 44. Router

研究：

```text
src/frontend/router/
```

理解 CFSM 官方前端页面行为。

但是第三方主题正式路由必须遵守：

```text
theme-develop.md
```

当前约定：

```text
首页
/#/
/#

详情
/#/server/:id

后台
/admin#admin
```

第三方主题不得自己实现 CFSM 管理后台。

---

# 45. 管理后台

Glassmorphism 不实现 CFSM 管理后台。

后台按钮统一：

```text
/admin#admin
```

不要移植原项目中真正负责：

```text
/admin
/terminal
/manage/*
```

的 Komari 后台实现。

CFSM 第三方主题负责：

```text
Dashboard
Theme Settings
Public/visitor UI
```

系统管理后台由：

```text
CFSM 默认主题
```

负责。

---

# 46. OS / Flag

研究：

```text
src/frontend/utils/osIcon.js
```

确认官方 OS 名称到图标资源的实际映射规则。

第三方主题优先使用：

```text
/os-icons/<filename>
/flags/<code>.svg
```

不要无意义重复打包 CFSM 已经提供的公共资源。

---

# 47. Finance

研究：

```text
src/frontend/utils/finance.js
```

了解 CFSM 当前：

```text
price
billing_cycle
currency
expire_date
```

的官方处理。

Glassmorphism 的：

```text
费用统计
剩余价值
性价比
```

功能必须使用真实 CFSM 字段语义。

禁止自己猜计费周期。

---

# 48. Glassmorphism 视觉设计

尽可能保持原版：

- 毛玻璃
- 动态背景
- 浅色
- 深色
- 北京时间自动日夜模式
- Card
- List
- Mini
- Compact
- Comfortable
- Large
- Header
- 总览
- 地球
- 地图
- 节点卡片
- 指标条
- Ping
- Tooltip
- Modal
- Drawer
- Details
- Chart
- 高级工具
- 设置页
- Mobile UI

不要以“适配 CFSM”为由重新设计一套别的主题。

---

# 49. 原主题设置必须逐项审计

以：

```text
komari-theme.json
```

和当前实际源码为准。

至少检查：

```text
默认主题模式
更新间隔
默认视图
节点卡尺寸
公告
地球旋转
地球 Renderer
隐藏地球
隐藏 Header
访客信息
Glass Color
Color Vision
自定义颜色
首页总览 Preset
General Card Keys
高级工具
隐私
后台入口
价格隐私
Provider Aliases
动画
快捷控制
节点列表 Metadata
Metadata Fields
Custom Tags
离线置底
高负载阈值
流量预警
到期预警
磁盘耗尽预测
详情 Tabs
详情 Card Preset
Detail Card Keys
GPU Chart
Chart Preset
Chart Keys
```

以及当前版本其它全部实际配置。

---

# 50. 不允许假设置

如果某个 Komari 设置在 CFSM 下完全没有作用：

不要保留一个假的开关。

处理优先级：

```text
等价适配
↓
合理降级
↓
隐藏
↓
明确标记暂不支持
```

---

# 51. `rpcTransportMode`

Komari 的：

```text
HTTP RPC / WebSocket RPC
```

是 Komari 特有架构。

CFSM 不使用这套 RPC。

不要机械移植。

在 CFSM 中统一采用：

```text
REST
+
CFSM WebSocket
```

如果该主题设置失去意义：

移除或改造成 CFSM 有真实意义的设置。

---

# 52. 主题配置三层模型

建立明确的三层配置：

```text
1. Theme Defaults
2. Backend theme_options
3. Local Browser Override
```

读取合并规则集中实现。

不要每个组件直接读取 localStorage。

---

# 53. 后端主题配置

从：

```text
GET /api/config
```

读取：

```text
theme_options
```

它代表：

```text
站点级 Glassmorphism 默认配置
```

所有浏览器和访客应该以它为基础。

---

# 54. 本机配置

localStorage 用于：

```text
当前浏览器临时覆盖
```

允许访客：

- 改主题
- 改显示方式
- 保存本机设置

但是：

未登录用户不能修改后端站点级主题配置。

---

# 55. 设置页面必须实现

Glassmorphism 自己的 Theme Settings 页面至少提供：

```text
保存到本机
保存到后端
改用后端配置
```

可以额外提供：

```text
复制配置 JSON
```

作为故障兼容方案。

---

# 56. “保存到后端”是硬性功能

参考 LuminaPlus 的成熟设计。

但是必须直接遵守 CFSM 官方接口。

唯一允许写主题配置的 API：

```text
POST /api/theme_options
```

---

# 57. POST Body

必须发送：

```json
{
  "theme_options": {
    "...": "当前完整 Glassmorphism 配置"
  }
}
```

发送的是：

> 当前完整、白名单化、归一化配置快照。

不是只发送发生变化的字段。

---

# 58. 不得调用其它管理写接口

禁止调用：

```text
save_settings
admin internal API
worker internal settings API
site_options write API
appearance_options internal API
```

第三方主题唯一允许的主题写入口：

```text
POST /api/theme_options
```

这一点不能因为研究了：

```text
src/frontend/
```

而改变。

---

# 59. JWT

保存站点配置必须使用：

```http
Authorization: Bearer <jwt>
```

复用 CFSM 已存在登录态。

不要创建自己的管理员密码系统。

不要创建第二套 Token。

---

# 60. Turnstile

启用 Turnstile 时正确复用：

```text
X-Turnstile-Verified
```

或：

```text
X-Turnstile-Token
```

保持与其它 CFSM 请求一致。

---

# 61. 后端保存成功

保存成功后：

1. 接受后端返回的 `theme_options`
2. 清理会覆盖新后端配置的旧 localStorage 主题覆盖
3. 更新 Runtime Theme Store
4. 重新 seed 设置表单
5. refetch `/api/config`
6. 当前页面立即使用新配置
7. 不要求用户 F5

提示：

```text
已保存到后端，所有设备与访客将以这套配置作为默认设置
```

---

# 62. 保存失败

## 400

识别：

```text
invalidThemeOptionsFormat
```

显示明确格式错误。

## 401

提示：

```text
登录状态已失效，请重新登录后再保存
```

保留当前草稿。

## 403

重新进入 Turnstile 验证流程。

保留当前草稿。

## Network Error

保留当前草稿。

不要 reset。

---

# 63. 未登录用户

没有有效管理员登录态：

```text
保存到后端
```

按钮：

```text
隐藏
```

或：

```text
disabled + 明确提示
```

不要让访客点击之后才看到模糊 401。

---

# 64. 保存到后端专项测试

测试：

### Case 1

管理员：

```text
修改
↓
保存到后端
↓
200
↓
重新获取 /api/config
↓
配置一致
```

### Case 2

清空 localStorage：

仍然从：

```text
theme_options
```

恢复站点配置。

### Case 3

失效 JWT：

```text
401
```

且编辑内容仍存在。

### Case 4

Turnstile 失效：

```text
403
```

且编辑内容仍存在。

### Case 5

错误 payload：

```text
400
```

正确提示。

---

# 65. CFSM 没有的数据

如果官方主题 API 不提供：

```text
真实 IPv4
真实 IPv6
ASN
ISP
Provider
City
真实节点经纬度
访客 IP
Komari Audit Log
```

绝对不要猜。

---

# 66. `ip_v4` / `ip_v6`

注意 CFSM 公共 Server 中：

```text
ip_v4
ip_v6
```

代表：

```text
IPv4 / IPv6 可达性状态
```

不是服务器真实 IP 地址。

严禁当作真实 IP 展示。

---

# 67. Provider 降级

若原 Glassmorphism Provider 功能依赖 CFSM 没有的数据：

可以根据用户明确提供的：

```text
tags
server_group
providerAliases
```

实现用户自定义归类。

不能自动声称某节点属于：

```text
DMIT
V.PS
Netcup
AWS
Cloudflare
```

除非真实数据明确提供。

---

# 68. 地球 / 地图

尽量保留：

```text
realistic
cobe
tiled
```

CFSM 只有：

```text
region
```

时：

只能做到国家/地区级定位。

允许根据标准 Region/Country Code 映射：

```text
国家/地区中心坐标
```

不得虚构城市级位置。

---

# 69. 高级工具：健康摘要

优先完整适配。

使用真实：

```text
online
CPU
Memory
Swap
Disk
Load
GPU
Traffic
Ping
Loss
Expire Date
History
```

形成健康判断。

---

# 70. 高级工具：性价比

尽量适配：

```text
price
billing_cycle
currency
cpu_cores
ram_total
disk_total
traffic_limit
```

不同币种：

禁止直接相加。

没有可靠汇率：

分币种统计或明确提示。

---

# 71. 高级工具：快照导出

尽量完整保留。

基于：

```text
当前实际获取的 CFSM 数据
```

在浏览器前端导出。

不得为了快照调用未公开后端 API。

---

# 72. 高级工具：拓扑

可根据：

```text
region
server_group
tags
```

实现合理降级版本。

缺：

```text
真实 IP
ASN
Provider
```

就不要展示伪造拓扑。

---

# 73. 高级工具：审计日志

如果 CFSM 官方第三方主题 API 没有对应接口：

标记：

```text
🔴 CFSM API 暂不支持
```

可以隐藏功能。

不要读取 CFSM 管理后台内部接口。

---

# 74. 费用功能

必须正确处理：

```text
price = ""
price = 0
price = -1
```

以及：

```text
billing_cycle
currency
expire_date
```

不能出现：

```text
NaN
undefined
Invalid Date
```

---

# 75. 免费节点

根据 CFSM 官方实际语义统一处理。

免费节点：

- 不参与错误的费用平均
- 不生成负价格
- 剩余价值合理显示
- 不拼接没有意义的收费周期

---

# 76. 到期预警

保持原 Glassmorphism 当前预警逻辑。

但日期解析必须严格。

无效日期：

```text
-
```

不要：

```text
剩余 0 天
```

---

# 77. 搜索

尽量保持原版搜索体验。

基于真实可搜索字段：

```text
name
server_group
tags
region
cpu_info
os
arch
```

只有 CFSM 确实返回的数据才能进入搜索。

---

# 78. 收藏

收藏可保留为 localStorage 功能。

必须基于：

```text
server ID
```

而不是 Node Name。

避免重名节点冲突。

---

# 79. 详情上一台 / 下一台

尽量保留。

详情页本身仍只订阅单节点。

导航列表可以来自首页已有缓存/轻量服务器索引。

不要为了上一台下一台让详情页永久订阅全量 WS。

---

# 80. Site Title

使用：

```text
/api/config.site_title
```

不要源码写死：

```text
Komari
Glassmorphism Monitor
My Monitor
```

---

# 81. Background

站点后台设置的背景图等外观配置属于 CFSM。

主题不要强制覆盖用户后台配置。

Glassmorphism 自身动态背景与 CFSM 后台背景图冲突时，要明确优先级。

---

# 82. Footer

必须包含：

```text
Powered by CF-Server-Monitor
```

链接：

```text
https://github.com/huilang-me/CF-Server-Monitor/
```

版本来自：

```text
/api/config.version
```

建议显示：

```text
Powered by CF-Server-Monitor vX.X.X
```

同时允许显示：

```text
Glassmorphism Theme
```

---

# 83. 原作者署名

原主题：

```text
sanrokamlan-prog/komari-theme-Glassmorphism
```

使用 MIT License。

必须正确保留：

```text
LICENSE
来源说明
原作者版权信息
```

README 明确写：

```text
本项目基于 Komari Glassmorphism 进行 CF-Server-Monitor 适配。
```

不要声称整体视觉设计完全原创。

---

# 84. README

建立完整：

```text
README.md
```

至少包括：

```text
项目介绍
预览
功能
CFSM 兼容性
安装方式
Actions 构建
Artifact 获取
开发
配置
后端保存
License
原项目致谢
```

不要写未经验证的功能。

---

# 85. README 构建说明

明确：

```text
main Push
↓
GitHub Actions
↓
Code Quality
↓
Build
↓
CFSM Theme ZIP Artifact
```

用户不需要手工在本地编译正式主题。

---

# 86. 本地开发

建议提供：

```bash
bun install
bun run dev
bun run lint
bun run typecheck
bun run test
bun run build
```

具体脚本根据项目实际设置。

---

# 87. 浏览器测试限制说明

允许使用浏览器自动化进行：

```text
localhost
本地 Vite Dev Server
本地 Mock Server
Visual Regression
Responsive Testing
```

但是：

**浏览器绝对不能用于操作 GitHub。**

也就是说：

```text
localhost:5173
```

可以测试。

```text
github.com
```

不得作为浏览器自动化目标。

---

# 88. Responsive

至少验证：

```text
375px
430px
768px
1024px
1440px
1920px
```

重点：

```text
Header
Earth
Tiled Map
Card
Mini Card
List
Detail
Chart
Theme Settings
Modal
Advanced Tools
长名称
大量 Tags
```

---

# 89. Light / Dark

测试：

```text
light
dark
beijing auto
system
```

具体模式以最终配置定义为准。

禁止出现：

- 黑底黑字
- 透明度错误
- 全页面被滤镜覆盖
- Tooltip 看不清
- Chart 图例看不清

---

# 90. 大量节点性能

测试：

```text
1
10
30
50+
```

节点。

尽量保留原版已有：

```text
Lazy Mount
KeepAlive
Memoization
Virtual/Lazy Rendering
按需图表
```

不要因为移植后端把这些优化全部删掉。

---

# 91. 请求性能

禁止：

```text
每个节点独立 WS
每张卡单独 polling
首页每台服务器拉 history
详情订阅全部服务器
每个 WS sample 重绘整个 App
```

---

# 92. 错误页面

必须处理：

```text
API unreachable
401
403
404
409
500
503
WebSocket disconnect
Invalid Server ID
Empty Server List
```

错误不能导致：

```text
Blank Screen
Infinite Spinner
JS Crash
```

---

# 93. 空数据测试

必须测试：

```text
0 节点
全部离线
1 个节点
无历史
无 Ping
无 Loss
无 GPU
无 Disk IO
无 Price
无 Expire Date
无 Traffic Limit
无 Tags
无 Group
```

---

# 94. Build 中不能有 Demo 数据

正式构建不得：

- 自动创建虚构节点
- 自动注入 mock 数据
- API 失败时显示演示服务器
- API 失败时生成随机 Metric

生产模式：

```text
真实数据
或
空状态
```

只有这两种。

---

# 95. 测试

建立适当单元测试。

重点覆盖：

```text
CFSM Server Adapter
GPU parser
Disk IO parser
Price parser
Billing parser
History mapper
WebSocket partial merge
Theme settings normalization
theme_options payload
401/403/400 behavior
Multi API Base
```

---

# 96. WebSocket 测试

至少确认：

```text
partial sample 不清掉旧字段
batchUpdate 多 sample 顺序正确
断线重连
visibilitychange
subscribe IDs
详情单节点订阅
```

---

# 97. Theme Settings 测试

至少确认：

```text
defaults
backend only
local override
backend + local
save local
clear local
save backend
backend response rehydrate
invalid backend config
```

---

# 98. Actions 也运行测试

本地测试通过不算全部完成。

`.github/workflows/build.yml` 必须运行同样的质量检查。

---

# 99. 原 Glassmorphism Visual Regression

如果合理，可以参考原项目 Visual Regression 测试设计。

允许建立：

```text
tests/visual/
```

使用完全虚构、本地固定 Mock 数据。

这些 Mock 不进入生产 Bundle。

---

# 100. 不要为了像素级对比访问 GitHub 网页

如果需要查看原项目资源：

使用：

```text
git clone
本地文件
仓库已有 docs/preview
```

不要通过浏览器打开 GitHub 页面进行操作。

---

# 101. AGENTS.md

在目标仓库根目录创建：

```text
AGENTS.md
```

记录本项目长期开发规则。

至少包含：

```text
CFSM 官方 theme-develop.md 优先
必须参考 CFSM src/frontend/
禁止私有管理 API
禁止生产 Mock
禁止假 IP/ASN/Provider
theme_options 是唯一主题写接口
构建由 Actions 完成
dist 不手工维护
Glassmorphism Visual First
```

这样后续 Codex 会话继续开发时不容易偏离架构。

---

# 102. 文档化适配差异

建立：

```text
docs/compatibility-matrix.md
docs/api-mapping.md
docs/theme-settings.md
docs/architecture.md
```

不要只把知识留在代码注释里。

---

# 103. `docs/api-mapping.md`

记录：

```text
/api/config
/api/servers
/api/server
/api/history/all
/api/ws
/api/theme_options
```

由哪个 Service 使用。

同时记录：

| 能力 | theme-develop.md | CFSM 官方 frontend 参考 | 本主题实现 |
|---|---|---|---|
| Config | `/api/config` | 对应官方文件 | 对应 service |
| Servers | `/api/servers` | 对应官方文件 | 对应 service |
| Detail | `/api/server` | 对应官方文件 | 对应 service |
| History | `/api/history/all` | 对应官方文件 | 对应 service |
| WebSocket | `/api/ws` | 对应官方文件 | 对应 service |
| Theme Save | `/api/theme_options` | 第三方主题规范 | 对应 service |

---

# 104. `docs/theme-settings.md`

逐项对照原：

```text
komari-theme.json
```

标记：

```text
✅ 一致
🟢 等价
🟡 降级
🔴 不支持
```

---

# 105. `docs/architecture.md`

至少说明：

```text
Transport
Service
Adapter
Store
UI
Theme Options
WebSocket
Multi API Base
```

数据流。

---

# 106. 功能验收：首页

必须逐项确认：

```text
加载服务器
在线/离线
CPU
RAM
Swap
Disk
Net Speed
Traffic
Ping
Loss
GPU
Card
Mini
List
Group
Search
Sort
Favorite
Earth
Map
Light
Dark
```

---

# 107. 功能验收：详情

确认：

```text
Hash Router
刷新恢复
REST server
Single Server WS
History
CPU Chart
RAM Chart
Disk Chart
Network Chart
GPU
Ping
Loss
Disk IO
Price
Expire
Traffic
```

---

# 108. 功能验收：设置

确认：

```text
即时预览
保存本机
刷新保留
清本机
读取后端
保存到后端
保存成功即时应用
换浏览器读取后端
401
403
400
```

---

# 109. 源码残留检查

完成前全局搜索：

```text
Komari API
/api/rpc
common:
public:
private:
manage
terminal
```

逐项确认。

只要是运行时遗留 Komari 后端调用：

必须清除。

---

# 110. Console

正式构建测试时：

不得存在持续：

```text
console.error
Unhandled Promise Rejection
Vue Error
Failed Resource
Infinite WS Reconnect
```

正常的可诊断 warning 可以保留，但不要污染控制台。

---

# 111. 依赖审计

不要无理由复制原项目所有依赖。

每个较重依赖：

确认当前主题真的在使用。

移除：

```text
Komari-only package
未使用 library
重复 chart library
重复 state library
```

---

# 112. 不要一次性推翻原代码

如果直接复用原 Glassmorphism 源码更合理：

优先：

```text
保留 UI
替换 Service
适配 Store
逐页修复
```

而不是：

```text
从零重新画一个“差不多”的 Glassmorphism
```

---

# 113. 开发阶段

## Phase 0 — Upstream Audit

```text
1. 获取当前最新 CFSM main
2. 阅读 theme-develop.md
3. 递归审计 src/frontend/
4. 获取当前最新 Glassmorphism main
5. 阅读 komari-theme.json 和完整 src/
6. 获取 LuminaPlus 当前实现
7. 建立 compatibility matrix
8. 建立 API mapping
9. 再开始写代码
```

不要在完成这些调查之前就大规模重写 UI。

## Phase 1

```text
仓库初始化
依赖
Vite
Vue
TS
Actions
Lint/Test/Build
```

## Phase 2

```text
导入 Glassmorphism 表现层
License
Styles
Assets
Router
基本布局
```

## Phase 3

```text
CFSM Types
HTTP
Config
Servers
Adapter
```

## Phase 4

```text
首页真实数据
Card
List
Search
Group
```

## Phase 5

```text
WebSocket
实时更新
多 API Base
页面可见性
```

## Phase 6

```text
详情
单节点 WS
History
Charts
```

## Phase 7

```text
Theme Settings
localStorage
theme_options
保存后端
JWT
Turnstile
```

## Phase 8

```text
Earth
高级工具
健康
性价比
导出
拓扑降级
```

## Phase 9

```text
Responsive
Performance
Visual Regression
错误处理
```

## Phase 10

```text
文档
最终残留扫描
Actions
正式构建验证
```

---

# 114. 每个阶段都保持可构建

不要等全部开发结束才：

```bash
bun run build
```

每个主要阶段至少运行：

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

保持 main 工程随时可构建。

---

# 115. 不要半途宣布完成

以下情况不算完成：

```text
首页能打开
看起来像 Glassmorphism
卡片显示假数据
只有桌面版
详情没做
设置没做
后端保存没做
Actions 不通过
Komari API 仍存在
```

---

# 116. 真正完成标准

只有满足以下条件才能宣布主要移植完成：

> CFSM-Glassmorphism 能够使用 CF-Server-Monitor 官方公开主题 API 实际展示真实服务器数据，支持首页、实时 WebSocket、节点详情、历史数据、Glassmorphism 主要布局和主题设置，能够通过官方 `POST /api/theme_options` 从主题设置界面直接把当前完整配置保存到 CFSM 后端并跨设备生效，同时保留原主题绝大多数在 CFSM 数据能力范围内可实现的功能，并通过 GitHub Actions 自动完成 lint、typecheck、test、build、产物校验和 Artifact 打包。

---

# 117. 最终交付报告

任务结束时不要只回复：

```text
完成
```

必须报告：

## 实现情况

```text
✅ 一致
🟢 等价
🟡 降级
🔴 不支持
```

各有多少项目。

## CFSM API

实际使用：

```text
/api/config
/api/servers
/api/server
/api/history/all
/api/ws
/api/theme_options
```

哪些完成。

## 设置

报告：

```text
原 Glassmorphism 设置数
已移植数
等价数
降级数
不支持数
```

## Tests

列出：

```text
lint
typecheck
unit tests
build
dist validation
```

结果。

## Actions

列出：

```text
workflow 文件
触发条件
Artifact 名称
```

## 未实现项

逐条说明：

```text
功能
原因
缺少的 CFSM API/字段
未来如果 CFSM 增加什么数据即可实现
```

不要含糊写“部分功能暂不支持”。

---

# 118. 最后原则

整个项目始终遵守以下优先级：

```text
数据真实性
>
CFSM 官方 API 兼容性
>
功能完整性
>
Glassmorphism 视觉还原度
>
开发便利性
```

但是在不存在数据冲突的情况下：

```text
Glassmorphism 原 UI 和功能
```

应尽可能完整保留。

不要因为移植工作量大而主动缩减功能。

不要因为某个功能难做就直接删除。

先研究，再适配，再降级。

---

# 119. 现在开始

现在直接开始在：

```text
allury/CFSM-Glassmorphism
```

当前本地工作区实施。

第一步：

1. 检查当前仓库状态
2. 获取并分析三个参考仓库以及 CFSM 官方 `src/frontend/`
3. 建立功能兼容矩阵
4. 初始化 Vue 3 + TypeScript + Vite + Bun 工程
5. 建立 GitHub Actions 自动构建
6. 开始数据层和 Glassmorphism 表现层移植

不要询问我是否继续下一阶段。

在能够自行根据源码、CFSM 官方文档、CFSM 官方前端和参考实现判断的地方，直接做最佳工程决策并继续。

不要因为任务规模大而只交付计划。

**实际修改代码并推进整个移植。**
