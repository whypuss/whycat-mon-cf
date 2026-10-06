# 视觉与响应式验证

## 第 15 轮 · v1.1.0：字体一致性与图表配色

逐项结论见 [`font-audit.md`](font-audit.md) 与 [`chart-parity.md`](chart-parity.md)，
这里只记录本轮新增、以后还会踩到的量测方法与陷阱。

### 判定「实际渲染字体」

CSS `font-family` 相同、`document.fonts.check` 通过，都**不等于**字形一样。
本轮用同一浏览器内的 Range 宽度指纹判定：把同一串文本分别用页面字体栈和
候选字族单独渲染再量宽度，宽度逐串相等才算同一字族。
实测中文 Windows 上 `system-ui` = 微软雅黑（与 `"Segoe UI"` / `sans-serif` / `Arial` 都不同）。
没有 DevTools「Rendered Fonts」面板时，这是可用的替代证据，但必须在报告里单列为证据缺口。

### 判定字重是否真的落在不同字面上

先用同样的方法测一遍字重台阶。本机（雅黑）只有 Regular 与 Bold：
`300 < 400 = 500 < 550 = 600 = 650 = 700 = 800`。
因此「600 写成 500」在这里是**肉眼可见**的粗细差，而「700 写成 720」没有任何差异。
换平台（有 Semibold 字面）结论会变，别把某一台机器的结论当成通用结论。

### canvas 内的东西只能读像素

ECharts 走 `CanvasRenderer`，画布里的折线、坐标轴文字、图例文字都不在 DOM 里，
`getComputedStyle` 完全看不到。读法是直接 `getImageData` 统计颜色分布，
按 alpha 区分实色与抗锯齿边缘（例如 `rgba(0,0,0,0.55)` 的峰值 alpha 是 140）。
这也是本轮定位「折线全黑」的唯一手段。

### Browser 面板隐藏时截图是空白

面板隐藏时 `computer{action:"screenshot"}` 返回整块背景色，看不出任何内容，
但 DOM 与画布都是正常的。此时不要用截图作为证据，改用
`read_page` / `get_page_text` / `getImageData`。

### 合成指针事件只能驱动一部分 zrender 交互

`pointermove` / `mousemove` 能触发 tooltip 与 emphasis 高亮（高亮色确实会变），
但 zrender 的**图例点击开关**在本轮没能被合成事件驱动。
这类交互要么用真实输入，要么在报告里如实标注为未验证。

## 第 13 轮 · v1.1.0-test.4：详情页两版逐项对照

基线 `72b9cce`（v1.1.0-test.3），上游 `bf83765`。启动方式与第 11 轮相同
（Komari mock API `25774` + Komari dev `4173` + CFSM 生产 `dist` `4181`）。

### 本轮新增的量测陷阱

除第 11 轮已记录的「resize 后要重新加载」「量测前 finish 动画」外，本轮再加一条：

> **Vite 产物的 `index.html` 会被浏览器缓存。** 改完样式重新 build 后，
> 必须用 hash 之前的查询参数（`/?cb=xxx#/server/...`）强制取新页面；
> 只改 hash 不会重新请求 `index.html`，会量到上一版 CSS。
> 本轮有两次量测因此得出了错误结论。

### 关于 Windows 上的 `bun run typecheck`

本轮还纠正了一个此前被误判的结论。之前几轮把 Windows 上 `vue-tsc` 报的四条
`Cannot find module './App.vue'` 记为「偶发环境问题、重试即可」。实际上它是
**稳定复现**的：Bun 在 Windows 下加载不了 Vue language plugin，vue-tsc 在分析任何
`.vue` 文件之前就停下，于是**所有 SFC 模板类型检查都被跳过**。

本轮据此漏掉了一个真实错误（详情页磁盘 IO 区仍在调用已从 import 中移除的
`formatSpeed`），本地全绿而 CI 的 Linux typecheck 直接失败。

正确做法：用仓库外的便携 Node 跑同一份检查

```bash
<portable-node>/node.exe node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json
```

它会真正分析模板。修好之后再推。禁止改 `package.json` / `bun.lock` / `tsconfig` / CI 绕过。

### 详情页六档几何

`nodes=10`、light、`财务` 预设。坐标 `[x, y, w, h]`。

| 视口 | 顶部导航 | 指标栅格 | 首个指标卡 | 信息栅格 | `clientWidth / scrollWidth` |
|---|---|---|---|---|---|
| 375×812 | h=72（两版同） | `163.5×2` | K 80 / C 82 | 单列 343 | 375 / 375 |
| 430×932 | h=72 | `191×2` | K 80 / C 82 | 单列 398 | 430 / 430 |
| 768×1024 | h=32 | `231.33×3` | 96（两版同） | 单列 726 | 758 / 758 |
| 1024×768 | h=32 | `316.66×3` | 96 | `483×2` | 1014 / 1014 |
| 1440×900 | h=32 | `300×4` | `[91,105,300,96]` | `616×2` | 1430 / 1430 |
| 1920×1080 | h=32 | `300×4` | `[331,105,300,96]` | `616×2` | 1910 / 1910 |

信息卡高度（硬件 / 系统 / 存储 / 网络）：375 档 K `209/300/104/110` vs C `207/296/104/110`；
768 与 1440 档除硬件 / 系统的 2px 外完全一致。

1024 档 Komari 的存储 / 网络卡比 CFSM 高 20px，原因是 fixture 数据不同
（Komari 样例节点双栈、两个 IP 徽章导致标题行折行；CFSM 样例节点只有 IPv6），
不是布局差异。

### 详情页表面实测

| 元素 | Komari | CFSM |
|---|---|---|
| 指标卡 / 信息卡 background | `--background` 50%（亮 `oklab(0.935 …/0.5)` / 暗 `oklab(0.141 …/0.5)`） | 同 |
| 指标卡 / 信息卡 border / radius / shadow / backdrop | `0px none` / `8px` / `none` / `none` | 同 |
| 信息格 background / radius / padding | `rgb(255 255 255 /.15)`（暗 `/.05`） / `6px` / `8px` | 同 |
| 卡片头部 padding / 标题 | `8px 12px` / 16px / 500 | 同 |
| 历史图表卡 | 与指标卡同源 | 同 |

### 详情页交互与状态

| 场景 | 结果 |
|---|---|
| 首页 → 详情 | `#/server/<id>?source=<owning base>` ✅ |
| 上一台 / 下一台 / 选择器 | 均切到正确节点并保留 `source` ✅ |
| 收藏 | 星标切换生效 ✅ |
| 分区 Tab（`nodeDetailSectionTabsEnabled`） | 概览 / 负载 / 延迟 各自只渲染对应区块；负载得到 CPU 与内存历史图，延迟得到探针卡 + Ping / 丢包历史图 ✅ |
| 详情 → 首页 | 分组「海外节点」、快捷筛选、视图模式与滚动位置 555 → 0 → 555 全部恢复 ✅ |
| `detailStatus=503` | 「服务暂不可用 · HTTP 503 · temporarilyUnavailable」，无白屏 ✅ |
| 非法 server id | 「节点不存在 · HTTP 404」 ✅ |
| `historyStatus=409` | 「历史数据库需要升级 · databaseUpgradeRequired」，不用 mock 顶替 ✅ |
| `sparse=1` | 探针字段整体缺失时面板隐藏，不渲染 0 值柱 ✅ |
| 暗色 | 三层表面与上游逐字一致 ✅ |
| console | 干净标签页加载详情页无任何 console 输出 ✅ |

## 第 11 轮 · v1.1.0-test.3：两版逐项 `getComputedStyle` 对照

基线 `f63740b`（v1.1.0-test.2），上游 `bf83765`。两套 localhost 同时运行：

| 角色 | 启动方式 | 地址 |
|---|---|---|
| Komari mock API | `bun work/komari-visual-server.mjs 25774` | `127.0.0.1:25774` |
| Komari 前端 | `work/round10-komari` 下 `bun run dev -- --host 127.0.0.1 --port 4173` | `127.0.0.1:4173` |
| CFSM 生产 `dist` | `bun work/visual-server.mjs 4181` | `127.0.0.1:4181` |

两版都支持 `nodes=0\|1\|10\|30\|64`、`theme=light\|dark`、
`renderer=realistic\|cobe\|tiled`、`view=card\|list`、
`card=mini\|compact\|comfortable\|large`、`earth=hidden`、`tools=hidden`、`sparse=1`，
CFSM 另有 `serversStatus` / `detailStatus` / `configStatus` 错误码参数。

### 两个必须记住的量测陷阱

1. **resize 之后不要立刻读值。** 上游卡片带 `transition-all`，改宽度后 `backdrop-filter`
   会停在旧值。第一次量到"桌面总览卡也有 `blur(8px)`"就是这个原因；
   在目标宽度重新加载后，实测是 `none`。
2. **浏览器面板隐藏时 CSS 动画不推进。** CFSM 节点卡入场动画是
   `animation-fill-mode: backwards`，页面不可见时停在 `from`
   （`scale(0.988) translateY(10px)`），量出的宽度会小 ~3.6px、y 偏低 12px。
   量测前先执行 `document.getAnimations().forEach(a => a.finish())`。

### 表面与令牌（1440×900 干净加载）

| 元素 | 属性 | Komari 实测 | CFSM 实测 |
|---|---|---|---|
| 总览卡片 | background | `oklab(0.935 -0.00463525 -0.0142658 / 0.5)` | 同 |
| 总览卡片 | border / radius / shadow | `0px none` / `10px` / `none` | 同 |
| 总览卡片 | backdrop-filter（桌面 / 窄屏） | `none` / `blur(8px)` | 同 |
| 总览卡片 | 内容 padding | `12px` | 同 |
| 总览卡片（暗色） | background | `oklab(0.141 0.00136333 -0.00481054 / 0.5)` | 同 |
| 节点卡片 | background | `rgba(241, 245, 249, 0.74)` | 同 |
| 节点卡片 | border | `1px solid rgba(203, 213, 225, 0.6)` | 同 |
| 节点卡片 | radius | `14px` | 同 |
| 节点卡片 | box-shadow | `rgba(15, 23, 42, 0.18) 0px 8px 28px` | 同 |
| 节点卡片 | backdrop-filter | `blur(14px) saturate(1.45)` | 同 |
| 节点卡片（暗色） | background / border / shadow | `rgba(13,17,26,.85)` / `rgba(255,255,255,.18)` / `rgba(0,0,0,.48) 0 8px 30px` | 同 |

### 六档视口几何

坐标为 `[x, y, w, h]`，`nodes=10`、light、realistic、compact。

| 视口 | 总览区 | 地球 | 总览卡 | 首个节点卡 | 卡片列数 | `clientWidth / scrollWidth` |
|---|---|---|---|---|---:|---|
| 375×812 | `[0,57,375,391]` | `[16,81,343,343]` | `109×80` | K `[16,536,343,331.81]` / C `[16,536,343,333.75]` | 1 | 375 / 375 |
| 430×932 | `[0,57,430,446]` | `[16,81,398,398]` | `127.33×80` | K `[16,591,398,331.81]` / C `[16,591,398,333.75]` | 1 | 430 / 430 |
| 768×1024 | `[0,57,758,232]` | `[383,69,359,359]` | `114.33×96` | K `[16,377,357,331.81]` / C `[16,377,357,333.75]` | 2 | 758 / 758 |
| 1024×768 | `[0,57,1014,232]` | `[531,69,448,448]` | `157×96` | K `[16,377,319.33,…]` / C 同宽 | 3 | 1014 / 1014 |
| 1440×900 | `[75,57,1280,232]` | `[805,69,448,448]` | `201.33×96` | K `[91,337,303,331.81]` / C `[91,337,303,333.75]` | 4 | 1430 / 1430 |
| 1920×1080 | `[315,57,1280,232]` | `[1045,69,448,448]` | `201.33×96` | K `[331,337,303,331.81]` / C `[331,337,303,333.75]` | 4 | 1910 / 1910 |

除节点卡高度的 1.94px 外，六档下总览区、地球、总览卡与节点卡的坐标、宽度、
栅格列宽在两版之间完全一致（含 `201.328px / 201.344px` 这样的舍入位）。
`earth=hidden` 时两版总览均为窄屏 3 列、≥768px 6 列，1440 下单卡 `201.33×112`、起点 `x=91`。

### tiled 渲染器

| 视口 | 项目 | Komari | CFSM |
|---|---|---|---|
| 375×812 | 总览区 / 地图 / 卡片 | `[0,57,375,640]` / `[12,358,351,327]` / `171.5×76`（两张一行） | 同 |
| 1920×1080 | 总览区 / 地图 / 卡片 | `[315,57,1280,689.59]` / `[331,283,1248,448]` / `303×92.8`（四张一行） | 同 |

### 文本格式对照（同一档数据）

| 位置 | Komari | CFSM |
|---|---|---|
| 总览「内存用量」 | `6.7` + `GB / 23.0 GB` | `42.0` + `GB / 80.0 GB`（同结构） |
| 总览「累计流量」 | `5.75` + `TB` | `2.15` + `TB` |
| 总览「实时上行 / 下行」 | `2.4` + `MB/s` | `5.7` + `MB/s` |
| 节点卡运行芯片 | `在线 3 天` | `在线 2 天` |
| 节点卡价格芯片 | `USD9.9 / 年` | `免费` / `USD18 / 年` |
| 节点卡内存副行 | `286.7 MB / 1.0 GB` | `2.2 GB / 8.0 GB` |
| 节点卡速率 | `18 KB/s` | `430 KB/s` |
| 列表速率列 | `↑ … ↓ …` | `↑ 430 KB/s` / `↓ 1.2 MB/s` |
| 列表运行时间列 | `2 天 3 小时`（hour 精度） | `2 天 0 小时` |

### 快捷控制

两版实测都是六项，顺序一致：收藏 / 总流量 / 峰值 / 离线 / 高负载 / 即将到期。
CFSM 另有「高级工具」开关（平台扩展，记为必要差异）。

### 状态、数据量与交互

| 场景 | 结果 |
|---|---|
| `nodes=0` | 真实空状态「暂无节点 · CFSM 返回了空服务器列表」，无溢出 |
| `nodes=1 / 10 / 30 / 64` | 分别渲染 1 / 10 / 30 / 64 张卡片，64 张时无 console error，`scrollHeight` 6370 |
| `theme=dark` | 总览卡与节点卡计算值与上游逐字一致 |
| `view=list` | 十列表头 `40 44 202.25 261.75 116 100 100 100 104 88`，行高 64px，30 行 |
| `card=mini / compact / large` | 单卡 `303×231.41` / `303×333.75` / `614×333.75`，列数 4 / 4 / 2 |
| `renderer=cobe` | canvas 448×448，无 console error |
| `tools=hidden` | 高级工具面板与入口按钮同时消失 |
| `sparse=1` | 探测字段整体缺失时面板隐藏，不渲染 0 值柱 |
| 0% 丢包 | 4 根 `is-signal-1` 满高柱，`is-empty` 为 0 |
| 超长名称 | 名称层 `clientWidth 198 / scrollWidth 550`，省略号截断，卡片不横向溢出 |
| 14 个标签 | 标签换行，卡片高度 362.25px，无溢出 |
| 离线节点 | `.node-card--offline` 与离线遮罩同时存在 |
| `serversStatus=401 / 503` | 分别显示 `unauthorized（HTTP 401）` / `temporarilyUnavailable（HTTP 503）` 与重新加载入口，无白屏 |
| 分组切换 | 「亚太边缘」→ 2 台、「海外节点」→ 10 台 |
| 搜索 | 折叠搜索框展开后输入「边缘」→ 22 台，ESC 清空回到 30 台 |
| 快捷筛选 | 离线 → 4 台，再次点击复原 30 台 |
| 收藏 | 点击星标后「切换到收藏节点」计数变为 1 台 |
| 视图切换 | 卡片 30 张 ↔ 列表 30 行 |
| 详情直达 | 点击卡片进入 `#/server/visual-node-38?source=http://127.0.0.1:4181`，owning source 正确 |
| 返回恢复 | 返回后分组、快捷筛选、视图模式全部保留；滚动位置 1400 → 详情 0 → 返回 1400 |

> 交互脚本用 `pointerdown/mousedown/pointerup/mouseup/click` 完整序列触发，
> 因为 reka-ui 的 Tabs 只监听指针序列，单独 `element.click()` 不会切换标签。
> 这是量测手段问题，不是主题缺陷。

## 第 11 轮补充回归（v1.1.0-test.2）：隐藏 Earth 与手机节点卡片

针对 `v1.1.0-test.1` 实机截图暴露的两个问题，本次重新在只读 Komari localhost 与
CFSM 生产 `dist` localhost 中读取计算样式和 DOM 几何，不以源码断言代替浏览器结果。

- **Earth 隐藏态**：Komari 实际使用带 16px 内边距的独立网格，移动端 3 列、
  768px 起 6 列，卡片均 `span 1`。CFSM 修复前的单列父网格因子区 `span 12`
  生成了 11 个隐式列；修复后 1440px 下 6 列计算宽度为
  201.33 / 201.34px，五张实际卡片宽度差仅 0.01px 舍入。
- **手机底部三列**：不再显示完整 ISO 日期，改为上游的「剩余 N 天 / 已过期 /
  长期 / —」和短金额行；速率、流量、金额都有独立的最小宽度与省略层。
  375px 下三列各 97px，430px 下各约 115.33px；截图场景中所有五条文本的
  `scrollWidth` 均不大于 `clientWidth`。
- **六档回归**：375 / 430 / 768 / 1024 / 1440 / 1920 全部保持三个底部信息框，
  页面 `scrollWidth <= clientWidth`；隐藏 Earth 的总览卡片宽度差为 0–0.01px。

本次仅修正两个截图已证实的首页偏差；Ping 柱、节点卡片主结构、点击路径、
Earth renderer 和数据/协议层均未改动。

## 第 10 轮：双版本 localhost 最终验证

第 10 轮补上了此前没有完成的真实双版本浏览器对照：只读 Komari v3.3.7（`bf83765`）运行在 localhost，当前 CFSM 主题以生产 `dist` 运行在另一个 localhost；两者使用等价的本地监控场景。测试 fixture 与服务脚本只在被 Git 忽略的 `work/` 中，不进入源码、测试包或发布 ZIP。审计不是只读源码：每档都实际打开两个页面，观察渲染结果，读取计算后 DOM 几何与列数，操作交互，并检查 console error 与页面级横向溢出。

### 首页六档矩阵

| 视口 | Komari / CFSM 共同终态 | 节点列数 | 控制区 | 结果 |
|---:|---|---:|---:|---|
| 375 × 812 | Header 57px；Earth/总览自 y=57 开始；内容左右 16px | 1 | 72px 高 | 无页面溢出、无 console error |
| 430 × 932 | Header 57px；移动端总览高度随宽度展开 | 1 | 72px 高 | 无页面溢出、无 console error |
| 768 × 1024 | Header 57px；总览 232px | 2 | 72px 高 | 无页面溢出、无 console error |
| 1024 × 768 | Header 57px；总览 232px；内容左右 16px | 3 | 72px 高 | 无页面溢出、无 console error |
| 1440 × 900 | 1280px 总宽居中；总览 232px | 4 | 32px 高 | 无页面溢出、无 console error |
| 1920 × 1080 | 1280px 总宽居中；总览 232px | 4 | 32px 高 | 无页面溢出、无 console error |

首页实测后收敛了 Header（57px 高、32px logo、桌面状态区和移动端隐藏策略）、1280px 外层与 16px 内容内边距、筛选/搜索/视图控制条、扁平节点层级，以及 mini/compact/comfortable/large 的 270/300/360/420px 最小列宽。四种卡片模式在相同数据下与 Komari 的单卡高度差为 0～3px；这一余量归入已有的细粒度 P2 shadow/blur/排版实现差异。高级工具能力保留，但默认不占首页层级，只有点击 Header 工具按钮后才出现。

列表模式另行在 375 与 1440 验证：行高均为 64px，十列计算宽度契约一致。窄屏横向滚动只发生在列表容器内，文档本身不溢出；桌面首行宽度与 1280px 内容容器对齐。

### 详情页与 History

| 视口 | 资源卡列数（Komari / CFSM） | 信息卡列数（Komari / CFSM） | 结果 |
|---:|---:|---:|---|
| 375 × 812 | 2 / 2 | 1 / 1 | 无页面溢出、无 console error |
| 430 × 932 | 2 / 2 | 1 / 1 | 无页面溢出、无 console error |
| 768 × 1024 | 3 / 3 | 1 / 1 | 无页面溢出、无 console error |
| 1024 × 768 | 3 / 3 | 2 / 2 | 无页面溢出、无 console error |
| 1440 × 900 | 4 / 4 | 2 / 2 | 无页面溢出、无 console error |
| 1920 × 1080 | 4 / 4 | 2 / 2 | 无页面溢出、无 console error |

详情页复用与首页一致的 Header，顶部仍保持返回 / 旗帜 + 名称 / 状态和标签 / 收藏与上下节点工具条；信息区顺序为硬件、系统、存储、网络。CFSM 真实提供且 Komari 对照场景没有同构位置的 probe、GPU、磁盘 IO 与 History 继续显示在后续区块，这属于真实数据内容扩展，不改变上述主层级。History 成功态实测 4 个 ECharts canvas；旧 CT/CU/CM/BD 和 Node 1～4 同时出现，`number` 显示数值，`null` 显示超时，`false` 隐藏或标记未配置，图表保持缺口。

### 状态与交互矩阵

| 场景 | 实际浏览器结果 |
|---|---|
| light / dark / beijing | 三种模式均可见且无 console error；北京时间模式按测试时刻解析到正确明暗主题 |
| realistic / cobe / tiled | 分别加载 `globe.gl`、cobe canvas 与 tiled SVG/贴图；移动 tiled 无页面级溢出 |
| advanced tools | 默认隐藏；点击 Header 工具按钮后显示 4 个标签页，按钮 `aria-pressed=true` |
| 0 / 10 / 64 节点 | 空状态真实；常规和 dense 集合列数稳定，无页面溢出或 console error |
| partial source / 503 / all offline | 保留可用来源或最后真实快照，并显示明确状态，不伪造成功数据 |
| 详情 401 / 403 / 503 | 分别显示登录授权、访问拒绝/Turnstile、服务不可用语义，不生成占位节点 |
| History 空 / 401 / 409 / 503 | 空状态明确不造趋势；鉴权、数据库升级与服务错误分类正确 |
| 首页 → 详情 → 返回 | 卡片和列表均直达详情；返回恢复会话筛选和浏览器滚动位置 |

最终浏览器审计没有发现需要改写第 4.5～9 轮数据/协议底座的问题。结构回归已同步到 `tests/fidelity-contract.test.ts` 和 `tests/responsive-contract.test.ts`；完整差异终态见 `docs/fidelity-audit.md`。

## 第 9.95 轮：详情页、History 与 UI 基元

第 9.95 轮当时以源码对照和契约测试清零 `docs/fidelity-audit.md` 中剩余的三个 P1，并未完成 Komari localhost 与 CFSM localhost 的并排浏览器复验。第 10 轮已补做真实浏览器对照，并据此继续修正 Header、详情信息卡和响应式断点；本节仅记录第 9.95 轮当时的验证范围。

- **History 图表**：改用上游同款 `echarts` + `vue-echarts`。契约测试断言使用 `VChart` + `autoresize`、只注册用到的 ECharts 组件、且旧手写 SVG 折线实现（`pathSegments`、固定 `viewBox`）不再存在。数据真实性由 `connectNulls: false` 与「只有真实数值进入 series」两条断言锁定：超时与缺失形成断点，不补 0、不插值；九种 `hours` 与 401 / 409 / 503 / 空 / 网络状态处理保持不变。
- **详情页层级**：顶部为 Komari 的导航条——返回、地区旗帜 + 名称、在线徽章、标签徽章、收藏与上一台 / 选择 / 下一台。契约测试断言 CFSM 自创的 `detail-hero` 与 "SERVER DETAIL" 文案已消失，且节点导航复用 `serverStore.servers` 并携带 owning `source`。
- **UI 基元与弹层**：Tooltip 走 `reka-ui` 的 `TooltipProvider / Portal`（真实 portal、碰撞翻转、ESC 与焦点行为），Tabs 走 `TabsRoot / List / Trigger`（roving focus 与方向键导航），Badge 走 `Primitive`；瞬时提示走 `vue-sonner`，`AppToaster` 在 `App.vue` 挂载一次。契约测试同时断言两处标签区不再手写 `role="tablist"`，设置页瞬时反馈不再常驻页面。
- **体积门槛**：引入 ECharts 与 UI 基元后 `validate:dist` 预算上调为 JS 3328 KiB / CSS 128 KiB / 总资源 6656 KiB，仍为硬门槛；ECharts 随详情页分块懒加载，未进入首页初始包。
- **死代码**：旧 SVG 折线样式、旧 tooltip 定位样式、`detail-hero*` 与 `.settings-save-alert.is-success` 均已删除。

## 第 9.9 轮：表现层深度收敛

第 9.9 轮继续以 Komari v3.3.7（`bf83765`）源码为权威基准，逐项终态见 `docs/fidelity-audit.md`。

- **总览卡片**：无独立标题区，12 栅格 `span 4`；`tests/fidelity-contract.test.ts` 锁定卡片解剖与栅格契约。
- **节点卡片**：状态点 + 名称 / 收藏 + OS + 旗帜 / 芯片 / 四项进度 / 三列指标盒 / 延迟丢包面板 / 标签 / 离线遮罩，区块顺序由契约测试锁定；mini / compact / comfortable / large 与 dense 集合渲染继续生效。
- **节点列表**：十列栅格契约（状态 / 系统 / 节点 / 信息 / 运行时间 / CPU / 内存 / 硬盘 / 流量 / 速率），行高 64px；窄屏保留列结构并允许容器横向滚动，不再拆成堆叠卡片。
- **图标**：全部字符占位替换为同名 Tabler / IconPark 图标；`AppIcon` 不含任何网络请求，契约测试断言不出现 `api.iconify.design`。
- **响应式**：第 9.9 轮仅由 `tests/responsive-contract.test.ts` 对 375 / 430 / 768 / 1024 / 1440 / 1920 六档做源码契约锁定，当时没有进行双版本浏览器并排实测；真实复验与随后修正的结论以本文件第 10 轮章节为准。契约同时确保 `.quick-view*` 与旧 SVG 地图样式不再进入产物。
- **视觉 token**：卡片 12px、列表行与指标盒 8px 圆角，指标网格 16/10px，芯片 11px——按 Komari 的 Tailwind 尺度校准。

第 9.95 轮已把历史图表、详情页信息层级与 UI 基元全部对齐上游，详见下节。

## 第 9.5 轮：高保真收敛

第 9.5 轮以原 Komari Glassmorphism（`bf83765`，v3.3.7）源码为唯一权威基准做表现层收敛，逐项差异见 `docs/fidelity-audit.md`。

已恢复并锁定的 Komari 真实行为：

- **Earth 三套渲染器互不退化**：realistic 走 `globe.gl` + `three`（原贴图、bump/specular、atmosphere、点与环、四光源、自转与阻尼、resize、可见性暂停），cobe 走真实 `cobe`（RAF、指针拖拽、theta 钳制、静态重绘窗口、标签球面投影），tiled 为独立渲染器（真实贴图三层叠加、等距投影、图例四级密度、移动端横向滚动）。`tests/fidelity-contract.test.ts` 断言三者不得含手绘 SVG 剪影、不得互相复用。
- **Earth 与总览同栅格**：桌面球体右半 / 卡片左半同一行，移动端卡片负边距上移叠加，tiled 改为卡片在上、地图在下；由 `general-stage` 样式与契约测试锁定。
- **主点击路径**：节点卡片与列表行点击直达 `/#/server/:id`（携带 owning `source`），`ServerQuickView` 强制中间层已删除；收藏等独立控件仍 `stopPropagation`，不触发导航。
- **首页往返**：`首页 → 详情 → 返回首页`保持搜索、分组、排序与快捷筛选，并由路由 `savedPosition` 恢复滚动位置，无需刷新。
- **旗帜**：使用 CFSM 默认皮肤的 `/flags/<code>.svg`（小写），缺失时静默隐藏，不打包进主题。

响应式与产物：六档断点结构仍由 `tests/responsive-contract.test.ts` 锁定；三个渲染器沿用 Komari 自身的断点与移动端行为（tiled 在 640px 以下保留 `min-width: 42rem` 的横向滚动容器，滚动被限制在地图容器内，不产生页面级横向溢出）。`bun run validate:dist` 实测 2281.6 KiB JS、78.8 KiB CSS、5275.8 KiB 总资源，dist 根仅 `index.html` 与 `assets/`。

未完成项（不得视为已对齐）：总览卡片结构与财务明细弹窗、NodeCard/NodeList 内部 DOM、echarts 图表族、详情页信息层级、图标体系与 UI 基元、间距/圆角/阴影逐项校准、`.quick-view*` 死 CSS 清理 —— 均记录在 `docs/fidelity-audit.md`。

## 第 9 轮复验

第 9 轮为性能、稳定性与异常收敛，未改动首页布局、Header/Footer、节点卡片结构、Card/List 点击路径、详情视觉结构、Earth/Map 渲染方式、弹窗/抽屉与主要动画；`shallowRef`、`createGlassServerMapper()` WeakMap 缓存、`v-memo` 与预计算动画延迟均只降低重算开销，不改变可见 DOM 结构或渲染输出，因此不存在需要更新的截图/像素基线。

- 375、430、768、1024、1440、1920 六档响应式结构由 `tests/responsive-contract.test.ts` 以源码断言锁定，本轮全部通过；无页面级横向溢出策略保持不变。
- 首页大规模节点行为由 `tests/performance-contract.test.ts` 锁定：视图与逐节点组件不得出现 `fetch`/`setInterval`/`setTimeout`，`HomeView` 不引用 `fetchHistory`，列表保留 `v-memo` 与 `.server-grid--dense` 的 `content-visibility: auto`，路由保持 3 处懒加载 `import()`，运行时依赖仅 `pinia`/`vue`/`vue-router`。
- 50+/64 节点首页加载经 `tests/api.test.ts`、`tests/dashboard.test.ts` 与 `tests/glassmorphism-adapter.test.ts` 核验：单次 `/api/servers`、无逐节点详情/历史请求，实时更新仅重算发生变化的节点视图模型。
- WebSocket 断连、503、重连风暴、可见性 hide/show 与历史陈旧响应/并发切换由 `tests/websocket.test.ts`、`tests/http.test.ts`、`tests/dashboard-realtime.test.ts`、`tests/detail-realtime.test.ts` 及详情 store 的控件禁用 + `revision`/AbortController 覆盖，行为稳定，无运行时异常。
- 本轮未发现由第 9 轮改动引入的视觉回归；与原 Komari Glassmorphism 的高保真差异（若有）仅记录、留待第 9.5 轮。

## 第 8 轮复验

第 8 轮继续以生产构建和只监听 `127.0.0.1` 的 CFSM 形状测试服务验证。本地场景覆盖 10 台节点、5 个明确 region、长名称、大量 tags、离线/高负载、两种付费币种和免费节点；测试数据只位于 Git 忽略的 `work/`，不进入产品源码或构建产物。

- realistic、cobe、tiled 三种渲染均逐一切换；国家/地区聚合标记、在线计数和“非精确位置”说明保持可见。
- 健康摘要展示当前指标与 `/api/servers` Ping/Loss 窗口覆盖；性价比将 CNY 与 USD 分组，免费节点明确排除；快照页只提供当前 JSON/CSV；拓扑只展示 region → group → tags 分类；Audit Log 明确隐藏。
- 375、430、768、1024、1440、1920 六个宽度均读取实际页面几何；`documentElement.scrollWidth` 与 `body.scrollWidth` 均不大于 `documentElement.clientWidth`，没有页面级横向溢出。
- 375px 下 Earth 地区列表、两列总览、高级工具标签和健康卡片按移动端规则收缩；768px 及以上恢复横向工具标签和紧凑数据表。设置页的 renderer、隐藏/停止 Earth、高级工具与导出口令控件均可即时预览。

## 第 7 轮复验

第 7 轮对生产构建启动本地 CFSM 形状测试服务，只访问 `127.0.0.1`。六档视口均读取实际 DOM 几何并检查 `documentElement.scrollWidth <= innerWidth`；结果全部无页面级横向溢出。浏览器控制台无 warning/error。

| 视口 | 总览列数 | 节点布局 | 快捷控制 | 结果 |
|---:|---:|---|---|---|
| 375 × 812 | 2 | card 单列 | 横向可滚动 | 长名称截断、大量 tags 有界，无页面溢出 |
| 430 × 932 | 2 | mini 两列 | 横向可滚动 | 底部抽屉左右贴边、底部贴合视口 |
| 768 × 900 | 3 | list 两列移动网格行 | 完整显示 | 表格转换正常，无页面溢出 |
| 1024 × 900 | 3 | card 两列 | 完整显示 | 无页面溢出 |
| 1440 × 1000 | 6 | card 三列 | 完整显示 | 内容受最大宽度约束 |
| 1920 × 1080 | 6 | card 三列 | 完整显示 | 内容受最大宽度约束 |

设置页另在 375px 与 1024px 复验：375px 的主布局、字段组和持久化面板均为单列；1024px 恢复双列 hero 与“设置 + 保存”布局。10 个 select、6 个 textarea 均在窄屏保持容器内宽度。`tests/responsive-contract.test.ts` 同步锁定 Header/Card/List/Detail/Chart/Settings/Modal 相关断点和 overflow 策略。

## 第 3 轮基线

## 方法与边界

验证对象为生产构建产物。测试服务器只存在于被 Git 忽略的 `work/` 目录，按 CFSM `/api/config` 与 `/api/servers` 的真实响应形状生成本地场景；生产源码、提交内容与构建包均不包含 mock 数据。所有数值、可达性、元数据和在线状态均经过正式 transport、adapter、store 与 UI 链路。

## 响应式矩阵

| 视口 | 节点数 | 视图 | 结果 |
|---:|---:|---|---|
| 375 × 812 | 30 | card | 单列卡片，无横向溢出；页头、总览、筛选和指标保持可用 |
| 430 × 932 | 30 | mini | 两列迷你卡片，无横向溢出 |
| 768 × 900 | 10 | list | 桌面表格转换为移动网格行，无横向溢出 |
| 1024 × 900 | 10 | compact | 三列紧凑卡片，无横向溢出 |
| 1440 × 1000 | 30 | card | 四列卡片、三组分区，无横向溢出 |
| 1920 × 1080 | 30 | card | 内容最大宽度 1280px、四列卡片，无横向溢出 |

另行检查了 0、1、10、30 台节点：0 台显示真实空状态和不可用汇总；1 台只生成一个节点与一个分组；10/30 台数量、分组及布局均与响应一致。长服务器名使用截断和 tooltip，14 个标签不会撑破卡片，30 台场景启用密集集合渲染优化。

## 交互检查

- card、compact、mini、list 四种布局可切换。
- 多词搜索只返回同时匹配所有词的真实节点。
- 收藏使用 source+id 稳定键；收藏数量、收藏筛选和刷新后持久化正常。
- 离线置底保留当前排序语义，刷新后持久化正常。
- system、light、dark 循环切换正常，刷新后保留显式主题选择。
- 点击节点打开当前 REST 快照；桌面模态框、移动端底部抽屉、背景关闭与 Escape 关闭正常。
- 明暗背景、玻璃层次、在线脉冲、离线警示、资源告警色与 reduced-motion 规则均保留非颜色信息。
- 浏览器控制台没有 warning 或 error。

375px 初验发现页头最右侧 tooltip 的隐藏气泡扩大了文档宽度；气泡改为右对齐后复验通过。
