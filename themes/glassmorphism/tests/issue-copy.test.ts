import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { issueCopy, issueReason } from '@/domain/issue-copy'
import { issueFromFailure } from '@/services/cfsm/errors'
import type { CfsmRequestIssue, CfsmRequestIssueKind } from '@/types/cfsm'

/*
 * 错误与离线提示面向访客：说清发生了什么、可以怎么做。401 / 409 / 503 照实说明，
 * 不把英文错误码、接口路径或 REST / WebSocket 这类实现细节直接显示出来。
 */
const TECHNICAL = /REST|WebSocket|\/api\/|theme_options|JWT|快照|模拟数据|替代数据|databaseUpgradeRequired|internalError|normalized/

function issue(kind: CfsmRequestIssueKind, status: number | null, code: string | null = null): CfsmRequestIssue {
  return { kind, status, code, message: 'raw english message' }
}

const ALL: CfsmRequestIssue[] = [
  issue('unauthorized', 401),
  issue('forbidden', 403, 'turnstileRequired'),
  issue('not-found', 404),
  issue('upgrade-required', 409, 'databaseUpgradeRequired'),
  issue('unavailable', 503),
  issue('server-error', 500, 'internalError'),
  issue('network', null, 'timeout'),
  issue('network', null, 'networkError'),
  issue('invalid-request', 400),
  issue('unknown', null),
  issue('unknown', 418),
]

describe('请求失败文案', () => {
  it('照实说明 401 / 409 / 503', () => {
    expect(issueCopy(issue('unauthorized', 401), 'history')).toEqual({
      title: '需要登录',
      body: '这个时间范围的历史需要登录 CFSM 后才能查看，登录后刷新页面即可。',
    })
    expect(issueCopy(issue('upgrade-required', 409, 'databaseUpgradeRequired'), 'history').title).toBe('历史数据库需要升级')
    expect(issueCopy(issue('unavailable', 503), 'detail').title).toBe('服务暂不可用')
    expect(issueCopy(issue('server-error', 502), 'detail').title).toBe('服务器出错')
    // 首页没有单独的状态码一行，简短原因里带上状态码。
    expect(issueReason(issue('unavailable', 503))).toBe('服务暂不可用（HTTP 503）')
    expect(issueReason(issue('server-error', 502))).toBe('服务器出错（HTTP 502）')
  })

  it('区分超时与连不上', () => {
    expect(issueCopy(issue('network', null, 'timeout'), 'detail').title).toBe('连接超时')
    expect(issueCopy(issue('network', null, 'networkError'), 'detail').title).toBe('网络连接失败')
    expect(issueReason(issue('network', null, 'timeout'))).toBe('连接超时')
    expect(issueReason(issue('network', null, 'networkError'))).toBe('无法连接')
  })

  it('不显示英文原文、错误码或实现细节', () => {
    for (const current of ALL) {
      for (const context of ['detail', 'history'] as const) {
        const copy = issueCopy(current, context)
        expect(copy.title + copy.body).not.toMatch(TECHNICAL)
        expect(copy.body).not.toContain('raw english message')
      }
      expect(issueReason(current)).not.toMatch(TECHNICAL)
      expect(issueReason(current)).not.toContain('raw english message')
    }
  })

  it('首页数据源失败按状态码还原分类', () => {
    expect(issueReason(issueFromFailure({ status: 500, code: 'internalError', message: 'internalError' }))).toBe('服务器出错（HTTP 500）')
    expect(issueReason(issueFromFailure({ status: 403, code: null, message: 'Turnstile verification failed' }))).toBe('需要人机验证')
    expect(issueReason(issueFromFailure({ status: null, code: 'timeout', message: 'CFSM request timed out' }))).toBe('连接超时')
    // 返回的不是 CFSM 数据，例如数据源地址指向了别的网站。
    expect(issueReason(issueFromFailure({ status: null, code: null, message: 'Servers response must be an object' }))).toBe('返回的数据无法识别')
  })
})

describe('首页与详情页的提示模板', () => {
  function template(path: string): string {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    return source.slice(source.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')
  }

  it('不出现实现细节与英文错误原文', () => {
    for (const path of [
      '../src/views/HomeView.vue',
      '../src/views/ServerDetailView.vue',
      '../src/components/detail/LoadChart.vue',
      '../src/components/detail/PingChart.vue',
      // 顶栏的提示与读屏标签同样面向访客。
      '../src/components/dashboard/AppHeader.vue',
      '../src/components/dashboard/DashboardControls.vue',
      '../src/components/dashboard/ServerCard.vue',
      '../src/components/dashboard/ServerList.vue',
      '../src/components/dashboard/OverviewCards.vue',
    ]) {
      const markup = template(path)
      expect(markup).not.toMatch(/REST|WebSocket|\/api\/|快照|模拟数据/)
      expect(markup).not.toContain('serverStore.error')
      expect(markup).not.toContain('app.error')
      expect(markup).not.toContain('failure.message')
      expect(markup).not.toMatch(/[Ii]ssue\.message/)
    }
  })

  it('状态码单独一行照实给出，不附带 CFSM 返回的英文原文', () => {
    expect(template('../src/views/ServerDetailView.vue')).toContain('<small v-if="issue?.status">HTTP {{ issue.status }}</small>')
    expect(template('../src/components/detail/LoadChart.vue')).toContain('<small v-if="historyIssue?.status">HTTP {{ historyIssue.status }}</small>')
    expect(template('../src/components/detail/PingChart.vue')).toContain('<small v-if="pingHistoryIssue?.status">HTTP {{ pingHistoryIssue.status }}</small>')
  })
})
