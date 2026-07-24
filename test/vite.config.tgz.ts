import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// core src 内 VERSION 由其 vite 配置的 define 注入（__CALLKIT_VERSION__），
// tgz 模式下 core 别名到 src，必须同样注入，否则运行时报 ReferenceError
// 注意：tgz 包内 callkit-vue3 的版本号在打包时已经通过 __CALLKIT_VUE3_VERSION__ 固化进 dist，
// 这里不要定义 __CALLKIT_VUE3_VERSION__，否则会把 tgz 里的版本号也覆盖成 core 版本
const corePkg = JSON.parse(readFileSync(resolve(__dirname, '../packages/callkit-core/package.json'), 'utf-8'))

// tgz 包模式：使用打包后的 .tgz 文件作为依赖
// 需要在 test 目录下安装 tgz 包：pnpm add ../release/easemob-community-callkit-vue3-2.1.2.tgz
export default defineConfig({
  plugins: [vue()],
  root: '.',
  server: {
    // 避免与 source 模式共用 5173 导致"实际跑的是另一个模式"
    port: 5173,
    strictPort: true
  },
  optimizeDeps: {
    // callkit-vue3 在本地频繁重打包/切换版本，排除预构建可防止 Vite 缓存旧 dist
    exclude: ['@easemob-community/callkit-vue3']
  },
  define: {
    '__CALLKIT_TEST_MODE__': JSON.stringify('tgz'),
    '__CALLKIT_VERSION__': JSON.stringify(corePkg.version)
  },
  resolve: {
    alias: {
      // tgz 模式下 callkit-vue3 从 node_modules 中解析
      // callkit-core 仍指向源码，便于同步调试核心变更
      '@easemob-community/callkit-core': resolve(__dirname, '../packages/callkit-core/src/index.ts')
    }
  }
})
