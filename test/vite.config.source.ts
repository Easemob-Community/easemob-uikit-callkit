import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// core/vue3 源码内 VERSION 由各自 vite 配置的 define 注入（core 用 __CALLKIT_VERSION__，vue3 用 __CALLKIT_VUE3_VERSION__），
// test 直接加载 src 时必须同样注入，否则运行时报 ReferenceError
const corePkg = JSON.parse(readFileSync(resolve(__dirname, '../packages/callkit-core/package.json'), 'utf-8'))
const vue3Pkg = JSON.parse(readFileSync(resolve(__dirname, '../packages/callkit-vue3/package.json'), 'utf-8'))

// 源码模式：直接引入 packages 目录下的源代码
export default defineConfig({
  plugins: [vue()],
  root: '.',
  server: {
    // 避免与 tgz 模式共用 5173 导致"实际跑的是另一个模式"
    port: 5173,
    strictPort: true
  },
  optimizeDeps: {
    // 这两个包在本地频繁重打包/切换版本，排除预构建可防止 Vite 缓存旧 dist
    exclude: ['@easemob-community/callkit-vue3', '@easemob-community/callkit-core']
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        core: resolve(__dirname, 'core-test.html'),
      },
    },
  },
  define: {
    '__CALLKIT_TEST_MODE__': JSON.stringify('source'),
    '__CALLKIT_VERSION__': JSON.stringify(corePkg.version),
    '__CALLKIT_VUE3_VERSION__': JSON.stringify(vue3Pkg.version)
  },
  resolve: {
    alias: [
      {
        find: /^@easemob-community\/callkit-vue3\/style\.css$/,
        replacement: resolve(__dirname, '../packages/callkit-vue3/src/style.css')
      },
      {
        find: /^@easemob-community\/callkit-vue3$/,
        replacement: resolve(__dirname, '../packages/callkit-vue3/src/index.ts')
      },
      {
        find: /^@easemob-community\/callkit-core$/,
        replacement: resolve(__dirname, '../packages/callkit-core/src/index.ts')
      }
    ]
  }
})
