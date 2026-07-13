---
name: callkit-architecture
description: >
  Easemob Chat CallKit 整体架构设计思路与关键决策沉淀。
  供后续评估 CallKit 设计方案、跨平台对齐、架构升级时参考。
  触发时机：用户询问架构设计、技术选型、跨平台对齐、性能优化方向。
  关联文档：.agent/patterns.md（架构模式速查）、.agent/refactor-guide.md（重构规范）
---

# CallKit 整体架构设计思路

## 一、目标架构模型

```
┌─────────────────────────────────────────────┐
│                 UI 层（完全隔离）             │
│  ┌──────────────┐    ┌────────────────────┐ │
│  │ SingleCall   │    │ GroupCallShell     │ │
│  │ 单聊 UI 组件  │    │ 群聊 UI 组件        │ │
│  └──────┬───────┘    └──────────┬─────────┘ │
└─────────┼───────────────────────┼───────────┘
          │                       │
┌─────────▼───────────────────────▼───────────┐
│           应用/状态层（领域隔离）              │
│  ┌─────────────────┐  ┌───────────────────┐ │
│  │ SingleCallStore │  │ GroupCallStore    │ │
│  │ (callStateStore)│  │                   │ │
│  └────────┬────────┘  └─────────┬─────────┘ │
│           │                     │           │
│  ┌────────┴─────────────────────┴─────────┐ │
│  │      GlobalCallStore（跨域共享）         │ │
│  │  • userInfoMap（昵称/头像）              │ │
│  │  • isMinimized（窗口模式）               │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │      领域服务层（共享能力）   │
          │  ┌────────────────────────┐ │
          │  │ @easemob-community/    │ │
          │  │   callkit-core           │ │
          │  │ • CallKitCore            │ │
          │  │ • SignalRouter           │ │
          │  │ • SingleCallStateMachine   │ │
          │  │ • GroupCallSession         │ │
          │  │ • EventBus                 │ │
          │  └────────────────────────┘ │
          │  ┌────────────────────────┐ │
          │  │ RtcService / RtcAdapter│ │
          │  │ （join/leave/track）   │ │
          │  │ 注意：无状态，纯原子操作  │ │
          │  └────────────────────────┘ │
          └─────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │      基础设施层（外部 SDK）  │
          │  • 环信 IM SDK             │
          │  • Agora RTC SDK           │
          └─────────────────────────────┘
```

### 关键设计决策

| 层级 | 策略 | 理由 |
|---|---|---|
| UI 层 | 彻底隔离 | 单聊是"一对一窗口"，群聊是"多方网格+拖拽" |
| 状态层 | 领域隔离 + GlobalCallStore 共享 | 单聊是二元状态机，群聊是分布式参与者集合 |
| 服务层 | 共享 | sendInviteMessage、joinChannel、createAudioTrack 是通用能力 |
| 基础设施 | 共享 | IM 连接和 RTC 客户端各一个实例 |

---

## 二、关键设计决策

### 多端一致性

**问题**：同一用户多端登录时，通话状态如何同步？

**当前实践**：
- 发送 invite 时携带 `calleeDevId`（目标设备 resourceId）
- 接收 cmd 信令时校验 `calleeDevId === clientResource`
- **缺失**：React 版本 invite 入口没有 calleeDevId 校验

### 离线消息与重连

**当前实践**：
- Vue3：增加 `isMessageExpired()` 基于消息时间戳过滤（invite 40s 阈值，cmd 60s 阈值）
- React：无任何过滤

### 事件系统设计

**当前实践**：
- Vue3：类型安全的 EventBus + `useCallKitEvents()` composable
- 事件 payload 包含 `conversationId`、`isLocal`、`localUserRole`、`endedBy`
- 提供 `getCallRecord()` API 自动生成标准化通话记录

### 状态管理策略

**当前实践**：
- `callStateStore`：单聊专用状态
- `GroupCallStore`：群聊专用状态（Pinia）
- `GlobalCallStore`：跨域共享状态
- **缺失**：没有考虑跨 session 状态恢复

### 信令协议设计

**当前实践**：
- invite 文本消息 ext 包含：`callId`、`channelName`、`callerDevId`、`calleeDevId`、`type`、`ts`、`invitedMembers`
- cmd 消息 ext 包含：`action`、`callId`、`callerDevId`、`calleeDevId`、`result`

### RTC 服务抽象

**目标设计**：
- `RtcService`：纯 SDK 封装，无状态，通过回调传出事件
- `SingleCallRtcAdapter` / `RtcMediaBridge`：消费回调，写回各自 Store
- `RtcJoinService`：无状态 joinChannel 原子操作

---

## 三、跨平台对齐检查清单

| 检查项 | React | Vue3 | iOS | Android |
|--------|-------|------|-----|---------|
| invite 入口 calleeDevId 校验 | ❌ | ✅ | ? | ? |
| invite 入口时间戳过期判断 | ❌ | ✅ | ? | ? |
| cmd 信令时间戳过期判断 | ❌ | ✅ | ? | ? |
| message.to 校验（单聊） | ❌ | ✅ | ? | ? |
| invitedMembers 校验（群聊） | ❌ | ✅ | ? | ? |
| callId 缓存过滤 | ❌ | ❌ | ? | ? |
| 事件 payload 含 conversationId | ❌ | ✅ | ? | ? |
| 事件 payload 含 isLocal | ❌ | ✅ | ? | ? |
| 事件 payload 含 localUserRole | ❌ | ✅ | ? | ? |
| 提供 getCallRecord API | ❌ | ✅ | ? | ? |

---

## 四、后续架构演进方向

1. **阶段 3：RTC 服务去状态化** —— RtcService 纯回调，Store 消费回调
2. **阶段 4：rtcChannelStore 拆解** —— 彻底消除全局 RTC 状态池
3. **阶段 5：跨平台信令协议标准化** —— 统一各平台的 invite/cmd 信令字段和校验逻辑

---

## 五、相关文档

- **AI 开发规范**：`.agent/dev-guide.md`
- **重构规范**：`.agent/refactor-guide.md`
- **架构模式**：`.agent/patterns.md`
- **当前状态**：`.agent/current-state.md`
---
name: callkit-architecture
description: >
  Easemob Chat CallKit 整体架构设计思路与关键决策沉淀。
  供后续评估 CallKit 设计方案、跨平台对齐、架构升级时参考。
---

# CallKit 整体架构设计思路

## 一、目标架构模型

```
┌─────────────────────────────────────────────┐
│                 UI 层（完全隔离）             │
│  ┌──────────────┐    ┌────────────────────┐ │
│  │ SingleCall   │    │ GroupCallShell     │ │
│  │ 单聊 UI 组件  │    │ 群聊 UI 组件        │ │
│  └──────┬───────┘    └──────────┬─────────┘ │
└─────────┼───────────────────────┼───────────┘
          │                       │
┌─────────▼───────────────────────▼───────────┐
│           应用/状态层（领域隔离）              │
│  ┌─────────────────┐  ┌───────────────────┐ │
│  │ SingleCallStore │  │ GroupCallStore    │ │
│  │ (callStateStore)│  │                   │ │
│  └────────┬────────┘  └─────────┬─────────┘ │
│           │                     │           │
│  ┌────────┴─────────────────────┴─────────┐ │
│  │      GlobalCallStore（跨域共享）         │ │
│  │  • userInfoMap（昵称/头像）              │ │
│  │  • isMinimized（窗口模式）               │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │      领域服务层（共享能力）   │
          │  ┌────────────────────────┐ │
          │  │ SignalingService       │ │
          │  │ （发送/接收信令，无状态） │ │
          │  └────────────────────────┘ │
          │  ┌────────────────────────┐ │
          │  │ RtcChannelService      │ │
          │  │ （join/leave/track）   │ │
          │  └────────────────────────┘ │
          └─────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │      基础设施层（外部 SDK）  │
          │  • 环信 IM SDK             │
          │  • Agora RTC SDK           │
          └────────────────────────────┘
```

## 二、关键设计决策

| 层级 | 策略 | 理由 |
|---|---|---|
| UI 层 | 彻底隔离 | 单聊是"一对一窗口"，群聊是"多方网格+拖拽"，交互模式差异巨大 |
| 状态层 | 领域隔离 + GlobalCallStore 共享 | 单聊是二元状态机，群聊是分布式参与者集合 |
| 服务层 | 共享 | sendInviteMessage、joinChannel、createAudioTrack 是通用能力 |
| 基础设施 | 共享 | IM 连接和 RTC 客户端各一个实例 |

## 三、架构设计时应考虑的核心问题

### 3.1 多端一致性

**问题**：同一用户多端登录时，通话状态如何同步？

**应考虑的子问题**：
- resourceId 固定 vs 动态：固定 resourceId 会导致离线消息重投（见 [callkit-problems.md](./callkit-problems.md)）
- 设备身份校验：invite 信令是否携带目标设备标识（calleeDevId）？接收方是否校验？
- 多端抢占：A 设备接听后，B 设备应收到什么通知？是否需要主动拒绝 B 设备？
- 状态同步：通话中切换设备，如何恢复当前通话状态？

**当前实践**：
- 发送 invite 时携带 `calleeDevId`（目标设备 resourceId）
- 接收 cmd 信令时校验 `calleeDevId === clientResource`
- **缺失**：invite 文本消息入口处没有 calleeDevId 校验（Vue3 已修复，React 仍缺失）

### 3.2 离线消息与重连

**问题**：用户离线期间收到通话邀请，重新上线后如何处理？

**应考虑的子问题**：
- 过期 invite 过滤：基于消息时间戳判断？基于 callId 缓存？还是两者结合？
- 离线信令堆积：大量过期的 cancelCall/confirmCallee/leaveCall 信令如何处理？
- 重连后状态恢复：是否需要持久化通话状态到 localStorage？
- 服务端支持：IM 服务端是否支持"只投递未过期离线消息"？

**当前实践**：
- Vue3：增加 `isMessageExpired()` 基于消息时间戳过滤（invite 40s 阈值，cmd 60s 阈值）
- React：无任何过滤

### 3.3 事件系统设计

**问题**：CallKit 如何向接入方暴露通话生命周期事件？

**应考虑的子问题**：
- 事件粒度过粗 vs 过细：每个状态变化都发事件？还是只发语义化事件（callStarted/callEnded）？
- 事件方向标识：接入方如何区分"本端触发"和"对端触发"？是否需要 `isLocal` 字段？
- 会话标识：单聊和群聊的会话 ID 如何统一？是否需要 `conversationId` 字段？
- 通话记录生成：CallKit 是否应该提供标准化的通话记录对象？
- 事件订阅方式：EventBus？回调函数？还是两者并存？

**当前实践**：
- Vue3：类型安全的 EventBus + `useCallKitEvents()` composable
- 事件 payload 包含 `conversationId`、`isLocal`、`localUserRole`、`endedBy`
- 提供 `getCallRecord()` API 自动生成标准化通话记录

### 3.4 状态管理策略

**问题**：单聊和群聊的状态如何组织？全局状态 vs 领域状态？

**应考虑的子问题**：
- 单聊状态：二元状态机（IDLE → INVITING → ALERTING → IN_CALL → IDLE）
- 群聊状态：分布式参与者集合（每个参与者的 state: invited/joinedRtc/left）
- 共享状态：userInfoMap、isMinimized 等跨域状态放在哪里？
- 状态持久化：是否需要跨 session 持久化？哪些状态需要？
- 状态重置：通话结束后，哪些状态要清零？哪些保留？

**当前实践**：
- `callStateStore`：单聊专用状态
- `GroupCallStore`：群聊专用状态（Pinia / Zustand）
- `GlobalCallStore`：跨域共享状态
- **缺失**：没有考虑跨 session 状态恢复（如通话中断后刷新页面）

### 3.5 信令协议设计

**问题**：CallKit 的自定义信令协议应该包含哪些字段？

**应考虑的子问题**：
- 设备标识：`callerDevId`、`calleeDevId` 是否必须？
- 时间戳：`ts` 字段是否必须？用于离线消息过期判断
- 通话标识：`callId`、`channel` 的生成策略和唯一性保证
- 群聊标识：`groupId`、`invitedMembers` 的处理
- 版本兼容：信令协议升级后，旧版本客户端如何处理新字段？
- 扩展字段：`ext` 对象的设计，预留扩展空间

**当前实践**：
- invite 文本消息 ext 包含：`callId`、`channelName`、`callerDevId`、`calleeDevId`、`type`、`ts`、`invitedMembers`
- cmd 消息 ext 包含：`action`、`callId`、`callerDevId`、`calleeDevId`、`result`

### 3.6 RTC 服务抽象

**问题**：RTC 服务应该是有状态的还是无状态的？

**应考虑的子问题**：
- 状态归属：RTC 相关状态（localStream、remoteStreams、joinedUsers）放在 Store 还是 Service？
- 回调设计：RtcService 通过回调通知状态变化，还是直接读写 Store？
- 多频道支持：是否需要支持同时加入多个 RTC 频道？
- 媒体资源管理：谁负责创建/销毁 AudioTrack/VideoTrack？
- 平台差异：WebRTC / Agora / TRTC 的抽象层设计

**目标设计**：
- `RtcService`：纯 SDK 封装，无状态，通过回调传出事件
- `SingleCallRtcAdapter` / `RtcMediaBridge`：消费回调，写回各自 Store
- `RtcJoinService`：无状态 joinChannel 原子操作

### 3.7 错误处理与降级

**问题**：CallKit 各层出错时如何优雅降级？

**应考虑的子问题**：
- 信令发送失败：是否重试？重试几次？
- RTC 加入失败：是否自动回退？如何通知用户？
- IM 连接断开：通话中 IM 断连，RTC 是否应该保持？
- 媒体设备权限：摄像头/麦克风被拒绝时，是否允许纯音频通话？
- 超时处理：invite 超时、响铃超时、确认超时分别如何处理？

**当前实践**：
- invite 超时 30s 后自动取消
- 响铃超时后有 handleTimeout 处理
- 部分错误通过 `callKitEventBus` 的 `callEnded` 事件暴露给接入方

### 3.8 可测试性

**问题**：CallKit 各层如何独立测试？

**应考虑的子问题**：
- UI 层：是否需要 Storybook / 视觉回归测试？
- 状态层：Store 的 action/getter 是否可单元测试？
- 服务层：SignalingService / RtcService 是否可以 Mock SDK 进行测试？
- 集成测试：完整的通话流程（邀请→接听→通话→挂断）如何自动化？
- 手动测试：test/src/App.vue 手动验证覆盖哪些场景？

**当前实践**：
- 无自动化测试，全靠 `test/src/App.vue` 手动验证
- 每个重构阶段完成后必须手动验证单聊/群聊完整流程

### 3.9 向后兼容性

**问题**：CallKit 升级后如何不影响已有接入方？

**应考虑的子问题**：
- Props 接口：新增 Props 是否有默认值？删除 Props 是否发 deprecation 警告？
- 事件接口：新增事件字段是否可选？删除字段是否兼容？
- Store 接口：Store 的 state shape 变化是否影响接入方？
- 信令协议：新旧版本客户端互通时，未知字段如何处理？
- 版本迁移：是否提供迁移指南？

**约束**：
- 不要修改单聊 UI 组件的外部 props / emits 接口
- 不要删除 `lib/deprecated/` 目录
- 不要修改 `types/callstate.types.ts` 中的 CALL_STATUS / CALL_TYPE 枚举值

### 3.10 性能考虑

**问题**：CallKit 在大量参与者、长时间通话时的性能表现？

**应考虑的子问题**：
- 视频轨道数量限制：浏览器同时解码多少路视频？
- 内存泄漏：RTC 连接断开后，MediaStream / AudioTrack 是否正确释放？
- 定时器管理：超时定时器是否正确清理？
- 重渲染优化：群聊视频网格在参与者变化时是否过度重渲染？
- 日志级别：生产环境默认只输出 ERROR/WARN/INFO

## 四、跨平台对齐检查清单

| 检查项 | React | Vue3 | iOS | Android |
|--------|-------|------|-----|---------|
| invite 入口 calleeDevId 校验 | ❌ | ✅ | ? | ? |
| invite 入口时间戳过期判断 | ❌ | ✅ | ? | ? |
| cmd 信令时间戳过期判断 | ❌ | ✅ | ? | ? |
| message.to 校验（单聊） | ❌ | ✅ | ? | ? |
| invitedMembers 校验（群聊） | ❌ | ✅ | ? | ? |
| callId 缓存过滤 | ❌ | ❌ | ? | ? |
| 事件 payload 含 conversationId | ❌ | ✅ | ? | ? |
| 事件 payload 含 isLocal | ❌ | ✅ | ? | ? |
| 事件 payload 含 localUserRole | ❌ | ✅ | ? | ? |
| 提供 getCallRecord API | ❌ | ✅ | ? | ? |

## 五、后续架构演进方向

1. **阶段 2：信令路由拆分** —— 把 monolithic listener 拆成 SignalRouter + Handler
2. **阶段 3：RTC 服务去状态化** —— RtcService 纯回调，Store 消费回调
3. **阶段 4：rtcChannelStore 拆解** —— 彻底消除全局 RTC 状态池
4. **阶段 5：跨平台信令协议标准化** —— 统一各平台的 invite/cmd 信令字段和校验逻辑
