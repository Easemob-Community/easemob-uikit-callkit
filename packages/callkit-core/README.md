# @easemob-community/callkit-core

框架无关的通话信令核心库，仅依赖环信 IM SDK 作为信令通道，RTC 层通过抽象接口由上层自行接入。

## 特性

- **零 UI 依赖**：纯信令核心，不绑定任何前端框架
- **零 RTC 依赖**：通过 `RtcAdapter` 接口或事件回调接入 Agora 等 RTC SDK
- **单聊状态机**：确定性有限状态机管理 `INVITING → ALERTING → IN_CALL → IDLE`
- **群聊会话模型**：分布式参与者集合，支持邀请、加入、离开、追加邀请
- **注册式信令路由**：`SignalRouter` + `SingleCallSignalHandler` / `GroupCallSignalHandler`
- **事件驱动**：所有状态变更和 RTC 指令通过事件总线通知上层

## 安装

```bash
pnpm add @easemob-community/callkit-core easemob-websdk
```

## 快速开始

```typescript
import { CallKitCore, CALL_TYPE, CALL_STATUS } from '@easemob-community/callkit-core'
import type { CallKitEvent } from '@easemob-community/callkit-core'

const core = new CallKitCore({
  imClient: conn,              // 环信 IM SDK Connection 实例
  inviteTimeout: 30000,        // 邀请超时时间（毫秒），默认 30000
  onEvent: (event: CallKitEvent) => {
    console.log('[callkit-core]', event.type, event.payload)
  }
})

// 发起单聊视频通话
await core.inviteCall({
  calleeUserId: 'user123',
  callType: CALL_TYPE.VIDEO_1V1,
  callerInfo: {
    nickname: '张三',
    avatarURL: 'https://example.com/avatar.png'
  }
})
```

## 核心概念

### CallKitCore

核心控制器，暴露所有通话 API：

| 方法 | 说明 |
|---|---|
| `inviteCall(params)` | 发起单聊通话 |
| `answerCall(params)` | 接听 / 拒绝 / 忙线拒绝 |
| `hangup(params?)` | 挂断 / 取消通话 |
| `inviteGroupCall(params)` | 发起群聊通话 |
| `inviteMoreParticipants(ids)` | 群聊中追加邀请成员 |
| `toggleAudio()` | 切换本地音频开关 |
| `toggleVideo()` | 切换本地视频开关 |
| `reportRtcEvent(report)` | 向上层上报 RTC 事件 |
| `destroy()` | 销毁实例并移除 IM 监听 |

### 单聊状态机

```
IDLE ──inviteCall──► INVITING ───────────────► IN_CALL
       ▲                │    │                    │
       │                │    └─answerCall(refuse)─┘
       │                │
       │                └──incomingCall / alert
       │
       └───────────────────────────────────────hangup
```

完整状态：`IDLE` | `INVITING` | `ALERTING` | `CONFIRM_RING` | `RECEIVED_CONFIRM_RING` | `ANSWER_CALL` | `CONFIRM_CALLEE` | `IN_CALL`

### 群聊会话

群聊没有全局状态机，只有：

- `session`：会话元数据（callId、groupId、channel、callerUserId）
- `participants`：参与者列表，每人状态为 `invited → accepted → joinedRtc → left`

### RTC 接入方式

#### 方式一：RtcAdapter（推荐）

实现 `RtcAdapter` 接口并传入 `CallKitCoreConfig.rtcAdapter`，Core 会自动处理 `shouldJoinRtc` / `shouldLeaveRtc` / `shouldPublishTracks` / `localAudioChanged` / `localVideoChanged` 等指令事件。

```typescript
import type { RtcAdapter, JoinRtcParams } from '@easemob-community/callkit-core'

class AgoraRtcAdapter implements RtcAdapter {
  private client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

  async joinChannel(params: JoinRtcParams): Promise<void> {
    await this.client.join(params.appId, params.channel, params.token, params.uid)
  }

  async leaveChannel(): Promise<void> {
    await this.client.leave()
  }

  async publishLocalTracks(types: ('audio' | 'video')[]): Promise<void> { /* ... */ }
  async unpublishLocalTracks(types: ('audio' | 'video')[]): Promise<void> { /* ... */ }
  async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void> { /* ... */ }
  async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void> { /* ... */ }
  async setAudioEnabled(enabled: boolean): Promise<void> { /* ... */ }
  async setVideoEnabled(enabled: boolean): Promise<void> { /* ... */ }
}

const core = new CallKitCore({
  imClient: conn,
  rtcAdapter: new AgoraRtcAdapter()
})
```

#### 方式二：事件回调

监听 `onEvent` / `onRtcEvent` 手动调用 RTC SDK：

```typescript
const core = new CallKitCore({
  imClient: conn,
  onEvent: async (event) => {
    switch (event.type) {
      case 'shouldJoinRtc': {
        const { channel, token, uid, appId } = event.payload
        await agoraClient.join(appId, channel, token, uid)
        break
      }
      case 'shouldLeaveRtc': {
        await agoraClient.leave()
        break
      }
      // ...
    }
  }
})
```

完整接口定义与示例参见 [docs/integration.md](./docs/integration.md)。

## 文档导航

- [架构说明](./docs/architecture.md) — 模块设计、状态机、信令路由
- [信令交互](./docs/signaling.md) — 消息格式、交互流程、超时处理
- [RTC 接入](./docs/integration.md) — RtcAdapter 实现、事件回调、平台差异
- [事件参考](./docs/events.md) — 完整事件类型、payload 结构、使用示例
- [API 参考](./docs/api/) — TypeDoc 自动生成的完整 API 文档

## 平台支持

| 平台 | 状态 |
|------|------|
| Web (Vue3 / React / Angular) | 已支持 |
| UniApp | 计划中 |
| 小程序 | 计划中 |

## License

MIT
