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

### 后续评估建议

- 统一 CallKit（React/Vue/iOS/Android）的 invite 入口校验标准
- 信令协议层面是否需要在服务端做 resourceId 路由优化，避免固定 resourceId 导致的消息重投
- 评估是否需要服务端支持 "设备级离线消息过滤"（只投递给当前在线设备的 resourceId）
