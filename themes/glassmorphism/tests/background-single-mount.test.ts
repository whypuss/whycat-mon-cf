import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('background application-level ownership', () => {
  it('mounts one DynamicBackground outside RouterView and none in the three pages', () => {
    const app = source('../src/App.vue')
    const views = [
      source('../src/views/HomeView.vue'),
      source('../src/views/ServerDetailView.vue'),
      source('../src/views/ThemeSettingsView.vue'),
    ]

    expect(app.match(/<DynamicBackground\s*\/>/g)).toHaveLength(1)
    const routerView = app.indexOf('<RouterView')
    expect(routerView).toBeGreaterThan(-1)
    expect(app.indexOf('<DynamicBackground />')).toBeLessThan(routerView)
    for (const view of views) expect(view).not.toContain('DynamicBackground')
  })
})
