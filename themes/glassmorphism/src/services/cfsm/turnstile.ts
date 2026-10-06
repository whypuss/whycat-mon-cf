/**
 * CFSM 全局 Turnstile 的前端部分，流程与 CFSM 默认前端（`src/frontend/utils/turnstile.js`、
 * `main.js` 的 `renderStartupTurnstile`）一致：加载 Cloudflare 官方脚本，渲染组件取得一次性令牌，
 * 再由 `verifyTurnstileToken`（`api.ts`）经 `/api/config` 换取 CFSM 签发的验证凭据。
 * 脚本地址与 CFSM 默认前端相同，CFSM 的 CSP 已放行该域名。
 */
export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/** 组件配色跟随主题解析出的明暗（含 beijing 模式），不交给 Turnstile 按系统设置自行判断。 */
export type TurnstileTheme = 'light' | 'dark'

export interface TurnstileRenderOptions {
  sitekey: string
  theme: TurnstileTheme
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
}

export interface TurnstileApi {
  /** 返回组件 ID（字符串），清理时交给 `remove`。 */
  render: (container: HTMLElement, options: TurnstileRenderOptions) => unknown
  remove?: (widgetId: string) => void
}

export function isTurnstileApi(value: unknown): value is TurnstileApi {
  return typeof value === 'object' && value !== null && 'render' in value && typeof value.render === 'function'
}

function currentTurnstileApi(): TurnstileApi | null {
  const candidate: unknown = Reflect.get(globalThis, 'turnstile')
  return isTurnstileApi(candidate) ? candidate : null
}

let scriptPromise: Promise<TurnstileApi> | null = null

/** 只注入一次官方脚本；加载失败后允许再次尝试。 */
export function loadTurnstileScript(doc: Document = document): Promise<TurnstileApi> {
  const existing = currentTurnstileApi()
  if (existing) return Promise.resolve(existing)
  if (scriptPromise) return scriptPromise

  const pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.onload = () => {
      const api = currentTurnstileApi()
      if (api) resolve(api)
      else reject(new Error('Turnstile script loaded without a render API'))
    }
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    doc.head.appendChild(script)
  })
  scriptPromise = pending
  pending.catch(() => {
    if (scriptPromise === pending) scriptPromise = null
  })
  return pending
}

/**
 * 渲染官方组件，完成验证后得到一次性令牌；出错或令牌过期时拒绝。
 * 组件 ID 经 `onRendered` 交给调用方，移除容器前要用它调用 `removeTurnstileWidget`。
 */
export function requestTurnstileToken(
  api: TurnstileApi,
  container: HTMLElement,
  siteKey: string,
  theme: TurnstileTheme,
  onRendered?: (widgetId: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const widgetId = api.render(container, {
      sitekey: siteKey,
      theme,
      callback: (token) => {
        if (token) resolve(token)
        else reject(new Error('Turnstile returned an empty token'))
      },
      'error-callback': () => reject(new Error('Turnstile challenge failed')),
      'expired-callback': () => reject(new Error('Turnstile token expired')),
    })
    if (typeof widgetId === 'string') onRendered?.(widgetId)
  })
}

/**
 * 按 CFSM 管理端 `removeTurnstile` 的做法清理组件：直接移除容器而不调用 `remove`，
 * Turnstile 之后会在控制台警告找不到组件。组件已失效时忽略。
 */
export function removeTurnstileWidget(api: TurnstileApi, widgetId: string): void {
  try {
    api.remove?.(widgetId)
  } catch {
    // 组件 ID 已失效，容器由调用方随后移除。
  }
}
