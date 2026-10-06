import { describe, expect, it } from 'vitest'
import { classifyCfsmRequestError } from '@/services/cfsm/errors'
import { CfsmRequestError } from '@/services/cfsm/http'

describe('CFSM request issue classification', () => {
  it.each([
    [401, null, 'unauthorized'],
    [403, 'turnstileRequired', 'forbidden'],
    [404, null, 'not-found'],
    [409, 'databaseUpgradeRequired', 'upgrade-required'],
    [500, 'internalError', 'server-error'],
    [503, 'temporarilyUnavailable', 'unavailable'],
    [400, 'Missing ID', 'invalid-request'],
  ] as const)('maps HTTP %s to %s', (status, code, expected) => {
    const issue = classifyCfsmRequestError(new CfsmRequestError('failed', {
      status,
      path: '/api/history/all',
      code: code ?? undefined,
    }))
    expect(issue).toMatchObject({ kind: expected, status, code })
  })

  it('keeps network failures distinct from HTTP and unknown errors', () => {
    expect(classifyCfsmRequestError(new CfsmRequestError('offline', {
      path: '/api/server',
      code: 'networkError',
    }))).toMatchObject({ kind: 'network', status: null })
    expect(classifyCfsmRequestError(new Error('unexpected'))).toEqual({
      kind: 'unknown',
      status: null,
      code: null,
      message: 'unexpected',
    })
  })
})
