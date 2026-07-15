---
name: callkit-platform-porting
description: >
  指导 AI 将基于 @easemob-community/callkit-core 的 CallKit 迁移到新的前端平台
  （UniApp、微信小程序、React、Angular 等）。以 callkit-vue3 为参考，但要求其
  只复用 core 与事件协议，不复制 Web/Vue3 专有实现。
  触发时机：用户要求新建 callkit-xxx 平台包、评估跨平台方案、把 Vue3 实现迁移到
  其他框架。
  关联文档：.agent/patterns.md、.agent/refactor-guide.md、skills/callkit-problems.md、
  skills/callkit-platform-pitfalls.md、skills/callkit-core-integration.md
---

# CallKit 跨平台迁移指南

## 一、核心原则

1. **只依赖 `@easemob-community/callkit-core`**，不引用 `callkit-vue3` 的任何 store/service/component。
2. **状态层、RTC 层、UI 层完全隔离**，参考 `.agent/patterns.md` 的四层架构。
3. **RTC 必须实现 `RtcAdapter` 接口**（`packages/callkit-core/src/rtc/RtcAdapter.ts`）。
4. **事件驱动**：UI 层只订阅事件，不直接操作 core。
5. **不要 inline 打包状态管理库**（Pinia/Vuex/MobX 等），避免多实例 symbol 不匹配。
6. **RTC 媒体状态必须按领域隔离**：单聊/群聊各自订阅 RtcService，不要共用全局 RTC Store。

## 二、平台能力对照表

| Vue3 概念 | UniApp 对应 | 微信小程序对应 | React 对应 |
|---|---|---|---|
| `createApp().use(EasemobChatCallKit)` | `App.vue` provide / 全局 mixin | `app.js` 全局初始化 | `React.Context` Provider |
| `EasemobChatCallKitProvider` | 根组件 + `onShow/onHide` | `app.js` / 页面 `onLoad` | 顶层 Provider 组件 |
| `Pinia Store` | Vue3 reactive / 外部 Pinia | Behavior / Page data | Zustand / Redux / Context |
| `callKitEventBus` | 事件总线 / mitt | `wx.on*` / Behavior 事件 | mitt / EventEmitter |
| `InvitationNotification` | `uni.showModal` + 自定义弹窗 | `wx.showModal` | Portal 弹窗 |
| 本地视频 | `<live-pusher>` | `<live-pusher>` | `<video>` + WebRTC |
| 远程视频 | `<live-player>` | `<live-player>` | `<div>`（Agora Web） |
| `RtcService` (Agora Web) | Agora 小程序/UniApp SDK | Agora 小程序 SDK | Agora Web SDK |
| 来电唤醒 | 推送 + 自定义路由 | VoIP / 普通推送 | 浏览器通知 / PWA |
| 页面生命周期 | `onShow/onHide/onUnload` | `onShow/onHide/onUnload` | `useEffect` |

## 三、最小目录结构

```
packages/callkit-<platform>/
├── src/
│   ├── core/
│   │   └── createPlatformCallKit.ts   // 封装 CallKitCore 生命周期
│   ├── rtc/
│   │   └── PlatformRtcAdapter.ts      // 实现 RtcAdapter
│   ├── store/
│   │   └── callState.ts               // 平台惯用法的响应式状态
│   ├── components/
│   │   ├── SingleCallContainer.*
│   │   ├── GroupCallContainer.*
│   │   └── IncomingCallNotification.*
│   └── index.ts
├── package.json
└── README.md
```

## 四、实现步骤

### Step 1: 确认 IM SDK 可用性

新平台必须提供与 `EasemobConnection`（`packages/callkit-core/src/core/CallKitCore.types.ts`）等价的能力：

- `send(msg)` 发送消息
- `addEventHandler/removeEventHandler` 监听文本/cmd 消息
- `getRTCToken(channel)` 获取 `{ data: { RTCToken, appId, RTCUId } }`
- `getUserIdByRTCUIds(uids)` uid → userId 映射

如果平台 SDK 返回值结构不同，先在外面包一层 adapter 再传给 core。

### Step 2: 实现 `RtcAdapter`

参考 `packages/callkit-core/src/rtc/RtcAdapter.ts`：

```ts
import type { RtcAdapter, JoinRtcParams } from '@easemob-community/callkit-core'

export function createPlatformRtcAdapter(): RtcAdapter {
  return {
    async joinChannel({ channel, token, uid, appId }) {
      // 1. 加入 RTC 频道
      // 2. 预注册 uid → userId 映射
      // 3. 根据通话类型创建并发布本地轨道
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
    // 可选
    async switchAudioOutput(device) {},
  }
}
```

**阶段 4 新增经验**：如果平台的 `RtcService` 是单例（Web 端常见），不要在里面保存 `localStream / audioEnabled / videoEnabled` 全局状态。应提供订阅 API：

```ts
class PlatformRtcService {
  subscribeAudioEnabledChange(cb: (enabled: boolean) => void): () => void
  subscribeVideoEnabledChange(cb: (enabled: boolean) => void): () => void
  subscribeLocalStreamChange(cb: (stream: any) => void): () => void
}
```

单聊/群聊分别订阅，写回各自领域状态。

### Step 3: 封装平台入口

```ts
import { CallKitCore } from '@easemob-community/callkit-core'

export function createPlatformCallKit(config: {
  imClient: any
  rtcAdapter: RtcAdapter
  inviteTimeout?: number
}) {
  const core = new CallKitCore({
    imClient: config.imClient,
    rtcAdapter: config.rtcAdapter,
    inviteTimeout: config.inviteTimeout ?? 30000,
    onEvent: (event) => {
      dispatchToPlatformState(event)
      notifyUI(event)
    },
  })

  return {
    call: (params) => core.inviteCall(params),
    groupCall: (params) => core.inviteGroupCall(params),
    answer: (params) => core.answerCall(params),
    hangup: () => core.hangup(),
    toggleAudio: () => core.toggleAudio(),
    toggleVideo: () => core.toggleVideo(),
    onEvent: (handler) => core.onEvent(handler),
    destroy: () => core.destroy(),
  }
}
```

### Step 4: 状态层

状态层只保存 UI 需要的数据：

- 单聊：`status / callId / channel / type / peerUserId / audioEnabled / videoEnabled / callDuration`
- 群聊：`session / participants[] / callDuration`
- 全局：`userInfoMap / isMinimized`

不要保存 RTC 轨道、MediaStream、remoteStreams 等业务无关对象。

**阶段 4 新增经验**：
- 单聊域和群聊域的 `localStream / audioEnabled / videoEnabled` 必须分开。
- Web 平台如果 RtcService 是单例，单聊/群聊切换时要取消旧订阅、建立新订阅，避免把本地流写到错误的域。
- 不要保留 `isConnected` 这种全局 RTC 连接状态，用单聊的 `status === IN_CALL` 或群聊的 `session.isActive` 判断即可。

**用户资料新增经验**：
- `userInfoMap` 必须支持业务主动 `setUserInfo(userId, info)` / `setUserInfoMap(map)`。
- 收到 `incomingCall` / `groupCallInit` 时把 `callerInfo` 写入 `userInfoMap`。
- 群聊 `participantJoined` / RTC `user-joined` 时若缓存无资料，自动调 Provider 拉取并更新 UI。

### Step 5: UI 层

UI 层只依赖状态层和事件：

- 收到 `incomingCall` → 显示来电通知
- `status === IN_CALL` → 显示通话中界面
- `groupCallInit` → 显示群聊通话界面
- `callEnded` → 关闭界面并展示通话记录

## 五、禁止事项

1. 不要直接引用 `callkit-vue3` 的 store/service/component。
2. 不要把 Pinia 或任何状态库 inline 打包到产物中。
3. 不要让 Service 直接读写 Store（参考 `.agent/refactor-guide.md` stage 3）。
4. 不要修改 `CALL_STATUS` / `CALL_TYPE` 枚举值。
5. 不要一次性跨多个阶段实施。

## 六、验证清单

- [ ] `pnpm build` / 平台构建零报错
- [ ] 单聊：主叫发起 → 被叫接听 → 通话中 → 挂断
- [ ] 单聊：被叫拒绝 / 忙线 / 超时
- [ ] 群聊：主叫发起 → 成员接听 → 视频/音频正常 → 挂断
- [ ] 群聊：主叫取消 / 成员离开
- [ ] 前后台切换后通话状态正确
- [ ] 重新发起通话没有状态污染
- [ ] 被叫弹窗显示主叫昵称/头像，而不是 userId
- [ ] 群聊新加入用户显示昵称/头像
- [ ] 手动 setUserInfo 后 UI 立即刷新
