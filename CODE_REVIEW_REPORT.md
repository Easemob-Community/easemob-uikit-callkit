# 代码审查报告：CallKit 一对一通话修复

> 审查时间：2026-07-13
> 审查范围：未提交变更（git diff）
> 审查重点：计时器双重触发、挂断重复清理、类似架构问题

---

## Critical Issues (MUST FIX)

### 1. RtcAdapter.ts 中仍存在计时器启动，与 CallKitCore 计时器冲突

**位置**: [RtcAdapter.ts](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/services/RtcAdapter.ts)

**问题**: `RtcAdapter.joinChannel()` 中仍调用了 `callTimerStore.startCallTimer()`，而 `CallKitCore` 已通过 `startDurationTimer` 每 1 秒发送 `callDurationUpdated` 事件。两者同时运行会导致计时器双重触发。

**修复**: 移除 `RtcAdapter.ts` 中的 `callTimerStore.startCallTimer()` 调用，统一由 CallKitCore 驱动计时器。

```typescript
// 删除以下代码
// callTimerStore.startCallTimer()
```

---

### 2. useEndCall.ts 中仍存在重复清理逻辑

**位置**: [useEndCall.ts](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/composables/useEndCall.ts)

**问题**: `useEndCall.hangup()` 在 `coreHangup` 成功后仍然调用 `callService.cleanup()`，而 `useCallKitCore.handleCoreEvent` 中 `callEnded` 事件已调用 `cleanupResources()` 和 `resetCallState()`。

**修复**: 让 `useEndCall` 遵循与 `useCallKit` 相同的原则——core 成功则不重复清理。

```typescript
const hangup = async (reason: HANGUP_REASON = HANGUP_REASON.HANGUP) => {
  try {
    await coreHangup({ reason: coreReason });
    // core 成功，callEnded 事件会触发清理，不需要重复调用
  } catch (coreErr) {
    logger.warn('useEndCall: core hangup 失败', coreErr);
    await callService.cleanup(); // 仅在失败时 fallback 清理
  }
};
```

---

### 3. EasemobChatCallStream.vue 中 onUnmounted 嵌套在 onMounted 内部

**位置**: [EasemobChatCallStream.vue#L425-L445](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/components/singleCall/EasemobChatCallStream.vue)

**问题**: Vue Composition API 中，`onUnmounted` 应该在 `<script setup>` 顶层注册，而不是嵌套在 `onMounted` 内部。虽然 Vue 会处理，但这是反模式，可能导致生命周期管理混乱。

**修复**: 将 `onUnmounted` 移到 `<script setup>` 顶层，与 `onMounted` 平行。

---

## Warnings (SHOULD FIX)

### 4. CallService.cleanup() 缺乏幂等性保护

**位置**: [CallService.ts](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/services/CallService.ts)

**问题**: `cleanup()` 被多处调用（core hangup 后、core 失败时回退），但缺乏重复调用保护。如果 `useCallKit.hangup()` 的 catch 分支和 core 的 `callEnded` 事件同时触发，可能并行执行两次 cleanup。

**修复**: 添加 `isCleaningUp` 标志确保幂等性。

```typescript
export class CallService {
  private isCleaningUp = false;

  async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      logger.warn('[CallService] 清理已在进行中，跳过重复调用');
      return;
    }
    this.isCleaningUp = true;
    try {
      // ... 现有清理逻辑
    } finally {
      this.isCleaningUp = false;
    }
  }
}
```

---

### 5. RtcAdapter 中 pendingUserId 可能内存泄漏

**位置**: [RtcAdapter.ts](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/services/RtcAdapter.ts)

**问题**: `joinChannel` 前预注册 `pendingUserId`，但如果 `joinChannel` 失败或超时，`pendingUserId` 可能不会被清理，导致 `pendingUserIds` Set 无限增长。

**修复**: 在 `try/finally` 中确保清理。

```typescript
joinChannel: async ({ channel, token, uid, appId }) => {
  rtcService.addPendingUserId(userId);
  try {
    await rtcService.joinChannel(...);
  } catch (err) {
    rtcService.removePendingUserId(userId); // 失败时清理
    throw err;
  }
  // 成功时 pendingUserId 会在 user-joined 事件后自动清理
}
```

---

### 6. useCallKitCore 模块级单例状态存在副作用风险

**位置**: [useCallKitCore.ts](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/composables/useCallKitCore.ts)

**问题**: `_callState`, `_coreInstance` 等变量定义在模块级（全局），多实例场景（如多标签页、微前端）会共享同一状态，导致冲突。

**修复**: 考虑使用 `provide/inject` 或 Pinia Store 来管理实例状态，或提供 `createCallKitCore()` 工厂函数。

---

## Suggestions (CONSIDER)

### 7. 计时器精度优化

**位置**: [CallKitCore.ts#L1449-L1462](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-core/src/core/CallKitCore.ts)

**问题**: `setInterval(..., 1000)` 并不保证精确 1 秒间隔，会累积误差。

**建议**: 改为每秒自增计数，避免累积误差。

```typescript
// 当前实现（累积误差）
const duration = Date.now() - this.durationStartTime;

// 优化实现（自增，无累积误差）
this.durationSeconds++;
const duration = this.durationSeconds * 1000;
```

---

### 8. 缺少 singleCallAccepted 事件处理

**位置**: [useCallKitCore.ts#L380-L399](/Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3/packages/callkit-vue3/src/composables/useCallKitCore.ts)

**问题**: 精确单聊/群聊生命周期事件分发中缺少 `singleCallAccepted` 事件。

**建议**: 检查 `callkit-core` 的 `CallKitEvents.ts` 确认是否导出了此事件类型，如有则补充处理。

---

### 9. 日志级别不一致

**位置**: 多处

**问题**: 部分地方使用 `logger.warn` 记录正常流程，部分使用 `logger.info` 记录错误恢复。

**建议**: 统一日志级别规范——错误恢复用 `warn`，正常流程用 `info`，严重错误用 `error`。

---

## Summary of Changes

- **计时器双重触发**: `useCallKitCore.ts` 的 `callStarted` 事件中移除了 `callTimerStore.startCallTimer()`，统一由 `CallKitCore` 的 `durationTimer` 驱动。但 `RtcAdapter.ts` 中仍存在重复启动，需进一步清理。
- **挂断重复清理**: `useCallKit.ts` 的 `hangup()` 和 `cancel()` 改为仅在 `coreHangup` 失败时才 fallback 调用 `callService.cleanup()`。但 `useEndCall.ts` 中仍存在重复清理，需同步修复。
- **Vite 配置修复**: 正则表达式改为 `new RegExp()` 字符串形式，避免 esbuild 解析错误；添加 `define` 注入 `__CALLKIT_VERSION__`，使用 `callkit-vue3` 子包的真实版本号。
- **架构风险**: 模块级单例状态、CallService 幂等性、pendingUserId 内存泄漏等问题需要后续迭代修复。

---

## 待验证项

- [ ] 单聊视频通话双方都能看到对方画面
- [ ] 单聊通话时长计时器正常递增
- [ ] 单聊挂断按钮能正常结束通话
- [ ] 挂断后重新发起通话正常
- [ ] 群聊通话不受单聊修复影响
