# @easemob-community/callkit-core

## 2.0.5

### Patch Changes

- 6d62581: fix(vue3): 始终安装 callkit 内部打包的 Pinia，避免 webpack/Vue CLI 环境下 Provider setup 报 getActivePinia 错误

  - 移除 `app.config.globalProperties.$pinia` 条件判断，改为无条件 `app.use(createPinia())`
  - 修复 Vue CLI + webpack 项目中 2.0.4 出现的 `getActivePinia() was called but there was no active Pinia` 错误
  - 顺带消除因 Provider 渲染失败导致的 `usePlayRing.js` audio 元素为 null 的二次报错

## 2.0.4

### Patch Changes

- feat: 支持主动更新 IM Client 实例（账号切换场景）

  - `callkit-core` 的 `CallKitCore`、`IMListener`、`SignalSender` 新增 `updateImClient(client)` 方法，切换账号时可热更新底层 IM 实例，不丢失当前通话状态。
  - `callkit-vue3` 的 `chatClientStore` 内聚 IM 连接状态监听绑定/解绑逻辑，`setClient` 时自动同步连接状态。
  - `useCallKitCore()` 新增 `updateImClient(client)` 方法，业务层可在账号切换登录后主动调用，确保 InvitationNotification 等组件正确识别 ChatClient 就绪状态。
  - `EasemobChatCallKitProvider` 简化 client 监听逻辑，依赖 `chatClientStore` 内聚的状态管理。

## 2.0.3

## 2.0.2

## 2.0.1

### Patch Changes

- 055347c: - fix(vue3): `initConfig.logLevel` 现在同时控制 `@easemob-community/callkit-core` 的核心日志输出
  - fix(provider): callkit-core 版本号使用 WARN 级别输出，确保生产环境可见
  - style(single-call): 一对一视频通话本地预览小窗改为纵向长方形
  - chore(release): 完善发布流程，增加 typecheck、core 单测、自动 git tag
  - docs: 补充日志级别与核心日志的关系说明
