import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [archivePath, sourceSha] = process.argv.slice(2)
if (!archivePath || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')) {
  throw new Error('Usage: node scripts/publish-preview.mjs <verified.zip> <source-sha>')
}
const git = (args, options = {}) => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim()
const sourceTip = () => git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s/)[0]
const windowsTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

if (sourceTip() !== sourceSha) {
  console.log('Source main has advanced; skipping the superseded preview.')
} else {
  // 独立工作目录和 index，不切源码分支，不清理源码文件。
  const staging = mkdtempSync(join(tmpdir(), 'cfsm-preview-'))
  try {
    const themeDir = join(staging, 'theme')
    mkdirSync(themeDir)
    const archive = resolve(archivePath)
    if (process.platform === 'win32') execFileSync(windowsTar, ['-xf', archive, '-C', themeDir])
    else execFileSync('unzip', ['-q', archive, '-d', themeDir])
    if (readdirSync(themeDir).sort().join(',') !== 'assets,index.html'
      || !statSync(join(themeDir, 'index.html')).isFile()
      || !statSync(join(themeDir, 'assets')).isDirectory()) {
      throw new Error('Preview archive must contain only index.html and assets/')
    }

    const previewRef = 'refs/heads/preview-main'
    // 不用 --exit-code：分支不存在可初始化，网络失败必须中止。
    // 记录本次看到的远端 SHA，推送时用租约拒绝覆盖并发修改。
    const observed = git(['ls-remote', 'origin', previewRef])
    const previousSha = observed ? observed.split(/\s/)[0] : ''
    const env = {
      ...process.env,
      GIT_INDEX_FILE: join(staging, 'index'),
      GIT_AUTHOR_NAME: 'github-actions[bot]',
      GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]',
      GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
    }
    const gitDir = git(['rev-parse', '--absolute-git-dir'])
    git([`--git-dir=${gitDir}`, `--work-tree=${themeDir}`, 'add', '-f', '--', 'index.html', 'assets'], { env })
    const tree = git(['write-tree'], { env })
    // 不设父提交：分支每次只保留最新一份产物。随机标识保证相同源码
    // 在同一秒重复发布时也会得到不同提交，便于审计租约更新。
    const commit = git(['commit-tree', tree], {
      env, input: `main 预览 · ${sourceSha.slice(0, 7)}\n\nSource: ${sourceSha}\nPreview-Nonce: ${randomUUID()}\n`,
    })
    if (sourceTip() !== sourceSha) {
      console.log('Source main advanced during packaging; skipping the superseded preview.')
    } else {
      // 分支不存在时空 SHA 表示期望不存在；旧 SHA 不一致则安全失败。
      git(['push', `--force-with-lease=${previewRef}:${previousSha}`, 'origin', `${commit}:${previewRef}`])
      console.log(`Published preview-main from ${sourceSha}`)
    }
  } finally {
    // 唯一删除目标是本次 mkdtemp 创建的目录。
    rmSync(staging, { recursive: true, force: true })
  }
}
