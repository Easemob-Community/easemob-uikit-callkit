---
"@easemob-community/callkit-vue3": patch
"@easemob-community/callkit-core": patch
---

fix(vue3): 始终安装 callkit 内部打包的 Pinia，避免 webpack/Vue CLI 环境下 Provider setup 报 getActivePinia 错误

- 移除 `app.config.globalProperties.$pinia` 条件判断，改为无条件 `app.use(createPinia())`
- 修复 Vue CLI + webpack 项目中 2.0.4 出现的 `getActivePinia() was called but there was no active Pinia` 错误
- 顺带消除因 Provider 渲染失败导致的 `usePlayRing.js` audio 元素为 null 的二次报错
