import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('release performance contracts', () => {
  it('keeps network orchestration out of views and per-node components', () => {
    const presentationSources = [
      '../src/views/HomeView.vue',
      '../src/components/dashboard/ServerCard.vue',
      '../src/components/dashboard/ServerList.vue',
      '../src/components/dashboard/EarthMap.vue',
      '../src/components/dashboard/AdvancedTools.vue',
    ].map(source).join('\n')

    expect(presentationSources).not.toMatch(/\bfetch\s*\(/)
    expect(presentationSources).not.toMatch(/\bsetInterval\s*\(/)
    expect(presentationSources).not.toMatch(/\bsetTimeout\s*\(/)
    expect(source('../src/views/HomeView.vue')).not.toContain('fetchHistory')
  })

  it('preserves batch rendering, dense lazy paint and lazy route boundaries', () => {
    const home = source('../src/views/HomeView.vue')
    const list = source('../src/components/dashboard/ServerList.vue')
    const stylesheet = source('../src/styles/main.css')
    const router = source('../src/router/index.ts')

    expect(home).toContain('glassServerMapper.map')
    expect(home).toContain('NODE_ITEM_DELAY_STYLES')
    expect(list).toContain('v-memo=')
    expect(stylesheet).toMatch(/\.server-grid--dense \.node-card\s*\{[^}]*content-visibility: auto/s)
    expect(router.match(/component: \(\) => import\(/g)).toHaveLength(3)
  })

  it('keeps the runtime dependency surface intentional and Komari-faithful', () => {
    const packageJson = JSON.parse(source('../package.json')) as {
      dependencies?: Record<string, string>
    }

    // 第 9 轮把运行时依赖收敛到 pinia/vue/vue-router。第 9.5 轮的高保真移植收敛
    // 要求恢复 Komari 真实的三套 Earth 渲染器，globe.gl + three 与 cobe 是这些渲染器
    // 本身的实现依赖，不能用 SVG 仿制替换；@vueuse/core 提供渲染器所需的元素尺寸与
    // 可见性侦测。第 9.95 轮继续按上游实现补齐 echarts + vue-echarts（History 图表族）
    // 与 reka-ui + vue-sonner（UI 基元与提示）。这里锁定完整集合，防止之后无意引入
    // 其它运行时依赖，也防止有人为了缩小包体退回自写仿制版本。
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      '@vueuse/core',
      'cobe',
      'echarts',
      'globe.gl',
      'pinia',
      'reka-ui',
      'three',
      'vue',
      'vue-echarts',
      'vue-router',
      'vue-sonner',
    ])
  })
})
