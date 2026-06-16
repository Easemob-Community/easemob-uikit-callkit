# RTC 接入指南

## 概述

`callkit-core` 不直接调用任何 RTC SDK。上层框架需要通过以下两种方式之一接入 RTC：

1. **事件回调方式**：监听 `shouldJoinRtc` / `shouldLeaveRtc` 等事件，手动调用 RTC SDK
2. **RtcAdapter 方式**：实现 `RtcAdapter` 接口，传入 `CallKitCoreConfig.rtcAdapter`

## 方式一：事件回调（推荐用于快速集成）

```typescript
import { CallKitCore, CALL_TYPE } from '@easemob-community/callkit-core'
import AgoraRTC from 'agora-rtc-sdk-ng'

const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

const core = new CallKitCore({
  imClient: conn,
  onEvent: (event) => {
    switch (event.type) {
      case 'shouldJoinRtc': {
        const { channel, token, uid } = event.payload
        await agoraClient.join(appId, channel, token, uid)
        // 创建并发布本地轨道
        const audioTrack = await AgoraRTC.createMicrophoneAudioTrack()
        const videoTrack = await AgoraRTC.createCameraVideoTrack()
        await agoraClient.publish([audioTrack, videoTrack])
        break
      }

      case 'shouldLeaveRtc': {
        await agoraClient.leave()
        break
      }

      case 'shouldPublishTracks': {
        const { trackTypes } = event.payload
        // 根据 trackTypes 发布对应轨道
        break
      }

      case 'localAudioChanged': {
        const { enabled } = event.payload
        // 静音/取消静音本地音频轨道
        break
      }

      case 'localVideoChanged': {
        const { enabled } = event.payload
        // 开启/关闭本地视频轨道
        break
      }
    }
  }
})
```

## 方式二：RtcAdapter（推荐用于生产环境）

实现 `RtcAdapter` 接口，将 RTC 逻辑封装在适配器中：

```typescript
import type { RtcAdapter, JoinRtcParams } from '@easemob-community/callkit-core'
import AgoraRTC from 'agora-rtc-sdk-ng'

class AgoraRtcAdapter implements RtcAdapter {
  private client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
  private localAudioTrack?: IMicrophoneAudioTrack
  private localVideoTrack?: ICameraVideoTrack

  async joinChannel(params: JoinRtcParams): Promise<void> {
    await this.client.join(appId, params.channel, params.token, params.uid)
  }

  async leaveChannel(): Promise<void> {
    this.localAudioTrack?.close()
    this.localVideoTrack?.close()
    await this.client.leave()
  }

  async publishLocalTracks(types: ('audio' | 'video')[]): Promise<void> {
    const tracks = []
    if (types.includes('audio')) {
      this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack()
      tracks.push(this.localAudioTrack)
    }
    if (types.includes('video')) {
      this.localVideoTrack = await AgoraRTC.createCameraVideoTrack()
      tracks.push(this.localVideoTrack)
    }
    await this.client.publish(tracks)
  }

  async unpublishLocalTracks(types: ('audio' | 'video')[]): Promise<void> {
    const tracks = []
    if (types.includes('audio') && this.localAudioTrack) {
      tracks.push(this.localAudioTrack)
    }
    if (types.includes('video') && this.localVideoTrack) {
      tracks.push(this.localVideoTrack)
    }
    await this.client.unpublish(tracks)
  }

  async subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void> {
    // Agora 使用 uid 而非 userId，需要映射
    const uid = await resolveUserIdToUid(userId)
    await this.client.subscribe(uid, mediaType)
  }

  async unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void> {
    const uid = await resolveUserIdToUid(userId)
    await this.client.unsubscribe(uid, mediaType)
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    this.localAudioTrack?.setMuted(!enabled)
  }

  async setVideoEnabled(enabled: boolean): Promise<void> {
    this.localVideoTrack?.setMuted(!enabled)
  }
}

// 使用
const core = new CallKitCore({
  imClient: conn,
  rtcAdapter: new AgoraRtcAdapter()
})
```

## RtcAdapter 接口定义

```typescript
interface RtcAdapter {
  joinChannel(params: JoinRtcParams): Promise<void>
  leaveChannel(): Promise<void>
  publishLocalTracks(types: ('audio' | 'video')[]): Promise<void>
  unpublishLocalTracks(types: ('audio' | 'video')[]): Promise<void>
  subscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>
  unsubscribeRemoteUser(userId: string, mediaType: 'audio' | 'video'): Promise<void>
  setAudioEnabled(enabled: boolean): Promise<void>
  setVideoEnabled(enabled: boolean): Promise<void>
  switchCamera?(deviceId: string): Promise<void>
  switchMicrophone?(deviceId: string): Promise<void>
  switchAudioOutput?(device: 'speaker' | 'earpiece'): Promise<void>
}
```

## 注意事项

### uid 与 userId 映射

Agora RTC 使用数字 uid，而业务层使用字符串 userId。需要在接入层维护映射关系：

```typescript
// 方案 1：使用 Agora 的 getUserIdByRTCUIds API
const { data } = await conn.getUserIdByRTCUIds([uid])
const userId = data[uid]

// 方案 2：自行维护 Map
const uidToUserIdMap = new Map<number, string>()
```

### 轨道生命周期

- `shouldPublishTracks` 事件触发时，需要创建并发布轨道
- `shouldLeaveRtc` 事件触发时，需要关闭并释放所有轨道
- 轨道关闭后不可复用，下次需要重新创建

### 多端登录处理

当同一账号在多个设备登录时：
- invite 消息中的 `calleeDevId` 用于路由到正确设备
- 非目标设备收到 invite 时应忽略

## 平台差异

| 平台 | 注意事项 |
|------|----------|
| Web | 需要处理浏览器权限申请、设备枚举 |
| UniApp | 使用 uni-app 的 live-pusher/live-player 组件 |
| 小程序 | 使用微信小程序的 live-pusher/live-player，注意包大小限制 |
