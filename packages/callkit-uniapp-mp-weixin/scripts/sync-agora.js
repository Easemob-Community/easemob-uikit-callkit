#!/usr/bin/env node
/**
 * 同步声网小程序 SDK 到 UniApp 微信小程序插件内
 *
 * 运行方式：
 *   node scripts/sync-agora.js
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AGORA_PKG_DIR = path.resolve(__dirname, '../node_modules/agora-miniapp-sdk')
const PLUGIN_DIR = path.resolve(
  __dirname,
  '../uni_modules/easemob-callkit-mp-weixin'
)
const PLUGIN_STATIC_DIR = path.join(PLUGIN_DIR, 'static')
const PLUGIN_VENDOR_DIR = path.join(PLUGIN_DIR, 'src/vendor')

/**
 * 文件映射：
 * - JS 运行时必须放到插件 static/，HBuilderX 才会原样复制到微信小程序输出包；
 *   放在 src/vendor/ 下仅被动态 require 引用时不会被复制，导致运行时
 *   "module is not defined"。
 * - .d.ts 类型声明放到 src/vendor/，仅开发期使用，不会打进小程序包。
 */
const FILE_MAPPINGS = {
  'build/agora-miniapp-sdk.js': path.join(PLUGIN_STATIC_DIR, 'agora-miniapp-sdk.js'),
  'build/index.d.ts': path.join(PLUGIN_VENDOR_DIR, 'agora-miniapp-sdk.d.ts')
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function syncAgora() {
  ensureDir(PLUGIN_STATIC_DIR)
  ensureDir(PLUGIN_VENDOR_DIR)

  for (const [sourceName, targetPath] of Object.entries(FILE_MAPPINGS)) {
    const sourcePath = path.join(AGORA_PKG_DIR, sourceName)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `[sync-agora] 源文件不存在: ${sourcePath}\n请先执行 pnpm install（确保 agora-miniapp-sdk 已安装）`
      )
    }

    fs.copyFileSync(sourcePath, targetPath)
    const stat = fs.statSync(targetPath)
    const displayName = path.relative(PLUGIN_DIR, targetPath)
    console.log(`[sync-agora] ${displayName.padEnd(48)} ${(stat.size / 1024).toFixed(1)} KB`)
  }

  // 记录版本（与 core 版本文件放在一起，便于发布前校验）
  const agoraPkg = JSON.parse(fs.readFileSync(path.join(AGORA_PKG_DIR, 'package.json'), 'utf-8'))
  const versionFile = path.join(PLUGIN_VENDOR_DIR, 'agora-version.txt')
  fs.writeFileSync(versionFile, agoraPkg.version, 'utf-8')
  console.log(`[sync-agora] ${path.relative(PLUGIN_DIR, versionFile).padEnd(48)} ${agoraPkg.version}`)

  console.log('[sync-agora] ✅ 同步完成')
}

try {
  syncAgora()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
