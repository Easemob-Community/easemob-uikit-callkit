#!/usr/bin/env node
/**
 * 同步 callkit-core 构建产物到 UniApp 微信小程序插件内
 *
 * 运行方式：
 *   node scripts/sync-core.js
 *   node scripts/sync-core.js --watch
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CORE_DIST_DIR = path.resolve(__dirname, '../../callkit-core/dist')
const CORE_SRC_DIR = path.resolve(__dirname, '../../callkit-core/src')
const PLUGIN_VENDOR_DIR = path.resolve(
  __dirname,
  '../uni_modules/em-callkit-weixin/src/vendor'
)
const CORE_PKG_PATH = path.resolve(__dirname, '../../callkit-core/package.json')

/**
 * 防呆检查：core src 比 dist 新（src 改了没 build）时警告。
 * 版本号与 dist 内容可能脱钩（package.json version 不变但 src 已修复），
 * 仅靠 version.txt 无法发现 vendor 滞后，此检查是唯一的滞后暴露手段。
 */
function warnIfDistStale() {
  const latestMtime = (dir) => {
    let latest = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        latest = Math.max(latest, latestMtime(full))
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        latest = Math.max(latest, fs.statSync(full).mtimeMs)
      }
    }
    return latest
  }

  const distIndex = path.join(CORE_DIST_DIR, 'index.js')
  if (!fs.existsSync(distIndex)) return // 缺 dist 由后续 existsSync 检查报错

  const srcLatest = latestMtime(CORE_SRC_DIR)
  const distMtime = fs.statSync(distIndex).mtimeMs
  if (srcLatest > distMtime) {
    console.warn(
      '[sync-core] ⚠️ 警告：callkit-core/src 有文件比 dist 更新（src 修改后未重新 build）！\n' +
      `  src 最新修改: ${new Date(srcLatest).toISOString()}\n` +
      `  dist 构建时间: ${new Date(distMtime).toISOString()}\n` +
      '  即将同步的可能是旧产物。建议先执行: pnpm --filter @easemob-community/callkit-core build\n' +
      '  （3 秒后继续同步，Ctrl+C 可中止）'
    )
    // 主线程休眠 3 秒（不空转 CPU）
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
  }
}

const FILE_MAPPINGS = {
  'index.js': 'callkit-core.esm.js',
  'index.cjs': 'callkit-core.cjs.js',
  'index.d.ts': 'callkit-core.d.ts'
}

// 为匹配 .esm.js 的运行时导入，额外同步一份同名的 .esm.d.ts 类型声明
const EXTRA_DTS_COPIES = {
  'index.d.ts': 'callkit-core.esm.d.ts'
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function syncCore() {
  ensureDir(PLUGIN_VENDOR_DIR)

  // 复制产物文件
  for (const [sourceName, targetName] of Object.entries(FILE_MAPPINGS)) {
    const sourcePath = path.join(CORE_DIST_DIR, sourceName)
    const targetPath = path.join(PLUGIN_VENDOR_DIR, targetName)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`[sync-core] 源文件不存在: ${sourcePath}\n请先执行 pnpm build:core`)
    }

    fs.copyFileSync(sourcePath, targetPath)
    const stat = fs.statSync(targetPath)
    console.log(`[sync-core] ${targetName.padEnd(24)} ${(stat.size / 1024).toFixed(1)} KB`)
  }

  // 额外复制类型声明，使其与运行时 .js 文件名一一对应
  for (const [sourceName, targetName] of Object.entries(EXTRA_DTS_COPIES)) {
    const sourcePath = path.join(CORE_DIST_DIR, sourceName)
    const targetPath = path.join(PLUGIN_VENDOR_DIR, targetName)
    fs.copyFileSync(sourcePath, targetPath)
    const stat = fs.statSync(targetPath)
    console.log(`[sync-core] ${targetName.padEnd(24)} ${(stat.size / 1024).toFixed(1)} KB`)
  }

  // 记录 core 版本
  const corePkg = JSON.parse(fs.readFileSync(CORE_PKG_PATH, 'utf-8'))
  const versionFile = path.join(PLUGIN_VENDOR_DIR, 'version.txt')
  fs.writeFileSync(versionFile, corePkg.version, 'utf-8')
  console.log(`[sync-core] version.txt -> ${corePkg.version}`)

  console.log('[sync-core] ✅ 同步完成')
}

function watchCore() {
  console.log('[sync-core] 👀 开始监听 callkit-core/dist 变化...')
  fs.watch(CORE_DIST_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.js') || filename.endsWith('.cjs') || filename.endsWith('.d.ts'))) {
      console.log(`[sync-core] 检测到变化: ${filename}`)
      try {
        syncCore()
      } catch (err) {
        console.error('[sync-core] 同步失败:', err.message)
      }
    }
  })
}

const isWatch = process.argv.includes('--watch')

try {
  warnIfDistStale()
  syncCore()
  if (isWatch) {
    watchCore()
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
