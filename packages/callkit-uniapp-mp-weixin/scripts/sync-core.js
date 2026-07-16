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
const PLUGIN_VENDOR_DIR = path.resolve(
  __dirname,
  '../uni_modules/easemob-callkit-mp-weixin/src/vendor'
)
const CORE_PKG_PATH = path.resolve(__dirname, '../../callkit-core/package.json')

const FILE_MAPPINGS = {
  'index.js': 'callkit-core.esm.js',
  'index.cjs': 'callkit-core.cjs.js',
  'index.d.ts': 'callkit-core.d.ts'
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
  syncCore()
  if (isWatch) {
    watchCore()
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
