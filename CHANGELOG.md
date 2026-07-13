# Changelog

## 1.0.8 (2026-07-13)

### 新增
- **`peerUserId` getter**：`callStateStore` 新增 `peerUserId` 计算属性，根据当前用户角色（主叫/被叫）自动返回对端用户 ID，替代各处散落的 `calleeUserId || callerUserId` 手工判断逻辑

### 修复
- **视频通话占位文案**：对方关闭摄像头时，占位区域错误显示「连接中...」，修复为根据 RTC 连接状态动态区分——未接通时显示「连接中...」、已接通时显示「视频通话中」
- **`remoteUserName` 对端识别**：`EasemobChatCallStream` / `EasemobChatSingleCall` 中的对端用户 ID 获取统一改用 `callStateStore.peerUserId`，避免角色互换时取错对端导致昵称显示异常
- **`onCallEnded` 事件 `to` 字段**：群聊场景下 `to` 字段修正为使用 `event.conversationId`，与 `onCallStarted` 保持一致

### 优化
- **测试 App**：`startCall` / `startMultiCall` 不再使用硬编码 `userInfo`，改为每次呼叫前通过环信 SDK `fetchUserInfoById` 实时获取当前用户的最新昵称和头像

## 1.0.7 (2026-07-01)

### 修复
- **角色互换后二次通话失败**：修复「A 呼叫 B 结束后、紧接着 B 呼叫 A」时第二通无法接通、主叫超时的问题。
  - 根因：`resetCallState` 自 1.0.4 起保留 `callerUserId`/`callerDevId`，而作为被叫时该字段会被对端身份覆盖；由于 `initInviteInfo` 只设置被叫方，下一次发起呼叫会把上一通残留的对方 ID 当作主叫（`callerIMName`）发出，导致接收方误判自身角色（`localUserRole=caller`）、`confirmRing` 走入多端分支而中断。
  - 修复：`useCallKit.call/groupCall` 在发起呼叫前调用 `callStateStore.initCallState(chatClient)`，从当前登录的 chatClient 重新写入主叫身份（`callerUserId`/`callerDevId`/`token`）；同时 `resetCallState` 不再跨通话保留主叫身份，改由每次发起时重建，彻底消除身份跨通话残留。

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
