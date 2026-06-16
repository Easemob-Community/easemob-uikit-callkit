# CallKit Core 实施路线图

> **当前分支**: `feat/callkit-core-extract`  
> **最后更新**: 2026-05-06  
> **状态**: Phase 3 已完成 ✅（64 测试通过）

---

## 总览

将 `lib/` 下信令核心逻辑抽离为框架无关的 JavaScript 库，仅保留环信 IM SDK 作为信令通道，RTC 层完全抽象。

---

## Phase 0：基础搭建 ✅

**目标**: 新建 `packages/callkit-core/` 目录，复制零改动的文件，搭好打包和测试骨架。

- [x] 新建 `pnpm-workspace.yaml`
- [x] 新建 `packages/callkit-core/package.json`（`@easemob-community/callkit-core`）
- [x] 新建 `packages/callkit-core/tsconfig.json`
- [x] 新建 `packages/callkit-core/vite.config.ts`（ESM + CJS + dts）
- [x] 复制 `lib/types/callstate.types.ts` → `src/types/`
- [x] 复制 `lib/types/signal.types.ts` → `src/types/`
- [x] 复制 `lib/utils/callUtils.ts` → `src/utils/`
- [x] 新建简化版 `src/utils/logger.ts`（可注入接口，不依赖 dexie）
- [x] 复制改造 `src/events/EventBus.ts`（去掉 logger 硬依赖）
- [x] 复制改造 `src/signaling/SignalRouter.ts`（内嵌 CmdMsgBody 类型）
- [x] 新建骨架文件：`CallKitCore.ts`、`IMProvider.ts`、`RtcAdapter.ts`、`CallKitEvents.ts` 等

**验证点**:
- [x] `pnpm build` 零报错

---

## Phase 1：状态机提取 ✅

**目标**: 将 `callStateStore`（Pinia）+ `GroupCallStore` 中的状态流转逻辑提取为纯 JS 类。

- [x] `SingleCallStateMachine`：单聊二元状态机
  - [x] `initInvite()` — 主叫发起
  - [x] `initIncoming()` — 被叫收到邀请
  - [x] `receiveAlert()` — 收到 alert
  - [x] `receiveConfirmRing()` — 收到 confirmRing
  - [x] `receiveAnswer()` — accept/refuse/busy
  - [x] `receiveCancel()` — 收到 cancel
  - [x] `receiveLeave()` — 收到 leave
  - [x] `receiveConfirmCallee()` — 收到 confirmCallee
  - [x] `hangup()` — 本地挂断
  - [x] `timeout()` — 邀请超时
  - [x] `reset()` — 强制重置，保留 callerDevId / callerUserId
- [x] `GroupCallSession`：群聊会话 + 参与者管理
- [x] 安装 vitest，写 22 个单元测试
- [x] 测试覆盖：主叫全流程 / 被叫全流程 / 拒绝 / 忙线 / 取消 / 超时 / leave / reset

**验证点**:
- [x] `pnpm test` 22/22 通过
- [x] `pnpm build` 零报错

---

## Phase 2：Handler 重构 ✅

**目标**: 把 `SingleCallSignalHandler` / `GroupCallSignalHandler` 从"控制器"退化为"处理器"，不再直接读写 Pinia，改为注入 `StateMachine` + `SignalSender`，返回 `DomainEvent[]`。

- [x] 扩展 `DomainEvent` 类型，添加群聊事件（`GROUP_CALL_INIT`、`PARTICIPANT_*`）
- [x] 修改 `SignalHandler` 接口：`handle()` 返回 `DomainEvent[]`
- [x] 修改 `SignalRouter.dispatch()`：聚合所有 Handler 返回的事件
- [x] 重构 `SingleCallSignalHandler`（~580 行 → 新核心库）
  - [x] 注入 `SingleCallStateMachine` + `SignalSender` + `deviceId`
  - [x] 移除 Pinia store 导入
  - [x] `handleAlert()` → 校验 deviceId → receiveAlert() → 发送 confirmRing → 返回事件
  - [x] `handleConfirmRing()` → 校验 callerDevId/calleeDevId → receiveConfirmRing() → 返回事件
  - [x] `handleAnswerCall()` → accept/refuse/busy 分支 → 发送 confirmCallee → 调用 receiveAnswer() → 返回事件
  - [x] `handleCancelCall()` → callId 匹配/不匹配容错 → receiveCancel() → 返回事件
  - [x] `handleLeaveCall()` → callId 匹配/不匹配容错 → receiveLeave() → 返回事件
  - [x] `handleConfirmCallee()` → callId 校验 → receiveConfirmCallee() → 返回事件
- [x] 重构 `GroupCallSignalHandler`（~384 行 → 新核心库）
  - [x] 注入 `GroupCallSession` + `SingleCallStateMachine` + `userId`
  - [x] `handleInviteTextMessage()` → 解析 invite 文本消息 → init session → 添加参与者 → 返回 `GROUP_CALL_INIT`
  - [x] `handleAnswerCall()` → accept → markAccepted + `PARTICIPANT_JOINED`；refuse → removeParticipant + `PARTICIPANT_LEFT`
  - [x] `handleCancelCall()` → 群聊容错（callId 不匹配 + caller + ALERTING/INVITING → 挂断）
  - [x] `handleLeaveCall()` → ALERTING + caller → 挂断；IN_CALL → `PARTICIPANT_LEFT`
- [x] 单测覆盖
  - [x] `SingleCallSignalHandler.test.ts`：17 个测试（alert/confirmRing/answer/cancel/leave/confirmCallee × 正常/异常场景）
  - [x] `GroupCallSignalHandler.test.ts`：11 个测试（init/answer/cancel/leave × 单聊/群聊分支）

**工作量预估**: 2-3 天 → **实际 1 天**

**验证点**:
- [x] `pnpm test` 50/50 通过（22 状态机 + 17 单聊 Handler + 11 群聊 Handler）
- [x] `pnpm build` 零报错（dist: 41KB ESM / 27KB CJS）

---

## Phase 3：Core Assembly ✅

**目标**: 把 `CallKitCore` 从骨架变成可运行的端到端核心。

- [x] 重构 `IMListener` — 改为回调模式，Core 控制完整消息流
- [x] 实现 `CallKitCore.inviteCall()`
  - [x] 生成 callId/channel，获取 RTC token
  - [x] `stateMachine.initInvite()` + `MessageBuilder.buildInviteExt()` + `SignalSender.sendInviteMessage()`
  - [x] 触发 `statusChanged` 事件
- [x] 实现 `CallKitCore.answerCall()`
  - [x] accept：发送 `answerCall('accept')`，等待 `confirmCallee`
  - [x] refuse：发送 `answerCall('refuse')` + `stateMachine.hangup()` → `callEnded`
- [x] 实现 `CallKitCore.hangup()`
  - [x] INVITING/ALERTING → 发送 `cancelCall`
  - [x] IN_CALL → 发送 `leaveCall`
  - [x] 触发 `callEnded`（含 duration）
- [x] 实现 `CallKitCore.inviteGroupCall()`
  - [x] 初始化 `GroupCallSession` + `SingleCallStateMachine`
  - [x] 发送 invite 文本消息（groupChat + receiverList）
- [x] 实现 `handleTextMessage()` — 单聊/群聊 invite 分支
  - [x] 单聊：`initIncoming()` → `incomingCall` 事件
  - [x] 群聊：`groupHandler.handleInviteTextMessage()` → `groupCallInit` 事件
- [x] 实现 `handleCmdMessage()` — Router dispatch → 事件映射
- [x] 实现 `DomainEvent → CallKitEvent` 完整映射（12 种事件）
- [x] 集成测试 `CallKitCore.test.ts`：14 个测试覆盖
  - [x] 主叫发起 → alert → accept → hangup
  - [x] 被叫收到 invite → accept/refuse → confirmCallee
  - [x] 群聊 invite → groupCallInit

**验证点**:
- [x] `pnpm test` 64/64 通过（22 状态机 + 17 单聊 Handler + 11 群聊 Handler + 14 Core 集成）
- [x] `pnpm build` 零报错（52KB ESM / 34KB CJS）

---

## Phase 4：Vue3 适配层

**目标**: 修改现有 `lib/composables/useCallKit.ts`，内部实例化 `CallKitCore`，订阅事件同步到 Pinia Store，保持现有 UI 组件无感知。

- [ ] 修改 `lib/composables/useCallKit.ts`
  - [ ] 内部 `new CallKitCore({ imClient, onEvent })`
  - [ ] `onEvent` 中：事件 → 同步到 `callStateStore` / `groupCallStore`
  - [ ] `shouldJoinRtc` 事件中调用现有 `useJoinChannel().joinChannel()`
- [ ] 验证现有 UI 组件无需改动
- [ ] `npx vue-tsc --noEmit --skipLibCheck` 零报错

**验证点**:
- [ ] `test/src/App.vue` 手动验证单聊 + 群聊全流程
- [ ] 现有 Vue3 CallKit 的 npm 打包 (`pnpm build:lib`) 正常

---

## Phase 5：UniApp Demo（可选，后续迭代）

**目标**: 验证核心库在 UniApp 场景下的可用性。

- [ ] 新建 `examples/uniapp-callkit/` 示例项目
- [ ] 集成 `@easemob-community/callkit-core` + `easemob-websdk`（uniapp 版）+ `agora-rtc-sdk-ng`（小程序版）
- [ ] 实现 `AgoraRtcAdapter`
- [ ] 手动验证：UniApp 打包到 H5 / 小程序 / App

---

## Phase 5：发布

**目标**: 发布 `@easemob-community/callkit-core` npm 包。

- [ ] 补充 README.md（安装、快速开始、API 文档）
- [ ] 补充 CHANGELOG.md
- [ ] `pnpm build && pnpm pack`
- [ ] 发布 `@easemob-community/callkit-core@0.1.0`

---

## 关键设计决策备忘

| 决策 | 说明 |
|---|---|
| **状态机不直接发消息** | `SingleCallStateMachine` 只管理状态和返回 `DomainEvent`，发送信令由 `SignalSender` 负责 |
| **callId 校验在 Handler** | 状态机假设 Handler 已做 callId 匹配校验，状态机只做状态流转 |
| **reset 保留 caller 身份** | 与现有 `callStateStore.resetCallState()` 行为一致，保留 `callerDevId` / `callerUserId` |
| **HANGUP_REASON 无 REMOTE_HANGUP** | 远程挂断统一用 `HANGUP_REASON.HANGUP`，与现有 CallService 行为一致 |
| **noUnusedLocals 关闭** | 骨架文件中有大量 TODO 方法，暂时关闭 TS 严格检查，待 Phase 2 完成后可重新开启 |
