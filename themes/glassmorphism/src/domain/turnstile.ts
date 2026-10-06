import type { SiteConfig } from '@/types/cfsm'

/**
 * 需要进行人机验证时返回 Turnstile site key，否则返回 null。
 *
 * 与 CFSM 默认前端的启动判断一致：站点开启全局 Turnstile、配置里有 site key，并且这次
 * `/api/config` 没有确认已验证（`verified !== true`）。另外，请求中途收到 403（凭据过期或失效）
 * 时同样需要重新验证。只开启「登录 Turnstile」不拦截公开页面，这里不处理。
 */
export function turnstileChallengeSiteKey(
  config: Pick<SiteConfig, 'turnstileEnabled' | 'turnstileSiteKey' | 'verified'> | null,
  rejected: boolean,
): string | null {
  if (!config?.turnstileEnabled) return null
  const siteKey = config.turnstileSiteKey?.trim()
  if (!siteKey) return null
  return !config.verified || rejected ? siteKey : null
}
