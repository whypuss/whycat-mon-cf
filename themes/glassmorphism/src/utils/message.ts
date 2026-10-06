import { toast } from 'vue-sonner'

/**
 * 对齐 Komari `utils/message.ts`：把瞬时反馈统一走 `vue-sonner`，
 * 避免各页面各自实现一套内联提示条。
 *
 * 只用于瞬时结果反馈；需要持续可见的错误（例如历史加载失败）仍保留在页面内。
 */
export const message = {
  success(text: string): void {
    toast.success(text)
  },
  error(text: string, description?: string): void {
    toast.error(text, description === undefined ? undefined : { description })
  },
  info(text: string): void {
    toast.info(text)
  },
}
