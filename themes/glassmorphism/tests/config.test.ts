import { describe, expect, it } from 'vitest'
import {
  adminUrl,
  apiSource,
  parseApiBaseContent,
  webSocketBase,
} from '@/services/cfsm/config'

describe('CFSM API base configuration', () => {
  it('normalizes, filters and deduplicates comma-separated origins', () => {
    expect(parseApiBaseContent(
      ' https://one.example/path,ftp://invalid.example,https://one.example, http://two.example/a ',
      'https://fallback.example',
    )).toEqual(['https://one.example', 'http://two.example'])
  })

  it('uses the current origin when the meta value has no valid base', () => {
    expect(parseApiBaseContent('', 'https://status.example/path')).toEqual([
      'https://status.example',
    ])
  })

  it('builds source, websocket and administration locations', () => {
    expect(apiSource('https://status.example/').base).toBe('https://status.example')
    expect(webSocketBase('https://status.example')).toBe('wss://status.example')
    expect(webSocketBase('http://localhost:8787')).toBe('ws://localhost:8787')
    expect(adminUrl('https://status.example')).toBe('https://status.example/admin#admin')
  })
})

