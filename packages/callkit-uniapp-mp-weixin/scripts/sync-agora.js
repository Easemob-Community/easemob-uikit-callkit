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
const PLUGIN_VENDOR_DIR = path.resolve(
  __dirname,
  '../uni_modules/easemob-callkit-mp-weixin/src/vendor'
)

const FILE_MAPPINGS = {
  'build/agora-miniapp-sdk.js': 'agora-miniapp-sdk.js',
  'build/index.d.ts': 'agora-miniapp-sdk.d.ts'
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function syncAgora() {
  ensureDir(PLUGIN_VENDOR_DIR)

  for (const [sourceName, targetName] of Object.entries(FILE_MAPPINGS)) {
    const sourcePath = path.join(AGORA_PKG_DIR, sourceName)
    const targetPath = path.join(PLUGIN_VENDOR_DIR, targetName)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `[sync-agora] 源文件不存在: ${sourcePath}\n请先执行 pnpm install（确保 agora-miniapp-sdk 已安装）`
      )
    }

    fs.copyFileSync(sourcePath, targetPath)
    const stat = fs.statSync(targetPath)
    console.log(`[sync-agora] ${targetName.padEnd(24)} ${(stat.size / 1024).toFixed(1)} KB`)
  }

  // 记录版本
  const agoraPkg = JSON.parse(fs.readFileSync(path.join(AGORA_PKG_DIR, 'package.json'), 'utf-8'))
  const versionFile = path.join(PLUGIN_VENDOR_DIR, 'agora-version.txt')
  fs.writeFileSync(versionFile, agoraPkg.version, 'utf-8')
  console.log(`[sync-agora] agora-version.txt -> ${agoraPkg.version}`)

  console.log('[sync-agora] ✅ 同步完成')
}

try {
  syncAgora()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
