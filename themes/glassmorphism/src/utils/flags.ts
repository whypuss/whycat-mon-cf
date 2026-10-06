/**
 * CFSM 默认皮肤提供的公共静态资源。
 *
 * `theme-develop.md` 明确要求第三方主题不要重复打包旗帜与 OS 图标：
 * 旗帜使用 `/flags/<code>.svg`，OS 图标使用 `/os-icons/<filename>`。
 * 因此这里只负责把地区代码规范化为官方文件名，不内联任何图片资源。
 */
export function flagUrl(code: string): string {
  return `/flags/${code.trim().toLowerCase()}.svg`
}

/** 旗帜缺失时静默隐藏，避免出现浏览器默认的破图占位。 */
export function hideMissingFlag(event: Event): void {
  const target = event.target
  if (target instanceof HTMLImageElement) target.style.visibility = 'hidden'
}
