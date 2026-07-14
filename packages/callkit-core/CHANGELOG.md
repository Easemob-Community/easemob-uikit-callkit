# @easemob-community/callkit-core

## 2.0.8

### Patch Changes

- 修复主叫方挂断时 targetId 推导为空串导致 sendCmdMessage 失败；新增 RTC user-left 兜底挂断；优化视频流订阅校验与错误降级；补充 hangup 失败日志。

## 2.0.7

### Patch Changes

- fea09fe: fix(core): 版本号从 package.json 动态注入，避免硬编码与实际版本不一致

  - 移除 `src/index.ts` 中硬编码的 `VERSION = '1.1.0'`
  - 通过 Vite `define` 注入 `__CALLKIT_VERSION__`，与 `package.json.version` 保持一致

## 2.0.6

### Patch Changes

- fix(vue3): 控制台初始化日志版本号改为从 package.json 动态注入

  - 修复 `[EasemobChatCallKit] v2.0.0 initialized` 与实际包版本不一致的问题
  - 通过 Vite `define` 注入 `__CALLKIT_VERSION__`，避免 src/index.ts 硬编码版本号

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
