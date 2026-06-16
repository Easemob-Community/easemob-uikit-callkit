# 架构说明

## 设计目标

`callkit-core` 是一个**框架无关**的通话信令核心库：

1. **零 RTC 依赖**：不直接调用任何 RTC SDK，通过 `RtcAdapter` 接口让上层接入
2. **零 UI 依赖**：不渲染任何界面，通过事件回调通知上层所有决策点
3. **单 IM 依赖**：仅依赖环信 IM SDK 作为信令通道

## 模块架构

```
┌─────────────────────────────────────────────┐
│                 上层框架层                    │
│  Vue3 / React / UniApp / 小程序              │
│  • UI 组件  • RtcAdapter 实现               │
└─────────────────────┬───────────────────────┘
                      │ 事件回调 / API 调用
┌─────────────────────▼───────────────────────┐
│              @easemob-community/callkit-core          │
│  ┌─────────────────────────────────────┐    │
│  │         CallKitCore (门面)           │    │
│  │  inviteCall / answerCall / hangup   │    │
│  │  inviteGroupCall / toggleAudio      │    │
│  └──────────────┬──────────────────────┘    │
│                 │                           │
│  ┌──────────────┼──────────────────────┐    │
│  │              │                      │    │
│  ▼              ▼                      ▼    │
│  ┌─────────┐ ┌─────────────┐ ┌──────────┐  │
│  │ 状态层   │ │   信令层     │ │   事件层  │  │
│  │         │ │             │ │          │  │
│  │ Single  │ │ SignalRouter│ │ EventBus │  │
│  │ Call    │ │ SignalSender│ │          │  │
│  │ State   │ │ Message     │ │          │  │
│  │ Machine │ │ Builder     │ │          │  │
│  │         │ │             │ │          │  │
│  │ Group   │ │ SingleCall  │ │          │  │
│  │ Call    │ │ Signal      │ │          │  │
│  │ Session │ │ Handler     │ │          │  │
│  │         │ │ GroupCall   │ │          │  │
│  │         │ │ Signal      │ │          │  │
│  │         │ │ Handler     │ │          │  │
│  └─────────┘ └─────────────┘ └──────────┘  │
│                 │                           │
│  ┌──────────────▼──────────────────────┐    │
│  │           IM 适配层                  │    │
│  │  IMListener / IMProvider            │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
                      │
          ┌───────────▼────────────┐
          │      环信 IM SDK        │
          └─────────────────────────┘
```

## 状态层设计

### 单聊状态机 (SingleCallStateMachine)

单聊采用**确定性有限状态机**，状态流转如下：

```
                    ┌──────────┐
         ┌─────────►│  IDLE    │◄────────────┐
         │          │ (空闲)   │             │
         │          └────┬─────┘             │
         │               │ inviteCall        │
         │               ▼                   │
         │          ┌──────────┐             │
         │    ┌────►│ INVITING │────┐        │
         │    │     │ (邀请中)  │    │        │
         │    │     └────┬─────┘    │        │
         │    │          │          │        │
         │    │    ┌─────┘          │        │
         │    │    ▼                ▼        │
         │    │ ┌──────────┐   ┌──────────┐  │
         │    │ │ALERTING  │   │ CONFIRM  │  │
         │    └─┤(被叫振铃)│   │ _RING    │  │
         │      └────┬─────┘   │(主叫确认)│  │
         │           │         └────┬─────┘  │
         │           │              │        │
         │           ▼              ▼        │
         │      ┌──────────────────────┐     │
         │      │  RECEIVED_CONFIRM    │     │
         │      │      _RING           │     │
         │      │  (收到被叫确认振铃)   │     │
         │      └──────────┬───────────┘     │
         │                 │ answerCall      │
         │                 ▼                 │
         │            ┌──────────┐           │
         │            │ANSWER_CALL│          │
         │            │(被叫应答) │          │
         │            └────┬─────┘          │
         │                 │                 │
         │                 ▼                 │
         │            ┌──────────┐           │
         │            │CONFIRM   │           │
         │            │_CALLEE   │           │
         │            │(确认被叫) │           │
         │            └────┬─────┘           │
         │                 │                 │
         │                 ▼                 │
         │            ┌──────────┐           │
         └────────────┤ IN_CALL  │───────────┘
                      │ (通话中)  │
                      └──────────┘
```

**关键设计**：
- 所有状态变更必须通过 `transition(event)` 方法，非法流转自动拒绝
- 状态变更后自动触发 `statusChanged` 事件
- `callId` 在 `INVITING` 时生成，贯穿整个通话周期

### 群聊会话 (GroupCallSession)

群聊采用**分布式参与者集合**模型：

- `session`：会话元数据（callId、groupId、channel、callerUserId）
- `participants`：参与者列表，每人有独立状态机（invited → accepted → joinedRtc → left）
- 没有全局通话状态，只有"会话是否活跃"和"各参与者状态"

## 信令层设计

### SignalRouter

中央路由器，采用**注册式 Handler** 模式：

```typescript
class SignalRouter {
  private handlers = new Map<string, SignalHandler[]>()

  register(action: string, matcher: (msg) => boolean, handler: SignalHandler)
  dispatch(message: CmdMsgBody)
}
```

消息分发流程：
1. `IMListener` 收到 IM `onCmdMessage` 回调
2. 解析消息体，提取 `action` 字段
3. `SignalRouter.dispatch()` 找到匹配的 Handler
4. Handler 内部判断是单聊/群聊分支，操作对应状态层
5. 状态层变更后触发事件，经 `EventBus` 通知上层

### 信令消息类型

| action | 方向 | 说明 |
|--------|------|------|
| `invite` | 主叫→被叫 | 发起通话邀请 |
| `alert` | 被叫→主叫 | 被叫收到邀请，正在振铃 |
| `confirmRing` | 主叫→被叫 | 主叫确认被叫已振铃 |
| `answerCall` | 被叫→主叫 | 被叫接受/拒绝通话 |
| `confirmCallee` | 主叫→被叫 | 主叫确认被叫已加入 |
| `cancelCall` | 主叫→被叫 | 主叫取消邀请 |
| `leaveCall` | 任意→任意 | 挂断/离开通话 |

## 事件层设计

### EventBus

轻量级发布-订阅实现：

```typescript
class EventBus<T extends Record<string, any>> {
  emit<K extends keyof T>(event: K, payload: T[K]): void
  on<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void
  off<K extends keyof T>(event: K, handler: Function): void
}
```

### 事件分类

| 分类 | 事件类型 | 说明 |
|------|----------|------|
| 生命周期 | `incomingCall`, `callStarted`, `callEnded`, `callTimeout` | 通话整体状态 |
| 单聊状态 | `statusChanged`, `callRefused`, `callBusy`, `callCanceled` | 单聊特有 |
| RTC 指令 | `shouldJoinRtc`, `shouldLeaveRtc`, `shouldPublishTracks` | 指示上层操作 RTC |
| 群聊状态 | `groupCallInit`, `participantStateChanged`, `participantJoined`, `participantLeft` | 群聊特有 |
| 媒体状态 | `localAudioChanged`, `localVideoChanged` | 本地媒体开关 |

## 与上层集成

### Vue3 集成示例

```typescript
import { CallKitCore, CALL_TYPE } from '@easemob-community/callkit-core'
import { ref, reactive } from 'vue'

const callState = reactive({ status: 'IDLE', callId: '' })

const core = new CallKitCore({
  imClient: conn,
  onEvent: (event) => {
    if (event.type === 'statusChanged') {
      callState.status = event.payload.to
    }
    if (event.type === 'shouldJoinRtc') {
      // 调用 Agora SDK 加入频道
      agoraClient.join({
        channel: event.payload.channel,
        token: event.payload.token,
        uid: event.payload.uid
      })
    }
  }
})
```

### RtcAdapter 接入

若上层实现了 `RtcAdapter` 接口并传入 `CallKitCoreConfig.rtcAdapter`，Core 会自动处理所有 RTC 指令事件，无需在 `onEvent` 中手动处理 `shouldJoinRtc` 等。
