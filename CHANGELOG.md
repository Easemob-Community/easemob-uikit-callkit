# Changelog

## Unreleased

## 2.0.0 (2026-06-17)

### ⚠️ Breaking Changes
- **包名与仓库重命名**：原 `easemob-chat-callkit-vue3` 重命名为 `@easemob-community/callkit-vue3`，并拆出框架无关的 `@easemob-community/callkit-core`
- **npm scope 迁移**：scope 从 `@easemob` 迁移到 `@easemob-community`

### 架构
- **提取 callkit-core**：将信令路由、状态机、RTC 适配器等核心逻辑抽离为 `@easemob-community/callkit-core`，实现 UI 层与核心层解耦
- **SignalRouter + Handler 模式**：`useListenerManager` 退化为 IM 监听挂载器，信令分发由 `SignalRouter`、`SingleCallSignalHandler`、`GroupCallSignalHandler` 负责

### 修复
- **单聊远程视频画面错乱**：Agora 远程视频播放容器改为 `<div>`，并清理容器避免 video 元素叠加；增加播放锁防止快速切换摄像头时并发 play 导致画面显示为己方
- **单聊对方关闭摄像头体验**：对方关闭摄像头时显示"摄像头已关闭"占位，不再显示"连接中"
- **Provider 重复初始化**：增加 `coreInitialized` / `rtcInitialized` 锁，避免 Provider 重挂载或 watch 触发导致 `CallKitCore` / `RtcService` 重复初始化
- **日志级别统一**：`initConfig.logLevel` 现在同时控制 Vue3 UI 层与 `@easemob-community/callkit-core` 的核心日志输出
- **群聊 answerCall 路由重叠**：`SingleCallSignalHandler` 不再处理群聊 `answerCall`，彻底交给 `GroupCallSignalHandler`，避免一个被叫拒绝导致主叫端整个群聊通话被挂断，以及 accept 时 `confirmCallee` 重复发送
- **音频群聊 confirmRing 状态**：`AUDIO_MULTI` 群聊主叫在 `IN_CALL` 后收到 `alert` 时，回发 `status=true` 的 `confirmRing`，避免 iOS/Android 音频群聊被叫误判为通话已取消
- **群聊追加邀请退化**：`inviteMoreParticipants` 复用当前会话的 `groupName`，不再退化为 `groupId`
- **群聊被叫 fetchRtcToken 窗口期信令丢失**：新增 `pendingIncomingInvites` 机制，在群聊被叫获取 RTC token 期间拦截主叫的 `cancelCall` / `leaveCall`，避免已取消/已结束的邀请仍弹出 `incomingCall`

### 优化
- **本地视频小窗样式**：一对一视频通话本地预览小窗改为纵向长方形（120×160），更符合主流视频通话视觉

## 1.0.4 (2026-04-27)

### 修复
- **主叫身份重置**：`resetCallState` 不再清空 `callerDevId`/`callerUserId`，避免二次通话时身份丢失导致信令匹配失败
- **媒体控制假切换**：`useRtcService.toggleVideo/toggleAudio` 现在调用真实 `RtcService` 方法，未初始化时降级到仅更新 Store 状态
- **Token 过期刷新**：`useJoinChannel` 增加 Token 过期检测（默认 24h，提前 5 分钟刷新），避免长期缓存导致加入频道失败
- **群呼失败回滚**：`groupCall` 在 `joinChannel` 失败时自动销毁 `GroupCallStore` session 并重置 `callStateStore`，防止 UI 状态不一致
- **枚举比较错误**：`useEndCall.canCancel/canHangup` 修复字符串比较为 `CALL_STATUS` 枚举比较
- **监听器生命周期**：`useListenerManager` 新增 `unmountListeners`，Provider 卸载时正确移除 IM 事件监听

### 优化
- **npm 包结构**：构建产物从 `release/dist` 迁移到标准 `dist/` 目录，入口路径更符合 npm 包惯例

## 1.0.1 (2026-04-20)

### 修复
- **语音通话样式**：修复语音模式下页面半透明、头像毛玻璃效果残留、文字看不清等问题，语音与视频使用独立视觉风格
- **miniCore 兼容性**：
  - 兼容环信 IM SDK miniCore 版本的消息创建 API（`client.Message.create`）
  - 兼容 miniCore 插件模式的用户属性 API（`client.contact.fetchUserInfoById`）
  - 兼容 miniCore 插件模式的群组 API（`client.group.getGroupMembers`）
  - 新增 `isMiniCore` Provider 配置项，显式切换调用方式
- **样式文件版本控制**：修复 `lib/style.css` 被 `.gitignore` 排除导致其他开发者 build 失败的问题

### 优化
- **包体积**：Pinia 内部消化，无需用户项目手动安装；Agora/IM 外部化后 ESM 338KB / UMD 248KB
- **Plugin 类型**：`install(app, ...options: any[])` 兼容 Vue 3.5 严格类型

## 1.0.0 (2026-04-18)

### 首次发布
- Vue3 + Vite + Pinia 架构的单聊/群聊音视频通话组件库
- 支持 Agora RTC 外部传入客户端实例
- 支持环信 IM SDK 外部化依赖
