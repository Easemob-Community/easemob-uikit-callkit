# Easemob Chat CallKit Vue3

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 **Vue 3 + 环信 IM SDK + 声网 RTC SDK** 的音视频通话 UI 组件库，采用**框架无关信令核心 + Vue3 UI 层**的双包架构。

- **`@easemob/callkit-core`**：框架无关的通话信令核心，管理单聊状态机、群聊会话、信令路由、RTC 指令事件。
- **`@easemob/callkit-vue3`**：Vue3 组件与 Composables，开箱即用的单聊/群聊通话界面。

---

## ✨ 特性

- 📞 **单人通话** — 1v1 音频/视频通话，支持呼叫、接听、挂断
- 👥 **群组通话** — 多人音视频通话，支持邀请成员、视频网格布局、追加邀请
- 🔔 **邀请通知** — 被叫方自动弹出接听/拒绝弹窗
- 🎛️ **媒体控制** — 静音、开关摄像头、切换前后置摄像头
- 🖼️ **视频布局** — 单聊悬浮窗、群聊网格/主视频模式
- 🎯 **自动显隐** — 组件根据通话状态自动显示/隐藏，无需手动 `v-if`
- 🔧 **外部 RTC 客户端** — 通过 `agora-client` 传入已有 Agora 实例，与业务共享频道生命周期
- 📦 **双包结构** — 核心信令可独立用于 React / Angular / UniApp 等框架

---

## 📋 前置条件

- Vue 3 项目
- 已安装 **环信 IM SDK**（`easemob-websdk`）并完成登录
- 已安装 **声网 RTC SDK**（`agora-rtc-sdk-ng`）

```bash
pnpm add vue easemob-websdk agora-rtc-sdk-ng
```

---

## 📦 安装

### 方式一：从 npm 安装（发布后）

```bash
pnpm add @easemob/callkit-vue3
```

### 方式二：从本地 tgz 文件安装

```bash
pnpm add ./@easemob/callkit-vue3-2.0.0.tgz
```

### 方式三：源码 alias（开发调试）

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@easemob/callkit-vue3': path.resolve(
        __dirname,
        '../easemob-uikit-callkit/packages/callkit-vue3/src/index.ts'
      ),
    },
  },
})
```

---

## 🚀 快速开始

参见 **[QUICK_START.md](./QUICK_START.md)** — 5 分钟跑通单聊/群聊通话，包含 Provider 放置、组件放置、发起通话完整示例。

> 完整 API 参考、事件订阅、进阶用法参见 [USAGE.md](./USAGE.md)。

---

## 🏗️ 核心概念

### Provider — 通话上下文

`EasemobChatCallKitProvider` 是所有通话组件的根上下文，负责：

- 接收外部 `chatClient` 和 `agoraClient`
- 初始化 `@easemob/callkit-core`
- 注册用户/群组资料 Provider
- 挂载 IM 消息监听（信令自动处理）
- 管理全局配置（debug、日志级别、铃声、超时等）

**必须在应用顶层包裹一次**，且内部放置通话相关组件。

### 自动显示/隐藏

- `EasemobChatSingleCall`：主叫方发起呼叫或通话中时自动显示；被叫响铃时不显示，由 `InvitationNotification` 接管
- `EasemobChatMultiCall`：默认初始不显示，收到群聊通话事件后自动显示；`autoShow` 设为 `false` 时可由外部 `v-if` 完全控制

**不需要写 `v-if`**，直接放在 Provider 内部即可。

### 事件订阅

通过 `useCallKitEvents()` 监听通话生命周期事件。所有事件均携带 `conversationId`、`isLocal`、`localUserRole` 字段：

```typescript
import { useCallKitEvents, HANGUP_REASON } from '@easemob/callkit-vue3'
import { onUnmounted } from 'vue'

const { onCallStarted, onCallEnded, onIncomingCall, onCallRefused, getCallRecord } = useCallKitEvents()

onCallStarted((e) => {
  console.log('通话接通', e.callId, '会话:', e.conversationId, '主叫:', e.isCaller)
})

onCallEnded((e) => {
  const sec = Math.round(e.duration / 1000)
  console.log('通话结束', '原因:', e.reason, '时长:', sec, '秒', '挂断方:', e.endedBy)

  // 一键获取标准化通话记录（callEnded 后自动生成）
  const record = getCallRecord()
  // record: { callId, conversationId, chatType, from, to, status, duration, timestamp, endedBy }
})

onCallRefused((e) => {
  if (!e.isLocal) {
    showToast('对方已拒绝')
  }
})

onIncomingCall((e) => {
  console.log('收到来电', e.callerUserId, '会话:', e.conversationId)
})

// 所有订阅返回解绑函数，建议在 onUnmounted 中调用
onUnmounted(() => {
  // ...unbind
})
```

> 完整事件列表和用法参见 [USAGE.md](./USAGE.md#usecallkitevents)。

### 日志级别

```typescript
import { LogLevel } from '@easemob/callkit-vue3'

<EasemobChatCallKitProvider
  :chat-client="chatClient"
  :init-config="{ logLevel: LogLevel.INFO }"
>
```

| 级别 | 说明 |
|------|------|
| `LogLevel.ERROR` | 只输出错误 |
| `LogLevel.WARN` | 错误 + 警告 |
| `LogLevel.INFO` | 推荐生产环境 |
| `LogLevel.DEBUG` | 开发调试 |
| `LogLevel.VERBOSE` | 完整信令日志 |

---

## 📚 包文档

| 包 | 文档 | 说明 |
|---|---|---|
| `@easemob/callkit-vue3` | [packages/callkit-vue3/README.md](./packages/callkit-vue3/README.md) | Vue3 组件与 Composables |
| `@easemob/callkit-core` | [packages/callkit-core/README.md](./packages/callkit-core/README.md) | 框架无关信令核心 |

---

## 🛠️ 开发 & 测试

```bash
# 安装依赖
pnpm install

# 源码模式开发（实时热更新）
pnpm run test:source

# 构建并测试 tgz 包
pnpm run test:tgz

# 仅构建库
pnpm run build:lib

# 仅构建 callkit-core
pnpm run build:core
```

---

## 📖 详细文档

- **[QUICK_START.md](./QUICK_START.md)** — 5 分钟上手指南
- **[USAGE.md](./USAGE.md)** — 完整的 API 参考、组件 Props、事件、Store、进阶用法
- **[AGENTS.md](./AGENTS.md)** — 架构说明、实施路线、提交规范

---

## 📄 License

[MIT](./LICENSE)
