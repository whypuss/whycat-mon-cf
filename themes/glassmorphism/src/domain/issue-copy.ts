import type { CfsmRequestIssue } from '@/types/cfsm'

export interface IssueCopy {
  title: string
  body: string
}

/**
 * 详情页与两个图表区共用的请求失败文案：面向访客说清发生了什么、可以怎么做。
 * 401 / 409 / 503 等状态照实说明，不以模拟数据兜底，也不把英文错误码直接显示出来。
 * 状态码由文案下方的「HTTP xxx」一行单独给出，正文不再重复。
 */
export function issueCopy(current: CfsmRequestIssue | null, context: 'detail' | 'history'): IssueCopy {
  if (!current) return { title: '读取失败', body: '暂时无法读取数据，请稍后重试。' }
  if (current.kind === 'unauthorized') {
    return {
      title: '需要登录',
      body: context === 'history'
        ? '这个时间范围的历史需要登录 CFSM 后才能查看，登录后刷新页面即可。'
        : '查看这个节点需要先登录 CFSM。',
    }
  }
  if (current.kind === 'forbidden') {
    // CFSM 只在人机验证缺失或过期时返回 403。
    return { title: '需要人机验证', body: '请先完成人机验证，通过后页面会自动重新加载。' }
  }
  if (current.kind === 'not-found') {
    return { title: '找不到这个节点', body: '节点可能已被删除，或者链接有误。' }
  }
  if (current.kind === 'upgrade-required') {
    return { title: '历史数据库需要升级', body: '站点管理员在 CFSM 后台完成数据库升级后，才能查看这段历史。' }
  }
  if (current.kind === 'unavailable') {
    return { title: '服务暂不可用', body: 'CFSM 暂时无法提供数据，请稍后重试。' }
  }
  if (current.kind === 'server-error') {
    return { title: '服务器出错', body: 'CFSM 处理请求时出错，请稍后重试。' }
  }
  if (current.kind === 'network') {
    return current.code === 'timeout'
      ? { title: '连接超时', body: 'CFSM 长时间没有响应，请稍后重试。' }
      : { title: '网络连接失败', body: '无法连接到 CFSM，请检查网络后重试。' }
  }
  if (current.kind === 'invalid-request') {
    return { title: '请求无效', body: 'CFSM 无法处理这个节点或时间范围。' }
  }
  return { title: '读取失败', body: '暂时无法读取数据，请稍后重试。' }
}

/** 一行放得下的简短原因，用于首页的数据源失败提示与「无法加载节点」。 */
export function issueReason(current: CfsmRequestIssue): string {
  switch (current.kind) {
    case 'unauthorized': return '需要登录'
    case 'forbidden': return '需要人机验证'
    case 'not-found': return '找不到接口（HTTP 404），请检查数据源地址'
    case 'upgrade-required': return '数据库需要升级'
    case 'unavailable': return '服务暂不可用（HTTP 503）'
    case 'server-error': return `服务器出错（HTTP ${current.status ?? '5xx'}）`
    case 'network': return current.code === 'timeout' ? '连接超时' : '无法连接'
    case 'invalid-request': return '请求无效（HTTP 400）'
    // 没有状态码又不是网络错误，基本是返回内容不是 CFSM 的数据（例如数据源地址指向了别的网站）。
    default: return current.status === null ? '返回的数据无法识别' : `请求失败（HTTP ${current.status}）`
  }
}
