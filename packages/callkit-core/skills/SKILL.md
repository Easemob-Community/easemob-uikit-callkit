---
name: callkit-core-integration
description: >
  Guide users to integrate @easemob-community/callkit-core for framework-agnostic call signaling.
  Use when a user wants to add audio/video call state management and signaling to their project
  (Vue3, React, UniApp, MiniProgram, or any frontend framework).
  Covers: CallKitCore initialization, RTC adapter implementation, event handling,
  single/group call initiation, and common integration issues.
---

# @easemob-community/callkit-core 快速接入指南

## 前置条件

- 已集成环信 IM SDK (`easemob-websdk`) 并完成登录
- 已申请 Agora AppID（如需音视频通话）
- 项目支持 ES Module、CommonJS 或 script 标签引入

## 安装

```bash
npm install @easemob-community/callkit-core
# or
pnpm add @easemob-community/callkit-core
# or CDN
<script src="https://unpkg.com/@easemob-community/callkit-core/dist/index.umd.js"></script>
```

## Step 1: 初始化 CallKitCore

```ts
import { CallKitCore, CALL_TYPE } from '@easemob-community/callkit-core'

const core = new CallKitCore({
  // 环信 IM 客户端实例（已登录）
  imClient: chatClient,

  // 当前用户资料（可选，用于邀请消息中展示）
  userProfile: {
    userId: 'current_user_id',
    nickname: '用户昵称',
    avatarURL: 'https://example.com/avatar.png',
  },

  // 事件监听（方式一：统一回调）
  onEvent: (event) => {
    console.log('收到事件:', event.type, event.payload)
  },

  // 事件监听（方式二：分类回调，可选）
  onUIEvent: (event) => {
    // UI 相关事件：incomingCall, callStarted, callEnded 等
    handleUIEvent(event)
  },
  onRtcEvent: (event) => {
    // RTC 指令事件：shouldJoinRtc, shouldLeaveRtc 等
    handleRtcEvent(event)
  },

  // RTC 适配器（可选，配置后 Core 自动处理 RTC 指令）
  rtcAdapter: myRtcAdapter,

  // 邀请超时时间（默认 30000ms）
  inviteTimeout: 30000,
})
```

## Step 2: 实现 RtcAdapter（音视频接入）

如果不传 `rtcAdapter`，则需手动处理 `onRtcEvent` 中的 RTC 指令。

```ts
import type { RtcAdapter, JoinRtcParams } from '@easemob-community/callkit-core'
import AgoraRTC from 'agora-rtc-sdk-ng'

const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

const myRtcAdapter: RtcAdapter = {
  async joinChannel({ channel, token, uid }) {
    await agoraClient.join('your-app-id', channel, token, uid)
    // 创建并发布本地音视频轨道
    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks()
    await agoraClient.publish([audioTrack, videoTrack])
  },

  async leaveChannel() {
    agoraClient.localTracks.forEach((track) => track.close())
    await agoraClient.leave()
  },

  async publishLocalTracks(types) {
    const tracks = []
    if (types.includes('audio')) {
      tracks.push(await AgoraRTC.createMicrophoneAudioTrack())
    }
    if (types.includes('video')) {
      tracks.push(await AgoraRTC.createCameraVideoTrack())
    }
    await agoraClient.publish(tracks)
  },

  async unpublishLocalTracks(types) {
    // 根据 types 取消发布对应轨道
  },

  async subscribeRemoteUser(userId, mediaType) {
    agoraClient.on('user-published', async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType)
      // 播放远程轨道
      if (mediaType === 'video') {
        user.videoTrack?.play('remote-video-element-id')
      }
      if (mediaType === 'audio') {
        user.audioTrack?.play()
      }
    })
  },

  async unsubscribeRemoteUser(userId, mediaType) {
    // 取消订阅逻辑
  },

  async setAudioEnabled(enabled) {
    agoraClient.localTracks
      .filter((t) => t.trackMediaType === 'audio')
      .forEach((t) => enabled ? t.setMuted(false) : t.setMuted(true))
  },

  async setVideoEnabled(enabled) {
    agoraClient.localTracks
      .filter((t) => t.trackMediaType === 'video')
      .forEach((t) => enabled ? t.setMuted(false) : t.setMuted(true))
  },

  // 移动端切换扬声器/听筒（可选）
  async switchAudioOutput(device) {
    // UniApp/小程序使用 uni.setInnerAudioOption({ speakerOn: device === 'speaker' })
  },
}
```

## Step 3: 发起通话

### 单聊通话

```ts
import { CALL_TYPE } from '@easemob-community/callkit-core'

// 发起视频通话
await core.inviteCall({
  calleeUserId: 'target_user_id',
  callType: CALL_TYPE.VIDEO_1V1, // 或 CALL_TYPE.AUDIO_1V1
})

// 发起音频通话
await core.inviteCall({
  calleeUserId: 'target_user_id',
  callType: CALL_TYPE.AUDIO_1V1,
})
```

### 群聊通话

```ts
await core.inviteGroupCall({
  groupId: 'group_id',
  participantIds: ['user1', 'user2', 'user3'],
  callType: CALL_TYPE.VIDEO_MULTI, // 或 CALL_TYPE.AUDIO_MULTI
})
```

### 通话中邀请更多成员

```ts
await core.inviteMoreParticipants(['user4', 'user5'])
```

## Step 4: 响应来电

```ts
// 被叫方收到 incomingCall 事件后，调用 answerCall
await core.answerCall({
  callId: 'incoming_call_id',
  result: 'accept', // 'accept' | 'refuse' | 'busy'
})
```

## Step 5: 挂断/取消通话

```ts
// 主动挂断
await core.hangup()

// 取消正在发起的邀请
await core.hangup({ reason: 'cancel' })
```

## Step 6: 媒体控制

```ts
// 切换静音
core.toggleAudio()

// 切换摄像头
core.toggleVideo()
```

## Step 7: 状态查询

```ts
// 是否在通话中
if (core.isInCall()) {
  console.log('当前通话时长:', core.getSingleCallState().duration)
}

// 是否在呼叫中
if (core.isCalling()) {
  console.log('等待对方接听...')
}

// 获取当前通话类型
const callType = core.getCurrentCallType() // CALL_TYPE | null

// 获取当前通话 ID
const callId = core.getCurrentCallId()

// 是否空闲
if (core.isIdle()) {
  console.log('可以发起新通话')
}
```

## Step 8: RTC 事件上报

上层接入 RTC SDK 后，需要通过 `reportRtcEvent` 反馈状态给 Core：

```ts
// 用户加入 RTC 频道
core.reportRtcEvent({
  type: 'userJoined',
  payload: { userId: 'remote_user_id' },
})

// 用户离开 RTC 频道
core.reportRtcEvent({
  type: 'userLeft',
  payload: { userId: 'remote_user_id' },
})

// 网络质量变化
core.reportRtcEvent({
  type: 'networkQuality',
  payload: { quality: 2 }, // 0-6
})

// 说话检测
core.reportRtcEvent({
  type: 'speaking',
  payload: { userId: 'remote_user_id', volume: 85 },
})
```

## Step 9: 事件订阅（精细控制）

```ts
// 订阅所有事件
const unsubscribe = core.onEvent((event) => {
  if (event.type === 'callStarted') {
    console.log('通话开始:', event.payload)
  }
  if (event.type === 'callEnded') {
    console.log('通话结束:', event.payload.reason, event.payload.duration)
  }
})

// 取消订阅
unsubscribe()

// 单次订阅
core.onceEvent((event) => {
  console.log('一次性事件:', event.type)
})
```

## 核心事件类型

### UI 事件

| 事件 | 触发时机 | payload |
|------|---------|---------|
| `incomingCall` | 收到通话邀请 | callId, callerUserId, callType, channel, token... |
| `callStarted` | 通话接通 | isCaller, startTime |
| `callEnded` | 通话结束 | reason, duration |
| `callTimeout` | 邀请超时 | — |
| `callRefused` | 通话被拒绝 | isRemote |
| `callBusy` | 对方忙线 | — |
| `callCanceled` | 通话被取消 | isRemote |
| `statusChanged` | 状态变化 | from, to |
| `groupCallInit` | 群聊通话初始化 | groupId, invitedMembers... |
| `participantJoined` | 成员加入 | userId |
| `participantLeft` | 成员离开 | userId, reason |
| `participantStateChanged` | 成员状态变化 | userId, state |

### RTC 事件

| 事件 | 触发时机 | payload |
|------|---------|---------|
| `shouldJoinRtc` | 应该加入 RTC 频道 | channel, token, uid, role |
| `shouldLeaveRtc` | 应该离开 RTC 频道 | reason |
| `shouldPublishTracks` | 应该发布轨道 | trackTypes |
| `localAudioChanged` | 本地音频状态变化 | enabled |
| `localVideoChanged` | 本地视频状态变化 | enabled |

## 生命周期管理

```ts
// 页面卸载时销毁
onBeforeUnmount(() => {
  core.destroy()
})
```

## 常见错误速查

| 现象 | 原因 | 修复 |
|------|------|------|
| `CallKitCore 已销毁` | 调用了已 destroy 的实例 | 重新创建实例 |
| 被叫方收不到邀请 | IM 未登录或不在线 | 确保 IM 已登录 |
| 无法加入 RTC | token 为空或过期 | 检查 getRTCToken 返回 |
| 群聊成员状态不同步 | 未调用 reportRtcEvent | 接入 RTC 后上报用户加入/离开 |
| 事件监听不生效 | 使用 onEvent 但实例已销毁 | 检查实例生命周期 |

## 平台差异说明

- **Vue3/React**: 正常使用，通过 reactive/ref 包裹状态
- **UniApp/小程序**: 数据格式与 Web 一致，直接复用相同代码
- **script 标签**: 使用 `CallKitCore` 全局变量

```html
<!-- CDN 引入 -->
<script src="https://unpkg.com/@easemob-community/callkit-core/dist/index.umd.js"></script>
<script>
  const core = new CallKitCore({
    imClient: chatClient,
    onEvent: (e) => console.log(e),
  })
</script>
```
