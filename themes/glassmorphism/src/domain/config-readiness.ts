/** 冷启动等到真实配置或明确失败；刷新时沿用上一份已确认配置。 */
export function configReady(config: unknown, state: 'idle' | 'loading' | 'ready' | 'partial' | 'error'): boolean {
  return config != null || state === 'error'
}
