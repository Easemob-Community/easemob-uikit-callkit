# 开发规范

> 编码约定、命名规则、文件组织方式。AI 写新代码时必须遵循。

---

## 1. 文件组织

### 包结构

```
packages/
├── callkit-core/         ← 框架无关，禁止引入 Vue/React
│   └── src/
│       ├── signaling/    ← SignalRouter + Handler 基类
│       ├── state/        ← SingleCallStateMachine + GroupCallSession
│       ├── types/        ← 共享类型定义
│       └── CallKitCore.ts
│
├── callkit-vue3/         ← Vue3 专属
│   └── src/
│       ├── components/   ← .vue / .tsx 组件
│       ├── composables/  ← useXxx() 函数
│       ├── store/        ← Pinia Store（单聊/群聊/全局）
│       ├── services/     ← RtcService / RtcAdapter（无状态）
│       └── types/        ← Vue3 层专属类型
```

### 禁止跨层引用

| 从 ↓ 到 → | callkit-core | callkit-vue3 store | callkit-vue3 components |
|---|---|---|---|
| callkit-core | ✅ | ❌ 禁止 | ❌ 禁止 |
| callkit-vue3 store | ✅ 允许 | ✅ | ❌ 禁止 |
| callkit-vue3 components | ❌ 禁止（通过 composables 间接使用） | ✅ 允许 | ✅ |

---

## 2. 命名约定

### 文件命名

| 类型 | 规则 | 示例 |
|---|---|---|
| 组件 | PascalCase，语义化 | `EasemobChatSingleCall.vue` |
| Composable | camelCase，use 前缀 | `useCallKit.ts` |
| Store | camelCase，store 后缀 | `callStateStore.ts` |
| Service | PascalCase，Service 后缀 | `RtcService.ts` |
| Adapter | PascalCase，Adapter 后缀 | `SingleCallRtcAdapter.ts` |
| 类型文件 | camelCase，.types.ts | `callstate.types.ts` |
| 常量/枚举 | UPPER_SNAKE_CASE | `CALL_STATUS`, `CALL_TYPE` |

### 变量命名

```ts
// ✅ 好的命名
const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI
const hasLocalVideo = localVideoTrack !== null
const remoteUserCount = joinedRtcUsers.size

// ❌ 差的命名
const flag = true        // 无意义
const data = {}          // 无意义
const temp = []          // 无意义
const a = 'userId'       // 单字母
```

---

## 3. TypeScript 规范

### 类型定义优先

```ts
// ✅ 显式定义接口
interface CallInvitationParams {
  targetId: string
  type: 'audio' | 'video'
  msg?: string
  userInfo?: UserInfo
}

// ❌ 不要内联复杂类型
function call(params: { targetId: string; type: string; msg?: string })  // 过于简单，但复杂时提取接口
```

### 枚举值不可修改

```ts
// ⚠️ 这些枚举与 iOS/Android SDK 兼容，**禁止修改值**
export enum CALL_STATUS {
  IDLE = 0,
  INVITING = 1,
  ALERTING = 2,
  CONFIRM_RING = 3,
  RECEIVED_CONFIRM_RING = 4,
  IN_CALL = 5,
}

export enum CALL_TYPE {
  AUDIO_SINGLE = 0,
  VIDEO_SINGLE = 1,
  VIDEO_MULTI = 2,
  AUDIO_MULTI = 3,
}
```

### 严格空值检查

```ts
// ✅ 显式处理 null/undefined
if (!chatClient) {
  logger.warn('chatClient is not initialized')
  return
}

// ✅ 可选链 + 默认值
const calleeDevId = ext?.calleeDevId ?? ''

// ❌ 不要隐式假设非空
chatClient.sendMessage(msg)  // 如果 chatClient 可能为 null，先检查
```

---

## 4. Vue3 组件规范

### 组件结构

```vue
<script setup lang="ts">
// 1. 类型导入
import type { PropType } from 'vue'

// 2. Vue 核心
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

// 3. 第三方库
import AgoraRTC from 'agora-rtc-sdk-ng'

// 4. 内部模块（按层级排序）
//    callkit-core（框架无关）
import { CallKitCore, CALL_STATUS } from '@easemob-community/callkit-core'
//    callkit-vue3 store
import { useCallStateStore } from '../store/callStateStore'
//    callkit-vue3 composables
import { useCallKitEvents } from '../composables/useCallKitEvents'
//    同目录组件
import CallControls from './CallControls.vue'

// 5. Props / Emits 定义
const props = defineProps({
  targetUser: { type: String, required: true },
  type: { type: String as PropType<'audio' | 'video'>, required: true },
})

const emit = defineEmits<{
  (e: 'hangup'): void
}>()

// 6. 状态定义
const callStateStore = useCallStateStore()
const { onCallEnded } = useCallKitEvents()

// 7. 生命周期
onMounted(() => {
  // ...
})

onUnmounted(() => {
  // 必须清理：定时器、事件监听、RTC 资源
})
</script>
```

### 模板规范

```vue
<template>
  <!-- ✅ 使用语义化 class 名 -->
  <div class="call-kit-container">
    <div class="call-kit-header">
      <span class="call-kit-timer">{{ formattedDuration }}</span>
    </div>

    <!-- ✅ 远程视频容器必须是 div（不是 video） -->
    <div ref="remoteVideoContainer" class="remote-video-container"></div>
  </div>
</template>
```

---

## 5. Store 规范

### Pinia Store 结构

```ts
// ✅ 使用 Setup Store 风格（函数式）
export const useCallStateStore = defineStore('callState', () => {
  // 1. State（ref）
  const status = ref<CALL_STATUS>(CALL_STATUS.IDLE)
  const calleeId = ref('')
  const callDuration = ref(0)

  // 2. Getters（computed）
  const isInCall = computed(() => status.value === CALL_STATUS.IN_CALL)
  const isIdle = computed(() => status.value === CALL_STATUS.IDLE)

  // 3. Actions（函数）
  function setStatus(newStatus: CALL_STATUS) {
    status.value = newStatus
  }

  function reset() {
    status.value = CALL_STATUS.IDLE
    calleeId.value = ''
    callDuration.value = 0
  }

  // 4. 导出
  return {
    status,
    calleeId,
    callDuration,
    isInCall,
    isIdle,
    setStatus,
    reset,
  }
})
```

### Store 职责边界

| Store | 职责 | 禁止 |
|---|---|---|
| `callStateStore` | 单聊状态（status, calleeId, callDuration） | 不存储群聊状态、不存储 RTC 轨道 |
| `GroupCallStore` | 群聊状态（session, participants, callDuration） | 不存储单聊状态 |
| `GlobalCallStore` | 跨域共享（userInfoMap, isMinimized） | 不存储通话状态、不存储 RTC 轨道 |
| `rtcChannelStore` | ⚠️ 待拆解（阶段 4），禁止新增依赖 | — |

---

## 6. Service 规范

### 无状态原则

```ts
// ✅ RtcService 是纯 SDK 封装，不读写 Store
class RtcService {
  constructor(config: {
    onLocalStreamChange?: (stream: MediaStream | null) => void
    onUserRtcJoined?: (uid: string, userId?: string) => void
    // ... 回调传出事件
  }) {
    this.callbacks = config
  }

  // 纯原子操作，不保存业务状态
  async joinChannel(params: JoinChannelParams): Promise<ILocalTrack[]> {
    // ...
  }

  async leaveChannel(): Promise<void> {
    // ...
  }
}

// ❌ 不要在 Service 里直接读写 Store
class BadRtcService {
  constructor() {
    this.store = useRtcChannelStore()  // ❌ 违反无状态原则
  }
}
```

---

## 7. 日志规范

### 日志级别使用

```ts
import { Logger } from '../utils/logger'

const logger = Logger.getInstance()

// ERROR: 导致功能不可用的错误
logger.error('Failed to join channel:', error)

// WARN: 异常但可恢复
logger.warn('Received expired invite message, ignoring')

// INFO: 关键状态流转
logger.info('Call status changed:', CALL_STATUS[status])

// DEBUG: 调试信息
logger.debug('Remote user published:', uid, mediaType)

// VERBOSE: 详细追踪（性能敏感，生产环境关闭）
logger.verbose('Track state:', track.enabled)
```

### 日志内容要求

```ts
// ✅ 包含上下文
logger.info(`[SignalRouter] Dispatching action: ${action}, callId: ${callId}`)

// ❌ 无意义的日志
logger.log('here')        // 不知道是哪
logger.log('ok')          // 不知道什么 ok
logger.log(data)          // 直接打印对象，无说明
```

---

## 8. 错误处理

### 错误类型

```ts
// ✅ 使用自定义错误类
import { CallError, CallErrorCode } from '../services/CallError'

throw new CallError(
  CallErrorCode.RTC_JOIN_FAILED,
  'Failed to join RTC channel',
  { channel, uid }
)
```

### 异步错误

```ts
// ✅ async/await + try/catch
try {
  await rtcService.joinChannel(params)
} catch (error) {
  logger.error('RTC join failed:', error)
  // 状态回滚
  callStateStore.setStatus(CALL_STATUS.IDLE)
  // 通知用户
  emit('error', error)
}

// ❌ 不要裸奔 Promise
rtcService.joinChannel(params)  // 错误会被吞掉
```

---

## 9. 注释规范

### 必须注释的场景

```ts
// ✅ 解释"为什么"而不是"做什么"
// 因为群聊主叫发 invite 后立即进入 IN_CALL，所以音频群聊也需要排除
const isGroupCall = type === CALL_TYPE.VIDEO_MULTI || type === CALL_TYPE.AUDIO_MULTI

// ✅ 标记临时方案
// TODO(stage-4): 移除 rtcChannelStore 兼容代码
const userId = rtcChannelStore.getUserIdByUid(uid) ?? groupCallStore.uidToUserIdMap.get(uid)

// ✅ 标记已知风险
// WARNING: 此操作会触发 Agora SDK 的副作用，不要并发调用
await playRemoteVideo(userId)
```

### 禁止的注释

```ts
// ❌ 解释显而易见的代码
const x = 1  // 设置 x 为 1

// ❌ 注释掉的代码（直接删除，git 会保留历史）
// const oldCode = 'deprecated'

// ❌ 误导性注释
// 修复了 bug（实际上 bug 还在）
```
