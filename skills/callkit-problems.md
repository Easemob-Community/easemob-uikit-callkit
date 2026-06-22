---
name: callkit-problems
description: >
  记录 Easemob Chat CallKit Vue3 编写过程中遇到的典型问题及根因分析。
  供后续评估整体 CallKit 设计方案/架构时参考。
---

# CallKit 编写过程中遇到的问题

## 问题 1：resourceId 固定导致离线消息重投，过期 invite 引起重复弹窗

### 现象

同一用户在不同设备/浏览器登录（resourceId 固定为 `webim_web_xxxx`），重新登录后 IM 服务端会把该用户在其他设备上已收到的离线消息重新投递一遍。过期的通话邀请（invite）文本消息会触发 `InvitationNotification` 弹窗，随后大量过期的 cancelCall / confirmCallee / leaveCall cmd 信令涌入。

### 日志特征

```
收到文本消息，发送方: pfh
开始处理通话邀请，发送方: pfh
[邀请处理] 当前通话状态: 0, 目标状态IDLE: 0
通话状态已更新至ALERTING
InvitationNotification: 显示通话邀请弹窗

// 随后大量过期信令，callId 均不匹配当前通话
cancelCall信令消息通话callId与当前通话callId不一致，不做处理
confirmCallee信令消息通话callId与当前通话callId不一致，不做处理
leaveCall信令消息通话callId与当前通话callId不一致，不做处理
```

### 根因分析

`handleInvitationMessage`（invite 文本消息处理入口）的校验过于薄弱，只检查了：
1. 是否是自己发的消息
2. 当前通话状态是否为 IDLE

**缺失校验**：
- **单聊 calleeDevId 匹配**：invite 消息 `ext.calleeDevId` 是目标设备的 resourceId，但代码完全没校验
- **消息时效性**：没有判断消息发送时间与当前时间的差值
- **群聊 invitedMembers 匹配**：虽然 Vue3 版本做了，但 React 版本也没做

### 修复方案（Vue3 已实施）

**防线一：单聊 calleeDevId 校验**

```ts
if (!isGroupCall && ext?.calleeDevId) {
  const currentDeviceId = chatClientStore.getClientDeviceId
  if (currentDeviceId && ext.calleeDevId !== currentDeviceId) {
    // 忽略：这条 invite 是发给另一个设备的
    return
  }
}
```

**防线二：消息时间戳过期判断**

```ts
// invite 文本消息：超过 inviteTimeout + 10s 忽略
if (message.time && isMessageExpired(message.time, inviteTimeout + 10000)) {
  return
}

// cmd 信令消息：超过 60 秒忽略
if (message.time && isMessageExpired(message.time, 60000)) {
  return
}
```

### React 版本对比

**React 版本（callkit/services/CallService.ts）存在完全相同的漏洞**：
- `handleInvitationMessage` 完全没有 `calleeDevId` 校验
- `handleInvitationMessage` 完全没有时间戳过期判断
- `handleInvitationMessage` 完全没有 `message.to` 或 `invitedMembers` 校验

React 版本只在 `handleConfirmRingMessage`（第2453行）和 `handleConfirmCalleeMessage`（第2633行）中做了 `calleeDevId !== clientResource` 的校验，但这些都是**收到 cmd 信令后**的处理，不是 invite 文本消息的入口过滤。

---

## 问题 2：群聊 answerCall 被两个 Handler 同时处理，导致一个成员拒绝即挂断整个通话

### 现象

群聊场景下，主叫邀请 A、B 两个成员。A 接受正常，B 拒绝后主叫端整个群聊通话直接结束，UI 关闭。

### 根因分析

`SignalRouter` 把 `answerCall` 同时注册给了 `SingleCallSignalHandler` 和 `GroupCallSignalHandler`：

```ts
this.signalRouter.register('answerCall', this.singleCallHandler)
this.signalRouter.register('answerCall', this.groupCallHandler)
```

当群聊 `answerCall` 到达时，`SingleCallSignalHandler` 先执行。它的 `handleAnswerCall` 没有按群聊分支过滤拒绝逻辑，直接调用：

```ts
this.stateMachine.receiveAnswer(ext.result as 'refuse' | 'busy')
```

`receiveAnswer` 在 refuse/busy 分支会 `resetCore()`，把 `singleCallState` 重置为 `IDLE` 并发出 `CALL_ENDED`。`useCallKitCore` 收到 `CALL_ENDED` 后清理资源、重置 UI，导致整个群聊通话被挂断。

accept 分支同样有问题：`SingleCallSignalHandler` 和 `GroupCallSignalHandler` 都会发送 `confirmCallee`，被叫会收到两次。

### 修复方案（Vue3 已实施）

在 `SingleCallSignalHandler.handleAnswerCall` 开头识别群聊类型，直接 `return []`，把群聊 answerCall 完全交给 `GroupCallSignalHandler`：

```ts
const isGroupCall =
  currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI
if (isGroupCall) {
  return []
}
```

### 设计教训

- `SignalRouter` 的 "一个 action 多个 handler" 模式需要明确责任边界。
- 单聊状态机与群聊会话的状态流转必须解耦，群聊一个参与者的 accept/refuse 不应该触发全局 `CALL_ENDED`。

---

## 问题 3：群聊被叫在 fetchRtcToken 期间丢失 cancelCall / leaveCall

### 现象

Web 主叫发起群聊后立刻取消，被叫端仍弹出了 `incomingCall` 邀请窗口；或者主叫已经挂断，被叫过了一会儿才收到邀请。

### 根因分析

`CallKitCore.handleGroupCallInvite` 是异步方法，被叫收到 invite 文本消息后要先执行：

```ts
const token = await this.fetchRtcToken(channel)
```

在这段等待时间里，`singleCallState` 仍然是 `IDLE`。而 `GroupCallSignalHandler` 的 `handleCancelCall` / `handleLeaveCall` 一进入就会检查：

```ts
if (
  currentState.type !== CALL_TYPE.VIDEO_MULTI &&
  currentState.type !== CALL_TYPE.AUDIO_MULTI
) {
  return []
}
```

由于状态机还没初始化群聊类型，这些信令会被直接忽略。等 `fetchRtcToken` 完成后，被叫才进入 `ALERTING` 并弹出邀请窗，但此时通话其实已经取消。

### 修复方案（Vue3 已实施）

在 `CallKitCore` 中维护一个待处理 invite 集合：

```ts
private pendingIncomingInvites = new Map<string, { aborted: boolean }>()
```

1. `handleGroupCallInvite` 在 `await fetchRtcToken` 前登记 `callId`
2. `handleCmdMessage` 在 dispatch 前拦截：若 `cancelCall` / `leaveCall` 的 `callId` 命中 pending invite，则标记 `aborted` 并直接 return
3. `fetchRtcToken` 返回后检查 `pending.aborted`，若为 true 则跳过 `initIncoming` 和 `incomingCall`

### 设计教训

- 任何涉及异步 IO（fetch token、查询用户资料、拉取群成员）的 invite 处理路径，都需要考虑 "异步窗口期" 内的信令到达。
- 状态机未就绪时，不能简单地把信令交给 Router 处理，否则会因为状态不匹配被丢弃。

---

## 问题 4：AUDIO_MULTI 群聊 confirmRing 回发 status=false

### 现象

音频群聊中，iOS/Android 被叫收到 invite 后回发 `alert`，但 Web 主叫已经处于 `IN_CALL`，回发的 `confirmRing` 中 `status=false`，被叫端等不到有效的 `confirmRing`，判定通话已取消，不弹框。

### 根因分析

`buildConfirmRingPayload` 中：

```ts
if (
  currentState.status > CALL_STATUS.RECEIVED_CONFIRM_RING &&
  currentState.type !== CALL_TYPE.VIDEO_MULTI
) {
  status = false
}
```

只排除了 `VIDEO_MULTI`，没有排除 `AUDIO_MULTI`。群聊主叫发 invite 后立即进入 `IN_CALL`，所以音频群聊会进入这个分支把 `status` 设成 `false`。

### 修复方案（Vue3 已实施）

统一判断群聊类型：

```ts
const isGroupCall =
  currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI
if (
  currentState.status !== undefined &&
  currentState.status > CALL_STATUS.RECEIVED_CONFIRM_RING &&
  !isGroupCall
) {
  status = false
}
```

### 设计教训

- 跨端兼容性常常藏在 "条件分支只覆盖了一种枚举值" 的细节里。
- 群聊的 `VIDEO_MULTI` 和 `AUDIO_MULTI` 在信令层应尽量保持行为一致，除非业务明确要求区分。

---

## 问题 5：一对一视频通话中，对方开关摄像头后大窗显示己方画面

### 现象

一对一视频通话正常建立后，对方（尤其是 iOS 端）快速关闭再打开摄像头，Web 端大窗（远程视频区域）会突然变成自己的画面。刷新页面后可能恢复，但反复操作后高概率复现，伴随 Agora SDK 报错：

```
AgoraRTCError REMOTE_USER_IS_NOT_PUBLISHED
```

### 根因分析

问题由多个并发因素叠加导致：

**1. Provider 重复初始化**

`EasemobChatCallKitProvider.vue` 在 `onMounted` 和 `watch(chatClientStore.getChatClient)` 里都会调用 `initCore()`。第一次初始化完成后，chatClient 的变化会触发第二次初始化，导致 `CallKitCore` 被销毁重建，`RtcService` 单例状态也发生重置。Agora client、本地轨道、远程订阅关系全部乱掉。

**2. `playRemoteVideo` 并发执行**

iOS 端快速开关摄像头时，`user-published` / `user-unpublished` 事件可能在 100ms 内连续到达。`CallStream` 对 `user-published` 做了 100ms 延迟再调用 `playRemoteVideo`，延迟期间对方可能已经取消发布，触发 `REMOTE_USER_IS_NOT_PUBLISHED`。同时：

- 事件触发了一次 `playRemoteVideo`
- 兜底订阅失败后的重试逻辑又触发了一次 `playRemoteVideo`
- 对方重新发布后新的 `user-published` 事件再次触发

多个 `playRemoteVideo` 并发执行，内部都执行 `currentRemoteVideoTrack.stop()` + `remoteVideoTrack.play()`，Agora 的同一个远程轨道被反复 stop/play，渲染状态错乱。

**3. 远程视频容器使用 `<video>` 元素**

Agora Web SDK v4 的 `IRemoteVideoTrack.play(element)` 要求传入 `<div>` 容器，SDK 会在容器内创建自己的 `<video>` 子元素。传入 `<video>` 元素会导致渲染行为不可预测。

### 修复方案（Vue3 已实施）

**修复 1：防止 Provider 重复初始化**

`EasemobChatCallKitProvider.vue` 增加 `coreInitialized` 状态锁：

```ts
let rtcInitializing = false
let coreInitializing = false
let rtcInitialized = false
let coreInitialized = false

async function initCore() {
  const client = chatClientStore.getChatClient
  if (!client || coreInitializing || coreInitialized) return
  // ...
  coreInitialized = true
}

watch(() => chatClientStore.getChatClient, async (client, oldClient) => {
  if (client && client !== oldClient && !coreInitialized) {
    await initRtcService()
    await initCore()
  }
})

onUnmounted(async () => {
  // ...
  rtcInitialized = false
  coreInitialized = false
})
```

**修复 2：远程视频容器改为 `<div>`**

```vue
<!-- 错误 -->
<video ref="remoteVideo" class="remote-video" autoplay></video>

<!-- 正确 -->
<div ref="remoteVideo" class="remote-video"></div>
```

CSS 确保 Agora 注入的子元素填满容器：

```css
.remote-video {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.remote-video video,
.remote-video canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

**修复 3：给 `playRemoteVideo` 加锁并过滤无需重试的错误**

```ts
let isPlayingRemoteVideo = false

const isRemoteUserNotPublishedError = (error: any): boolean => {
  const message = error?.message || error?.code || String(error)
  return message.includes('REMOTE_USER_IS_NOT_PUBLISHED')
}

const playRemoteVideo = async (userId: string) => {
  if (isPlayingRemoteVideo) return
  isPlayingRemoteVideo = true

  try {
    // ... 获取 track

    if (!remoteVideoTrack && retryCount.value === 0) {
      try {
        await rtcService.value.subscribeRemoteUser(remoteUser.uid, 'video')
        remoteVideoTrack = rtcService.value.getRemoteVideoTrack(uidStr)
      } catch (e: any) {
        if (isRemoteUserNotPublishedError(e)) {
          retryCount.value = 0
          return // 等待下一次 user-published
        }
      }
    }

    if (remoteVideoTrack && remoteVideo.value) {
      // 先 stop 旧 track 并清空容器
      if (currentRemoteVideoTrack) {
        currentRemoteVideoTrack.stop()
        currentRemoteVideoTrack = null
      }
      remoteVideo.value.innerHTML = ''

      remoteVideoTrack.play(remoteVideo.value)
      currentRemoteVideoTrack = remoteVideoTrack
      hasRemoteVideo.value = true
      remoteVideoEnabled.value = true
      retryCount.value = 0
    }
  } finally {
    isPlayingRemoteVideo = false
  }
}
```

### 设计教训

- **单例初始化必须加完成态锁**：不能只有 "初始化中" 锁，还要有 "已初始化" 锁，防止 watch 回调在完成后再次触发。
- **RTC 视频播放要串行化**：`play()`/`stop()` 是带副作用的异步操作，对同一个远程 track 的并发调用会导致 Agora 内部渲染状态异常。
- **Agora `play()` 必须使用 div 容器**：传入 `<video>` 元素虽然在某些场景下能跑，但快速状态切换时会出现不可预期的画面错位。
- **区分"需要重试"和"不需要重试"的错误**：`REMOTE_USER_IS_NOT_PUBLISHED` 表示对方已经取消发布，重试只会徒增噪音，应该等待下一次 `user-published` 事件。

---

## 问题 6：Vue CLI + webpack 项目使用 2.0.4 时 Provider setup 报 `getActivePinia()` 错误

### 现象

在 Vue CLI（webpack）搭建的 demo 中，安装 `@easemob-community/callkit-vue3@2.0.4` 后启动，控制台报错：

```
Uncaught Error: [🍍]: "getActivePinia()" was called but there was no active Pinia.
Are you trying to use a store before calling "app.use(pinia)"?
```

报错位置在 `EasemobChatCallKitProvider` 的 setup 阶段。Provider 渲染失败后，`<audio id="ring">` 元素也没有挂载到 DOM，于是连带出现：

```
usePlayRing.js:13 Uncaught (in promise) TypeError: Cannot read properties of null (reading 'pause')
```

### 根因分析

`callkit-vue3` 为了降低接入成本，把 `pinia` 作为 dependency 并 inline 打包到 `dist/index.js` 中，同时在插件 `install` 里自动注入 Pinia：

```ts
// 2.0.4 及之前
if (!app.config.globalProperties.$pinia) {
  app.use(createPinia());
}
```

这里有两个隐藏问题：

1. **Store 与 `createPinia()` 必须来自同一个 Pinia 实例**。由于 Pinia 的 `piniaSymbol` 是模块内通过 `Symbol()` 生成的，只要存在两份 Pinia 代码（例如 callkit 内部 inline 一份、项目又单独装了一份），它们的 symbol 就不匹配。如果外部已经设置了 `$pinia`，上述 `if` 会跳过内部 Pinia 的安装，导致内部 store 的 `useStore()` 找不到 active Pinia。
2. **webpack/Vue CLI 的模块解析和 provide/inject 时机与 Vite 有差异**。在 Vite 测试项目里条件注入可以正常工作，但在 webpack 构建的 demo 中，`getActivePinia()` 在 Provider setup 时检测不到 active 实例，说明 `app.use(createPinia())` 未能成功把内部 Pinia 设为当前 app 的 active 实例。

2.0.4 还加剧了触发时机：

- `chatClientStore.setClient()` 内聚了 IM 连接状态监听绑定/解绑。
- `EasemobChatCallKitProvider` 对 `props.chatClient` 使用了 `{ immediate: true }` 的 watch，setup 阶段同步调用 `chatClientStore.setClient()`，此时必须已经有 active Pinia。

### 修复方案（2.0.5 已实施）

在 `packages/callkit-vue3/src/index.ts` 中，移除条件判断，**始终使用 callkit 内部打包的 Pinia 实例**：

```ts
const EasemobChatCallKit: Plugin = {
  install(app: App, ...options: any[]) {
    console.info(`%c[EasemobChatCallKit] v${VERSION} initialized`, ...);
    // 必须始终安装 callkit 内部打包的 Pinia：
    // store 文件与该实例在同一 bundle 内，符号一致。
    app.use(createPinia());
    // 注册组件...
  },
};
```

### 设计教训

- **只要库内部 inline 打包了 Pinia，就不要做条件注入**。内部 store 的 `defineStore`/`useStore` 与外部 Pinia 的 symbol 可能不一致，条件跳过会导致不可预期的 `getActivePinia()` 失败。
- **不同构建工具的行为差异需要单独验证**。Vite 能跑通不代表 webpack/Vue CLI 也能跑通，发布前应在两种典型工程（Vite 和 Vue CLI）中都做冒烟测试。
- **Provider setup 中的 `immediate: true` watch 要谨慎**。任何同步触发 store action 的逻辑，都会把 "Pinia 是否已 active" 变成 hard requirement。

---

### 后续评估建议

- 统一 CallKit（React/Vue/iOS/Android）的 invite 入口校验标准
- 信令协议层面是否需要在服务端做 resourceId 路由优化，避免固定 resourceId 导致的消息重投
- 评估是否把 `playRemoteVideo` 这类带副作用的 RTC 操作抽象为队列或状态机，避免所有 UI 组件各自处理并发
- 评估是否需要服务端支持 "设备级离线消息过滤"（只投递给当前在线设备的 resourceId）
- 评估是否把 Pinia 从 inline bundle 改回 peerDependency，让用户显式安装并统一管理，彻底避免多实例问题
