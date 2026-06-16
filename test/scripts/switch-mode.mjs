#!/usr/bin/env node

/**
 * 切换测试模式：源码模式 vs tgz 包模式
 * 
 * 用法：
 *   node switch-mode.mjs source    # 切换到源码模式
 *   node switch-mode.mjs tgz       # 切换到 tgz 包模式
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const mode = process.argv[2]
const packageJsonPath = path.resolve(__dirname, '../package.json')

if (!mode || !['source', 'tgz'].includes(mode)) {
  console.log('Usage: node switch-mode.mjs <source|tgz>')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const hasTgzDep = pkg.dependencies && pkg.dependencies['@easemob/callkit-vue3']

if (mode === 'source') {
  if (hasTgzDep) {
    delete pkg.dependencies['@easemob/callkit-vue3']
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log('✓ Switched to SOURCE mode (using lib/ directory)')
    console.log('  Run "pnpm install" to update dependencies')
  } else {
    console.log('✓ Already in SOURCE mode')
  }
} else if (mode === 'tgz') {
  const tgzPath = path.resolve(__dirname, '../../release/easemob-callkit-vue3-2.0.0.tgz')
  if (!fs.existsSync(tgzPath)) {
    console.error('✗ Error: tgz file not found at ' + tgzPath)
    console.error('  Please run "pnpm run build:pack" in the project root first')
    process.exit(1)
  }

  if (!hasTgzDep) {
    pkg.dependencies = pkg.dependencies || {}
    pkg.dependencies['@easemob/callkit-vue3'] = 'file:../release/easemob-callkit-vue3-2.0.0.tgz'
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log('✓ Switched to TGZ mode (using .tgz package)')
  } else {
    console.log('✓ Already in TGZ mode')
  }

  // 强制删除 pnpm 缓存的旧 tgz 包，确保后续安装重新读取最新文件
  const nodeModulesPath = path.resolve(__dirname, '../node_modules')
  const pnpmStorePath = path.join(nodeModulesPath, '.pnpm')
  if (fs.existsSync(pnpmStorePath)) {
    const callkitStorePaths = fs.readdirSync(pnpmStorePath)
      .filter(name => name.startsWith('@easemob+callkit-vue3@'))
      .map(name => path.join(pnpmStorePath, name))

    for (const p of callkitStorePaths) {
      fs.rmSync(p, { recursive: true, force: true })
      console.log('  Cleared old package cache: ' + path.basename(p))
    }
  }

  const callkitDepPath = path.join(nodeModulesPath, '@easemob/callkit-vue3')
  if (fs.existsSync(callkitDepPath)) {
    fs.rmSync(callkitDepPath, { recursive: true, force: true })
    console.log('  Cleared old node_modules/@easemob/callkit-vue3')
  }

  console.log('  Run "pnpm add file:../release/easemob-callkit-vue3-2.0.0.tgz" to install the latest tgz package')
}
