import type { CfsmRequestIssue, CfsmRequestIssueKind } from '@/types/cfsm'
import { CfsmRequestError } from './http'

function issueKind(status: number | null, code: string | null): CfsmRequestIssueKind {
  if (status === 400) return 'invalid-request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409 || code === 'databaseUpgradeRequired') return 'upgrade-required'
  if (status === 503) return 'unavailable'
  if (status !== null && status >= 500 && status <= 599) return 'server-error'
  if (status === null && (code === 'networkError' || code === 'timeout')) return 'network'
  return 'unknown'
}

export function classifyCfsmRequestError(error: unknown): CfsmRequestIssue {
  if (error instanceof CfsmRequestError) {
    return {
      kind: issueKind(error.status, error.code),
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  return {
    kind: 'unknown',
    status: null,
    code: null,
    message: error instanceof Error ? error.message : 'Unknown CFSM request error',
  }
}

/** 首页的数据源失败只保留了状态码与错误码，这里按同一规则还原分类。 */
export function issueFromFailure(failure: {
  status: number | null
  code: string | null
  message: string
}): CfsmRequestIssue {
  return {
    kind: issueKind(failure.status, failure.code),
    status: failure.status,
    code: failure.code,
    message: failure.message,
  }
}
