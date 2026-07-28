# @easemob-community/callkit-vue3

## 2.2.0

### Minor Changes

- feat: 被叫资料随 answerCall 信令回传（与 invite 的 callerInfo 对称）

  - core：`answerCall` ext 新增可选字段 `ease_chat_uikit_user_info`；`AnswerCallParams` 新增 `calleeInfo`；`callAccepted`/`singleCallAccepted`/`groupCallAccepted` 事件 payload 携带 `calleeInfo`
  - vue3：`accept()` 自动回传本地缓存的本人资料；`callAccepted` 时将被叫资料写入 `userInfoMap`
  - 修复主叫侧无法展示被叫昵称/头像（此前只能依赖服务端用户属性），覆盖通话中界面与对方关摄像头占位

### Patch Changes

- Updated dependencies
  - @easemob-community/callkit-core@2.2.0

## 2.1.0

### Minor Changes

- - 修复被叫待接听弹窗优先显示主叫方传入的 `callerInfo`，缺失时兜底 enrich 用户资料。
  - 新增 `useCallKit().setUserInfo(userId, info)` 与 `useCallKit().setUserInfoMap(map)` API，支持业务方主动注入昵称/头像。
  - 群聊通话中新加入用户若缓存无资料，自动通过 Provider 拉取并更新参与者资料。

### Patch Changes

- Updated dependencies
  - @easemob-community/callkit-core@2.1.0

## 2.0.8

### Patch Changes

- 修复主叫方挂断时 targetId 推导为空串导致 sendCmdMessage 失败；新增 RTC user-left 兜底挂断；优化视频流订阅校验与错误降级；补充 hangup 失败日志。
- Updated dependencies
  - @easemob-community/callkit-core@2.0.8

## 2.0.7

### Patch Changes

- chore(vue3): 升级 bundled callkit-core 并确保版本号动态注入

  - 同步依赖 `@easemob-community/callkit-core@2.0.7`，移除 core 硬编码版本号
  - callkit-vue3 初始化日志版本号继续从 package.json 动态注入

- Updated dependencies [fea09fe]
  - @easemob-community/callkit-core@2.0.7

## 2.0.6

### Patch Changes

- fix(vue3): 控制台初始化日志版本号改为从 package.json 动态注入

  - 修复 `[EasemobChatCallKit] v2.0.0 initialized` 与实际包版本不一致的问题
  - 通过 Vite `define` 注入 `__CALLKIT_VERSION__`，避免 src/index.ts 硬编码版本号

- Updated dependencies
  - @easemob-community/callkit-core@2.0.6

## 2.0.5

### Patch Changes

- 6d62581: fix(vue3): 始终安装 callkit 内部打包的 Pinia，避免 webpack/Vue CLI 环境下 Provider setup 报 getActivePinia 错误

  - 移除 `app.config.globalProperties.$pinia` 条件判断，改为无条件 `app.use(createPinia())`
  - 修复 Vue CLI + webpack 项目中 2.0.4 出现的 `getActivePinia() was called but there was no active Pinia` 错误
  - 顺带消除因 Provider 渲染失败导致的 `usePlayRing.js` audio 元素为 null 的二次报错

- Updated dependencies [6d62581]
  - @easemob-community/callkit-core@2.0.5

## 2.0.4

### Patch Changes

- feat: 支持主动更新 IM Client 实例（账号切换场景）

  - `callkit-core` 的 `CallKitCore`、`IMListener`、`SignalSender` 新增 `updateImClient(client)` 方法，切换账号时可热更新底层 IM 实例，不丢失当前通话状态。
  - `callkit-vue3` 的 `chatClientStore` 内聚 IM 连接状态监听绑定/解绑逻辑，`setClient` 时自动同步连接状态。
  - `useCallKitCore()` 新增 `updateImClient(client)` 方法，业务层可在账号切换登录后主动调用，确保 InvitationNotification 等组件正确识别 ChatClient 就绪状态。
  - `EasemobChatCallKitProvider` 简化 client 监听逻辑，依赖 `chatClientStore` 内聚的状态管理。

- Updated dependencies
  - @easemob-community/callkit-core@2.0.4

## 2.0.3

### Patch Changes

- fix(vue3): 修复账号切换后 InvitationNotification 误判 ChatClient 未就绪的问题

  - 在 `chatClientStore` 中新增 `isConnected` 状态，用于准确反映 IM 客户端的连接/登录状态。
  - `EasemobChatCallKitProvider` 在接收到 `chatClient` 时绑定 `onConnected` / `onDisconnected` / `onLogout` 事件监听，实时同步连接状态。
  - `InvitationNotification` 的 `isChatClientReady` 判断改为优先使用 `isConnected`，并以 `deviceId` 兜底，避免仅依赖非响应式的 `client.context.jid.clientResource` 导致切换账号后无法弹窗。
  - @easemob-community/callkit-core@2.0.3

## 2.0.2

### Patch Changes

- fix(vue3): 修正依赖声明与产物形态

  - 将 `pinia` 从 `peerDependencies` 移入 `dependencies`，并在构建时内联打包，用户无需手动安装 Pinia。
  - 移除未在代码中使用的 `vue-i18n` 幽灵依赖声明。
  - 修复 CSS 产物文件名：`dist/callkit-vue3.css` 统一输出为 `dist/style.css`，与 `exports["./style.css"]` 保持一致。
  - 更新 README 中关于依赖自动带入和 UMD/CDN 使用的说明。
  - 修复 `test/scripts/switch-mode.mjs` 与 `test/package.json` 中错误的 tgz 文件名。
  - 为 `test` 项目 source 模式补充 `pinia` devDependency。
  - @easemob-community/callkit-core@2.0.2

## 2.0.1

### Patch Changes

- 055347c: - fix(vue3): `initConfig.logLevel` 现在同时控制 `@easemob-community/callkit-core` 的核心日志输出
  - fix(provider): callkit-core 版本号使用 WARN 级别输出，确保生产环境可见
  - style(single-call): 一对一视频通话本地预览小窗改为纵向长方形
  - chore(release): 完善发布流程，增加 typecheck、core 单测、自动 git tag
  - docs: 补充日志级别与核心日志的关系说明
- Updated dependencies [055347c]
  - @easemob-community/callkit-core@2.0.1
