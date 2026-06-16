import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import path from 'path'
import fs from 'fs'

const cleanDist = () => ({
  name: 'clean-dist',
  buildStart() {
    const distPath = path.resolve(__dirname, 'dist')
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true })
    }
    fs.mkdirSync(distPath, { recursive: true })
  }
})

const fixTypesEntry = () => ({
  name: 'fix-types-entry',
  closeBundle() {
    const distDir = path.resolve(__dirname, 'dist')
    const generatedDir = path.join(distDir, 'callkit-vue3', 'src')
    const generatedDts = path.join(generatedDir, 'index.d.ts')
    if (!fs.existsSync(generatedDts)) return

    // 将 callkit-vue3/src/* 提升到 dist 根目录
    const entries = fs.readdirSync(generatedDir, { withFileTypes: true })
    for (const entry of entries) {
      const src = path.join(generatedDir, entry.name)
      const dest = path.join(distDir, entry.name)
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true })
      }
      fs.renameSync(src, dest)
    }
    fs.rmSync(path.join(distDir, 'callkit-vue3'), { recursive: true, force: true })

    // 入口 dts 已经位于正确位置
    fs.copyFileSync(path.join(distDir, 'index.d.ts'), path.join(distDir, 'index.d.ts'))
  }
})

export default defineConfig({
  plugins: [
    cleanDist(),
    vue(),
    fixTypesEntry(),
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      outDir: 'dist',
      tsconfigPath: './tsconfig.json',
      rollupTypes: false,
      insertTypesEntry: true,
      copyDtsFiles: true
    })
  ],
  build: {
    outDir: 'dist',
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'EasemobCallKitVue3',
      formats: ['es', 'umd'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'umd.js'}`
    },
    cssCodeSplit: false,
    rollupOptions: {
      external: [
        'vue',
        'vue-i18n',
        'pinia',
        'agora-rtc-sdk-ng',
        'easemob-websdk',
        '@easemob-community/callkit-core'
      ],
      output: {
        exports: 'named',
        globals: {
          vue: 'Vue',
          'vue-i18n': 'VueI18n',
          pinia: 'Pinia',
          'agora-rtc-sdk-ng': 'AgoraRTC',
          'easemob-websdk': 'WebSDK',
          '@easemob-community/callkit-core': 'EasemobCallKitCore'
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'style.css'
          }
          return assetInfo.name || ''
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
