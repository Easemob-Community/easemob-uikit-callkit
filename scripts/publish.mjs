#!/usr/bin/env node

/**
 * CallKit monorepo 发布脚本
 *
 * 用法：
 *   node scripts/publish.mjs              # 正式发布
 *   node scripts/publish.mjs --dry-run    #  dry-run，不真正发布
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

const corePkgPath = path.join(root, 'packages/callkit-core/package.json')
const vue3PkgPath = path.join(root, 'packages/callkit-vue3/package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const help = args.includes('--help') || args.includes('-h')

if (help) {
  console.log(`
CallKit monorepo 发布脚本

用法:
  node scripts/publish.mjs [选项]

选项:
  --dry-run          演练模式：构建、打包都执行，但不真正推送到 npm
  -h, --help         显示帮助

发布顺序:
  1. 校验 @easemob-community/callkit-core 和 @easemob-community/callkit-vue3 版本号一致
  2. pnpm run typecheck
  3. pnpm --filter @easemob-community/callkit-core run test
  4. pnpm run build:all
  5. 临时将 callkit-vue3 的 callkit-core 依赖从 workspace:* 改为 ^版本
  6. npm publish @easemob-community/callkit-core --access public
  7. npm publish @easemob-community/callkit-vue3 --access public
  8. 生成 tgz 到 release/easemob-callkit-vue3-<version>.tgz
  9. 打 git tag v<version> 并推送
 10. 恢复 workspace:* 依赖
（老包 easemob-chat-callkit-vue3 已废弃完毕，脚本不再处理）
`)
  process.exit(0)
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  if (dryRun && cmd.includes('publish')) {
    console.log('[dry-run] skipped')
    return ''
  }
  return execSync(cmd, { stdio: 'inherit', cwd: root, ...opts })
}

function runNpm(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  if (dryRun && cmd.includes('publish')) {
    console.log('[dry-run] skipped')
    return ''
  }
  // 统一使用 npm 执行，避免 pnpm 和 npm 认证上下文不一致
  return execSync(cmd, { stdio: 'inherit', cwd: root, ...opts })
}

function checkNpmAuth() {
  // CI 环境（GitHub Actions OIDC）使用短令牌，不支持 npm whoami，跳过检查
  if (process.env.CI) {
    console.log('✓ CI 环境（OIDC 认证），跳过 npm whoami 检查')
    return
  }

  try {
    const user = execSync('npm whoami', { cwd: root, encoding: 'utf8' }).trim()
    console.log(`✓ npm 已登录: ${user}`)
  } catch {
    console.error('✗ 未登录 npm，请先执行 npm login')
    process.exit(1)
  }
}

async function main() {
  const corePkg = readJson(corePkgPath)
  const vue3Pkg = readJson(vue3PkgPath)

  console.log('=====================================')
  console.log('准备发布 scoped CallKit 包')
  console.log('=====================================')
  console.log(`  @easemob-community/callkit-core  : ${corePkg.version}`)
  console.log(`  @easemob-community/callkit-vue3  : ${vue3Pkg.version}`)
  console.log(`  演练模式                : ${dryRun ? '是' : '否'}`)
  console.log('=====================================\n')

  if (corePkg.version !== vue3Pkg.version) {
    console.error('错误：两个包的 version 不一致，请先统一版本号')
    process.exit(1)
  }

  if (!dryRun) checkNpmAuth()

  const version = corePkg.version

  // 0. 发布前检查
  console.log('\n--- 发布前检查 ---')
  run('pnpm run typecheck')
  console.log('--- 发布前检查通过 ---\n')

  // 1. 构建全部
  run('pnpm run build:all')

  // 2. 临时替换 workspace:* 为实际版本
  const originalCoreDep = vue3Pkg.dependencies['@easemob-community/callkit-core']
  let needRestore = false

  if (originalCoreDep === 'workspace:*') {
    vue3Pkg.dependencies['@easemob-community/callkit-core'] = `^${corePkg.version}`
    writeJson(vue3PkgPath, vue3Pkg)
    needRestore = true
    console.log(`\n✓ 已临时将 callkit-vue3 的 callkit-core 依赖改为 ^${corePkg.version}`)
  }

  try {
    // 3. 发布 core（使用 npm 而非 pnpm，确保认证上下文一致）
    // 注意：路径必须带 ./ 前缀，否则 npm 会把 "packages/callkit-core" 误解析为 GitHub shorthand
    runNpm('npm publish ./packages/callkit-core --access public --no-git-checks' + (dryRun ? ' --dry-run' : ''))

    // 4. 发布 vue3（使用 npm 而非 pnpm，确保认证上下文一致）
    runNpm('npm publish ./packages/callkit-vue3 --access public --no-git-checks' + (dryRun ? ' --dry-run' : ''))

    // 5. 生成 tgz 到 release 目录
    const releaseDir = path.join(root, 'release')
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true })
    }

    // 清理旧 tgz（pnpm pack 对 scoped 包生成 easemob-community-callkit-vue3-x.x.x.tgz）
    const tgzName = `easemob-community-callkit-vue3-${version}.tgz`
    const oldTgz = path.join(releaseDir, tgzName)
    if (fs.existsSync(oldTgz)) {
      fs.rmSync(oldTgz)
    }

    run('cd packages/callkit-vue3 && pnpm pack --pack-destination ../../release')

    const generated = path.join(releaseDir, tgzName)
    if (fs.existsSync(generated)) {
      console.log(`\n✓ tgz 已生成: ${generated}`)
    } else {
      console.warn('\n⚠ 未找到生成的 tgz 文件，请检查 release/ 目录')
    }

    // 6. 打 git tag 并推送（dry-run 跳过）
    if (!dryRun) {
      run(`git tag -a v${version} -m "release: v${version}"`)
      run(`git push origin v${version}`)
      console.log(`\n✓ git tag v${version} 已创建并推送`)
    } else {
      console.log(`\n[dry-run] 跳过 git tag v${version}`)
    }

    console.log('\n=====================================')
    console.log('✓ 发布流程完成')
    console.log('=====================================')
    if (!dryRun) {
      console.log('\n下一步建议：')
      console.log('  1. 在 npm 官网确认包已发布:')
      console.log('     https://www.npmjs.com/package/@easemob-community/callkit-core')
      console.log('     https://www.npmjs.com/package/@easemob-community/callkit-vue3')
      console.log('  2. 在 GitHub 查看 tag:')
      console.log('     https://github.com/Easemob-Community/easemob-uikit-callkit/releases/tag/v' + version)
      console.log('  3. 在独立项目中安装验证:')
      console.log('     pnpm add @easemob-community/callkit-vue3')
      console.log('  4. 用 release/easemob-community-callkit-vue3-' + version + '.tgz 做离线集成测试:')
      console.log('     pnpm add file:/path/to/release/easemob-community-callkit-vue3-' + version + '.tgz')
    }
  } finally {
    // 7. 恢复 workspace:*
    if (needRestore) {
      vue3Pkg.dependencies['@easemob-community/callkit-core'] = originalCoreDep
      writeJson(vue3PkgPath, vue3Pkg)
      console.log('\n✓ 已恢复 callkit-vue3 的 workspace:* 依赖')
    }
  }
}

main().catch((err) => {
  console.error('\n✗ 发布失败:', err.message || err)
  process.exit(1)
})
