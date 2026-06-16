# 快速开始

本文档帮助你在 **5 分钟内** 跑通 CallKit 的单人通话和群组通话。

> 完整 API 参考参见 [USAGE.md](./USAGE.md)。

---

## 前置条件

- Vue 3 项目
- 已安装 **环信 IM SDK**（`easemob-websdk`）并完成登录
- 已安装 **声网 RTC SDK**（`agora-rtc-sdk-ng`）

```bash
pnpm add vue easemob-websdk agora-rtc-sdk-ng
```

---

## 安装

```bash
# 从 npm 安装（发布后）
pnpm add @easemob-community/callkit-vue3

# 或从本地 tgz 文件安装
pnpm add ./@easemob-community/callkit-vue3-2.0.0.tgz
```

---

## Step 1：注册插件 + 引入样式

```typescript
// main.ts
import { createApp } from 'vue'
import EasemobChatCallKit from '@easemob-community/callkit-vue3'
import App from './App.vue'

const app = createApp(App)
app.use(EasemobChatCallKit)
app.mount('#app')
```

> `@easemob-community/callkit-vue3` 会自动注入 Pinia，用户项目无需额外安装/配置 Pinia。

---

## Step 2：在根组件放置 Provider 和通话组件

```vue
<template>
  <EasemobChatCallKitProvider
    :chat-client="chatClient"
    :agora-client="agoraClient"
    :init-config="{ inviteTimeout: 30000, logLevel: LogLevel.INFO }"
  >
    <!-- 你的应用内容 -->
    <router-view />

    <!-- 通话邀请通知（被叫时自动弹出） -->
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

// 外部传入的 Agora 客户端实例（推荐方式）
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })

// 你的环信 IM Connection 实例
const chatClient = /* easemob-websdk Connection */
const groupId = /* 当前群组 ID */
</script>
```

### Provider 关键配置说明

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chatClient` | `Chat.Connection` | ✅ | 环信 IM 实例 |
| `agoraClient` | `IAgoraRTCClient` | ❌ | 外部 Agora 客户端实例。不传时 Provider 内部会创建一个占位实例 |
| `isMiniCore` | `boolean` | ❌ | 是否使用环信 IM SDK miniCore 版本 |
| `getUserInfo` | `(ids) => Promise<UserInfo[]>` | ❌ | 自定义用户资料 Provider |
| `getGroupInfo` | `(ids) => Promise<GroupInfo[]>` | ❌ | 自定义群组资料 Provider |
| `initConfig` | `object` | ❌ | 全局配置，见下表 |

#### initConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | `boolean` | `false` | 开启调试日志（等价于 `logLevel: LogLevel.VERBOSE`） |
| `logLevel` | `LogLevel` | `LogLevel.ERROR` | 控制台日志级别 |
| `enableIDBLog` | `boolean` | `true` | 是否启用 IndexedDB 日志持久化 |
| `enableRingtone` | `boolean` | `true` | 开启呼叫铃声 |
| `inviteTimeout` | `number` | `30000` | 邀请超时时间（毫秒） |

---

## Step 3：发起/结束通话

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

// ─── 单人通话 ───
const startAudio = async () => {
  await call({ targetId: targetUserId.value, type: 'audio' })
}

const startVideo = async () => {
  await call({ targetId: targetUserId.value, type: 'video' })
}

// 带自定义昵称头像（被叫方弹窗会直接显示）
const startVideoWithProfile = async () => {
  await call({
    targetId: targetUserId.value,
    type: 'video',
    userInfo: {
      nickname: '张三',
      avatarURL: 'https://example.com/avatar.png'
    }
  })
}

// ─── 群组通话 ───
const startGroupCall = async () => {
  await groupCall({
    groupId: 'group001',
    members: ['user1', 'user2'],
    type: 'video',
    groupName: '产品组',
    userInfo: {
      nickname: '张三',
      avatarURL: 'https://example.com/avatar.png'
    }
  })
}

const endCall = async () => {
  await hangup()
}
</script>
```

> ✅ 就这么简单。`EasemobChatSingleCall` 会根据通话状态自动显示/隐藏，不需要写 `v-if`。

---

## Step 4：监听通话事件

```vue
<script setup lang="ts">
import { onUnmounted } from 'vue'
import { useCallKitEvents, HANGUP_REASON } from '@easemob-community/callkit-vue3'

const { onCallStarted, onCallEnded, onCallRefused, getCallRecord } = useCallKitEvents()

const unbindStarted = onCallStarted((e) => {
  console.log('通话接通', e.callId, 'isCaller:', e.isCaller)
})

const unbindEnded = onCallEnded((e) => {
  const sec = Math.round(e.duration / 1000)
  console.log('通话结束', e.reason, '时长:', sec, '秒')

  const record = getCallRecord()
  // 可在此将 record 插入本地消息或发送 custom 消息
})

const unbindRefused = onCallRefused((e) => {
  if (!e.isLocal) {
    alert('对方已拒绝')
  }
})

onUnmounted(() => {
  unbindStarted()
  unbindEnded()
  unbindRefused()
})
</script>
```

---

## 下一步

- **事件监听**：完整事件列表、精确单聊/群聊事件 → 参见 [USAGE.md#usecallkitevents](./USAGE.md#usecallkitevents)
- **进阶配置**：自定义背景图、离线静态资源、日志持久化 → 参见 [USAGE.md#进阶用法](./USAGE.md#进阶用法)
- **类型导出**：`CallParams`、`GroupCallParams`、`HANGUP_REASON` 等 → 参见 [USAGE.md#类型与常量](./USAGE.md#类型与常量)
- **自定义框架接入**：若使用 React / Angular，可使用底层 `@easemob-community/callkit-core` → 参见 [packages/callkit-core/README.md](./packages/callkit-core/README.md)
