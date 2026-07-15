# 当前状态

> 本文件记录 CallKit 重构的实时进度。AI 每次处理 CallKit 任务时**必须首先阅读**。
> 更新时机：阶段完成、重大 bug 修复、架构决策变更。

---

## 重构阶段

| 阶段 | 状态 | 说明 |
|---|---|---|
| 0. 群聊从旧架构迁出 | ✅ 完成 | `EasemobChatMultiCall.vue` 重写为薄 wrapper |
| 1. 状态层净地化 | ✅ 完成 | `GlobalCallStore` 提取，`callStateStore` 回归单聊域 |
| 2. 信令路由拆分 + callkit-core 集成 | ✅ 完成 | `SignalRouter` 拆分，`useListenerManager` 仅挂载监听 |
| 3. RTC 服务去状态化 | ✅ 完成 | `RtcService` 改为纯回调 + `subscribe*` 多订阅 API |
| 4. rtcChannelStore 拆解与领域化 | ✅ 完成 | 彻底消除全局 RTC 状态池，单聊/群聊各自维护媒体状态 |
| 5. 跨平台信令协议标准化 | ⏸ 远期 | 统一 React/Vue/iOS/Android 信令字段 |

---

## 阶段 3 / 4 详细进展

### 目标
- 阶段 3：`RtcService` 变成纯 SDK 封装，不读写任何 Store。
- 阶段 4：彻底消除全局 RTC 状态池，按单聊/群聊领域隔离。

### 已完成
- [x] `RtcService` 移除所有 Store 依赖，改为回调传出
- [x] 新增 `subscribeAudioEnabledChange` / `subscribeVideoEnabledChange` / `subscribeLocalStreamChange`，支持多域独立订阅
- [x] `useCallKitRtc` 退化为纯 RtcService 实例容器，删除全局 `_state`
- [x] 单聊域：`useCallKitCore` 自行维护 `audioEnabled` / `videoEnabled` / `localStream`
- [x] 群聊域：`useGroupCallViewModel` + `GroupCallStore.localParticipant` 独立管理本地媒体
- [x] `EasemobChatCallStream.vue` 改读 `useCallKitCore` 单聊域状态
- [x] `GroupCallShell.vue` 删除对 `useCallKitRtc().localStream` 的依赖
- [x] `useRtcService` / `CallService` / `RtcAdapter` 移除对全局 RTC 状态的依赖

### 验证清单（已执行类型检查）
- [ ] 单聊：视频通话双方都能看到对方画面（需手动验证）
- [ ] 群聊：本地视频 + 远程视频都能正常渲染（需手动验证）
- [ ] 静音/摄像头切换功能正常（需手动验证）
- [ ] 单聊挂断后重新发起通话正常（需手动验证）
- [ ] 群聊挂断后重新发起通话正常（需手动验证）

---

## 已知问题（未解决）

| 问题 | 影响 | 临时规避 | 根治计划 |
|---|---|---|---|
| 无自动化测试 | 重构风险高 | 全靠 `test/src/App.vue` 手动验证 | 阶段 4 后评估引入单元测试 |
| React 版本 invite 入口无 calleeDevId 校验 | 跨端不一致 | Vue3 已修复 | 阶段 5 统一 |

---

## 下一步（由用户确认后执行）

1. 在 `test/src/views/FullTest.vue` 手动验证阶段 3/4 涉及的通话场景
2. 实施阶段 5：跨平台信令协议标准化（远期）
3. 或基于现有架构沉淀更多跨平台 skills

---

## 2026-07-15 补充：用户资料显示与主动注入 API

### 已完成

- [x] 点对点被叫待接听弹窗优先显示主叫方传入的 `callerInfo`，缺失时兜底调用 Provider 拉取
- [x] 群聊新加入用户若 `GlobalCallStore` 无资料，自动通过 Provider 解析并更新参与者资料
- [x] `useCallKit()` 暴露 `setUserInfo(userId, info)` / `setUserInfoMap(map)`
- [x] `index.ts` 直接导出 `setUserInfo` / `setUserInfoMap`，支持业务方在通话前/通话中主动注入

### 设计要点

用户资料三级优先级：
1. **主动 set**（业务方通过 `setUserInfo` / `setUserInfoMap` 注入）
2. **主叫方信令携带**（`incomingCall` / `callInvited` 事件中的 `callerInfo`）
3. **Provider 拉取**（环信 SDK `fetchUserInfoById` 或自定义 `getUserInfo`）

新平台实现时应在状态层提供等价的 `userInfoMap`，并在以下时机 enrich：
- 收到 `incomingCall` / `groupCallInit` 时把事件携带的 callerInfo 写入缓存
- 渲染 UI 前优先读缓存，未命中再调 Provider
- 群聊 `user-joined` / `participantJoined` 时若缓存无资料，异步拉取并更新 UI

### 验证清单

- [x] 点对点被叫弹窗显示主叫昵称/头像
- [x] 群聊新加入用户显示昵称/头像
- [x] 手动 `setUserInfo` 后 UI 立即刷新

---

## 历史决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2024-XX | 单聊/群聊 UI 层彻底隔离 | 交互模式差异巨大（一对一 vs 多方网格+拖拽） |
| 2024-XX | `callkit-core` 提取为独立包 | 支持跨框架（React/Vue/原生）复用信令逻辑 |
| 2024-XX | Pinia 打包在 callkit 内部 | 降低接入成本，但导致 webpack 项目 symbol 不匹配问题（已修复） |
| 2024-XX | 版本号通过构建工具注入 | 避免人工同步遗漏（曾出现 2.0.6 包打印 2.0.0） |
| 2026-07-15 | `RtcService` 改为多订阅模式 | 阶段 4 需要单聊/群聊领域独立订阅同一 RtcService 实例的媒体状态 |

---

## 最后更新

- 更新人：AI Agent
- 更新于：2026-07-15
- 阶段 3/4 已完成，commit: `78a41f3`
