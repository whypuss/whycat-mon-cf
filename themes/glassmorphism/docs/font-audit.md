# 字体一致性专项验收（第 15 轮）

| 对象 | 版本 / 位置 |
|---|---|
| Komari Glassmorphism 基准 | `bf8376587c720de915ac48789a8a180357c762d6`（v3.3.7） |
| 本轮起点 | `v1.1.0-test.5` / `961a4edb1683e72b6bd615e3d0b8c69783d4eccc` |
| 对照环境 | Komari：`work/round10-komari` 的 Vite dev server（`127.0.0.1:4173`）+ mock API（`127.0.0.1:25774`）；CFSM：本仓库生产构建（`127.0.0.1:4181`） |
| 浏览器 | 同一实例的两个标签页，Chrome / Windows / zh-CN，缩放 100%，`devicePixelRatio = 1` |
| 采样时机 | `await document.fonts.ready` 后 + `document.getAnimations().forEach(a => a.finish())` |

`work/round10-komari/src` 与只读克隆 `work/upstreams/komari-theme-Glassmorphism/src` 逐文件 diff 为空，
因此 dev server 跑的就是基准 commit 的源码。

## 实际渲染字体：先回答「是不是同一个字」

两边页面的 `font-family` 计算值分别是：

- Komari：`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- CFSM（修复前）：`system-ui, -apple-system, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif`

用 Range 宽度指纹判定实际落到哪个字族（同一浏览器内逐个字族单独测量，同串对比）：

| 字族 | `Glassmorphism 0123456789` | `香港边缘计算节点` | `455.0 102.9 GB` | `€63.39 ¥123456.78 0% 16%` |
|---|---|---|---|---|
| 页面字体栈（两版一致） | 189.33 | 112 | 99.91 | 183.66 |
| `system-ui` | **189.33** | **112** | **99.91** | **183.66** |
| `"Microsoft YaHei"` | **189.33** | **112** | **99.91** | **183.66** |
| `"Segoe UI"` | 173.98 | 112 | 91.75 | 168.80 |
| `sans-serif` | 182.88 | 112 | 95.06 | 175.08 |
| `Arial` | 179 | 112 | 98.08 | 176.72 |

结论：中文 Windows 上 `system-ui` **就是**微软雅黑，宽度与 `"Microsoft YaHei"` 逐串相等，
与 `"Segoe UI"` / `sans-serif` / `Arial` 都不同。因此：

- 拉丁字母、数字、`€` / `¥` / `%` 与中文**全部由同一个字族（微软雅黑）绘制**，没有分裂到不同 fallback；
- CFSM 多写的那个 `"Microsoft YaHei"` 永远轮不到，本机上 **0 渲染差异**；
- 但在 `system-ui` 不是雅黑的系统（例如英文 Windows）上，上游会落到 `sans-serif`、
  本主题会落到雅黑，两者会分叉。按「上游令牌逐字照抄」已删除该项。

> **证据缺口（单列）**：本轮没有 DevTools「Rendered Fonts」面板可用，实际字形归属是用
> 同浏览器内的 Range 宽度指纹判定的，不是平台字体 API。结论对本机成立；
> 换平台需重测。`document.fonts.size` 为 0（两版都不加载任何网络字体），
> 无字体资源 URL、无 CORS / 解码错误、无 FOUT/FOIT——两版首屏都不存在字体切换闪烁。

## 全局字体令牌

| 属性 | Komari | CFSM 修复前 | 本机渲染差异 | 处置 |
|---|---|---|---|---|
| `font-family` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | 多一个 `"Microsoft YaHei"` | 无（见上表） | **已改为逐字照抄** |
| `font-synthesis` | 默认 `weight style small-caps` | `none` | 无（雅黑有真实 Bold 字面，700 权重宽度 199.33 = 199.33） | **已删除** |
| `text-rendering` | `auto` | `optimizeLegibility` | 无（Chrome 下等价，宽度 199.33 = 199.33） | **已删除** |

后两项来自 Vite Vue 模板的默认样式，上游没有。删除后两版 `html` 的计算值完全一致。

## 字重：本机只有 Regular 与 Bold 两档

同一字体栈下逐档实测宽度（12px，`17.0% 香港 Glass`）：

| 声明字重 | 300 | 400 | 500 | 550 | 600 | 650 | 680 | 700 | 720 | 800 |
|---|---|---|---|---|---|---|---|---|---|---|
| 渲染宽度 | 89.69 | 95.64 | **95.64** | 99.47 | **99.47** | 99.47 | 99.47 | 99.47 | 99.47 | 99.47 |

即 **500 落到 Regular、≥550 落到 Bold**，中间没有 Semibold 实体字面。
所以「600 而不是 500」不是纸面差异，而是整列数字直接变粗。

### 确认并修复的字重 / 字号差异

| ID | 组件 | Komari | CFSM 修复前 | 实测影响 | 处置 |
|---|---|---|---|---|---|
| F-01 | 首页节点卡指标数值 `.node-metric__value` | `tabular-nums font-medium` = 12px / **500** | 12px / **600** | 12px「17.0%」36.8px（Bold）对 34.68px（Regular） | 改 500 |
| F-02 | 首页延迟 / 丢包面板数值 `.node-probe__value` | `<span class="font-medium">` = 11px / **500**，**无** `tabular-nums` | 11px / **600** + `tabular-nums` | 11px「21.0 ms」43.01px 对 40.66px；`tabular-nums` 在该字族下 0 宽度差 | 改 500，去掉 `tabular-nums` |
| F-03 | 详情页徽章 `.app-badge` | `h-5 … px-2 py-0.5 text-xs font-medium` = **12px / 500 / lh 16px**，高 20px | **11px / 600 / lh 1.5**，高 20.5px | 「在线」22px（11/Bold）对 24px（12/Regular）；徽章高 20.5 → **20**，与上游 `h-5` 相等 | 改 12px / 500 / 16px |
| F-04 | 站点名 `.brand__copy strong` | `m-0 text-lg font-semibold` = 18px / **600** / 字距 normal | 18px / **720** / `-0.015em` | 本机同为 Bold（宽度 196.55 = 196.55），带 Semibold 字面的系统会粗一档；字距差 −0.27px | 改 600，去掉负字距 |
| F-05 | 详情分区标题 `.detail-section__header h2` / `.history-chart h3` | `text-base font-semibold` = 16px / **600** / 字距 normal | `h2` 默认 700 / `-0.025em` | 同上，本机同为 Bold；字距差 −0.4px | 改 600，去掉负字距 |
| F-06 | 历史图表 tooltip（canvas 外的 HTML 气泡） | `MetricSeriesChartCard` `textStyle: { fontSize: 12 }` | `fontSize: 11` | 字号小 1px | 改 12 |

修复后 1440 实测：`.node-metric__value` = 12px/500/tabular-nums，`.node-probe__value` = 11px/500/normal，
`.app-badge` = 12px/500/16px 且高 20px，`.brand__copy strong` = 18px/600/normal，
`.detail-section__header h2` = 16px/600/normal。

## 已量化但**未修复**的差异：line-height 与其补偿

CFSM 在多处用 `line-height: normal`，上游是 Tailwind 的具体值：

| 字号 | Komari | CFSM | 单行差 |
|---|---|---|---|
| 12px（总览标签 / 单位 / 指标标签） | 16px | `normal`（≈15） | −1px |
| 14px（节点名 / 详情信息行） | 20px | `normal`（17.5） | −2.5px |
| 11px（提示文本） | 15.7143px | `normal`（14） | −1.7px |
| 16px / 18px（标题） | 24px / 28px | `normal` | −1 ~ −2px |

**为什么本轮不动它**：这些偏小的行高被本主题更大的内边距与 gap 抵消了。
1440 实测节点卡高度：Komari `331.81`、CFSM `333.77`。
把上述行高逐项注入 CFSM 后再测，卡高变成 `335.34`——误差从 1.96px 扩大到 3.53px，
即**单独对齐行高会让容器几何离上游更远**。要正确处理必须连同 padding / gap 一起
从上游重新推导整张卡的盒模型，那是重做第 11 / 13 轮已验收的几何，超出本轮范围。

因此登记为 **DEFERRED-TYPO-01**：数据事实、上游值、注入实验与影响范围都在上表，
留待单独一轮统一处理，**不计为 PASS**。

## 无上游对应项（必要差异，单列）

`.eyebrow`（`PROBES` / `DISK IO` / `GPU` 等分区眉标，10px / 750 / `1.4px` 字距）、
`.probe-detail-card` 的三网标签（11px / 750）、磁盘 IO 数值（14px / 700）等，
对应的是 CFSM 独有的数据分区，Komari 没有同位组件，按任务书「原版无 CFSM 字段时
只做有对应关系的组件对照」处理，不强行对标。

## 六档视口 × 浅色 / 深色

| 视口 | 浅色 | 深色 |
|---|---|---|
| 375×812 | ✅ 首页 + 详情 | ✅ 详情 |
| 390×844 | ✅ 首页 | ✅ 详情 |
| 768×1024 | ✅ 首页 + 详情 | ✅ 详情 |
| 1024×768 | ✅ 详情 | ✅ 详情 |
| 1440×900 | ✅ 首页 + 详情 | ✅ 详情 |
| 1920×1080 | ✅ 详情 | ✅ 详情 |

每档均在目标宽度下**重新加载**后采样（`transition-all` 会让 resize 后的计算值停在旧值，
第 11 轮已记录该陷阱）。浅色 / 深色只改变颜色，`font-size` / `font-weight` /
`letter-spacing` / `font-variant-numeric` 在两种主题下逐项相同。

## 长值与截断（配合 D-02）

768px 六列栅格下，总览卡内容宽度只有 90 多 px：

| 卡片 | 主数值 client/scroll | 单位 client/scroll | 是否截断 |
|---|---|---|---|
| CFSM 硬盘用量 `455.0` | 43 / 63 | 48 / 71 | 是 |
| Komari 硬盘用量 `258.6` | 38 / 63 | 48 / 80 | 是 |
| CFSM 内存用量 `42.0` | 36 / 49 | 54 / 73 | 是 |
| Komari 内存用量 `6.7` | 28 / 37 | 58 / 73 | 是 |

修完第 14 轮 BUG-004 之后，本主题分给主数值的宽度已经**不少于**上游（43 对 38），
截断属同等行为。真正的问题是**完整值读不出来**——见 `docs/bug-matrix.md` 的 D-02。

## 图表 canvas 内的文字

两版都不给 ECharts 设 `fontFamily`，canvas 文本走 ECharts 默认的 `sans-serif`
（与页面 DOM 的雅黑不同，但两版一致）。字号：tooltip 12 / 图例 10 / 坐标轴 10，
本轮把 CFSM 的 tooltip 从 11 改成 12 后与上游 `MetricSeriesChartCard` 完全一致。
canvas 内文字颜色的问题另见 `docs/chart-parity.md`。
