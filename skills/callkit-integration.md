---
name: easemob-callkit-integration
description: >
  Guide AI IDE to help users integrate the Easemob Chat CallKit Vue3 plugin correctly.
  Use this skill when a user wants to add audio/video call functionality to their Vue3 project.
  Covers: dependency installation, main.ts setup, Provider configuration, call initiation,
  and common integration errors.
---

# Easemob Chat CallKit Vue3 接入指南

## 前置条件

- Vue 3.x 项目
- 已集成环信 IM SDK (`easemob-websdk`) 并完成登录
- 已申请 Agora AppID

## Step 1: 安装依赖

```bash
# 必须安装（peer dependencies）
npm install agora-rtc-sdk-ng easemob-websdk

# 安装 callkit 本体
npm install @easemob/callkit-vue3
```

> **注意**：不需要安装 `pinia`。callkit 已将 pinia 打包在内部，通过 `app.use(EasemobChatCallKit)` 自动注入。

## Step 2: main.ts 注册插件

```ts
import { createApp } from 'vue'
import EasemobChatCallKit from '@easemob/callkit-vue3'
import App from './App.vue'

// 必须导入样式
import '@easemob/callkit-vue3/style.css'

const app = createApp(App)

// ⚠️ 必须调用 app.use()，否则 Pinia 未注入会导致 getActivePinia() 报错
app.use(EasemobChatCallKit)

app.mount('#app')
```

### ❌ 常见错误

| 错误 | 原因 | 修复 |
|------|------|------|
| `[🍍] getActivePinia() was called but there was no active Pinia` | 忘记 `app.use(EasemobChatCallKit)` | 补上 `app.use(EasemobChatCallKit)` |
| `Cannot find module 'pinia'` | 旧版本残留或试图手动安装 pinia | 移除 pinia 依赖，让 callkit 内部处理 |

## Step 3: App.vue 中使用 Provider

```vue
<template>
  <EasemobChatCallKitProvider
    :chat-client="chatClient"
    :agora-client="agoraClient"
    :init-config="{ inviteTimeout: 30000, logLevel: LogLevel.INFO }"
  >
    <!-- 通话邀请通知（被叫方弹窗） -->
    <InvitationNotification />

    <!-- 你的业务内容 -->
    <YourBusinessContent />

    <!-- 单人通话组件（autoShow，无需 v-if） -->
    <EasemobChatSingleCall
      :target-user="targetUserId"
      :type="singleCallType"
    />

    <!-- 群组通话组件（autoShow，无需 v-if） -->
    <EasemobChatMultiCall
      :group-id="groupId"
      :group-name="groupName"
      :group-avatar="groupAvatar"
      :type="multiCallType"
      :current-user-id="chatClient?.user"
    />

    <!-- 群组通话成员选择弹窗（首次发起邀请时使用） -->
    <EasemobChatGroupMemberList
      v-if="showInviteModal"
      :group-id="currentGroupId"
      :existing-user-ids="[]"
      @close="showInviteModal = false"
      @invite="onInviteSelected"
    />
  </EasemobChatCallKitProvider>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SDK from 'easemob-websdk'
import AgoraRTC from 'agora-rtc-sdk-ng'
import {
  LogLevel,
  useCallKit,
  EasemobChatCallKitProvider,
  InvitationNotification,
  EasemobChatSingleCall,
  EasemobChatMultiCall,
  EasemobChatGroupMemberList,
} from '@easemob/callkit-vue3'

// 1. 创建 Agora 客户端（推荐外部传入，避免版本冲突）
const agoraClient = AgoraRTC.createClient({ mode: 'live', codec: 'h264' })

// 2. 初始化环信 IM 客户端
const chatClient = ref<any>()
onMounted(() => {
  const connection = new SDK.connection({
    appKey: 'your-app-key',
  })
  chatClient.value = connection
  // 然后调用 connection.open({ user, pwd }) 登录
})

// 3. 通话控制
const { call, groupCall, hangup } = useCallKit()

// 状态
const targetUserId = ref('')
const singleCallType = ref<'audio' | 'video'>('video')
const groupId = ref('')
const groupName = ref('')
const groupAvatar = ref('')
const multiCallType = ref<'audio' | 'video'>('video')

// 发起单人通话
async function startSingleCall(type: 'audio' | 'video') {
  await call({
    targetId: targetUserId.value,
    type,
    msg: '通话邀请',
    userInfo: {
      nickname: '我的昵称',
      avatarURL: 'https://example.com/avatar.png',
    },
  })
}

// 发起群组通话
async function startGroupCall(type: 'audio' | 'video') {
  await groupCall({
    groupId: groupId.value,
    members: ['user1', 'user2'],
    type,
    msg: '群组通话邀请',
    groupName: groupName.value || undefined,
    groupAvatar: groupAvatar.value || undefined,
    userInfo: {
      nickname: '我的昵称',
      avatarURL: 'https://example.com/avatar.png',
    },
  })
}

// 群组通话成员选择弹窗（首次发起邀请时）
const showInviteModal = ref(false)
const currentGroupId = ref('')

function openGroupMemberSelector(gId: string) {
  currentGroupId.value = gId
  showInviteModal.value = true
}

function onInviteSelected(userIds: string[]) {
  showInviteModal.value = false
  groupCall({
    groupId: currentGroupId.value,
    members: userIds,
    type: 'video',
    msg: '邀请加入视频通话',
  })
}
</script>
```

## Step 4: 群组通话成员选择弹窗（可选）

`EasemobChatGroupMemberList` 是 callkit 内置的群成员选择组件，可用于**首次发起群组通话时**让用户选择要邀请的成员。该组件与通话中"邀请更多人"的弹窗 UI 完全一致。

### 使用方式

```vue
<template>
  <button @click="openGroupMemberSelector('group-id')">发起群视频通话</button>

  <EasemobChatGroupMemberList
    v-if="showInviteModal"
    :group-id="currentGroupId"
    :members="cachedMembers"          <!-- 可选：传入外部成员列表，不传则组件内部拉取 -->
    :existing-user-ids="[]"           <!-- 首次邀请传空数组 -->
    @close="showInviteModal = false"
    @invite="onInviteSelected"
  />
</template>

<script setup>
import { ref } from 'vue'
import { useCallKit, EasemobChatGroupMemberList } from '@easemob/callkit-vue3'

const { groupCall } = useCallKit()
const showInviteModal = ref(false)
const currentGroupId = ref('')

function openGroupMemberSelector(groupId) {
  currentGroupId.value = groupId
  showInviteModal.value = true
}

function onInviteSelected(userIds) {
  showInviteModal.value = false
  groupCall({
    groupId: currentGroupId.value,
    members: userIds,
    type: 'video',
    msg: '邀请加入视频通话',
  })
}
</script>
```

### Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `groupId` | `string` | ✅ | 群组 ID，用于拉取群成员列表 |
| `members` | `Array<{userId, userName, avatar?}>` | ❌ | **外部传入成员列表（双轨制）**。传入则优先使用，不传则组件内部通过 IM SDK 拉取 |
| `existingUserIds` | `string[]` | ✅ | 已在通话中的用户 ID 列表（用于灰态显示）。首次邀请传 `[]` |
| `invitingUserIds` | `string[]` | ❌ | 正在邀请中的用户 ID 列表（显示"邀请中"状态） |

### Events

| Event | 参数 | 说明 |
|-------|------|------|
| `invite` | `userIds: string[]` | 用户点击确定，返回选中的用户 ID 数组 |
| `close` | — | 用户点击取消或关闭弹窗 |

### 注意事项

1. **不需要手动处理昵称头像**：组件内部会自动调用 `resolveUserProfiles` 查询成员昵称和头像，通过 Provider 的 `getUserInfo` 走你的用户资料系统
2. **双轨制获取成员**：如果你已经在业务层缓存了群成员列表，可通过 `members` prop 传入，避免重复请求 IM SDK
3. **样式已内置**：只要项目已引入 `@easemob/callkit-vue3/style.css`，弹窗样式即自动生效

---

## Step 5: 可选 — 监听通话事件

通过 `useCallKitEvents()` 订阅通话生命周期事件。所有事件均携带 `conversationId`、`isLocal`、`localUserRole` 字段，接入方无需自行推断会话 ID 和通话方向。

```ts
import { useCallKitEvents, CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '@easemob/callkit-vue3'

const {
  onIncomingCall,      // 收到通话邀请
  onCallStarted,       // 通话接通
  onCallEnded,         // 通话结束
  onCallCanceled,      // 通话被取消
  onCallRefused,       // 通话被拒绝
  onCallTimeout,       // 邀请超时
  onCallBusy,          // 对方忙线
  onStatusChanged,     // 通话状态变化
  onParticipantJoined, // 群通话成员加入
  onParticipantLeft,   // 群通话成员离开
  getCallRecord,       // 获取最近一次通话记录
} = useCallKitEvents()
```

### 事件公共字段

所有事件均包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `callId` | `string` | 通话唯一标识 |
| `channel` | `string` | RTC 频道名 |
| `type` | `CALL_TYPE` | 通话类型：0=音频单聊, 1=视频单聊, 2=视频群聊, 3=音频群聊 |
| `callerUserId` | `string` | 主叫方用户 ID |
| `calleeUserId` | `string` | 被叫方用户 ID（群聊时为空） |
| `groupId` | `string` | 群组 ID（群聊时存在） |
| **`conversationId`** | `string` | **会话 ID**：单聊=对方用户ID，群聊=groupId，直接对应 IM 会话 key |
| **`isLocal`** | `boolean` | **方向标识**：`true`=本端行为触发，`false`=对端信令/系统触发 |
| **`localUserRole`** | `string` | **当前用户角色**：`'caller'` 主叫 / `'callee'` 被叫 / `'participant'` 群聊参与者 |

### 各事件详细说明

#### `onIncomingCall` — 收到通话邀请

```ts
onIncomingCall((e) => {
  console.log('收到来电:', e.callerUserId)
  console.log('会话ID:', e.conversationId)   // 单聊=对方ID，群聊=groupId
  console.log('我的角色:', e.localUserRole)  // 'caller' | 'callee' | 'participant'
  console.log('群名称:', e.groupName)        // 群聊时存在
  console.log('被邀请成员:', e.invitedMembers) // 群聊时存在
})
```

#### `onCallStarted` — 通话接通

```ts
onCallStarted((e) => {
  console.log('通话接通:', e.callId)
  console.log('我是主叫?', e.isCaller)       // true/false
  console.log('会话ID:', e.conversationId)
})
```

#### `onCallEnded` — 通话结束

```ts
onCallEnded((e) => {
  console.log('通话结束')
  console.log('原因:', e.reason)             // HANGUP_REASON 枚举值
  console.log('时长:', e.duration, 'ms')     // 通话时长（毫秒）
  console.log('挂断方:', e.endedBy)          // 挂断方的 userId（可能为空）
  console.log('本端触发?', e.isLocal)        // true=本端挂断，false=对端挂断/超时
  console.log('会话ID:', e.conversationId)
})
```

**接入方常用逻辑**：

```ts
onCallEnded((e) => {
  const sec = Math.round(e.duration / 1000)

  if (e.isLocal) {
    showToast(`你已挂断，时长 ${sec} 秒`)
  } else {
    // 对端挂断或系统原因
    if (e.endedBy) {
      showToast(`对方已挂断，时长 ${sec} 秒`)
    } else if (e.reason === HANGUP_REASON.NO_RESPONSE) {
      showToast('对方无响应')
    }
  }
})
```

#### `onCallRefused` / `onCallBusy` / `onCallCanceled` / `onCallTimeout`

```ts
onCallRefused((e) => {
  // isLocal=false 表示对方拒绝；isLocal=true 理论上不会发生（本地拒绝不触发 callRefused）
  if (!e.isLocal) {
    showToast('对方已拒绝')
  }
})

onCallBusy((e) => {
  // busy 始终是对端信令触发
  showToast('对方忙线中')
})

onCallCanceled((e) => {
  // isRemote 与 !isLocal 等价，保留兼容
  if (!e.isLocal || e.isRemote) {
    showToast('对方已取消')
  } else {
    showToast('你已取消')
  }
})

onCallTimeout((e) => {
  // timeout 由本端定时器触发，isLocal=true
  showToast('邀请超时')
})
```

#### `onParticipantJoined` / `onParticipantLeft` — 群通话成员变化

```ts
onParticipantJoined((e) => {
  console.log('成员加入:', e.userId)
  console.log('会话ID:', e.conversationId)
})

onParticipantLeft((e) => {
  console.log('成员离开:', e.userId, '原因:', e.reason)
})
```

### 一键获取通话记录

`getCallRecord()` 在 `callEnded` 事件触发后自动生成一条标准化的通话记录，接入方可直接用于插入本地消息或发送 custom 消息。

```ts
onCallEnded((e) => {
  const record = getCallRecord()
  // record 结构：
  // {
  //   callId: 'xxx',
  //   conversationId: 'userB',          // 直接对应 IM 会话 key
  //   chatType: 'singleChat',           // 'singleChat' | 'groupChat'
  //   from: 'userA',                    // 主叫方 userId
  //   to: 'userB',                      // 被叫方 userId 或群 groupId
  //   status: 'ended',                  // ended | refused | busy | canceled | timeout | noResponse
  //   duration: 180000,                 // 毫秒
  //   timestamp: 1713761400000,         // 结束时间戳
  //   endedBy: 'userA'                  // 挂断方 userId
  // }

  // 示例：插入本地消息
  insertLocalMessage(record.conversationId, {
    type: 'custom',
    customEvent: 'callRecord',
    customExts: record,
  })
})
```

**字段映射关系**：

| CallRecord 字段 | 来源说明 |
|-----------------|----------|
| `callId` | 通话唯一标识 |
| `conversationId` | 事件中的 `conversationId` |
| `chatType` | 根据 `type` 推导：单聊=`singleChat`，群聊=`groupChat` |
| `from` | `callerUserId` |
| `to` | 单聊=`calleeUserId`，群聊=`groupId` |
| `status` | `reason` 映射：`hangup/abnormalEnd`→`ended`，`refuse/remoteRefuse`→`refused`，`busy`→`busy`，`cancel/remoteCancel`→`canceled`，`noResponse/remoteNoResponse`→`noResponse` |
| `duration` | 通话时长（毫秒） |
| `timestamp` | `callEnded` 触发时的 `Date.now()` |
| `endedBy` | 事件中的 `endedBy` |

### 完整示例：在聊天记录中展示通话状态

```ts
const { onCallEnded, onCallRefused, onCallBusy, onCallTimeout, getCallRecord } = useCallKitEvents()

function insertCallRecordMessage(record: ReturnType<typeof getCallRecord>) {
  if (!record) return

  // 根据 status 生成展示文本
  const statusTextMap: Record<string, string> = {
    ended: `通话时长 ${Math.round(record.duration / 1000)}s`,
    refused: '对方已拒绝',
    busy: '对方忙线',
    canceled: '通话已取消',
    timeout: '邀请超时',
    noResponse: '对方无响应',
  }

  insertLocalMessage(record.conversationId, {
    type: 'custom',
    customEvent: 'callRecord',
    customExts: {
      ...record,
      displayText: statusTextMap[record.status] || '通话结束',
    },
  })
}

onCallEnded(() => insertCallRecordMessage(getCallRecord()))
onCallRefused(() => insertCallRecordMessage(getCallRecord()))
onCallBusy(() => insertCallRecordMessage(getCallRecord()))
onCallTimeout(() => insertCallRecordMessage(getCallRecord()))
```

## 关键配置项说明

### `EasemobChatCallKitProvider` Props

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chatClient` | `Chat.Connection` | ✅ | 环信 IM 客户端实例（需已登录） |
| `agoraClient` | `IAgoraRTCClient` | ❌ | Agora 客户端实例。推荐传入，不传则内部创建 |
| `agoraAppId` | `string` | ❌ | **已废弃**，appId 从环信服务器动态获取 |
| `initConfig` | `object` | ❌ | 配置项，见下表 |
| `getUserInfo` | `function` | ❌ | 自定义用户资料查询（传入则覆盖默认） |
| `getGroupInfo` | `function` | ❌ | 自定义群组资料查询 |

### `initConfig` 选项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | `boolean` | `false` | 开启调试模式（verbose 日志） |
| `logLevel` | `LogLevel` | — | 日志级别：0=ERROR, 1=WARN, 2=INFO, 3=DEBUG, 4=VERBOSE |
| `enableRingtone` | `boolean` | `true` | 来电铃声（当前为桩函数，不实际播放音频） |
| `enableIDBLog` | `boolean` | `true` | 是否启用 IndexedDB 日志持久化（默认开启，上限 20MB） |
| `resizable` | `boolean` | `true` | 通话窗口可调整大小 |
| `draggable` | `boolean` | `true` | 通话窗口可拖动 |
| `inviteTimeout` | `number` | `30000` | 邀请超时时间（毫秒） |

## IndexedDB 日志与问题排查

CallKit 内置了基于 IndexedDB 的结构化日志系统，用于线上问题排查和通话还原。

### 自动记录的内容

无需手动调用，以下事件会自动写入 IndexedDB：

| 类别 | 内容 |
|------|------|
| `signal` | 信令收发（invite/alert/answerCall/cancelCall/leaveCall 等） |
| `state` | 通话状态流转（IDLE → INVITING → ALERTING → IN_CALL → IDLE） |
| `rtc` | RTC 事件（joinChannel/userJoined/publishTracks 等） |
| `event` | 业务事件（callTimeout/callEnded 等） |

### 日志特点

- **独立于控制台级别**：即使你把 `logLevel` 设为 `ERROR`，IDB 依然会完整记录所有级别的日志
- **按 callId 维度关联**：每通通话的日志通过 `callId` 自动关联，便于按通话还原时序
- **容量上限**：默认 20MB（约 5 万条），超出后自动删除最旧的日志
- **浏览器隔离**：IndexedDB 遵循同源策略，不同端口（如 5173 vs 5175）的数据互不共享

### 业务方导出日志

```ts
import { Logger } from '@easemob/callkit-vue3'

// 1. 获取最近有日志的 callId 列表
const sessions = await Logger.getInstance().getSessions()

// 2. 导出某一通通话的日志（JSON）
const json = await Logger.getInstance().exportLogsAsJSON(sessions[0])

// 3. 导出全部日志（纯文本 .log 格式，便于直接阅读）
const text = await Logger.getInstance().exportLogsAsText()

// 4. 下载为文件
const blob = new Blob([text], { type: 'text/plain' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = `callkit-logs-${Date.now()}.log`
a.click()
```

### 关闭日志持久化

```vue
<EasemobChatCallKitProvider
  :init-config="{ enableIDBLog: false }"
>
```

---

## 常见接入错误速查

| 现象 | 原因 | 修复 |
|------|------|------|
| `getActivePinia() was called but there was no active Pinia` | 忘记 `app.use(EasemobChatCallKit)` | main.ts 中补上 |
| `Cannot find module 'pinia'` | 项目残留 pinia 依赖或旧版本 callkit | 卸载 pinia，更新 callkit |
| 通话组件不显示 | 没有使用 `useCallKit().call()` 或 `groupCall()` 发起 | 确认调用了 call 方法 |
| 被叫方收不到邀请 | `chatClient` 未登录或未传入 Provider | 确保 IM 已登录且 chatClient 传入 Provider |
| 视频黑屏 | Agora 未正确初始化或 token 过期 | 检查 agoraClient 传入、检查 token 有效期 |

## 版本兼容性

- Vue: `^3.0.0`
- Agora RTC SDK: `^4.14.0`
- Easemob WebSDK: `^4.12.0`

> **Pinia 版本无关**：callkit 内部已打包 pinia，用户项目无需关心 pinia 版本。
