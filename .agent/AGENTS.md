# CallKit Vue3 — Agent 工作区

> 本目录是 AI 的专属上下文，所有 `.md` 文件在 AI 处理 CallKit 任务时自动加载。
> 人类开发者如需查阅详细知识，请访问 `.qoder/repowiki/`。

---

## 当前状态（阶段 4 已完成）

- 阶段 0 ✅ 群聊从旧架构迁出
- 阶段 1 ✅ 状态层净地化（GlobalCallStore 提取）
- 阶段 2 ✅ 信令路由拆分 + callkit-core 集成
- 阶段 3 ✅ RTC 服务去状态化（RtcService 纯回调 + subscribe* API）
- 阶段 4 ✅ rtcChannelStore 拆解与领域化（单聊/群聊 RTC 状态完全隔离）
- **阶段 5 ⏸ 跨平台信令协议标准化（远期）**

详见：[current-state.md](./current-state.md)

---

## 目录索引

| 文件 | 用途 | 何时读取 |
|---|---|---|
| [current-state.md](./current-state.md) | 当前阶段、已知问题、下一步 | **每次任务必读** |
| [dev-guide.md](./dev-guide.md) | 编码规范、命名约定、文件组织 | 写新代码时 |
| [refactor-guide.md](./refactor-guide.md) | 重构规则、禁止事项、验证清单 | 改旧代码时 |
| [patterns.md](./patterns.md) | 架构模式决策（Store vs Service vs Composable） | 设计新模块时 |

---

## 快速约束（不可违反）

1. **不要修改单聊 UI 组件的外部 props / emits 接口**（向后兼容）
2. **不要删除 `lib/deprecated/` 目录**
3. **不要修改 `types/callstate.types.ts` 中的 CALL_STATUS / CALL_TYPE 枚举值**
4. **不要一次性跨多个阶段实施**（必须逐阶段验证）
5. **每次阶段完成后必须**：
   - `npx vue-tsc --noEmit --skipLibCheck` 零报错
   - `test/src/App.vue` 或 `test/src/views/FullTest.vue` 手动验证
   - commit message: `refactor(arch): [阶段名] — [简要说明]`
   - **未经用户确认不执行 `git push`**

---

## 项目结构速查

```
packages/
├── callkit-core/     ← 信令核心（框架无关）
│   └── src/
│       ├── signaling/    ← SignalRouter + Handlers
│       ├── state/        ← SingleCallStateMachine + GroupCallSession
│       └── CallKitCore.ts
│
├── callkit-vue3/     ← Vue3 UI 层
│   └── src/
│       ├── components/   ← UI 组件（SingleCall / MultiCall / Provider）
│       ├── composables/  ← useCallKit / useCallKitEvents / useRtcService
│       └── store/        ← callStateStore + GroupCallStore + GlobalCallStore
│
lib/                  ← 构建输出（deprecated/ 保留旧代码）
test/                 ← 手动验证入口（App.vue / FullTest.vue）
```

---

## 外部 Skill 索引

如需接入指南、跨平台构建或问题排查，使用 Qoder slash command：

| Skill | 命令 | 用途 |
|---|---|---|
| callkit-integration | `/callkit-integration` | 用户接入指南 |
| callkit-architecture | `/callkit-architecture` | 架构设计参考 |
| callkit-problems | `/callkit-problems` | 已知问题与根因 |
| callkit-core-integration | `/callkit-core-integration` | 基于 callkit-core 构建新平台 CallKit |
| callkit-platform-porting | `/callkit-platform-porting` | 跨平台迁移映射与实现步骤 |
| callkit-platform-pitfalls | `/callkit-platform-pitfalls` | 跨平台通用坑点与强制规则 |
