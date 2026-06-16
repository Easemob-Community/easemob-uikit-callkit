import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// tgz 包模式：使用打包后的 .tgz 文件作为依赖
// 需要在 test 目录下安装 tgz 包：pnpm add ../release/easemob-callkit-vue3-2.0.0.tgz
export default defineConfig({
  plugins: [vue()],
  root: '.',
  define: {
    '__CALLKIT_TEST_MODE__': JSON.stringify('tgz')
  },
  resolve: {
    alias: {
      // tgz 模式下 callkit-vue3 从 node_modules 中解析
      // callkit-core 仍指向源码，便于同步调试核心变更
      '@easemob-community/callkit-core': resolve(__dirname, '../packages/callkit-core/src/index.ts')
    }
  }
})
