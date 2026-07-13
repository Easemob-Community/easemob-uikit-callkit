import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import callkitVue3Pkg from './packages/callkit-vue3/package.json'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __CALLKIT_VERSION__: JSON.stringify(callkitVue3Pkg.version),
  },
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: new RegExp('^@easemob-community/callkit-vue3/style\\.css$'),
        replacement: resolve(__dirname, './packages/callkit-vue3/src/style.css')
      },
      {
        find: new RegExp('^@easemob-community/callkit-vue3$'),
        replacement: resolve(__dirname, './packages/callkit-vue3/src/index.ts')
      },
      {
        find: new RegExp('^@easemob-community/callkit-core$'),
        replacement: resolve(__dirname, './packages/callkit-core/src/index.ts')
      }
    ]
  }
})
