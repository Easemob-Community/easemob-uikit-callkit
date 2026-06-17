# @easemob-community/callkit-vue3

基于 **Vue 3 + 环信 IM SDK + 声网 RTC SDK** 的音视频通话 UI 组件库。

内部封装了 `@easemob-community/callkit-core` 作为信令与状态核心，用户只需放置组件、调用 Composables 即可使用完整的单聊/群聊通话能力。

## 前置条件

- Vue 3 项目
- 已安装 **环信 IM SDK**（`easemob-websdk`）并完成登录
- 已安装 **声网 RTC SDK**（`agora-rtc-sdk-ng`）

```bash
pnpm add vue easemob-websdk agora-rtc-sdk-ng
```

## 安装

```bash
pnpm add @easemob-community/callkit-vue3
```

## 快速开始

### 1. 注册插件

```typescript
// main.ts
import { createApp } from 'vue'
import EasemobChatCallKit from '@easemob-community/callkit-vue3'
import App from './App.vue'

const app = createApp(App)
app.use(EasemobChatCallKit)
app.mount('#app')
```

> `@easemob-community/callkit-vue3` 会自动注入 Pinia，无需在用户项目中手动安装/配置。

### 2. 在根组件放置 Provider

```vue
<template>
  <EasemobChatCallKitProvider
    :chat-client="chatClient"
    :agora-client="agoraClient"
    :init-config="{ logLevel: LogLevel.INFO }"
  >
    <!-- 你的应用内容 -->
    <router-view />

    <!-- 通话邀请通知（被叫时自动弹出接听/拒绝弹窗） -->
    <InvitationNotification />

    <!-- 单人通话组件（自动显示/隐藏） -->
    <EasemobChatSingleCall />

    <!-- 群组通话组件（自动显示/隐藏） -->
    <EasemobChatMultiCall :group-id="groupId" />
  </EasemobChatCallKitProvider>
</template>

<script setup lang="ts">
import {
  EasemobChatCallKitProvider,
  InvitationNotification,
  EasemobChatSingleCall,
  EasemobChatMultiCall,
  LogLevel,
} from '@easemob-community/callkit-vue3'
import AgoraRTC from 'agora-rtc-sdk-ng'

// 外部创建的 Agora 客户端实例（推荐方式）
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

// 环信 IM SDK 登录后的 Connection 实例
const chatClient = /* 你的 easemob-websdk Connection */
const groupId = /* 当前群组 ID */
</script>
```

### 3. 发起通话

```vue
<template>
  <div>
    <input v-model="targetUserId" placeholder="输入用户ID" />
    <button @click="startAudio">语音通话</button>
    <button @click="startVideo">视频通话</button>
    <button @click="endCall">结束通话</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCallKit } from '@easemob-community/callkit-vue3'

const targetUserId = ref('')
const { call, groupCall, hangup } = useCallKit()

const startAudio = async () => {
  await call({ targetId: targetUserId.value, type: 'audio' })
}

const startVideo = async () => {
  await call({
    targetId: targetUserId.value,
    type: 'video',
    userInfo: {
      nickname: '张三',
      avatarURL: 'https://example.com/avatar.png'
    }
  })
}

const startGroupVideo = async () => {
  await groupCall({
    groupId: 'group001',
    members: ['user1', 'user2'],
    type: 'video',
    groupName: '产品组'
  })
}

const endCall = async () => {
  await hangup()
}
</script>
```

### 4. 监听通话事件

```typescript
import { useCallKitEvents } from '@easemob-community/callkit-vue3'
import { onUnmounted } from 'vue'

const { onCallStarted, onCallEnded, onIncomingCall, getCallRecord } = useCallKitEvents()

const unbindStarted = onCallStarted((e) => {
  console.log('通话接通', e.callId, 'isCaller:', e.isCaller)
})

const unbindEnded = onCallEnded((e) => {
  const sec = Math.round(e.duration / 1000)
  console.log('通话结束', e.reason, '时长:', sec, '秒')
  const record = getCallRecord()
  // record 可直接用于插入本地消息或展示通话记录
})

const unbindIncoming = onIncomingCall((e) => {
  console.log('收到来电', e.callerUserId)
})

onUnmounted(() => {
  unbindStarted()
  unbindEnded()
  unbindIncoming()
})
```

## 核心概念

### Provider 是根上下文

`EasemobChatCallKitProvider` 负责：

- 接收外部 `chatClient` 和 `agoraClient`
- 初始化 `@easemob-community/callkit-core`
- 注册用户/群组资料 Provider
- 自动挂载 IM 消息监听

### 组件自动显隐

- `EasemobChatSingleCall`：主叫 `INVITING` 或通话中自动显示；被叫响铃由 `InvitationNotification` 接管
- `EasemobChatMultiCall`：默认初始不显示，收到群聊通话事件后自动显示；也可通过 `autoShow` 控制

### 日志级别

```typescript
import { LogLevel } from '@easemob-community/callkit-vue3'

<EasemobChatCallKitProvider
  :chat-client="chatClient"
  :init-config="{ logLevel: LogLevel.INFO, enableIDBLog: true }"
>
```

`initConfig.logLevel` 会同时控制 UI 层与 `@easemob-community/callkit-core` 的核心日志输出。

| 级别 | 说明 |
|------|------|
| `LogLevel.ERROR` | 只输出错误 |
| `LogLevel.WARN` | 错误 + 警告 |
| `LogLevel.INFO` | 推荐生产环境 |
| `LogLevel.DEBUG` | 开发调试 |
| `LogLevel.VERBOSE` | 完整信令日志 |

## 完整 API 参考

参见项目根目录 [USAGE.md](../USAGE.md)。

## 发布流程

参见项目根目录 [RELEASING.md](../RELEASING.md)。

## License

MIT
