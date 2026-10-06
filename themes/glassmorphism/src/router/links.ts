import type { RouteLocationRaw } from 'vue-router'

/*
 * 详情页链接的唯一生成入口。
 *
 * `source` 是本主题自己的查询参数，只为多 apiBase 部署服务：它把详情与历史请求送回
 * 拥有该节点的后端（source ownership）。单后端站点上它恒等于当前同源地址，纯属冗余，
 * 所以只在确实配置了多个来源时写入。
 *
 * 读取端照旧兼容：旧的带 `?source=` 链接仍然可以直接打开，详情页进入后再把冗余参数
 * 抹掉（见 `ServerDetailView` 的规范化）。
 */
export function serverDetailLocation(
  serverId: string,
  sourceBase: string,
  multiSource: boolean,
): RouteLocationRaw {
  return multiSource
    ? { name: 'server-detail', params: { id: serverId }, query: { source: sourceBase } }
    : { name: 'server-detail', params: { id: serverId } }
}

/** 只有配置了多个 apiBase 才需要在链接里区分节点归属。 */
export function hasMultipleSources(apiBases: readonly string[]): boolean {
  return apiBases.length > 1
}
