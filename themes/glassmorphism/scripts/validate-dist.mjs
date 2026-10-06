import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const distRoot = resolve(projectRoot, 'dist')
const expectedRootEntries = ['assets', 'index.html']
/*
 * 发布体积预算。
 *
 * 第 9 轮的预算（JS 512 KiB / 总资源 768 KiB）建立在当时的单一 SVG 地图之上。
 * 第 9.5 轮按高保真移植要求恢复了 Komari 的三套真实 Earth 渲染器，
 * globe.gl 与 three 是 realistic 渲染器本身的实现依赖，原主题地球贴图是它和
 * tiled 地图的真实素材 —— 都不允许为了压体积换成 SVG 仿制。
 *
 * 因此预算按真实构成重设，仍保持「只留合理余量」以继续拦截意外膨胀：
 * globe.gl 与 three 只在选用 realistic 渲染器时按需懒加载，不进入首屏包。
 */
/*
 * 体积预算按「正式版高保真所需的上游依赖」的真实构成设定，而不是无限放宽：
 * - globe.gl + three 是 realistic Earth 渲染器本身的实现（懒加载，仅该渲染器加载）；
 * - echarts + vue-echarts 是 History 图表族的实现（懒加载，随详情页分块加载）；
 * - 地球贴图是原主题资源，占总资源预算的大头。
 * 这些都不允许为了缩小包体退回自写仿制版本，因此预算随之上调，但仍是硬门槛：
 * 超出即让 dist 校验失败，防止无关依赖悄悄进入产物。
 */
const sizeBudgets = {
  javascript: 3328 * 1024,
  stylesheet: 128 * 1024,
  allAssets: 6656 * 1024,
}
const forbiddenRuntimeMarkers = [
  '/api/public',
  '/api/nodes',
  '/api/clients',
  '/api/rpc',
  '/rpc2',
  '/manage/',
  'Komari RPC',
]

/*
 * Komari 的 RPC 命名空间只有作为字符串字面量被调用时才算运行时残留。
 * 裸的 `common:` / `public:` 会误伤第三方库的对象字面量 —— 例如 three.js 的
 * shader chunk 表就包含 `common:S_`。因此这里要求命名空间前必须是引号，
 * 既能拦住 `"common:getRecords"` 这类真实调用，又不会误判依赖内部结构。
 */
const forbiddenRuntimePatterns = [
  /['"`](?:common|public|private|admin):[a-z][a-zA-Z]/,
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = resolve(directory, entry.name)
    return entry.isDirectory() ? collectFiles(absolute) : [absolute]
  }))
  return files.flat()
}

const rootEntries = (await readdir(distRoot)).sort()
if (JSON.stringify(rootEntries) !== JSON.stringify(expectedRootEntries)) {
  throw new Error(
    'dist root must contain only index.html and assets; found: ' + rootEntries.join(', '),
  )
}

const indexPath = resolve(distRoot, 'index.html')
if (!(await stat(indexPath)).isFile()) throw new Error('dist/index.html is not a file')

const assetFiles = await collectFiles(resolve(distRoot, 'assets'))
if (assetFiles.length === 0) throw new Error('dist/assets is empty')

const assetSizes = await Promise.all(assetFiles.map(async (file) => ({
  file,
  bytes: (await stat(file)).size,
})))
const javascriptBytes = assetSizes
  .filter(({ file }) => file.endsWith('.js'))
  .reduce((sum, { bytes }) => sum + bytes, 0)
const stylesheetBytes = assetSizes
  .filter(({ file }) => file.endsWith('.css'))
  .reduce((sum, { bytes }) => sum + bytes, 0)
const allAssetBytes = assetSizes.reduce((sum, { bytes }) => sum + bytes, 0)

for (const [label, actual, budget] of [
  ['JavaScript', javascriptBytes, sizeBudgets.javascript],
  ['CSS', stylesheetBytes, sizeBudgets.stylesheet],
  ['total assets', allAssetBytes, sizeBudgets.allAssets],
]) {
  if (actual > budget) {
    throw new Error(`${label} size ${actual} bytes exceeds the ${budget}-byte release budget`)
  }
}

const textFiles = [indexPath, ...assetFiles.filter((file) => /\.(css|js|html|map)$/.test(file))]
for (const file of textFiles) {
  const content = await readFile(file, 'utf8')
  const marker = forbiddenRuntimeMarkers.find((item) => content.includes(item))
  if (marker) throw new Error('Forbidden Komari runtime marker ' + marker + ' found in ' + file)
  const pattern = forbiddenRuntimePatterns.find((item) => item.test(content))
  if (pattern) {
    throw new Error('Forbidden Komari RPC namespace ' + String(pattern) + ' found in ' + file)
  }
}

console.log(
  'dist validation passed: index.html and ' + assetFiles.length + ' asset file(s); '
  + `${(javascriptBytes / 1024).toFixed(1)} KiB JS, `
  + `${(stylesheetBytes / 1024).toFixed(1)} KiB CSS, `
  + `${(allAssetBytes / 1024).toFixed(1)} KiB total assets`,
)
