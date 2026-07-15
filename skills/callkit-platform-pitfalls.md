---
name: callkit-platform-pitfalls
description: >
  汇总 CallKit 在各平台实现时容易重复踩的坑，以及必须遵守的防御性规则。
  供 AI 在生成/评审 callkit-xxx 平台代码时使用，目标是让通用问题只出现一次。
  触发时机：用户遇到通话 Bug、评审新平台代码、生成新的 callkit 平台包。
  关联文档：skills/callkit-problems.md、.agent/refactor-guide.md、
  skills/callkit-platform-porting.md、skills/callkit-core-integration.md
---

# CallKit 跨平台坑点与强制规则

## 一、通用规则（任何平台都必须遵守）

### 1. Provider / Core 初始化必须加“完成锁”

问题：Vue3 中 `EasemobChatCallKitProvider` 的 `onMounted` 和 `watch(chatClient)` 都会触发 `initCore`，导致 CallKitCore 被重建、RTC 状态重置。

强制规则：
- 同时维护 `coreInitializing` 和 `coreInitialized` 两个锁。
- 已初始化后不再重复初始化。
- 销毁时把两个锁都复位。

### 2. invite 入口必须做三层校验

问题：离线消息重投、过期 invite 会导致被叫端重复弹窗。

强制规则（单聊）：
- `msg.to === currentUserId`
- `ext.calleeDevId` 为空或等于当前设备 ID
- `msg.time` 未超过 `inviteTimeout + 10s`

强制规则（群聊）：
- 当前用户必须在 `ext.invitedMembers` 中
- 消息未过期

参考实现：`packages/callkit-core/src/core/CallKitCore.ts:handleTextMessage`

### 3. 异步 token 获取期间必须保护信令

问题：群聊被叫在 `fetchRtcToken` 期间收到 `cancelCall/leaveCall`，因状态机还是 IDLE 而被丢弃，导致已取消的通话仍弹窗。

强制规则：
- `CallKitCore` 维护 `pendingIncomingInvites` Map。
- `await fetchRtcToken` 前登记 `callId`。
- token 返回后检查是否已被 `aborted`。
- `handleCmdMessage` 中先拦截 pending invite 的取消/离开。

### 4. SignalRouter Handler 必须按领域隔离

问题：`answerCall` 同时注册给了单聊和群聊 Handler，群聊中一个成员拒绝会触发单聊状态机 `resetCore`，导致整个通话被挂断。

强制规则：
- `SingleCallSignalHandler.handleAnswerCall` 开头判断群聊类型，直接 `return []`。
- 群聊 `answerCall` 完全交给 `GroupCallSignalHandler`。

### 5. RTC 媒体状态不要全局共享

问题：Vue3 2.0.8 之前 `useCallKitRtc` 保存了全局 `_state`（`localStream / audioEnabled / videoEnabled / isConnected`），单聊和群聊共用。导致从单聊切换到群聊时，本地流被错误写入单聊域，或群聊挂断后单聊再发起通话状态残留。

强制规则：
- `RtcService` 只封装 SDK，不保存业务状态。
- 单聊域和群聊域各自订阅 `RtcService` 的媒体状态变化。
- 不要用 `isConnected` 这种全局 RTC 标志，用业务状态判断（单聊 `status === IN_CALL`、群聊 `session.isActive`）。

参考：`packages/callkit-vue3/src/services/RtcService.ts` 的 `subscribe*Change` API。

### 6. RTC uid ↔ userId 映射必须提前注册

问题：Agora 用数字 uid，业务用字符串 userId；映射没建立时 `user-joined` 事件找不到对应用户。

强制规则：
- `RtcAdapter.joinChannel` 之前，把已知的对端 userId 加入 pending 列表。
- 收到 `user-joined` 时优先用 pending 列表匹配，再用 `getUserIdByRTCUIds` 兜底。
- 群聊要预注册所有非本地参与者。

参考：`packages/callkit-vue3/src/services/RtcAdapter.ts`

### 7. 远程视频播放必须串行化

问题：iOS 端快速开关摄像头时，多个 `playRemoteVideo` 并发执行，Agora 同一个远程轨道被反复 stop/play，画面变成自己或黑屏。

强制规则：
- 给 `playRemoteVideo` 加锁 `isPlayingRemoteVideo`。
- 错误 `REMOTE_USER_IS_NOT_PUBLISHED` 不要重试，等待下一次 `user-published`。
- 先 `stop` 旧轨道、清空容器，再 `play` 新轨道。

### 8. 远程视频容器必须用正确元素

问题：Agora Web SDK 的 `IRemoteVideoTrack.play(element)` 要求传入 `<div>`，传入 `<video>` 会导致渲染异常。

强制规则：
- Web：远程视频容器是 `<div>`。
- 小程序/UniApp：使用 `<live-player>`，不能直接用 `<video>`。

### 9. 资源清理顺序必须固定

强制顺序：
1. unpublish 本地轨道
2. 停止并关闭本地轨道
3. 离开 RTC 频道
4. 清空 DOM / 重置播放器
5. 重置业务状态

### 10. 版本号必须从 package.json 注入

问题：源码硬编码 `VERSION` 导致发版后日志版本和实际包版本不一致。

强制规则：
- `vite.config.ts` 用 `define: { __CALLKIT_VERSION__: JSON.stringify(pkg.version) }`。
- 源码 `declare const __CALLKIT_VERSION__: string`。

### 11. 不要 inline 打包状态管理库

问题：callkit-vue3 2.0.4 把 Pinia inline 打包，webpack 项目出现 `getActivePinia()` 错误。

强制规则：
- 状态库作为 `peerDependency` 或让用户自行传入。
- 如果必须内置，不要做任何条件注入，始终安装自己的实例。

## 二、UniApp / 小程序特有风险

### 1. RTC SDK 不是 `agora-rtc-sdk-ng`

Web 版 SDK 不能直接在小程序运行。使用：
- **微信小程序**：Agora 小程序 SDK（`agora-miniapp-sdk` 或官方小程序插件）
- **UniApp**：Agora UniApp 插件 / 原生插件

`RtcAdapter` 内部要调用的是小程序/UniApp API，不是 `AgoraRTC.createClient`。

### 2. `<live-pusher>` / `<live-player>` 有严格 DOM 限制

- 一个页面最多只能有一个 `<live-pusher>`。
- `<live-player>` 数量受小程序性能限制，通常建议最多 4 路。
- 切换摄像头、静音通过组件属性控制，不是 SDK track API。

### 3. 前后台切换会中断推流

强制规则：
- `onHide` / 切后台时暂停本地预览并提示用户。
- `onShow` 返回前台后重新加入或恢复推流（按业务策略）。
- 不要把页面 `unload` 误当成挂断。

### 4. 来电唤醒不能靠 DOM

小程序没有后台 WebSocket，被叫不在当前页面时：
- 需要服务端推送 + VoIP（iOS）或普通推送（Android）。
- 点击推送进入指定页面后，再初始化/恢复 CallKitCore。

### 5. 包大小和权限

- Agora 小程序 SDK 会增加主包体积，注意分包。
- 提前在 `app.json` 声明 `camera` / `record` 权限，并在运行时再次请求。

## 三、AI 生成代码时的自检 Prompt

在生成/评审新的 callkit-xxx 平台代码前，AI 必须逐条确认：

```text
[ ] Provider/Core 初始化是否有双重锁？
[ ] invite 入口是否做了 calleeDevId / message.to / invitedMembers / 时间戳校验？
[ ] fetchRtcToken 异步窗口是否有 pendingIncomingInvites 保护？
[ ] SingleCallSignalHandler 是否对群聊 answerCall 直接 return []？
[ ] RTC 媒体状态是否按单聊/群聊领域隔离，没有全局 RTC Store？
[ ] RtcAdapter.joinChannel 前是否预注册了 uid→userId 映射？
[ ] 远程视频播放是否有串行锁和 REMOTE_USER_IS_NOT_PUBLISHED 降级？
[ ] 远程视频容器是否使用了平台要求的元素（div / live-player）？
[ ] 挂断/销毁时是否按 unpublish → stop tracks → leave → reset 顺序清理？
[ ] 版本号是否由构建工具从 package.json 注入？
[ ] 状态管理库是否没有 inline 打包？
```

全部勾选后，方可认为该平台基础实现具备可测性。
