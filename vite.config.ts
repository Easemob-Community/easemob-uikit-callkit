import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^@easemob-community/callkit-vue3\/style\.css$/,
        replacement: resolve(__dirname, './packages/callkit-vue3/src/style.css')
      },
      {
        find: /^@easemob-community/callkit-vue3$/,
        replacement: resolve(__dirname, './packages/callkit-vue3/src/index.ts')
      },
      {
        find: /^@easemob-community/callkit-core$/,
        replacement: resolve(__dirname, './packages/callkit-core/src/index.ts')
      }
    ]
  }
})
