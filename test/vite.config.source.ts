import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 源码模式：直接引入 packages 目录下的源代码
export default defineConfig({
  plugins: [vue()],
  root: '.',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        core: resolve(__dirname, 'core-test.html'),
      },
    },
  },
  define: {
    '__CALLKIT_TEST_MODE__': JSON.stringify('source')
  },
  resolve: {
    alias: [
      {
        find: /^@easemob\/callkit-vue3\/style\.css$/,
        replacement: resolve(__dirname, '../packages/callkit-vue3/src/style.css')
      },
      {
        find: /^@easemob\/callkit-vue3$/,
        replacement: resolve(__dirname, '../packages/callkit-vue3/src/index.ts')
      },
      {
        find: /^@easemob\/callkit-core$/,
        replacement: resolve(__dirname, '../packages/callkit-core/src/index.ts')
      }
    ]
  }
})
