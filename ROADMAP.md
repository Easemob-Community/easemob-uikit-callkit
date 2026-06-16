# CallKitCore 提取路线图

> **分支**: `feat/callkit-core-extract`
> **目标**: 将 `lib/` 中的通话信令逻辑提取为框架无关的 `@easemob-community/callkit-core` 核心库
> **策略**: 双轨并行（新旧链路共存，`?core=1` 切换验证）

---

## 已完成阶段

### ✅ Phase 0: 脚手架搭建
- [x] pnpm workspace 配置 (`packages/*` + `test`)
- [x] `packages/callkit-core/` 目录结构与基础构建配置
- [x] `vite-plugin-dts` 类型生成
- [x] vitest 测试框架 + `@vitest/coverage-v8`
- [x] 零依赖文件迁移（`types/`, `utils/`, `signaling/MessageBuilder`）

### ✅ Phase 1: 状态机实现
- [x] `SingleCallStateMachine`（纯 JS 状态机，8 种状态，11 个转换方法）
- [x] `GroupCallSession`（Map-based 参与者管理）
- [x] 22 个状态机单元测试（全部通过）

### ✅ Phase 2: Handler 重构
- [x] `SingleCallSignalHandler` (~340 行) — 纯处理器，返回 `DomainEvent[]`
- [x] `GroupCallSignalHandler` (~250 行) — 同上
- [x] 移除 Pinia 依赖，注入 `StateMachine`/`Session` + `SignalSender`
- [x] 28 个 Handler 单元测试（全部通过）

### ✅ Phase 3: Core 组装
- [x] `CallKitCore` 端到端编排：
  - `inviteCall()` → token → `initInvite()` → `SignalSender`
  - `answerCall()` → accept/refuse/busy 分支
  - `hangup()` → cancelCall (INVITING) / leaveCall (IN_CALL)
  - `inviteGroupCall()` → `GroupCallSession` + invite text
- [x] `IMListener` — 薄 wrapper，回调驱动
- [x] `SignalRouter` — 注册式消息路由
- [x] 12 种 `CallKitEvent` → `DomainEvent` 映射
- [x] `CallKitCore.test.ts` 14 个集成测试（全部通过）
- [x] **构建零报错，测试 64/64 通过**

### ✅ Phase 4: Vue3 适配层（双轨并行）
- [x] `lib/composables/useCallKitCore.ts` — 新建文件，零修改现有 `lib/`
- [x] Core 事件 → Pinia Store 同步映射（`callStateStore` / `groupCallStore` / `globalCallStore`）
- [x] Core 事件 → `callKitEventBus` 转发（保持 UI 组件兼容性）
- [x] `shouldJoinRtc` → `useJoinChannel().joinChannel()` 桥接
- [x] `useListenerManager` 旧监听器自动卸载（避免重复处理）
- [x] `lib/index.ts` 导出 `useCallKitCore`
- [x] `test/App.vue` 双轨切换开关（`?core=1` 激活 Core 链路）
- [x] `vue-tsc --noEmit --skipLibCheck` 零报错

---

## 剩余工作

### Phase 5: RTC 适配层 ✅ 已收尾
**目标**: Core 的 `RtcAdapter` 接口正式接入 Agora SDK

- [x] 实现 `RtcAdapter` 接口（`lib/services/RtcServiceAdapter.ts`）
- [x] `CallKitCore` 中自动调用注入的 `rtcAdapter`（`shouldJoinRtc`/`shouldLeaveRtc`/`shouldPublishTracks`）
- [x] `RtcService` 补充 `unpublishTracks` / `unsubscribeRemoteUser` / `getLocalAudioTrack`
- [x] `useCallKitCore` adapter 中 `shouldLeaveRtc` → `cleanupRtc()`
- [x] `SingleCallStateMachine` 添加 `audioEnabled` / `videoEnabled` 状态管理
- [x] Core 发出 `localAudioChanged` / `localVideoChanged` → adapter 同步到 `rtcChannelStore`
- [x] 群聊：`RtcMediaBridge` 消费 Core 事件（替代现有 `useListenerManager` 的群聊分支）→ **长期保留双轨，不强制替代**

**Phase 4-5 修复与收尾记录**:
- ✅ 群聊 `answerCall`：被叫方接受后直接进入 `IN_CALL` + `SHOULD_JOIN_RTC`
- ✅ `groupCall` 中 `joinChannel()` 失败不再阻断流程
- ✅ `SingleCallStateMachine` 新增 `audioEnabled` / `videoEnabled` 状态
- ✅ `CallKitCore` 新增 `toggleAudio()` / `toggleVideo()` API
- ✅ `useCallKitCore` adapter 处理 `localAudioChanged` / `localVideoChanged`
- ✅ `RtcServiceAdapter` 实现完整 `RtcAdapter` 接口
- ✅ `CallKitCore` 自动调用注入的 `rtcAdapter`
- ✅ 新增 11 个单元/集成测试（状态机 7 个 + Core 4 个），全部通过

### Phase 6: 双轨一致性验证与长期并行（策略调整）
**目标**: 旧链路已发布且稳定，Core 新链路与之长期并行，通过对比验证行为一致性

**策略变更**: 由「替换废弃」转为「长期双轨 + 渐进验证」

- [ ] **一致性验证清单**
  - [ ] 单聊主叫流程：发起 → 响铃 → 接受 → 进入通话 → 挂断（新旧链路对比）
  - [ ] 单聊被叫流程：收到邀请 → 接受 → 进入通话 → 挂断（新旧链路对比）
  - [ ] 群聊主叫流程：发起 → 成员接受 → 进入通话 → 挂断（新旧链路对比）
  - [ ] 异常场景：拒绝 / 忙线 / 超时 / 取消（新旧链路对比）
  - [ ] 多端场景：主叫多端 / 被叫多端（新旧链路对比）
- [ ] **渐进迭代**
  - [ ] 新功能优先在 Core 链路实现，旧链路保持冻结
  - [ ] `test/App.vue` `?core=1` 开关长期保留，作为验证入口
  - [ ] Core 链路通过充分验证后，后续版本可将 `useCallKitCore` 作为默认导出（旧链路仍保留）
- [ ] **不删除的旧代码**
  - `lib/composables/useCallKit.ts` — 旧链路主入口，已发布稳定
  - `lib/composables/useListenerManager.ts` — 旧 monolith，保持兼容
  - `lib/signaling/` 中的旧 Handler — 保持兼容
  - `lib/deprecated/` — 按 AGENTS.md 保留

### Phase 7: 发布与文档
- [ ] `packages/callkit-core` 独立版本发布（v0.1.0 → v1.0.0）
- [ ] 更新 `README.md` 和 `USAGE.md`
- [ ] 发布 `@easemob-community/callkit-vue3` 新版本（依赖 `@easemob-community/callkit-core`）

---

## 验证清单

每次阶段完成后执行：
1. `npx vue-tsc --noEmit --skipLibCheck` 零报错 ✅
2. `cd packages/callkit-core && npx vitest run` 全部通过 ✅
3. `test/src/App.vue` 手动验证目标场景
4. commit message: `refactor(core): [阶段名] — [简要说明]`
