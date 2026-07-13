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
| **3. RTC 服务去状态化** | **🔄 进行中** | `RtcService` 改为纯回调，状态由各自 Store 消费 |
| 4. rtcChannelStore 拆解与领域化 | ⏸ 待开始 | 彻底消除全局 RTC 状态池 |
| 5. 跨平台信令协议标准化 | ⏸ 远期 | 统一 React/Vue/iOS/Android 信令字段 |

---

## 阶段 3 详细进展

### 目标
`RtcService` 变成纯 SDK 封装，不读写任何 Store。

### 已完成
- [x] 设计回调接口：`onLocalStreamChange` / `onUserRtcJoined` / `onUserRtcLeft` / `onUserPublished`

### 待完成
- [ ] 移除 `useRtcChannelStore()` import
- [ ] 所有状态写回改为回调传出
- [ ] 新建 `SingleCallRtcAdapter`（单聊侧消费回调）
- [ ] `RtcMediaBridge` 直接消费回调（群聊侧）
- [ ] `useJoinChannel` → `RtcJoinService` 无状态化

### 验证清单（阶段 3 完成后必须全部勾选）
- [ ] 单聊：视频通话双方都能看到对方画面
- [ ] 群聊：本地视频 + 远程视频都能正常渲染
- [ ] 静音/摄像头切换功能正常

---

## 已知问题（未解决）

| 问题 | 影响 | 临时规避 | 根治计划 |
|---|---|---|---|
| 无自动化测试 | 重构风险高 | 全靠 `test/src/App.vue` 手动验证 | 阶段 4 后评估引入单元测试 |
| `rtcChannelStore` 仍被多处引用 | 阶段 4 阻塞 | 保留现有兼容代码 | 阶段 4 拆解 |
| React 版本 invite 入口无 calleeDevId 校验 | 跨端不一致 | Vue3 已修复 | 阶段 5 统一 |

---

## 下一步（由用户确认后执行）

1. 实施阶段 3：RTC 服务去状态化
2. 验证阶段 3：单聊/群聊视频通话手动测试
3. 提交：`refactor(arch): stage 3 — RTC 服务去状态化`

---

## 历史决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2024-XX | 单聊/群聊 UI 层彻底隔离 | 交互模式差异巨大（一对一 vs 多方网格+拖拽） |
| 2024-XX | `callkit-core` 提取为独立包 | 支持跨框架（React/Vue/原生）复用信令逻辑 |
| 2024-XX | Pinia 打包在 callkit 内部 | 降低接入成本，但导致 webpack 项目 symbol 不匹配问题（已修复） |
| 2024-XX | 版本号通过构建工具注入 | 避免人工同步遗漏（曾出现 2.0.6 包打印 2.0.0） |

---

## 最后更新

- 更新人：AI Agent
- 更新于：2026-07-13
- 阶段 3 尚未开始实施，等待用户确认
