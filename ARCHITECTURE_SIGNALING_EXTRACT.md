# CallKit Core — 信令层独立架构设计文档

> **版本**：v1.0-draft  
> **日期**：2026-05-06  
> **目标**：将 `lib/` 下信令核心逻辑抽离为框架无关的 JavaScript 库，仅保留环信 IM SDK 作为信令通道，RTC 层完全抽象。  
> **约束**：不修改现有 Vue3 CallKit 的外部接口；新核心库与现有代码可并行运行，逐步迁移。

---

## 一、背景与目标

### 1.1 当前痛点

当前 `lib/signaling/*Handler.ts` 已完成物理拆分（`SignalRouter` + `SingleCallSignalHandler` + `GroupCallSignalHandler`），但 Handler 仍是**控制器角色**：

- 直接 `useCallStateStore()` 读写 Pinia 状态
- 直接 `useJoinChannel().joinChannel()` 触发 RTC Join
- 直接 `new CallService()` 执行挂断

这导致信令层与 Vue/Pinia 深度绑定，无法直接用于 UniApp（小程序/App）或 React 场景。

### 1.2 核心目标

| 目标 | 说明 |
|---|---|
| **框架无关** | 核心库不依赖 Vue、React、Pinia 等任何 UI 框架 |
| **IM 锁定环信** | 信令通道仅基于环信 IM SDK（Web/小程序/UniApp API 一致） |
| **RTC 可插拔** | 核心库不直接 import 声网 SDK；通过抽象接口让上层自行接入任意 RTC（声网/腾讯/自研） |
| **事件驱动** | 所有内部决策通过事件通知上层，上层决定何时执行 RTC 操作 |
| **可渐进迁移** | 新核心库可与现有 `lib/` 代码并存，逐步替换 |

---

## 二、架构总览

### 2.1 分层架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户应用层（任意框架）                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Vue3 CallKit │  │ UniApp App   │  │ UniApp 小程序 │  │ React / RN / ... │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │
└─────────┼─────────────────┼─────────────────┼───────────────────┼───────────┘
          │                 │                 │                   │
          └─────────────────┴─────────────────┴───────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      callkit-core (本库)       │
                    │  ┌─────────────────────────┐  │
                    │  │   CallKitCore (主入口)   │  │
                    │  │  • 生命周期管理            │  │
                    │  │  • 事件总线聚合            │  │
                    │  └─────────────────────────┘  │
                    │  ┌─────────────────────────┐  │
                    │  │   CallStateMachine       │  │
                    │  │  • 单聊二元状态机          │  │
                    │  │  • 群聊会话状态            │  │
                    │  │  • 超时/计时器管理          │  │
                    │  └─────────────────────────┘  │
                    │  ┌─────────────────────────┐  │
                    │  │   SignalingEngine        │  │
                    │  │  • SignalRouter          │  │
                    │  │  • SingleCallHandler     │  │
                    │  │  • GroupCallHandler      │  │
                    │  │  • MessageBuilder        │  │
                    │  └─────────────────────────┘  │
                    │  ┌─────────────────────────┐  │
                    │  │   RtcAdapter (抽象层)     │  │
                    │  │  • 纯接口定义              │  │
                    │  │  • 不依赖任何 RTC SDK      │  │
                    │  └─────────────────────────┘  │
                    └───────────────┬───────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
┌─────────▼─────────┐    ┌──────────▼──────────┐    ┌────────▼────────┐
│  环信 IM SDK      │    │   Agora RTC SDK     │    │  Tencent TRTC   │
│ (easemob-websdk)  │    │  (agora-rtc-sdk-ng) │    │  (trtc-sdk-v5)  │
│  • 发送/接收信令   │    │  • join/publish     │    │  • 上层自行接入  │
│  • 获取 RTC Token  │    │  • 音视频轨道        │    │                 │
└───────────────────┘    └─────────────────────┘    └─────────────────┘
```

### 2.2 关键设计决策

| 层级 | 策略 | 理由 |
|---|---|---|
| **核心库** | 纯 TypeScript，零框架依赖 | 可被任何 JS 运行环境消费 |
| **IM 层** | 锁定环信，但内部用 `IMProvider` 接口隔离 | 环信 Web/小程序/UniApp API 一致，无需适配多套；但接口隔离便于未来扩展 |
| **RTC 层** | 完全抽象，核心库只发事件 | 声网 track 模型与腾讯云 stream 模型差异大，核心库不应感知 |
| **状态层** | 纯 JS 状态机（非响应式） | 响应式由上层框架自行包装（Vue ref / React useState / UniApp reactive） |
| **事件层** | 轻量自实现 EventBus | 不依赖 `mitt`/`EventEmitter`，零依赖 |

---

## 三、核心模块设计

### 3.1 CallKitCore（主入口）

职责：生命周期管理、模块协调、对外暴露 API。

```typescript
export interface CallKitCoreConfig {
  /** 环信 IM 客户端实例 */
  imClient: EasemobChat.Connection
  /** 当前用户资料（用于 ext 构建） */
  userProfile?: {
    userId: string
    nickname?: string
    avatarURL?: string
  }
  /** RTC 适配器（可选，如仅需信令可不传） */
  rtcAdapter?: RtcAdapter
  /** 全局事件回调 */
  onEvent: (event: CallKitEvent) => void
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export class CallKitCore {
  constructor(config: CallKitCoreConfig)
  
  // ─── 单聊 API ───
  inviteCall(params: InviteCallParams): Promise<void>
  answerCall(params: AnswerCallParams): Promise<void>
  hangup(params?: HangupParams): Promise<void>
  
  // ─── 群聊 API ───
  inviteGroupCall(params: InviteGroupCallParams): Promise<void>
  
  // ─── 状态查询 ───
  getState(): Readonly<CallKitState>
  
  // ─── 生命周期 ───
  destroy(): Promise<void>
}
```

### 3.2 CallStateMachine（状态机）

**核心改造点**：将现有 `callStateStore`（Pinia）+ `GroupCallStore` 中的状态流转逻辑提取为纯 JS 类。

#### 3.2.1 单聊状态机

```
                    ┌─────────────┐
         invite     │   IDLE      │◄────────────────────────┐
        ┌──────────►│  (空闲)     │                         │
        │           └──────┬──────┘              hangup/    │
        │                  │                       cancel/   │
        │                  │ invite               timeout    │
        │                  ▼                                │
        │           ┌─────────────┐                         │
        │           │  INVITING   │                         │
        │           │  (邀请中)   │                         │
        │           └──────┬──────┘                         │
        │                  │                                │
        │          ┌───────┴───────┐                        │
        │          │               │                        │
        │    alert/timeout   confirmRing                     │
        │          │               │                        │
        │          ▼               ▼                        │
        │   ┌─────────────┐ ┌─────────────┐                │
        └───│  ALERTING   │ │ RECEIVED_   │                │
            │  (响铃中)   │ │ CONFIRM_RING│                │
            └──────┬──────┘ └──────┬──────┘                │
                   │               │                        │
              accept/reject   answerCall(accept)            │
                   │               │                        │
                   └───────┬───────┘                        │
                           │                                │
                           ▼                                │
                    ┌─────────────┐                         │
                    │   IN_CALL   │─────────────────────────┘
                    │  (通话中)   │    hangup / remoteLeave
                    └─────────────┘
```

```typescript
export class SingleCallStateMachine {
  private state: SingleCallState = { status: 'IDLE' }
  
  /**
   * 接收一个信令动作，返回状态变更事件列表
   * 不执行任何副作用（不发消息、不 join RTC）
   */
  transition(action: SignalingAction): DomainEvent[] {
    // 包含：callId 校验、deviceId 校验、多端冲突处理
    // 逻辑从现有 SingleCallSignalHandler + callStateStore 提取
  }
  
  getState(): Readonly<SingleCallState> {
    return Object.freeze({ ...this.state })
  }
}
```

#### 3.2.2 群聊会话模型

```typescript
export class GroupCallSession {
  private session: GroupSessionState
  private participants = new Map<string, GroupParticipant>()
  
  init(params: InitGroupSessionParams): DomainEvent[]
  addParticipant(userId: string, info: ParticipantInfo): DomainEvent[]
  removeParticipant(userId: string): DomainEvent[]
  markAccepted(userId: string): DomainEvent[]
  markJoinedRtc(userId: string): DomainEvent[]
  markLeftRtc(userId: string): DomainEvent[]
  
  getParticipant(userId: string): Readonly<GroupParticipant> | undefined
  getAllParticipants(): Readonly<GroupParticipant>[]
}
```

### 3.3 SignalingEngine（信令引擎）

#### 3.3.1 现有代码映射

| 现有文件 | 新模块 | 改造方式 |
|---|---|---|
| `lib/signaling/SignalRouter.ts` | `SignalRouter` | ✅ 直接复用，零改动 |
| `lib/signaling/SingleCallSignalHandler.ts` | `SingleCallSignalHandler` | 不再读写 Pinia，改为返回 `DomainEvent[]` |
| `lib/signaling/GroupCallSignalHandler.ts` | `GroupCallSignalHandler` | 同上，不再读写 `groupCallStore` |
| `lib/services/ChatService.ts` | `MessageBuilder` | 不再读取 `callStateStore`，改为纯函数，调用方传入完整 `ext` 数据 |
| `lib/composables/useSignalManager.ts` | `SignalSender` | 内部封装 `imClient.send()`，接口简化 |
| `lib/composables/useListenerManager.ts` | `IMListener` | 薄壳，挂载 `imClient.addEventHandler()`，回调转交 `SignalRouter` |

#### 3.3.2 Handler 改造示例

**改造前**（耦合 Pinia + RTC）：
```typescript
// SingleCallSignalHandler.handleAnswerCall() — 当前代码
if (ext.result === 'accept') {
  this.callStateStore.setCallStatus(CALL_STATUS.IN_CALL)
  this.joinRtcChannel()  // 🔴 直接 join！
  callKitEventBus.emit('callStarted')
}
```

**改造后**（纯事件返回）：
```typescript
// SingleCallSignalHandler.handleAnswerCall() — 目标代码
if (ext.result === 'accept') {
  return [
    { type: 'STATUS_CHANGED', from: 'ANSWER_CALL', to: 'IN_CALL' },
    { type: 'SHOULD_JOIN_RTC', channel, token, uid },
    { type: 'CALL_STARTED', callId, callerUserId, calleeUserId },
  ]
}
```

`SignalingEngine` 聚合这些事件，统一通过 `onEvent` 回调通知上层。

### 3.4 MessageBuilder（消息构建器）

由 `ChatService` 改造而来，**纯函数**，不读写任何状态。

```typescript
export class MessageBuilder {
  /**
   * 构建 invite 文本消息
   * @param params 所有需要的数据由调用方显式传入
   */
  static buildInviteMessage(params: BuildInviteParams): {
    to: string
    chatType: 'singleChat' | 'groupChat'
    msg: string
    ext: InviteSignalingExt
  }
  
  static buildCmdMessage(params: BuildCmdParams): {
    to: string
    action: 'rtcCall'
    ext: SignalingExt
  }
}
```

**关键改动**：
- 删除 `private callStateStore = useCallStateStore()`
- `buildInviteMessageExt()` 的参数从 `callStateStore.getCallState` 改为显式传入 `callId`、`channel`、`callerDevId` 等字段
- `userInfo` / `groupInfo` 查询由上层完成，通过参数传入

### 3.5 RtcAdapter（RTC 抽象层）

**核心原则**：核心库不直接调用任何 RTC SDK 方法，只定义接口。上层可选择实现声网适配器、腾讯适配器，或不传（仅做纯信令）。

```typescript
/**
 * 核心库对 RTC 的期望：
 * 1. 能加入/离开频道
 * 2. 能获取本地音视频流
 * 3. 能发布/订阅
 * 4. 能静音/开关摄像头
 * 
 * 但核心库不直接调用这些方法——
 * 核心库只通过事件通知上层"该 join 了"，
 * 上层自行调用 RTC SDK，完成后通过 report 反馈。
 */
export interface RtcAdapter {
  /** 上层实现：加入 RTC 频道 */
  joinChannel(params: JoinRtcParams): Promise<void>
  /** 上层实现：离开 RTC 频道 */
  leaveChannel(): Promise<void>
  /** 上层实现：创建并发布本地轨道 */
  publishLocalTracks(types: ('audio' | 'video')[]): Promise<void>
  /** 上层实现：静音/取消静音 */
  setAudioEnabled(enabled: boolean): Promise<void>
  /** 上层实现：开关摄像头 */
  setVideoEnabled(enabled: boolean): Promise<void>
}

/**
 * 核心库向上层报告的 RTC 事件
 * 上层调用 RTC SDK 后，通过 core.reportRtcEvent() 反馈
 */
export interface RtcReport {
  type: 'rtcJoined' | 'rtcLeft' | 'userJoined' | 'userLeft' | 'userPublished' | 'userUnpublished'
  payload: {
    userId?: string
    uid?: string
    mediaType?: 'audio' | 'video'
    track?: any  // 上层自行定义 track 类型
  }
}
```

**声网适配器示例（上层实现）**：
```typescript
class AgoraRtcAdapter implements RtcAdapter {
  private client: IAgoraRTCClient
  
  async joinChannel({ channel, token, uid }) {
    await this.client.join(appId, channel, token, uid)
  }
  
  async publishLocalTracks(types) {
    const tracks = []
    if (types.includes('audio')) tracks.push(await AgoraRTC.createMicrophoneAudioTrack())
    if (types.includes('video')) tracks.push(await AgoraRTC.createCameraVideoTrack())
    await this.client.publish(tracks)
  }
  
  // ...其他方法
}
```

---

## 四、事件设计（CallKitEvent）

### 4.1 事件总览

```typescript
export type CallKitEvent =
  // ─── 通话生命周期 ───
  | IncomingCallEvent       // 收到邀请
  | CallStartedEvent        // 通话建立（双方已进入 IN_CALL）
  | CallEndedEvent          // 通话结束
  | CallTimeoutEvent        // 邀请超时
  
  // ─── 单聊特定 ───
  | StatusChangedEvent      // 状态机变更
  | CallRefusedEvent        // 对方拒绝
  | CallBusyEvent           // 对方忙线
  | CallCanceledEvent       // 对方取消
  
  // ─── RTC 指令 ───
  | ShouldJoinRtcEvent      // 上层该 join RTC 了
  | ShouldLeaveRtcEvent     // 上层该 leave RTC 了
  | ShouldPublishTracksEvent // 上层该发布本地轨道了
  
  // ─── 群聊特定 ───
  | GroupCallInitEvent      // 群聊会话初始化完成
  | ParticipantJoinedEvent  // 成员加入 RTC
  | ParticipantLeftEvent    // 成员离开 RTC
  | ParticipantStateChangedEvent // 成员状态变更（accepted/joinedRtc/left）
  
  // ─── 媒体状态 ───
  | LocalAudioChangedEvent
  | LocalVideoChangedEvent
  | RemoteAudioChangedEvent
  | RemoteVideoChangedEvent
  
  // ─── 网络质量 ───
  | NetworkQualityEvent
```

### 4.2 关键事件详细定义

```typescript
/** 收到来电 */
interface IncomingCallEvent {
  type: 'incomingCall'
  payload: {
    callId: string
    callType: 'audio' | 'video' | 'audio_multi' | 'video_multi'
    callerUserId: string
    callerDevId: string
    channel: string
    calleeUserId: string
    /** 群聊时有效 */
    groupId?: string
    groupName?: string
    /** 被邀请成员列表（群聊） */
    invitedMembers?: string[]
    /** Caller 资料 */
    callerInfo?: { nickname?: string; avatarURL?: string }
  }
}

/** 上层该加入 RTC 频道了 */
interface ShouldJoinRtcEvent {
  type: 'shouldJoinRtc'
  payload: {
    callId: string
    channel: string
    token: string
    uid: number | string
    callType: CALL_TYPE
    /** 当前角色：caller / callee */
    role: 'caller' | 'callee'
  }
}

/** 通话结束 */
interface CallEndedEvent {
  type: 'callEnded'
  payload: {
    callId: string
    reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel'
    /** 通话时长（秒） */
    duration?: number
  }
}
```

### 4.3 完整信令 → 事件映射

| 信令（接收） | 单聊事件序列 | 群聊事件序列 |
|---|---|---|
| `invite`（文本消息） | `incomingCall` | `groupCallInit` + `incomingCall` |
| `alert` | `statusChanged(IDLE→ALERTING)` | — |
| `confirmRing` | `statusChanged(ALERTING→RECEIVED_CONFIRM_RING)` | — |
| `answerCall(accept)` | `shouldJoinRtc` + `callStarted` | `participantStateChanged(accepted)` |
| `answerCall(refuse)` | `callRefused` + `callEnded` | `participantRemoved` |
| `answerCall(busy)` | `callBusy` + `callEnded` | — |
| `confirmCallee` | `shouldJoinRtc` + `callStarted` | — |
| `cancelCall` | `callCanceled` + `callEnded` | `callEnded`（主叫取消） |
| `leaveCall` | `callEnded(remoteHangup)` | `participantLeft` |

---

## 五、状态机详细设计

### 5.1 单聊状态机（StateMachine）

```typescript
interface SingleCallState {
  status: 'IDLE' | 'INVITING' | 'ALERTING' | 'RECEIVED_CONFIRM_RING' | 'IN_CALL'
  callId: string
  channel: string
  token: string
  type: CALL_TYPE
  callerDevId: string
  calleeDevId: string
  callerUserId: string
  calleeUserId: string
  inviteTimeoutTimer: number | null
  startTime: number | null
}

type SignalingAction =
  | { type: 'LOCAL_INVITE'; calleeUserId: string; callType: CALL_TYPE }
  | { type: 'RECEIVE_ALERT'; from: string; callId: string; calleeDevId: string }
  | { type: 'RECEIVE_CONFIRM_RING'; status: boolean; callerDevId: string; calleeDevId: string }
  | { type: 'RECEIVE_ANSWER'; result: 'accept' | 'refuse' | 'busy'; callId: string }
  | { type: 'RECEIVE_CANCEL'; from: string; callId: string }
  | { type: 'RECEIVE_LEAVE'; from: string; callId: string }
  | { type: 'RECEIVE_CONFIRM_CALLEE'; callId: string }
  | { type: 'LOCAL_HANGUP'; reason: HangupReason }
  | { type: 'TIMEOUT' }
```

**状态转换表（简化）**：

| 当前状态 | 动作 | 新状态 | 产生事件 |
|---|---|---|---|
| IDLE | LOCAL_INVITE | INVITING | `statusChanged`, `messageSent(invite)` |
| INVITING | RECEIVE_ALERT | ALERTING | `statusChanged`, `messageSent(confirmRing)` |
| INVITING | TIMEOUT | IDLE | `callEnded(timeout)` |
| ALERTING | RECEIVE_CONFIRM_RING(true) | RECEIVED_CONFIRM_RING | `statusChanged` |
| ALERTING | RECEIVE_ANSWER(accept) | IN_CALL | `statusChanged`, `shouldJoinRtc`, `callStarted` |
| ALERTING | RECEIVE_ANSWER(refuse) | IDLE | `callRefused`, `callEnded` |
| ALERTING | RECEIVE_CANCEL | IDLE | `callCanceled`, `callEnded` |
| RECEIVED_CONFIRM_RING | RECEIVE_ANSWER(accept) | IN_CALL | `statusChanged`, `shouldJoinRtc`, `callStarted` |
| IN_CALL | RECEIVE_LEAVE | IDLE | `callEnded(remoteHangup)` |
| IN_CALL | LOCAL_HANGUP | IDLE | `callEnded(hangup)` |

### 5.2 群聊会话状态

群聊没有严格的二元状态机，而是**会话 + 参与者集合**模型：

```typescript
interface GroupSessionState {
  sessionId: string       // = channel
  groupId: string
  groupName: string
  callType: 'audio' | 'video'
  status: 'inviting' | 'inCall' | 'ended'
  callerUserId: string
  startTime: number
}

interface GroupParticipant {
  userId: string
  nickname: string
  avatarUrl?: string
  state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
  isLocal: boolean
  isMuted: boolean
  isCameraOn: boolean
  isSpeaking: boolean
}
```

---

## 六、与现有代码的映射关系

### 6.1 文件迁移矩阵

| 现有文件路径 | 新位置 | 迁移策略 |
|---|---|---|
| `lib/types/callstate.types.ts` | `core/types/callstate.types.ts` | ✅ 直接复制，零改动 |
| `lib/types/signal.types.ts` | `core/types/signal.types.ts` | ✅ 直接复制，零改动 |
| `lib/signaling/SignalRouter.ts` | `core/signaling/SignalRouter.ts` | ✅ 直接复制，删除 logger 依赖或改为可注入 |
| `lib/signaling/SingleCallSignalHandler.ts` | `core/signaling/SingleCallSignalHandler.ts` | 🔧 重构：删除所有 Pinia import，改为注入 `CallStateMachine`，返回 `DomainEvent[]` |
| `lib/signaling/GroupCallSignalHandler.ts` | `core/signaling/GroupCallSignalHandler.ts` | 🔧 同上，注入 `GroupCallSession` |
| `lib/services/ChatService.ts` | `core/signaling/MessageBuilder.ts` | 🔧 删除 Store 依赖，改为纯静态方法 |
| `lib/composables/useSignalManager.ts` | `core/signaling/SignalSender.ts` | 🔧 从 Composable 改为类，封装 `imClient.send()` |
| `lib/composables/useListenerManager.ts` | `core/signaling/IMListener.ts` | 🔧 删除 Pinia 依赖，只负责挂载监听 + 路由分发 |
| `lib/services/RtcService.ts` | 不迁移 | ❌ 留在 Vue CallKit 层，或作为 `AgoraRtcAdapter` 参考实现 |
| `lib/store/callState.ts` | `core/state/SingleCallStateMachine.ts` | 🔧 提取状态流转逻辑，删除 Pinia 壳 |
| `lib/store/groupCallStore.ts` | `core/state/GroupCallSession.ts` | 🔧 提取领域模型，删除 Vue `ref`/`computed` |
| `lib/core/events/CallKitEventBus.ts` | `core/events/EventBus.ts` | ✅ 直接复制 |
| `lib/utils/callUtils.ts` | `core/utils/callUtils.ts` | ✅ 直接复制 |
| `lib/utils/logger.ts` | `core/utils/logger.ts` | 🔧 改为可注入的 Logger 接口 |

### 6.2 保留在 Vue CallKit 层的模块

以下模块不属于核心库，保留在现有 `lib/` 中，作为 Vue3 的 UI 适配层：

```
lib/
├── components/           # Vue UI 组件（完全保留）
├── composables/          # Vue Composables（保留，内部改用 callkit-core）
│   ├── useCallKit.ts     # 封装 CallKitCore，对外保持现有 API
│   ├── useJoinChannel.ts # 封装 RtcAdapter + Agora SDK
│   └── useParticipants.ts
├── services/
│   └── RtcService.ts     # Agora SDK 封装（作为 AgoraRtcAdapter 的内部实现）
├── store/                # Pinia Stores（保留，但改为订阅 core 事件同步状态）
│   ├── callState.ts      # 订阅 core 的 statusChanged 事件
│   ├── globalCall.ts     # 保留
│   └── rtcChannel.ts     # 保留，但逐步退化
└── modules/groupCall/    # 群聊 UI 模块（保留）
```

---

## 七、实施路径

### Phase 0：基础搭建（1 天）

1. 新建目录 `packages/callkit-core/`（Monorepo 结构）
2. 初始化 `package.json`：`name: '@easemob-community/callkit-core'`，零依赖（仅 `typescript` devDep）
3. 复制零改动的文件：`types/`、`SignalRouter.ts`、`EventBus.ts`、`callUtils.ts`
4. 配置 `tsconfig.json` + `vite/rollup` 打包为 UMD + ESM

### Phase 1：状态机提取（2-3 天）

1. 新建 `SingleCallStateMachine.ts`，从 `callStateStore` 提取状态流转逻辑
2. 新建 `GroupCallSession.ts`，从 `GroupCallStore` 提取领域模型
3. **双轨验证**：在 `test/` 中写单元测试，断言新状态机与旧 Pinia Store 的行为一致
4. 关键测试场景：
   - 单聊：invite → alert → confirmRing → answer(accept) → inCall → hangup
   - 单聊多端冲突：主叫两设备，被叫 accept 非当前设备
   - 群聊：invite → answer → leave（通话继续）→ 全部离开 → 结束

### Phase 2：Handler 重构（2-3 天）

1. 重构 `SingleCallSignalHandler`：
   - 删除 `useChatClientStore()` → 通过构造函数注入 `{ currentUserId, deviceId }`
   - 删除 `useCallStateStore()` → 通过构造函数注入 `SingleCallStateMachine`
   - 删除 `this.joinRtcChannel()` → 返回 `DomainEvent` 中的 `shouldJoinRtc`
   - 删除 `new CallService()` → 返回 `DomainEvent` 中的 `callEnded`
   - 删除 `callKitEventBus.emit()` → 返回 `DomainEvent` 中的对应事件
2. 重构 `GroupCallSignalHandler` 同理
3. 新建 `MessageBuilder`（由 `ChatService` 改造）
4. 新建 `SignalSender`（由 `useSignalManager` 改造）

### Phase 3：CallKitCore 组装（1-2 天）

1. 实现 `CallKitCore` 主类，组装 `IMListener` → `SignalRouter` → `Handler` → `StateMachine`
2. 实现事件聚合：`Handler` 返回的 `DomainEvent[]` → 去重/排序 → `onEvent()` 回调
3. 实现对外 API：`inviteCall`、`answerCall`、`hangup`、`inviteGroupCall`
4. 实现 `reportRtcEvent()` 供上层反馈 RTC 状态

### Phase 4：Vue3 适配层（2 天）

1. 修改 `lib/composables/useCallKit.ts`：
   - 内部实例化 `CallKitCore`
   - 订阅 `core.onEvent`，将事件同步到 Pinia Store（保持现有 UI 组件不变）
   - 在 `shouldJoinRtc` 事件中调用现有 `useJoinChannel().joinChannel()`
2. 验证：现有 `test/src/App.vue` 手动测试通过

### Phase 5：UniApp 适配器 Demo（2-3 天）

1. 新建 `examples/uniapp-callkit/` 示例项目
2. 集成 `callkit-core` + `easemob-websdk`（uniapp 版）+ `agora-rtc-sdk-ng`（或小程序版）
3. 实现 `AgoraRtcAdapter`
4. 手动验证：UniApp 打包到 H5 / 小程序 / App

### Phase 6：发布（1 天）

1. `npx vue-tsc --noEmit --skipLibCheck` 零报错
2. `test/src/App.vue` 手动验证单聊 + 群聊
3. 发布 `@easemob-community/callkit-core@0.1.0` 到 npm

---

## 八、API 完整示例

### 8.1 Vue3 场景（现有 CallKit 的底层替换）

```typescript
// lib/composables/useCallKit.ts（改造后）
import { CallKitCore } from '@easemob-community/callkit-core'
import { useChatClientStore } from '../store/chatClient'

export function useCallKit() {
  const chatClientStore = useChatClientStore()
  const callStateStore = useCallStateStore()
  const { joinChannel } = useJoinChannel()
  
  const core = new CallKitCore({
    imClient: chatClientStore.getChatClient,
    onEvent: (event) => {
      switch (event.type) {
        case 'incomingCall':
          callStateStore.updateCallState(event.payload)
          callKitEventBus.emit('incomingCall', event.payload)
          break
        case 'shouldJoinRtc':
          joinChannel(event.payload.channel, event.payload.token)
          break
        case 'callEnded':
          callStateStore.resetCallState()
          callKitEventBus.emit('callEnded', event.payload)
          break
        // ...其他事件同步到 Pinia
      }
    }
  })
  
  return {
    inviteCall: core.inviteCall.bind(core),
    answerCall: core.answerCall.bind(core),
    hangup: core.hangup.bind(core),
  }
}
```

### 8.2 UniApp 场景（全新接入）

```typescript
// uniapp 项目
import { CallKitCore } from '@easemob-community/callkit-core'

const core = new CallKitCore({
  imClient: emClient,  // 环信 uniapp SDK 实例
  onEvent: async (event) => {
    switch (event.type) {
      case 'incomingCall':
        uni.showModal({
          title: '来电',
          content: `${event.payload.callerUserId} 邀请你语音通话`,
          success: (res) => {
            if (res.confirm) core.answerCall({ callId: event.payload.callId, accept: true })
            else core.answerCall({ callId: event.payload.callId, accept: false })
          }
        })
        break
        
      case 'shouldJoinRtc':
        // 调用声网小程序 SDK
        await agoraMiniAppClient.joinChannel({
          channelId: event.payload.channel,
          token: event.payload.token,
          uid: event.payload.uid,
        })
        // 反馈给核心库
        core.reportRtcEvent({ type: 'rtcJoined', payload: { channel: event.payload.channel } })
        break
        
      case 'shouldLeaveRtc':
        await agoraMiniAppClient.leaveChannel()
        core.reportRtcEvent({ type: 'rtcLeft', payload: {} })
        break
    }
  }
})
```

---

## 九、风险与缓解

| 风险 | 影响 | 缓解方案 |
|---|---|---|
| **状态机双写期** | Phase 1-2 期间新旧状态机并存，可能不一致 | 写对比测试：每次 transition 后断言新状态机输出与旧 Pinia Store 状态一致 |
| **事件顺序敏感** | `alert` → `confirmRing` → `answerCall` 有严格的时序要求 | 在单元测试中覆盖完整时序链；使用状态机 guards 拒绝非法顺序事件 |
| **群聊 Store 用了 Vue `ref`** | `GroupCallStore` 是唯一显式 `import { ref } from 'vue'` 的 Store | 提取纯领域模型 `GroupCallSession`，响应式由上层自行包装 |
| **IM SDK 的 `getUserIdByRTCUIds`** | 当前 `RtcService` 依赖环信独有的 UID→UserId 映射 API | 改为 `IMProvider` 接口方法，或让上层维护映射后通过 `reportRtcEvent` 注入 |
| **Timer 生命周期** | 邀请超时、通话计时当前由 Pinia 管理 | 移至 `SingleCallStateMachine` 内部，用 `setTimeout` 纯 JS 管理；destroy 时统一清理 |
| **breaking change** | 若直接替换现有 `lib/` 代码，可能引入回归 | 采用双轨运行：新核心库在 `useCallKit` 中封装，现有 UI 组件无感知 |

---

## 十、附录

### A. 目录结构（目标）

```
packages/
├── callkit-core/                 # 新核心库
│   ├── src/
│   │   ├── core/
│   │   │   ├── CallKitCore.ts
│   │   │   └── CallKitCore.types.ts
│   │   ├── state/
│   │   │   ├── SingleCallStateMachine.ts
│   │   │   ├── GroupCallSession.ts
│   │   │   └── types.ts
│   │   ├── signaling/
│   │   │   ├── SignalRouter.ts
│   │   │   ├── SingleCallSignalHandler.ts
│   │   │   ├── GroupCallSignalHandler.ts
│   │   │   ├── SignalSender.ts
│   │   │   └── MessageBuilder.ts
│   │   ├── im/
│   │   │   ├── IMListener.ts
│   │   │   └── IMProvider.ts
│   │   ├── rtc/
│   │   │   └── RtcAdapter.ts       # 纯接口定义
│   │   ├── events/
│   │   │   ├── EventBus.ts
│   │   │   └── CallKitEvents.ts
│   │   ├── types/
│   │   │   ├── callstate.types.ts  # 从 lib/types 复制
│   │   │   └── signal.types.ts     # 从 lib/types 复制
│   │   └── utils/
│   │       ├── callUtils.ts
│   │       └── logger.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── callkit-vue3/                   # 现有 Vue3 CallKit（改造后）
    └── src/
        ├── adapters/
        │   └── AgoraRtcAdapter.ts  # 声网适配器（上层实现示例）
        └── ...（现有 lib/ 结构保留）

examples/
├── uniapp-callkit/                 # UniApp 示例
└── vanilla-js-callkit/             # 纯 HTML+JS 测试页
```

### B. 术语对照表

| 新核心库术语 | 现有代码术语 | 说明 |
|---|---|---|
| `CallKitCore` | `useCallKit` + `callStateStore` | 主入口 + 状态聚合 |
| `SingleCallStateMachine` | `callStateStore` | 单聊状态机 |
| `GroupCallSession` | `GroupCallStore` | 群聊会话 |
| `SignalingEngine` | `SignalRouter` + `*Handler` | 信令处理引擎 |
| `MessageBuilder` | `ChatService` | 消息构建（纯函数） |
| `SignalSender` | `useSignalManager` | 信令发送 |
| `IMListener` | `useListenerManager` | IM 消息监听 |
| `RtcAdapter` | `RtcService` | RTC 抽象接口 |
| `DomainEvent` | `callKitEventBus.emit()` | 领域事件 |
