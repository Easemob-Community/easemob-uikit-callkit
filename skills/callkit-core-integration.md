---
name: callkit-core-integration
description: >
  指导 AI 基于 @easemob-community/callkit-core 快速构建新的 CallKit 平台包
  （UniApp、微信小程序、React、Angular、原生 App 等）。重点讲清 core 的边界、
  平台必须实现哪些接口、哪些坑已经在 Vue3 踩过不要再踩。
  触发时机：用户说"基于 callkit-core 做一个 xx 平台的 callkit"、"帮我生成 callkit-xxx"
  "如何把 Vue3 callkit 迁到 xx 平台"。
  关联文档：skills/callkit-platform-porting.md、skills/callkit-platform-pitfalls.md、
  .agent/patterns.md、packages/callkit-core/README.md
---

# 基于 callkit-core 构建新平台 CallKit

## 一、core 的边界（它做什么、不做什么）

### callkit-core 负责

| 能力 | 入口 | 说明 |
|---|---|---|
| IM 监听挂载 | `CallKitCore` 构造函数 `imClient` | 自动监听文本/CMD 消息 |
| 信令路由 | `SignalRouter` + Handlers | 区分单聊/群聊、过滤过期消息 |
| 单聊状态机 | `SingleCallStateMachine` | INVITING → RINGING → IN_CALL → IDLE |
| 群聊会话 | `GroupCallSession` | 多方参与者集合、邀请超时管理 |
| 事件广播 | `onEvent` 回调 | 所有状态变化转成结构化事件 |
| RTC 调用 | `RtcAdapter` 接口 | 由平台实现，core 在合适时机调用 |
| 消息创建 | `createMessage` 工厂 | 平台传入，core 只负责填充 ext |

### callkit-core 不负责

- ❌ UI 渲染（弹窗、通话页面、视频格子）
- ❌ 具体 RTC SDK 封装（Web/小程序/UniApp SDK 不同）
- ❌ 全局用户资料管理（昵称/头像由平台提供）
- ❌ 状态管理库选型（Pinia/Zustand/Redux/Behavior 由平台决定）
- ❌ 来电唤醒推送（小程序 VoIP、浏览器通知等平台各自处理）

**结论**：新平台只需要做 4 件事——**IM 适配、RtcAdapter 实现、状态层、UI 层**。

---

## 二、平台必须提供的 4 个能力

### 1. IM 客户端适配

`CallKitCore` 构造函数需要 `imClient`，它必须支持：

```ts
interface EasemobConnectionLike {
  user: string                         // 当前用户 ID
  send(msg: any): Promise<any>        // 发送消息
  addEventHandler(handler: any): void   // 监听连接/消息事件
  removeEventHandler(handler: any): void
  // 可选：core 不强制要求，但 RtcAdapter 通常需要
  getRTCToken(channel: string): Promise<{ data: { RTCToken: string; appId: string; RTCUId: number } }>
  getUserIdByRTCUIds(uids: number[]): Promise<{ data: Record<number, string> }>
}
```

**注意**：
- 如果平台 SDK 的方法名/返回值结构与上表不同，**先包一层 adapter** 再传入 core，不要在 core 里写 `if (platform === 'xxx')`。
- `createMessage` 工厂必须能创建带 `ext` 的消息对象，core 会把 callId/channel/action 等字段放到 ext 里。

### 2. RtcAdapter 实现

这是新平台最核心、最容易踩坑的部分。必须实现：

```ts
import type { RtcAdapter } from '@easemob-community/callkit-core'

export function createPlatformRtcAdapter(): RtcAdapter {
  return {
    async joinChannel({ channel, token, uid, appId }) {
      // 1. 加入 RTC 频道
      // 2. 根据通话类型创建本地音频/视频轨道并发布
      // 3. 预注册已知的 uid → userId 映射（群聊尤为重要）
    },
    async leaveChannel() {
      // 1. 取消发布本地轨道
      // 2. 停止并释放本地轨道
      // 3. 离开频道
    },
    async publishLocalTracks(types) {},
    async unpublishLocalTracks(types) {},
    async subscribeRemoteUser(userId, mediaType) {},
    async unsubscribeRemoteUser(userId, mediaType) {},
    async setAudioEnabled(enabled) {},
    async setVideoEnabled(enabled) {},
  }
}
```

**RtcAdapter 的调用时机**：
- `joinChannel`：被叫接听 / 主叫收到 `confirmCallee` 后，core 发出 `shouldJoinRtc` 事件，平台监听该事件后调用 `core.rtcAdapter.joinChannel()`，或者让 core 直接调用（取决于封装方式）。
- `setAudioEnabled` / `setVideoEnabled`：用户点击静音/摄像头按钮时调用 `core.toggleAudio()` / `core.toggleVideo()`，core 内部调用 RtcAdapter。
- `leaveChannel`：`core.hangup()` 时调用，或收到 `shouldLeaveRtc` 事件时。

### 3. 状态层

状态层只保存 UI 需要的数据，**不要保存 RTC 轨道、MediaStream 等业务无关对象**。

| 域 | 必须字段 |
|---|---|
| 单聊 | `status / callId / channel / type / callerUserId / calleeUserId / audioEnabled / videoEnabled / callDuration / localStream` |
| 群聊 | `session / participants[] / callDuration` |
| 全局 | `userInfoMap / isMinimized` |

**阶段 4 后的重要经验**：
- `RtcService` 是单例，但**媒体状态必须按领域拆分**。
- 单聊域订阅 `RtcService.subscribeAudioEnabledChange` / `subscribeVideoEnabledChange` / `subscribeLocalStreamChange`。
- 群聊域也要订阅本地流变化，但写回到 `localParticipant.localStream`，不要和单聊状态混在一起。
- 不要用全局 `rtcChannelStore` 保存 `isConnected / localStream / audioEnabled / videoEnabled`。

### 4. UI 层

UI 层只依赖状态层和事件：

```ts
// 伪代码
core.onEvent((event) => {
  switch (event.type) {
    case 'incomingCall':
      showIncomingNotification(event.payload)
      break
    case 'callConnected':
    case 'callStarted':
      showSingleCallWindow()
      break
    case 'groupCallInit':
      showGroupCallWindow()
      break
    case 'callEnded':
    case 'callCanceled':
    case 'callRefused':
    case 'callTimeout':
    case 'callBusy':
      hideAllCallWindows()
      break
  }
})
```

---

## 三、与 callkit-vue3 的映射关系

| Vue3 实现 | 新平台对应 | 备注 |
|---|---|---|
| `EasemobChatCallKitProvider` | 平台根组件 / 应用入口初始化 | 必须加 `coreInitializing` / `coreInitialized` 双锁 |
| `useCallKitCore()` | 平台封装的 core 单例 + 响应式状态 | 不要每个组件都 new 一个 CallKitCore |
| `useCallKitRtc()` | 平台的 RtcService 容器 | 只存实例，不存状态 |
| `store/callTimer.ts` | 平台计时器 | 单聊/群聊可各有一个 |
| `store/globalCall.ts` | 平台全局状态 | userInfoMap / isMinimized |
| `components/singleCall/*` | 平台单聊 UI | 可用平台原生弹窗/页面 |
| `components/multiCall/GroupCallShell` | 平台群聊 UI | 小程序用 `<live-player>` 网格 |
| `modules/groupCall/media/RtcMediaBridge` | 平台群聊 RTC → 状态桥接 | 必须预注册 uid→userId 映射 |
| `services/RtcAdapter.ts` | 平台的 RtcAdapter 实现 | 调用平台 RTC SDK |

---

## 四、Vue3 已经踩过的坑（新平台不要再踩）

### 1. 不要全局保存 RTC 媒体状态

Vue3 2.0.8 之前 `useCallKitRtc` 保存了全局 `_state`，导致单聊/群聊互相污染。

**正确做法**：
```ts
// 单聊域
const singleCallState = {
  audioEnabled: ref(true),
  videoEnabled: ref(true),
  localStream: ref<MediaStream | null>(null),
}
rtcService.subscribeAudioEnabledChange((enabled) => singleCallState.audioEnabled.value = enabled)
rtcService.subscribeLocalStreamChange((stream) => singleCallState.localStream.value = stream)

// 群聊域
rtcService.subscribeLocalStreamChange((stream) => groupStore.setLocalStream(localUserId, stream))
```

### 2. Provider / Core 初始化必须加双锁

```ts
let coreInitializing = false
let coreInitialized = false

async function initCore() {
  if (coreInitializing || coreInitialized) return
  coreInitializing = true
  try {
    // ... 初始化
    coreInitialized = true
  } finally {
    coreInitializing = false
  }
}

async function destroy() {
  // ...
  coreInitialized = false
  coreInitializing = false
}
```

### 3. invite 入口要做三层校验

单聊：
- `msg.to === currentUserId`
- `ext.calleeDevId` 为空或等于当前设备 ID
- 消息未超过 `inviteTimeout + 10s`

群聊：
- 当前用户在 `ext.invitedMembers` 中
- 消息未过期

### 4. 远程视频播放要串行化

给 `playRemoteVideo` 加锁，先 stop 旧轨道、清空容器，再 play 新轨道。
错误 `REMOTE_USER_IS_NOT_PUBLISHED` 不要重试。

### 5. 远程视频容器必须用平台要求的元素

- Web：`<div>`（Agora Web SDK 的 `IRemoteVideoTrack.play` 要求）
- 小程序/UniApp：`<live-player>`

### 6. 资源清理顺序固定

1. unpublish 本地轨道
2. 停止并关闭本地轨道
3. 离开 RTC 频道
4. 清空 DOM / 重置播放器
5. 重置业务状态

---

## 五、用户资料管理（昵称/头像）

CallKit 需要显示通话参与者的昵称和头像，但 **core 不强制提供用户资料系统**。平台层需要自行维护 `userInfoMap`，并处理三层资料来源。

### 资料来源优先级

```
1. 业务主动 set（最高优先级）
2. 主叫方信令携带的 callerInfo
3. Provider 异步拉取（兜底）
```

### 必须维护的全局状态

```ts
interface GlobalCallState {
  userInfoMap: Map<string, { nickname?: string; avatarURL?: string }>
  isMinimized: boolean
}
```

### 五个必须处理的时机

#### 1. Provider 初始化时注册资料 Provider

```ts
registerUserInfoProvider(async (userIds) => {
  // 可调用环信 SDK fetchUserInfoById，或业务自己的用户服务
  return userIds.map(userId => ({
    userId,
    nickname: await getNickname(userId),
    avatarUrl: await getAvatar(userId),
  }))
})
```

#### 2. 业务方主动注入（通话前/通话中均可）

```ts
// Vue3 示例
const { setUserInfo, setUserInfoMap } = useCallKit()

setUserInfo('user1', { nickname: '张三', avatarURL: 'https://...' })

setUserInfoMap({
  user1: { nickname: '张三', avatarURL: '...' },
  user2: { nickname: '李四', avatarURL: '...' },
})
```

新平台必须暴露等价 API，并保证写入 `userInfoMap` 后通知 UI 刷新。

#### 3. 收到 invite 时缓存 callerInfo

```ts
core.onEvent((event) => {
  if (event.type === 'incomingCall') {
    const { callerUserId, callerInfo } = event.payload as any
    if (callerUserId && callerInfo) {
      globalCallStore.setUserInfo(callerUserId, callerInfo)
    }
  }
})
```

**坑点**：被叫端弹窗可能在 Provider 拉取完成前就渲染，此时只有 `callerInfo` 能避免显示 userId。

#### 4. 渲染前兜底 enrich

```ts
async function showIncomingNotification(event) {
  const callerUserId = event.payload.callerUserId
  // 先读缓存
  let info = globalCallStore.getUserInfo(callerUserId)

  // 缓存没有且 Provider 存在，则异步拉取
  if (!info.nickname && !info.avatarURL && userInfoProvider) {
    await resolveUserProfiles([callerUserId])
    info = globalCallStore.getUserInfo(callerUserId)
  }

  renderNotification({ userId: callerUserId, ...info })
}
```

#### 5. 群聊新用户加入时自动 enrich

```ts
// 在群聊 RTC Bridge 的 user-joined / participantJoined 中
async function onParticipantJoined(userId: string) {
  let info = globalCallStore.getUserInfo(userId)

  if (!info.nickname && !info.avatarURL) {
    try {
      await resolveUserProfiles([userId])
      info = globalCallStore.getUserInfo(userId)
    } catch (err) {
      logger.warn('获取用户资料失败', err)
    }
  }

  groupCallStore.updateParticipantProfile(userId, {
    nickname: info.nickname,
    avatarUrl: info.avatarURL,
  })
}
```

### 新平台实现 checklist

- [ ] 有全局 `userInfoMap` 状态
- [ ] 支持 `setUserInfo(userId, info)` 和批量注入
- [ ] 收到 `incomingCall` / `groupCallInit` 时把 `callerInfo` 写入缓存
- [ ] UI 渲染前优先读缓存，未命中异步调 Provider
- [ ] 群聊 `participantJoined` / `user-joined` 时若缓存无资料自动拉取
- [ ] 资料更新后触发对应参与者的 UI 刷新

---

## 六、AI 生成新平台代码的流程

当用户要求"做一个 xx 平台的 callkit"时，按以下顺序执行：

1. **确认 IM SDK**：平台是否有环信 IM SDK？方法名是否与 `EasemobConnectionLike` 一致？
2. **确认 RTC SDK**：是 Agora Web / 小程序 / UniApp / 其他？`RtcAdapter` 里调用的 API 完全不同。
3. **确认状态管理**：平台用 Vue3/Pinia、React/Zustand、小程序 Behavior、还是原生？
4. **确认 UI 形态**：单聊是弹窗还是页面？群聊最多几路视频？
5. **生成最小目录结构**（参考 skills/callkit-platform-porting.md）。
6. **先生成 core 封装 + RtcAdapter + 状态层**，再生成 UI。
7. **每生成一个模块后运行类型检查**（如果有）。
8. **最后给出验证清单**。

---

## 七、自检 Prompt

生成/评审新平台 CallKit 前，逐条确认：

```text
[ ] IM 客户端是否已包成 EasemobConnectionLike 适配层？
[ ] createMessage 工厂是否能创建带 ext 的消息？
[ ] RtcAdapter 是否实现了全部必需方法？
[ ] RtcAdapter.joinChannel 前是否预注册了 uid→userId 映射？
[ ] 单聊/群聊媒体状态是否按领域隔离，没有全局 RTC Store？
[ ] Provider/Core 初始化是否有 coreInitializing + coreInitialized 双锁？
[ ] invite 入口是否做了 calleeDevId / message.to / invitedMembers / 时间戳校验？
[ ] 远程视频播放是否有串行锁和 REMOTE_USER_IS_NOT_PUBLISHED 降级？
[ ] 远程视频容器是否使用了平台要求的元素？
[ ] 挂断/销毁时是否按 unpublish → stop tracks → leave → reset 顺序清理？
[ ] 状态管理库是否没有 inline 打包到产物中？
[ ] 是否没有引用 callkit-vue3 的 store/service/component？
[ ] 是否有全局 userInfoMap 并支持 setUserInfo/setUserInfoMap？
[ ] 收到 incomingCall/groupCallInit 时是否缓存了 callerInfo？
[ ] 群聊 participantJoined / user-joined 时是否自动 enrich 用户资料？
```

全部勾选后，方可认为该平台基础实现具备可测性。

---

## 八、参考实现

- Vue3 RtcAdapter：`packages/callkit-vue3/src/services/RtcAdapter.ts`
- Vue3 RtcService（Web Agora 封装）：`packages/callkit-vue3/src/services/RtcService.ts`
- Vue3 群聊 RTC 桥接：`packages/callkit-vue3/src/modules/groupCall/media/RtcMediaBridge.ts`
- core RtcAdapter 接口：`packages/callkit-core/src/rtc/RtcAdapter.ts`
- core 事件定义：`packages/callkit-core/src/core/events.ts`
