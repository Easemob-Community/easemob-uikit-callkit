# Easemob Chat CallKit Vue3 — 架构重构计划

> **状态**：阶段 4 已完成（群聊解耦 + GlobalCallStore 提取 + callkit-core 集成 + 信令路由拆分 + RTC 服务去状态化 + rtcChannelStore 拆解领域化）
> **目标架构**：四层隔离模型（UI 层 / 状态层 / 服务层 / 基础设施层），RTC 媒体状态按单聊/群聊领域隔离
> **约束**：不可引入单聊回归；无自动化测试，全靠 `test/src/App.vue` / `test/src/views/FullTest.vue` 手动验证

---

## 一、目标架构图

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
│  │ • status        │  │ • session         │ │
│  │ • calleeId      │  │ • participants    │ │
│  │ • callDuration  │  │ • callDuration    │ │
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
          │  │ @easemob-community/callkit-core  │ │
          │  │ • CallKitCore          │ │
          │  │ • SignalRouter         │ │
          │  │ • SingleCallStateMachine│ │
          │  │ • GroupCallSession     │ │
          │  │ • EventBus             │ │
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
          └────────────────────────────┘
```

### 关键设计决策

| 层级 | 策略 | 理由 |
|---|---|---|
| UI 层 | 彻底隔离 | 单聊是"一对一窗口"，群聊是"多方网格+拖拽" |
| 状态层 | 领域隔离 + GlobalCallStore 共享 | 单聊是二元状态机，群聊是分布式参与者集合 |
| 服务层 | 共享 | sendInviteMessage、joinChannel、createAudioTrack 是通用能力 |
| 基础设施 | 共享 | IM 连接和 RTC 客户端各一个实例 |

---

## 二、已完成工作

### ✅ 阶段 0：群聊从旧架构迁出
- `EasemobChatMultiCall.vue` 重写为薄 wrapper（只渲染 `GroupCallShell`）
- 旧组件移入 `lib/deprecated/`
- `GroupCallStore` 成为群聊唯一事实源

### ✅ 阶段 1：状态层净地化
- 新建 `GlobalCallStore`（`userInfoMap` + `isMinimized`）
- `callStateStore` 删除共享字段，回归纯单聊域
- 全局替换引用（8 个文件）

### ✅ 阶段 2：信令路由拆分 + callkit-core 集成
- 提取 `@easemob-community/callkit-core` 作为独立包
- `useListenerManager` 退化为仅挂载 IM 监听，所有消息交给 `SignalRouter.dispatch()`
- Vue3 层通过 `useCallKitCore()` 与 callkit-core 交互，并通过 `callKitEventBus` 向 UI 广播事件
- UI 组件改为事件驱动：`EasemobChatSingleCall` / `EasemobChatMultiCall` / `InvitationNotification` 根据事件自动显隐

### ✅ 阶段 3：RTC 服务去状态化
- `packages/callkit-vue3/src/services/RtcService.ts` 改为纯 SDK 封装，不读写任何 Store
- 所有 RTC 事件通过构造函数回调 + `subscribe*` API 多订阅传出
- 单聊/群聊各自通过 Adapter/Bridge 消费回调，写回各自领域状态

### ✅ 阶段 4：rtcChannelStore 拆解与领域化
- 删除 `packages/callkit-vue3/src/store/` 下的全局 RTC 状态池
- `useCallKitRtc` 退化为纯 `RtcService` 实例容器
- 单聊域：`_callState` + `_localStream` 由 `useCallKitCore` 自行维护
- 群聊域：`GroupCallStore.localParticipant` 独立管理本地流与媒体开关
- `RtcService` 新增 `subscribeAudioEnabledChange` / `subscribeVideoEnabledChange` / `subscribeLocalStreamChange`，支持多域独立订阅

### ✅ 阶段 4 后续修复：单聊媒体开关单一事实源 + 媒体输入监控

**背景**：单聊 UI 曾绕过 core 状态机直调 `RtcService.toggleVideo`，导致 core 的 `videoEnabled` 永远停在初始值、被每秒 `syncState` 刷回，形成"关摄像头后开了空转"死锁；并发 double-toggle 也曾导致 track 重复创建/泄漏（本地视频透明）。

- **单一事实源（方案 A）**：单聊 UI（`EasemobChatCallStream`）的摄像头/麦克风开关统一走 `useCallKitCore.toggleAudio()/toggleVideo()` → core 状态机翻转 → `LOCAL_*_CHANGED` → `RtcAdapter.set*Enabled` → `RtcService`。禁止单聊 UI 直调 `rtcService.toggleAudio/toggleVideo`（群聊 `GroupCallShell` 除外，其本地媒体由 `GroupCallStore.localParticipant` 独立管理）
- **失败回滚**：`RtcAdapter.set*Enabled` 校验 `RtcService` 返回的实际状态，与目标不一致即抛错；`CallKitCore` 捕获后通过状态机 `setMediaEnabled()`（静默、不发域事件，防"失败→回滚→再失败"循环）回滚，并向 UI 广播回滚后的 `local*Changed` 事件
- **toggle 串行化**：`RtcService.toggleAudio/toggleVideo` 内部按媒体类型排队执行，并发/连点不再产生并发 `createVideoTrack`；原"track 为空时重复关闭"的静默早退分支已补日志
- **媒体输入监控**：`RtcService` 新增 `checkMediaInputDevices()`（声网 `getCameras`/`getMicrophones` 设备枚举）、`startMediaInputMonitor()/stopMediaInputMonitor()`（周期调用 `checkAudioTrackIsActive`/`checkVideoTrackIsActive`，连续 3 次无输入才上报，避免安静/静止画面误报）、`subscribeMediaInputStatus()`；由 `RtcAdapter.joinChannel` 成功后启动、`leaveChannel`/`destroy` 停止
- **UI 提示**：`useCallKitCore` 暴露 `mediaInputStatus`；`EasemobChatCallStream` 顶部展示异常提示条（未检测到麦克风/摄像头设备、麦克风无输入、摄像头无画面输入）

### ✅ 阶段 4 后续修复：离线信令乱序防护 + confirmCallee 超时回收

**背景**：被叫离线期间主叫发起并取消呼叫，重新登录时 IM 离线补投不保证顺序——cancelCall（CMD）先于 invite（txt）到达，IDLE 状态机按 callId 不匹配丢弃 cancel，随后 invite 被当作新来电弹出"已放弃的呼叫"；用户误接听后状态机卡在"等待 confirmCallee"，阻塞后续所有外呼。

- **已取消 callId 名单**：`CallKitCore` 收到 `cancelCall` 时无论状态机是否消费都记录 `recentlyCanceledCalls`（TTL = inviteTimeout + 10s，惰性清理）；`handleTextMessage` 处理 invite 时命中名单即丢弃
- **confirmCallee 等待超时**：被叫 `answerCall(accept)` 后统一 `clearInviteTimeout` + 启动 10s `confirmCalleeTimer`（单聊群聊一致）；`confirmCallee` 到达（callId 匹配）时清除；`startInviteTimeout` 覆盖启动时同步清除旧 timer，防止误杀新通话
- **reset 保留主叫标识**：状态机 `resetCore()`/`reset()` 重置时保留 `callerDevId`/`callerUserId`——修复被动结束端 `callEnded` 事件 payload 主叫字段丢失（实现补上既有测试锁定语义）

### ✅ 阶段 4 后续修复：全量审计修复（v2.1.1）

**背景**：五路并行审计（群聊域/UI 层/信令层/服务层/包间漂移）发现的"拆分不干净"残留，已全部修复。共性根因：防护逻辑逐 action 打补丁、错误伪装成功、版本号与内容脱钩。

- **信令守卫对称化（core）**：cancelCall callId 匹配分支补群聊守卫（防击穿群通话）；忙线拒绝先比 callId（同 callId 重复 invite 忽略，防误踢在聊成员）；`receiveConfirmRing` 仅 ALERTING 可流转（防补投把 IN_CALL 降级）；`confirmCallee` 补 calleeDevId 校验（防多端幽灵接听）；单聊 invite 的 fetchRtcToken 窗口复用 `pendingIncomingInvites` + 取消名单 + IDLE 三重复查；leaveCall/cancelCall 容错分支补 from 校验与 inviteTs 陈旧信令守卫（状态机新增 `inviteTs` 字段）；群聊 leaveCall callId 不匹配只记日志；invite/answer 发送失败立即复位状态机并 emitError
- **RtcService 标志可信化**：`createAudioTrack/createVideoTrack` 按当前标志 setEnabled 并广播真实值；`leaveChannel` finally 复位双标志+notify；死 track 重建前先 close 置 null（修复缓存早退击穿）；`leaveChannel` 幂等串行化、toggle/switch 统一队列、destroy 分断清理、媒体监控 generation 防重入
- **vue3 层**：`useRtcService` toggle 代理 core 状态机（公共 API 不再绕过单一事实源）；Provider 账号切换接 `updateImClient`；群聊期间 syncState/订阅回调不写单聊媒体字段；MiniWindow 监听命名引用+卸载解绑；`useCallKitEvents` 通话记录改模块级单例订阅；callTimer 结束无条件清零；participantLeft 2s 移除 timer 可取消+remove 前校验 state
- **群聊**：RtcMediaBridge 绑定时 `setAutoSubscribe(false)`（消除双重订阅）；RTC join/leave/mute 经 `reportRtcEvent` 回写 core 群会话；远端 isMuted 全链路接通（ParticipantTile 静音图标生效）；三处 2s 移除 timer 全部可取消化（GroupCallSession.scheduleRemoveParticipant）
- **工程防呆**：根 package.json 加 `pnpm.overrides` 将 core 强制解析到 workspace（tgz 装包不再依赖 registry 版本）；`sync-core.js` 新增"src 比 dist 新即警告"（3s 提示窗）；test 的 tgz 引用更新为 2.1.1
- **低危清理**：删除 useAnswerCall/useEndCall 死代码；callTimerStore 死 action；群聊双计时器删一份；静默 catch 全部补日志；userInfoMap 加 500 上限；IMListener handlerId 随机后缀

**验证**：core vitest 91/91（新增 9 个守卫用例）、双端 typecheck 零报错、`release/easemob-community-callkit-vue3-2.1.1.tgz` 已打、uniapp vendor 已 sync（version.txt=2.1.1）

### ✅ 阶段 4 后续修复：toggle 开启路径标志时序回归（v2.1.2）

**背景**：v2.1.1 的"createAudioTrack/createVideoTrack 按当前标志 setEnabled"与 `doToggleVideo` 开启路径的"先建轨、后更新标志"时序冲突——重新开启摄像头时 `isVideoEnabled` 仍为 false，新建 track 被立即 `setEnabled(false)`（声网对视频轨会直接终结底层 MediaStreamTrack），随后 `publish` 抛 `AgoraRTCError TRACK_IS_DISABLED`，摄像头永远无法再开。日志特征：每次开启尝试都是新 `track-cam-xxxx` + publish 抛错 + RtcAdapter 校验失败回滚。

- **修复**：`doToggleAudio`/`doToggleVideo` 的开启路径（含死轨重建路径）统一"先置标志为 true、再 createTrack"，create 失败时复位标志并抛错；create 内的按标志应用由此拿到正确值

### ✅ 阶段 4 后续修复：test dev 模式混淆与版本号显示防呆（v2.1.3）

**背景**：tgz 模式下 `vite.config.tgz.ts` 用 `__CALLKIT_VERSION__` 注入 core 版本，但 callkit-vue3 的 dist 也使用同一个全局常量表示自身版本，导致 test 工程实际加载的 vue3 包版本被 core 版本覆盖（2.1.2 tgz 显示成 2.1.1）；同时 source/tgz 两种模式默认共用 5173 端口，用户容易同时启动两个服务却看了旧模式页面。

- **独立 vue3 版本常量**：vue3 构建改用 `__CALLKIT_VUE3_VERSION__`，与 core 的 `__CALLKIT_VERSION__` 分离；test source 模式同时注入两者，tgz 模式只注入 core 版本，tgz dist 保留自身打包版本
- **strictPort**：test 两个 vite 配置都开启 `server.strictPort: true`，端口被占时直接报错，不再静默切到 5174 等端口造成"假 tgz 模式"
- **启动横幅**：`test/src/main.ts` 打印当前 mode、coreVersion、vue3Version，一眼确认加载的是哪个包
- **版本推进**：vue3 包 2.1.2 → 2.1.3，test tgz 引用同步更新

---

## 三、剩余实施路线

### 阶段 5：跨平台信令协议标准化
**目标**：统一 React/Vue/iOS/Android 信令字段，减少多端不一致。

**预估**：远期
**验证点**：
- [ ] React / Vue / iOS / Android 四端互通单聊
- [ ] 四端互通群聊
- [ ] 多端同时在线时 invite 设备筛选一致

---

## 四、文档索引

重构后的文档统一放在仓库根目录、子包目录和 `skills/` 目录：

| 文档 | 说明 |
|---|---|
| [README.md](./README.md) | 项目总览、双包结构、快速入口 |
| [QUICK_START.md](./QUICK_START.md) | 5 分钟上手指南 |
| [USAGE.md](./USAGE.md) | 完整 Vue3 API 参考 |
| [packages/callkit-core/README.md](./packages/callkit-core/README.md) | 框架无关信令核心说明 |
| [packages/callkit-vue3/README.md](./packages/callkit-vue3/README.md) | Vue3 包专属说明 |
| [packages/callkit-core/docs/](./packages/callkit-core/docs/) | callkit-core 架构/信令/事件/集成文档 |
| [skills/callkit-core-integration.md](./skills/callkit-core-integration.md) | 基于 callkit-core 构建新平台 CallKit 的集成指南 |
| [skills/callkit-platform-porting.md](./skills/callkit-platform-porting.md) | 跨平台迁移映射与实现步骤 |
| [skills/callkit-platform-pitfalls.md](./skills/callkit-platform-pitfalls.md) | 跨平台通用坑点与强制规则 |
| [skills/callkit-release.md](./skills/callkit-release.md) | 手动发包流程与命令 |
| [skills/callkit-uniapp-mp-weixin-plugin.md](./skills/callkit-uniapp-mp-weixin-plugin.md) | UniApp/微信小程序 `uni_modules` 插件开发规范 |
| [skills/callkit-problems.md](./skills/callkit-problems.md) | 历史问题与根因 |

---

## 五、提交规范

每次阶段完成后必须：
1. `npx vue-tsc --noEmit --skipLibCheck` 零报错
2. `test/src/App.vue` / `test/src/views/FullTest.vue` 手动验证该阶段涉及的通话场景
3. commit message 格式：`refactor(arch): [阶段名] — [简要说明]` 或 `docs: [说明]`（纯文档改动）
4. **未经用户确认不执行 `git push`**

---

## 六、禁止事项

1. **不要修改单聊 UI 组件的外部 props / emits 接口**（保持向后兼容）
2. **不要删除 `lib/deprecated/` 目录**（保留 git history 以外的备份）
3. **不要修改 `types/callstate.types.ts` 中的 CALL_STATUS / CALL_TYPE 枚举值**（与 iOS/Android SDK 兼容）
4. **不要一次性跨多个阶段实施**（必须逐阶段验证）
