# 事件参考

## 事件总览

`callkit-core` 的所有状态变更和信令交互都通过事件通知上层。事件分为两大类：

- **UIEvent**：界面层事件，用于更新 UI、显示弹窗、处理通话生命周期
- **RtcEvent**：RTC 指令事件，用于指示上层执行 RTC 操作

## 生命周期事件

### incomingCall

收到通话邀请时触发。

```typescript
{
  type: 'incomingCall'
  payload: {
    callId: string           // 通话唯一标识
    callType: CALL_TYPE      // 通话类型
    callerUserId: string     // 主叫用户 ID
    callerDevId: string      // 主叫设备 ID
    channel: string          // RTC 频道名
    calleeUserId: string     // 被叫用户 ID
    token?: string           // RTC Token（部分场景）
    groupId?: string         // 群聊 ID（群聊场景）
    groupName?: string       // 群聊名称
    invitedMembers?: string[] // 被邀请成员列表
    callerInfo?: {           // 主叫用户信息
      nickname?: string
      avatarURL?: string
    }
  }
}
```

**使用场景**：显示来电弹窗、播放铃声

---

### callStarted

通话正式开始时触发（双方/多方进入 IN_CALL）。

```typescript
{
  type: 'callStarted'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    isCaller: boolean        // 当前用户是否为主叫
    startTime: number        // 通话开始时间戳
  }
}
```

**使用场景**：开始计时、显示通话中界面

---

### callAccepted

被叫接受通话时触发（仅主叫侧，收到被叫的 answerCall accept 信令后）。

```typescript
{
  type: 'callAccepted'   // 单聊同时触发 singleCallAccepted，群聊触发 groupCallAccepted
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    isCaller: boolean
    calleeInfo?: {           // 被叫用户信息（v2.2.0+，被叫随 answerCall 回传，可选）
      nickname?: string
      avatarURL?: string
    }
  }
}
```

**使用场景**：主叫侧缓存被叫资料（写入 `userInfoMap`），
使通话中界面/对方关摄像头占位无需依赖服务端用户属性即可展示被叫昵称/头像。
与 `incomingCall` 携带 `callerInfo` 对称。旧端不回传时该字段为 `undefined`。

---

### callEnded

通话结束时触发。

```typescript
{
  type: 'callEnded'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel'
    duration?: number        // 通话时长（毫秒）
  }
}
```

**使用场景**：关闭通话界面、记录通话记录、显示结束原因

---

### callTimeout

邀请超时时触发。

```typescript
{
  type: 'callTimeout'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
  }
}
```

**使用场景**：显示"对方未接听"提示

## 单聊状态事件

### statusChanged

单聊状态机状态变更时触发。

```typescript
{
  type: 'statusChanged'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    from: string            // 原状态
    to: string             // 新状态
  }
}
```

**状态值**：`IDLE` | `INVITING` | `ALERTING` | `CONFIRM_RING` | `RECEIVED_CONFIRM_RING` | `ANSWER_CALL` | `CONFIRM_CALLEE` | `IN_CALL`

---

### callRefused

被叫拒绝通话时触发。

```typescript
{
  type: 'callRefused'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    isRemote: boolean       // 是否对方拒绝
  }
}
```

---

### callBusy

被叫忙线时触发。

```typescript
{
  type: 'callBusy'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
  }
}
```

---

### callCanceled

通话被取消时触发。

```typescript
{
  type: 'callCanceled'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    isRemote: boolean       // 是否对方取消
  }
}
```

## RTC 指令事件

### shouldJoinRtc

通知上层加入 RTC 频道。

```typescript
{
  type: 'shouldJoinRtc'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    token: string           // RTC Token
    uid: number | string    // RTC 用户标识
    role: 'caller' | 'callee'
  }
}
```

**响应**：上层应调用 RTC SDK 的 joinChannel 方法

---

### shouldLeaveRtc

通知上层离开 RTC 频道。

```typescript
{
  type: 'shouldLeaveRtc'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    reason: string
  }
}
```

**响应**：上层应调用 RTC SDK 的 leaveChannel 方法，并释放所有轨道

---

### shouldPublishTracks

通知上层发布本地媒体轨道。

```typescript
{
  type: 'shouldPublishTracks'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    calleeUserId?: string
    trackTypes: ('audio' | 'video')[]
  }
}
```

---

### localAudioChanged

本地音频状态变更时触发。

```typescript
{
  type: 'localAudioChanged'
  payload: {
    enabled: boolean
  }
}
```

---

### localVideoChanged

本地视频状态变更时触发。

```typescript
{
  type: 'localVideoChanged'
  payload: {
    enabled: boolean
  }
}
```

## 群聊事件

### groupCallInit

群聊通话初始化时触发（所有被邀请者都会收到）。

```typescript
{
  type: 'groupCallInit'
  payload: {
    callId: string
    groupId: string
    groupName: string
    channel: string
    callType: 'audio' | 'video'
    callerUserId: string
    invitedMembers: string[]
  }
}
```

---

### participantStateChanged

群聊参与者状态变更时触发。

```typescript
{
  type: 'participantStateChanged'
  payload: {
    callId: string
    userId: string
    state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
    groupId?: string
  }
}
```

---

### participantJoined

群聊有新参与者加入 RTC 时触发。

```typescript
{
  type: 'participantJoined'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    userId: string
    groupId?: string
  }
}
```

---

### participantLeft

群聊有参与者离开时触发。

```typescript
{
  type: 'participantLeft'
  payload: {
    callId: string
    channel: string
    callType: CALL_TYPE
    callerUserId: string
    userId: string
    reason: string
    groupId?: string
  }
}
```

## RTC 上报事件

### rtcReport

上层通过 `reportRtcEvent()` 上报的 RTC 事件透传。

```typescript
{
  type: 'rtcReport'
  payload: {
    type: string
    payload: Record<string, any>
  }
}
```

**常见上报类型**：

| type | 说明 |
|------|------|
| `rtcJoined` | 本地用户已加入 RTC 频道 |
| `rtcLeft` | 本地用户已离开 RTC 频道 |
| `userJoined` | 远程用户加入频道 |
| `userLeft` | 远程用户离开频道 |
| `userPublished` | 远程用户发布轨道 |
| `userUnpublished` | 远程用户取消发布轨道 |
| `networkQuality` | 网络质量变化 |
| `error` | RTC 错误 |

## 事件分类速查

```typescript
import { isUIEvent, isRtcEvent } from '@easemob-community/callkit-core'

// 分类判断
if (isUIEvent(event)) {
  // 处理界面更新
}

if (isRtcEvent(event)) {
  // 处理 RTC 操作
}
```

| 分类 | 包含事件 |
|------|----------|
| UIEvent | `incomingCall`, `callStarted`, `callEnded`, `callTimeout`, `statusChanged`, `callRefused`, `callBusy`, `callCanceled`, `groupCallInit`, `participantStateChanged`, `participantJoined`, `participantLeft`, `rtcReport` |
| RtcEvent | `shouldJoinRtc`, `shouldLeaveRtc`, `shouldPublishTracks`, `localAudioChanged`, `localVideoChanged` |
