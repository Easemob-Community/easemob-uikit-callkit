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

### 12. 用户资料显示不要只依赖 Provider 异步拉取

问题：Vue3 点对点被叫弹窗、群聊新用户加入时，UI 先渲染出 userId，等 Provider 拉取到昵称/头像后才刷新。如果网络慢或 Provider 失败，用户会长时间看到 userId。

根因：
- `incomingCall` 事件 payload 里已经带了主叫方传入的 `callerInfo`，但平台层没有把它立即写入缓存。
- 群聊 `participantJoined` / RTC `user-joined` 时只读了 `GlobalCallStore`，没有触发 Provider 兜底拉取。
- 弹窗的 `onMounted` 兜底路径没有调用 enrich 逻辑。

强制规则：
- 收到 `incomingCall` / `groupCallInit` 时，把 `event.payload.callerInfo` 立即写入 `userInfoMap`。
- UI 渲染前读缓存；缓存没有时，若存在 Provider 则异步拉取，同时允许先显示 userId 兜底。
- 群聊新用户加入时，若缓存无资料必须调用 Provider 拉取并更新参与者资料。
- 暴露 `setUserInfo(userId, info)` / `setUserInfoMap(map)` API，让业务方在通话前主动注入，避免依赖 Provider。

参考：`packages/callkit-vue3/src/composables/useCallKitCore.ts` 的 `incomingCall` handler、`packages/callkit-vue3/src/modules/groupCall/media/RtcMediaBridge.ts` 的 `enrichParticipantProfile`。

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
- **微信小程序自定义组件不继承外部 class**：给 `agora-pusher` / `agora-player` 等自定义组件设置的 `class` 不会作用到组件根节点，除非配置 `styleIsolation` 或 `externalClasses`。因此定位、z-index、圆角等样式必须通过组件的 `:style` 内联绑定，或在组件内部实现。
- **原生组件层级由 DOM 顺序决定**：`<live-pusher>` / `<live-player>` 是原生组件，互相覆盖时 `z-index` 仅在同级定位元素间有效，最终层级更依赖首次渲染的 DOM 顺序。本地小窗应与远端画面保持同级，并确保本地小窗 DOM 在后。

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

### 6. 单聊 1v1 音视频页面布局陷阱

这次 uniapp 微信小程序单聊实现中踩过的具体坑：

#### 6.1 语音通话必须保持 media 组件存在

问题：语音通话时把 `agora-pusher` / `agora-player` 用 `v-if="false"` 移除，导致 RTC 推流/拉流中断，对方听不到声音或本端听不到对方。

强制规则：
- 只要处于 `in_call`，`agora-pusher` 和 `agora-player` 必须始终渲染。
- 语音通话时把它们尺寸设为 `1x1`、移出屏幕外或 `opacity: 0`，但不能销毁。
- `live-pusher` 的 `enable-camera` 设为 `false`，使其只推音频。

#### 6.2 v-if/v-else 结构会吞掉语音通话主内容区

问题：用 `v-if="showMediaLayer"` 渲染 media 层，再用 `v-else` 渲染头像/昵称主内容区。进入 `in_call` 后 `showMediaLayer` 为 true，`v-else` 分支完全不渲染，导致语音通话接通后页面只剩控制按钮和黑色背景。

强制规则：
- 主内容区条件应为 `!showVideoLayout`（或 `status !== 'in_call' || callType !== 'video'`），而不是 `!showMediaLayer`。
- 语音通话 `in_call` 时要同时显示 media 层和主内容区。

#### 6.3 本地小窗被远端画面覆盖

问题：把远端 `agora-player` 和本地 `agora-pusher` 放在同一个父容器内，依赖 `z-index` 让本地在上。微信小程序原生组件层级不严格遵循 CSS z-index，导致本地画面被远端画面覆盖或完全看不到。

强制规则：
- 本地小窗与远端画面保持**同级**（不要嵌套在不同层级的容器里）。
- 确保本地小窗 DOM 顺序在远端画面之后。
- 本地小窗使用内联 `style` 绑定 `position:absolute; z-index:2`。
- 预留右上角胶囊安全区：用 `uni.getMenuButtonBoundingClientRect()` 计算胶囊底部，本地小窗 `top` 从该位置开始。

#### 6.4 切换摄像头不能调 Agora Client API

问题：Agora 小程序 SDK 的 `Client` 没有 `switchCamera` 方法，调用 `client.switchCamera()` 无效。

强制规则：
- 切换摄像头必须获取 `agora-pusher` 自定义组件实例，调用其内部 `live-pusher` 的 `switchCamera()`。
- 在 UniApp Vue3 中给自定义组件加 `ref`，通过 `ref.value?.switchCamera?.()` 调用（需确保组件 methods 暴露）。

#### 6.5 Agora 小程序 SDK join 参数

问题：`Client.join(token, channel, uid, isAudioOnly, uidType)` 在真机上传入 `isAudioOnly` / `uidType` 会导致加入频道后立即断线（`Disconnected from server`）。

强制规则：
- 真机只传前三个参数：`client.join(token, channel, uid)`。
- `isAudioOnly` 通过 `live-pusher` 的 `enable-camera` 属性控制，不要通过 join 参数传递。

#### 6.6 stream-added 后的 url 来源

问题：依赖 `client.on('update-url')` 获取远端拉流地址，有时事件不触发或延迟，导致远端画面不显示。

强制规则：
- `client.on('stream-added')` 回调里直接 `await client.subscribe(uid)`，使用返回对象的 `url` 字段设置远端拉流地址。
- 同时保留 `update-url` 监听用于地址刷新，但不要把它作为唯一来源。

#### 6.7 本地画面比例

问题：本地小窗用正方形（`width === height` + `aspect="3:4"`）显示前置摄像头画面，效果很丑。

建议：
- 本地小窗采用竖屏 `9:16` 比例（`aspect="9:16"`，宽度约为屏幕 28%，高度 = 宽度 × 16 / 9）。
- 圆角 + 细边框 + 阴影，视觉更接近微信原生通话。

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
[ ] 用户资料是否三级兜底（主动 set / callerInfo / Provider）？
[ ] 群聊新用户加入时是否自动 enrich 用户资料？
[ ] (小程序) agora-pusher/player 的样式是否通过 :style 内联绑定，而非外部 class？
[ ] (小程序) 语音通话 in_call 时是否仍保留 pusher/player 组件（即使隐藏）？
[ ] (小程序) 本地小窗是否与远端画面同级且 DOM 顺序在后？
[ ] (小程序) 切换摄像头是否调用了 agora-pusher 组件实例的 switchCamera？
[ ] (小程序) Client.join 是否只传 (token, channel, uid) 三个参数？
[ ] (小程序) stream-added 中是否优先使用 subscribe 返回值的 url 字段？
```

全部勾选后，方可认为该平台基础实现具备可测性。
