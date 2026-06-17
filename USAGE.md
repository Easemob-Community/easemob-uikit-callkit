# Easemob Chat CallKit Vue3 — API 参考

本文档提供完整的 API 参考，涵盖所有组件、Composables、Store、类型和常量。

> 关于**安装和快速开始**，参见 [`README.md`](./README.md) 和 [`QUICK_START.md`](./QUICK_START.md)。

---

## 📦 导出清单

```typescript
import {
  // 组件
  EasemobChatCallKitProvider,
  EasemobChatSingleCall,
  EasemobChatMultiCall,
  EasemobChatGroupMemberList,
  InvitationNotification,
  EasemobChatMiniWindow,
  GroupCallShell,

  // Composables
  useCallKit,
  useCallKitEvents,
  useCallKitCore,
  useRtcService,
  useParticipants,
  useDraggable,
  useCenteredDraggable,
  useCornerDraggable,

  // Store
  useRtcChannelStore,
  useGlobalCallStore,
  useCallTimerStore,

  // 服务 & 工具
  RtcService,
  DEFAULT_BACKGROUND_IMAGE,
  ICONS,
  getAssetUrl,
  Logger,

  // 常量
  CALL_STATUS,
  CALL_TYPE,
  HANGUP_REASON,
  LogLevel,
} from '@easemob-community/callkit-vue3'
```

---

## 🧩 组件 API

### EasemobChatCallKitProvider

通话根上下文组件。**必须在应用顶层包裹一次**。

```vue
<EasemobChatCallKitProvider
  :chat-client="chatClient"
  :agora-client="agoraClient"
  :is-mini-core="false"
  :get-user-info="getUserInfo"
  :get-group-info="getGroupInfo"
  :init-config="initConfig"
>
  <slot />
</EasemobChatCallKitProvider>
```

#### Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chatClient` | `Chat.Connection` | ✅ | 环信 IM 实例。传入后 Provider 自动保存到 `chatClientStore`，并挂载消息监听器 |
| `agoraClient` | `IAgoraRTCClient` | ❌ | 外部传入的 Agora RTC 客户端实例。不传时内部会创建占位实例，实际 AppId 在加入频道时从环信服务器动态获取 |
| `isMiniCore` | `boolean` | ❌ | 是否使用环信 IM SDK miniCore 版本（插件模式）。默认 `false` |
| `getUserInfo` | `(userIds: string[]) => Promise<Array<{ userId: string; nickname?: string; avatarUrl?: string }>>` | ❌ | 自定义用户资料 Provider。未传入时使用环信 SDK 默认接口 |
| `getGroupInfo` | `(groupIds: string[]) => Promise<Array<{ groupId: string; groupName?: string; groupAvatar?: string }>>` | ❌ | 自定义群组资料 Provider |
| `initConfig` | `object` | ❌ | 全局配置，见下表 |

#### initConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | `boolean` | `false` | 开启调试日志（等价于 `logLevel: LogLevel.VERBOSE`） |
| `logLevel` | `LogLevel` | `LogLevel.ERROR` | 日志输出级别。`0=ERROR, 1=WARN, 2=INFO, 3=DEBUG, 4=VERBOSE`。优先级高于 `debug`。该级别会同时作用于 UI 层与 `@easemob-community/callkit-core` 的核心日志 |
| `enableIDBLog` | `boolean` | `true` | 是否启用 IndexedDB 日志持久化。关闭后可进一步减少运行期开销 |
| `enableRingtone` | `boolean` | `true` | 开启呼叫铃声 |
| `inviteTimeout` | `number` | `30000` | 邀请超时时间（毫秒） |

---

### EasemobChatSingleCall

单人通话组件。自动根据通话状态显示/隐藏。

```vue
<EasemobChatSingleCall
  :target-user="targetUserId"
  :type="'video'"
  :background-image="'/my-bg.png'"
  @call-started="onStart"
  @call-ended="onEnd"
  @call-canceled="onCancel"
/>
```

#### Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `targetUser` | `string` | — | 目标用户 ID。不传时自动从 `callStateStore` 推断 |
| `type` | `'audio' \| 'video'` | — | 通话类型。不传时自动从 store 推断 |
| `backgroundImage` | `string` | CDN 默认图 | 自定义背景图 URL。离线场景可传本地路径如 `'/callkit-static-assets/images/callkit_bg.png'` |
| `enableRingtone` | `boolean` | `true` | 是否开启铃声 |

#### Events

| 事件 | 说明 |
|------|------|
| `@callStarted` | 通话界面开始显示 |
| `@callEnded` | 通话结束（状态变为 `IDLE`） |
| `@callCanceled` | 呼叫被取消 |

#### 显示规则

| 状态 | 是否显示 | 说明 |
|------|---------|------|
| `IDLE` | ❌ | 无通话 |
| `INVITING` | ✅ | 主叫等待中，显示 `CallWaiting` |
| `ALERTING` | ❌ | 被叫响铃中，由 `InvitationNotification` 接管 |
| `ANSWER_CALL` / `CONFIRM_CALLEE` | ✅ | 接听过渡态，显示 `CallStream` |
| `IN_CALL` | ✅ | 通话中，显示 `CallStream` |

---

### EasemobChatMultiCall

群组通话组件。自动根据群组通话状态显示/隐藏。

```vue
<EasemobChatMultiCall
  :group-id="groupId"
  :group-name="groupName"
  :group-avatar="groupAvatar"
  :type="'video'"
  :current-user-id="currentUserId"
  :auto-show="true"
  @call-started="onStart"
  @call-ended="onEnd"
  @add-participant="onAdd"
  @participant-timeout="onTimeout"
  @error="onError"
/>
```

#### Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `groupId` | `string` | `''` | 群组 ID |
| `groupName` | `string` | `''` | 群组名称 |
| `groupAvatar` | `string` | `''` | 群组头像 URL |
| `type` | `'audio' \| 'video'` | `'video'` | 通话类型 |
| `currentUserId` | `string` | `''` | 当前用户 ID。不传时自动从 `chatClientStore` 获取 |
| `autoShow` | `boolean` | `true` | 是否根据通话状态自动显示/隐藏。设为 `false` 时可完全由外部 `v-if` 控制 |

#### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `@callStarted` | — | 通话开始 |
| `@callEnded` | — | 通话结束 |
| `@addParticipant` | — | 点击添加参与者按钮 |
| `@participantTimeout` | `userId: string` | 某参与者邀请超时 |
| `@error` | `error: Error` | 发生错误 |

---

### InvitationNotification

通话邀请通知组件。被叫方收到邀请时自动弹出接听/拒绝弹窗。

```vue
<InvitationNotification />
```

无需传入任何 Props，直接放置在 Provider 内部即可。

---

### EasemobChatMiniWindow

最小化通话窗口组件。通常由 `EasemobChatSingleCall` 内部自动使用，也可单独使用。

```vue
<EasemobChatMiniWindow
  @expand="onExpand"
  @close="onClose"
/>
```

#### Events

| 事件 | 说明 |
|------|------|
| `@expand` | 点击展开按钮 |
| `@close` | 点击关闭按钮 |

---

### GroupCallShell

群组通话壳组件，包含视频网格、控制栏、添加成员弹窗等。通常由 `EasemobChatMultiCall` 内部使用。

```vue
<GroupCallShell
  :group-id="groupId"
  :group-name="groupName"
  :current-user-id="currentUserId"
  :current-nickname="nickname"
  :current-avatar-url="avatar"
  :rtc-service="rtcService"
  @hangup="onHangup"
  @add-participant="onAdd"
/>
```

#### Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `groupId` | `string` | ✅ | 群组 ID |
| `groupName` | `string` | ❌ | 群组名称 |
| `currentUserId` | `string` | ✅ | 当前用户 ID |
| `currentNickname` | `string` | ❌ | 当前用户昵称 |
| `currentAvatarUrl` | `string` | ❌ | 当前用户头像 URL |
| `rtcService` | `RtcService \| null` | ❌ | RTC 服务实例 |

#### Events

| 事件 | 说明 |
|------|------|
| `@hangup` | 点击挂断按钮 |
| `@addParticipant` | 点击添加参与者按钮 |

#### Expose

通过 `ref` 可调用以下方法：

| 方法 | 参数 | 说明 |
|------|------|------|
| `startSession` | `{ sessionId, callType }` | 启动会话（幂等，重复调用安全） |
| `addRemoteParticipant` | `userId, nickname?, avatar?` | 添加远程参与者 |
| `markRemoteAccepted` | `userId` | 标记远程用户已接受 |
| `bindRtcService` | `RtcService` | 绑定 RTC 服务 |
| `unbindRtcService` | — | 解绑 RTC 服务 |
| `sendInvite` | `userIds, groupId, message` | 发送邀请 |

---

## 🔧 Composables API

### useCallKit()

**统一的通话控制入口**。一个 hook 覆盖发起、接听、挂断、拒绝全部动作。

```typescript
const {
  call,        // 发起单人通话
  groupCall,   // 发起群组通话
  hangup,      // 挂断/结束通话
  cancel,      // 取消通话邀请
  accept,      // 接听通话
  reject,      // 拒绝通话
  rejectBusy,  // 忙碌拒绝
} = useCallKit()
```

#### call(params)

发起单人通话。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `params.targetId` | `string` | ✅ | 目标用户 ID |
| `params.type` | `'audio' \| 'video'` | ✅ | 通话类型 |
| `params.msg` | `string` | ❌ | 邀请消息。不传时默认：`"邀请您进行语音通话"` / `"邀请您进行视频通话"` |
| `params.userInfo` | `{ nickname?: string; avatarURL?: string }` | ❌ | 主叫方头像昵称。传入后优先写入 invite 消息扩展字段，被叫方可直接显示 |

```typescript
await call({ targetId: 'user123', type: 'video' })
await call({ targetId: 'user123', type: 'audio', msg: '快来语音聊天' })
await call({
  targetId: 'user123',
  type: 'video',
  userInfo: { nickname: '张三', avatarURL: 'https://example.com/avatar.png' }
})
```

#### groupCall(params)

发起群组通话。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `params.groupId` | `string` | ✅ | 群组 ID |
| `params.members` | `string[]` | ✅ | 被邀请成员列表 |
| `params.type` | `'audio' \| 'video'` | ✅ | 通话类型 |
| `params.msg` | `string` | ❌ | 邀请消息 |
| `params.groupName` | `string` | ❌ | 群组名称 |
| `params.groupAvatar` | `string` | ❌ | 群组头像 URL |
| `params.userInfo` | `{ nickname?: string; avatarURL?: string }` | ❌ | 主叫方头像昵称 |

```typescript
await groupCall({
  groupId: 'group123',
  members: ['user1', 'user2', 'user3'],
  type: 'video',
  msg: '邀请加入视频会议'
})

await groupCall({
  groupId: 'group123',
  members: ['user1', 'user2'],
  type: 'video',
  groupName: '产品组',
  userInfo: { nickname: '张三', avatarURL: 'https://example.com/avatar.png' }
})
```

#### hangup(reason?)

挂断当前通话。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | `HANGUP_REASON` | ❌ | 挂断原因，默认 `HANGUP_REASON.HANGUP` |

```typescript
await hangup()
await hangup(HANGUP_REASON.CANCEL)
```

#### cancel()

取消正在发起的呼叫（等同于 `hangup(HANGUP_REASON.CANCEL)`）。

```typescript
await cancel()
```

#### accept()

被叫方接听通话。

```typescript
await accept()
```

#### reject()

被叫方拒绝通话。

```typescript
await reject()
```

#### rejectBusy()

被叫方忙碌拒绝。

```typescript
await rejectBusy()
```

---

### useCallKitEvents()

**通话生命周期事件订阅**。用于监听通话全生命周期中的关键事件。所有订阅方法都返回**解绑函数**，建议在 `onUnmounted` 中调用。

```typescript
const {
  // 通用 API
  on, once, off,
  // 通用生命周期
  onStatusChanged,
  onIncomingCall,
  onCallInvited,
  onCallStarted,
  onCallEnded,
  onCallCanceled,
  onCallRefused,
  onCallTimeout,
  onCallBusy,
  // 精确单聊事件
  onSingleCallInvited,
  onSingleCallStarted,
  onSingleCallConnected,
  onSingleCallEnded,
  onSingleCallCanceled,
  onSingleCallRefused,
  onSingleCallTimeout,
  onSingleCallBusy,
  // 精确群聊事件
  onGroupCallInvited,
  onGroupCallStarted,
  onGroupCallConnected,
  onGroupCallEnded,
  onGroupCallCanceled,
  onGroupCallRefused,
  onGroupCallTimeout,
  onGroupCallBusy,
  // 群聊成员
  onParticipantJoined,
  onParticipantLeft,
  // 其他
  onCallDurationUpdated,
  onCallError,
  // 通话记录
  getCallRecord,
  clearCallRecord,
} = useCallKitEvents()
```

#### 使用示例

```typescript
import { useCallKitEvents } from '@easemob-community/callkit-vue3'
import { onUnmounted } from 'vue'

const { onCallStarted, onCallEnded, onIncomingCall, onCallRefused } = useCallKitEvents()

const unbindStarted = onCallStarted((e) => {
  console.log('通话开始', e.callId, e.channel, 'isCaller:', e.isCaller)
})

const unbindEnded = onCallEnded((e) => {
  const durationSec = Math.round(e.duration / 1000)
  console.log('通话结束', '原因:', e.reason, '时长:', durationSec, '秒')
})

const unbindIncoming = onIncomingCall((e) => {
  console.log('收到来自', e.callerUserId, '的通话邀请')
})

onUnmounted(() => {
  unbindStarted()
  unbindEnded()
  unbindIncoming()
})
```

#### 事件列表

| 便捷方法 | 事件名 | 触发时机 |
|----------|--------|----------|
| `onStatusChanged` | `statusChanged` | 每次通话状态变化 |
| `onIncomingCall` | `incomingCall` | 收到通话邀请（文本消息） |
| `onCallInvited` | `callInvited` | 通话邀请已发出/收到 |
| `onCallStarted` | `callStarted` | 双方/多方接通进入 `IN_CALL` |
| `onCallEnded` | `callEnded` | 通话结束，状态重置为 `IDLE` |
| `onCallCanceled` | `callCanceled` | 通话被取消 |
| `onCallRefused` | `callRefused` | 通话被拒绝 |
| `onCallTimeout` | `callTimeout` | 通话邀请超时 |
| `onCallBusy` | `callBusy` | 对方忙线 |
| `onSingleCallInvited` | `singleCallInvited` | 单聊邀请阶段 |
| `onSingleCallStarted` | `singleCallStarted` | 单聊通话开始 |
| `onSingleCallConnected` | `singleCallConnected` | 单聊通话已连接 |
| `onSingleCallEnded` | `singleCallEnded` | 单聊通话结束 |
| `onGroupCallInvited` | `groupCallInvited` | 群聊邀请阶段 |
| `onGroupCallStarted` | `groupCallStarted` | 群聊通话开始 |
| `onGroupCallConnected` | `groupCallConnected` | 群聊通话已连接 |
| `onGroupCallEnded` | `groupCallEnded` | 群聊通话结束 |
| `onParticipantJoined` | `participantJoined` | 群通话成员加入 |
| `onParticipantLeft` | `participantLeft` | 群通话成员离开 |
| `onCallDurationUpdated` | `callDurationUpdated` | 通话时长更新 |
| `onCallError` | `callError` | 通话错误 |

#### 通用 API

```typescript
const { on, once, off } = useCallKitEvents()

const unbind = on('callEnded', (e) => { ... })
once('callStarted', (e) => { ... })
off('callEnded', handler)
```

#### 通话记录

```typescript
const { onCallEnded, getCallRecord } = useCallKitEvents()

onCallEnded(() => {
  const record = getCallRecord()
  // record: { callId, conversationId, chatType, from, to, status, duration, timestamp, endedBy }
})
```

---

### useCallKitCore()

底层核心访问入口。主要用于高级场景，如直接读取响应式状态、调用 `callkit-core` API、订阅原始事件。

```typescript
const {
  callState,
  groupSession,
  groupParticipants,
  lastEvent,
  eventLog,
  error,
  isInitialized,

  inviteCall,
  answerCall,
  hangup,
  inviteGroupCall,
  inviteMoreParticipants,
  toggleAudio,
  toggleVideo,
  reportRtcEvent,
  destroy,

  onCallEvent,

  canAccept,
  canReject,
  canHangup,
  isWaitingCalleeAction,
  isInActiveCall,
  isInCall,
  isCalling,
  isIdle,
} = useCallKitCore()
```

> 普通业务建议优先使用 `useCallKit()` 和 `useCallKitEvents()`。

---

### useRtcService()

获取并管理 RTC 服务实例。

```typescript
const { rtcService, isReady, init, destroy } = useRtcService()
```

> 通常由 `EasemobChatCallKitProvider` 内部自动初始化，不需要手动调用。

---

### useParticipants(currentUserId?)

**已废弃**。旧架构的参与者列表生成器。群组通话请使用 `GroupCallStore` 的 `participantList`。

```typescript
const { participants } = useParticipants()
```

---

### useDraggable(options)

拖拽定位 composable。用于实现通话窗口的拖拽居中/角落定位。

```typescript
const {
  elementRef,
  isDragging,
  hasDragged,
  style,
  startDrag,
} = useDraggable({
  centered: true,
  width: 360,
  height: 640,
  boundary: true,
  boundaryPadding: 20,
})
```

#### 便捷别名

```typescript
const { elementRef, style, startDrag } = useCenteredDraggable({ width, height })

const { elementRef, style, startDrag } = useCornerDraggable({
  corner: 'bottom-right',
  offsetX: 20,
  offsetY: 20,
})
```

---

## 📊 Store API

CallKit 内部使用 Pinia 管理状态。以下 Store 已暴露在库入口中，供高级场景使用。

### useRtcChannelStore

RTC 频道状态 store。管理 RTC 连接、本地/远程媒体流、频道列表等。

```typescript
const store = useRtcChannelStore()
```

#### State

| 字段 | 类型 | 说明 |
|------|------|------|
| `channels` | `Record<string, RtcChannelInfo>` | 频道列表 |
| `activeChannelId` | `string \| null` | 当前活跃频道 ID |
| `isConnected` | `boolean` | 是否已连接 RTC |
| `localStream` | `MediaStream \| null` | 本地媒体流 |
| `remoteStreams` | `Record<string, MediaStream>` | 远程用户媒体流映射 |
| `audioEnabled` | `boolean` | 音频是否开启 |
| `videoEnabled` | `boolean` | 视频是否开启 |
| `agoraAppId` | `string \| null` | Agora App ID |

#### Getters

| Getter | 返回类型 | 说明 |
|--------|---------|------|
| `activeChannel` | `RtcChannelInfo \| null` | 当前活跃频道 |
| `getRtcService()` | `RtcService` | 获取 `RtcService` 实例 |

#### Actions

| Action | 说明 |
|--------|------|
| `initializeRtcService(appId, agoraClient?)` | 初始化 RTC 服务 |
| `destroyRtcService()` | 销毁 RTC 服务 |
| `setLocalStream(stream)` | 设置本地流 |
| `addRemoteStream(userId, stream)` | 添加远程流 |
| `removeRemoteStream(userId)` | 移除远程流 |
| `setAudioEnabled(enabled)` | 设置音频开关 |
| `setVideoEnabled(enabled)` | 设置视频开关 |
| `reset()` | 重置所有 RTC 状态 |

---

### useGlobalCallStore

跨通话域的共享状态。管理用户资料映射、窗口最小化状态等。

```typescript
const store = useGlobalCallStore()
```

#### State

| 字段 | 类型 | 说明 |
|------|------|------|
| `userInfoMap` | `Map<string, { nickname?, avatarURL? }>` | 用户资料映射 |
| `isMinimized` | `boolean` | 通话窗口是否最小化 |

#### Actions

| Action | 参数 | 说明 |
|--------|------|------|
| `setUserInfo(userId, userInfo)` | `string, { nickname?, avatarURL? }` | 设置用户资料 |
| `setMinimized(value)` | `boolean` | 设置最小化状态 |

#### Getters

| Getter | 返回类型 | 说明 |
|--------|---------|------|
| `getUserInfo(userId)` | `{ nickname?, avatarURL? }` | 获取用户资料 |

---

### useCallTimerStore

通话计时器。管理通话时长计时和格式化显示。

```typescript
const store = useCallTimerStore()
```

#### State

| 字段 | 类型 | 说明 |
|------|------|------|
| `callDuration` | `number` | 通话时长（秒） |
| `callStartTime` | `number` | 计时开始时间戳 |

#### Getters

| Getter | 返回类型 | 说明 |
|--------|---------|------|
| `formattedCallDuration` | `string` | 格式化时长，如 `"05:32"` 或 `"01:05:32"` |

#### Actions

| Action | 说明 |
|--------|------|
| `startCallTimer()` | 开始计时 |
| `stopCallTimer()` | 停止计时并清零 |
| `reset()` | 重置 |

---

## 🔢 类型与常量

### CALL_STATUS

```typescript
import { CALL_STATUS } from '@easemob-community/callkit-vue3'

CALL_STATUS.IDLE              // 0  空闲
CALL_STATUS.INVITING          // 1  主叫邀请中
CALL_STATUS.ALERTING          // 2  被叫响铃中
CALL_STATUS.CONFIRM_RING      // 3  响铃确认
CALL_STATUS.RECEIVED_CONFIRM_RING // 4  收到响铃确认
CALL_STATUS.ANSWER_CALL       // 5  已应答（发送 answerCall 后）
CALL_STATUS.CONFIRM_CALLEE    // 6  被叫确认
CALL_STATUS.IN_CALL           // 7  通话中
```

### CALL_TYPE

```typescript
import { CALL_TYPE } from '@easemob-community/callkit-vue3'

CALL_TYPE.AUDIO_1V1   // 0  一对一语音
CALL_TYPE.VIDEO_1V1   // 1  一对一视频
CALL_TYPE.VIDEO_MULTI // 2  多人视频
CALL_TYPE.AUDIO_MULTI // 3  多人语音
```

### HANGUP_REASON

```typescript
import { HANGUP_REASON } from '@easemob-community/callkit-vue3'

HANGUP_REASON.HANGUP               // 正常挂断
HANGUP_REASON.CANCEL               // 取消呼叫
HANGUP_REASON.REMOTE_CANCEL        // 对方取消
HANGUP_REASON.REFUSE               // 拒绝
HANGUP_REASON.REMOTE_REFUSE        // 对方拒绝
HANGUP_REASON.BUSY                 // 忙碌
HANGUP_REASON.NO_RESPONSE          // 无响应（超时）
HANGUP_REASON.REMOTE_NO_RESPONSE   // 对方无响应
HANGUP_REASON.HANDLE_ON_OTHER_DEVICE // 在其他设备处理
HANGUP_REASON.ABNORMAL_END         // 异常结束
```

---

## 🎨 进阶用法

### 自定义背景图

```vue
<EasemobChatSingleCall :background-image="'/my-bg.png'" />
```

### 离线静态资源

默认图标和背景图从 CDN 加载。如需离线使用：

1. 将 `packages/callkit-vue3/src/callkit-static-assets/` 复制到你项目的 `public/` 目录下
2. 使用本地路径：

```typescript
import { getAssetUrl, DEFAULT_BACKGROUND_IMAGE } from '@easemob-community/callkit-vue3'

const localBg = getAssetUrl(
  '/callkit-static-assets/images/callkit_bg.png',
  DEFAULT_BACKGROUND_IMAGE
)
```

### 设置用户资料（头像/昵称）

```typescript
import { useGlobalCallStore } from '@easemob-community/callkit-vue3'

const globalStore = useGlobalCallStore()
globalStore.setUserInfo('user123', {
  nickname: '张三',
  avatarURL: 'https://example.com/avatar.png'
})
```

### 自定义用户/群组资料 Provider

```vue
<EasemobChatCallKitProvider
  :chat-client="chatClient"
  :get-user-info="fetchUserInfos"
  :get-group-info="fetchGroupInfos"
>
</EasemobChatCallKitProvider>
```

```typescript
async function fetchUserInfos(userIds: string[]) {
  // 调用你自己的用户资料接口
  return userIds.map((userId) => ({
    userId,
    nickname: '昵称',
    avatarUrl: 'https://example.com/avatar.png'
  }))
}

async function fetchGroupInfos(groupIds: string[]) {
  return groupIds.map((groupId) => ({
    groupId,
    groupName: '群组名',
    groupAvatar: 'https://example.com/group-avatar.png'
  }))
}
```

### 日志级别配置

```typescript
import { LogLevel } from '@easemob-community/callkit-vue3'

const initConfig = { logLevel: LogLevel.WARN }
```

| 级别 | 值 | 输出内容 |
|------|-----|---------|
| `ERROR` | 0 | 错误日志 |
| `WARN` | 1 | 警告 + 错误 |
| `INFO` | 2 | 信息 + 警告 + 错误 |
| `DEBUG` | 3 | 调试 + 信息 + 警告 + 错误 |
| `VERBOSE` | 4 | 全部（包括详细信令日志） |

`initConfig.logLevel` 会同时控制 UI 层与 `@easemob-community/callkit-core` 的核心日志输出。例如设置为 `LogLevel.WARN` 时，`[CallKitCore]` 前缀的 INFO/DEBUG 日志也会被过滤。

### 调试信令

在 Provider 的 `initConfig` 中开启 `logLevel: LogLevel.VERBOSE`，浏览器控制台会输出完整信令收发日志。

---

## ❓ 常见问题

### Q1：组件为什么不显示？

1. 已调用 `app.use(EasemobChatCallKit)` 注册插件
2. `EasemobChatCallKitProvider` 已正确传入 `chatClient`
3. 组件已放置在 Provider 内部
4. 已调用 `call()` / `groupCall()` 发起通话

### Q2：被叫方收到邀请但没有弹窗？

检查 `InvitationNotification` 是否已放置在 Provider 内部：

```vue
<EasemobChatCallKitProvider :chat-client="chatClient">
  <InvitationNotification />
</EasemobChatCallKitProvider>
```

### Q3：Vite 热更新后通话状态丢失？

Vite HMR 会重置 Pinia state。开发时建议使用源码模式：`pnpm run test:source`。
