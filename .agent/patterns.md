# 架构模式

> 何时用 Store、何时用 Service、何时用 Composable 的决策指南。AI 设计新模块时参考。

---

## 1. 四层架构

```
┌─────────────────────────────────────────────┐
│                 UI 层                        │
│  ┌──────────────┐    ┌────────────────────┐ │
│  │ SingleCall   │    │ GroupCallShell     │ │
│  │ 单聊 UI 组件  │    │ 群聊 UI 组件        │ │
│  └──────┬───────┘    └──────────┬─────────┘ │
└─────────┼───────────────────────┼───────────┘
          │                       │
┌─────────▼───────────────────────▼───────────┐
│           应用/状态层（领域隔离）              │
│  ┌─────────────────┐  ┌───────────────────┐   │
│  │ SingleCallStore │  │ GroupCallStore    │   │
│  │ (callStateStore)│  │                   │   │
│  └────────┬────────┘  └─────────┬─────────┘   │
│           │                     │             │
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
          │  │ @easemob-community/      │ │
          │  │   callkit-core           │ │
          │  │ • CallKitCore            │ │
          │  │ • SignalRouter           │ │
          │  │ • SingleCallStateMachine  │ │
          │  │ • GroupCallSession       │ │
          │  │ • EventBus               │ │
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

---

## 2. 决策矩阵

### 问题：这个数据/逻辑应该放在哪里？

| 条件 | 选择 | 示例 |
|---|---|---|
| 需要跨组件共享的 UI 状态 | **Store** | 通话状态、是否最小化 |
| 需要持久化的用户数据 | **Store** | userInfoMap、通话记录 |
| 纯 SDK 封装，无业务状态 | **Service** | RtcService、SignalingService |
| 与 Vue 生命周期绑定的逻辑 | **Composable** | useCallKit、useCallKitEvents |
| 组件内部私有状态 | **组件 ref** | 弹窗显隐、加载状态 |

### 反模式

```ts
// ❌ 在 Service 里直接读写 Store
class BadService {
  store = useCallStateStore()  // Service 不应该依赖 Store
}

// ❌ 在 Store 里直接调用 Service
const badStore = defineStore('bad', () => {
  const rtc = new RtcService()  // Store 不应该创建 Service 实例
})

// ❌ 在 Composable 里管理全局状态
function badComposable() {
  const globalState = ref({})  // 应该用 Store
}
```

---

## 3. Store 模式

### 领域隔离原则

```ts
// ✅ 单聊 Store：只关心二元状态
export const useCallStateStore = defineStore('callState', () => {
  const status = ref<CALL_STATUS>(CALL_STATUS.IDLE)
  const calleeId = ref('')
  const callDuration = ref(0)

  // 单聊专属：只有主叫/被叫两个角色
  const isCaller = computed(() => status.value === CALL_STATUS.INVITING)

  return { status, calleeId, callDuration, isCaller }
})

// ✅ 群聊 Store：关心分布式参与者
export const useGroupCallStore = defineStore('groupCall', () => {
  const session = ref<GroupCallSession | null>(null)
  const participants = ref<Map<string, Participant>>(new Map())

  // 群聊专属：多方参与者管理
  const joinedCount = computed(() =>
    Array.from(participants.value.values()).filter(p => p.state === 'joined').length
  )

  return { session, participants, joinedCount }
})

// ✅ 全局 Store：跨域共享
export const useGlobalCallStore = defineStore('globalCall', () => {
  const userInfoMap = ref<Map<string, UserInfo>>(new Map())
  const isMinimized = ref(false)

  return { userInfoMap, isMinimized }
})
```

### 状态重置策略

```ts
// ✅ 通话结束后完整重置
function reset() {
  status.value = CALL_STATUS.IDLE
  calleeId.value = ''
  callDuration.value = 0
  // 不重置 userInfoMap（跨通话保留）
}
```

---

## 4. Service 模式

### 无状态 Service

```ts
// ✅ 纯 SDK 封装，通过回调传出事件
class RtcService {
  constructor(private callbacks: RtcCallbacks) {}

  async joinChannel(params: JoinChannelParams): Promise<ILocalTrack[]> {
    const { appId, channel, token, uid } = params

    // 纯原子操作
    await this.client.join(appId, channel, token, uid)
    const tracks = await this.createLocalTracks()
    await this.client.publish(tracks)

    // 通过回调通知，不直接写 Store
    this.callbacks.onLocalStreamChange?.(new MediaStream(tracks.map(t => t.getMediaStreamTrack())))

    return tracks
  }
}
```

### 适配器模式（消费回调）

```ts
// ✅ 单聊适配器：把 RTC 回调翻译成单聊状态
class SingleCallRtcAdapter {
  constructor(
    private store: ReturnType<typeof useCallStateStore>,
    private globalStore: ReturnType<typeof useGlobalCallStore>
  ) {}

  onLocalStreamChange(stream: MediaStream | null) {
    // 单聊：本地流直接关联到当前通话
    this.store.localStream = stream
  }

  onUserRtcJoined(uid: string, userId?: string) {
    // 单聊：只有一个对端，直接确认
    if (userId && userId === this.store.calleeId) {
      this.store.setRemoteJoined(true)
    }
  }
}

// ✅ 群聊桥接：把 RTC 回调翻译成群聊参与者状态
class RtcMediaBridge {
  constructor(private store: ReturnType<typeof useGroupCallStore>) {}

  onUserRtcJoined(uid: string, userId?: string) {
    // 群聊：更新参与者状态
    if (userId) {
      this.store.updateParticipantState(userId, 'joinedRtc')
    }
  }

  onUserPublished(uid: string, mediaType: 'audio' | 'video') {
    const userId = this.store.uidToUserIdMap.get(uid)
    if (userId) {
      this.store.updateParticipantMedia(userId, mediaType, true)
    }
  }
}
```

---

## 5. Composable 模式

### 职责边界

```ts
// ✅ useCallKit：提供通话控制 API
export function useCallKit() {
  const core = useCallKitCore()

  async function call(params: CallInvitationParams) {
    // 参数校验
    // 调用 core 发起邀请
    // 返回 Promise
  }

  async function hangup() {
    // 清理资源
    // 调用 core 挂断
  }

  return { call, groupCall, hangup, answer, refuse }
}

// ✅ useCallKitEvents：提供事件订阅
export function useCallKitEvents() {
  const eventBus = useCallKitEventBus()

  function onCallStarted(handler: (e: CallStartedEvent) => void) {
    return eventBus.on('callStarted', handler)
  }

  return { onCallStarted, onCallEnded, /* ... */ }
}

// ✅ useRtcService：封装 RTC 生命周期
export function useRtcService() {
  const rtcService = ref<RtcService | null>(null)

  onMounted(() => {
    // 初始化 RTC
  })

  onUnmounted(() => {
    // 清理 RTC
    rtcService.value?.leaveChannel()
  })

  return { rtcService }
}
```

### 生命周期管理

```ts
// ✅ Composable 负责绑定和解绑
export function useCallTimer() {
  const duration = ref(0)
  let timer: number | null = null

  function start() {
    timer = window.setInterval(() => {
      duration.value++
    }, 1000)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  // 自动清理
  onUnmounted(stop)

  return { duration, start, stop }
}
```

---

## 6. 事件系统模式

### EventBus 使用

```ts
// ✅ 类型安全的事件定义
interface CallKitEvents {
  callStarted: CallStartedEvent
  callEnded: CallEndedEvent
  participantJoined: ParticipantEvent
  participantLeft: ParticipantEvent
}

// ✅ 事件 payload 规范
interface CallEndedEvent {
  callId: string
  channel: string
  type: CALL_TYPE
  conversationId: string  // 单聊=对方ID，群聊=groupId
  isLocal: boolean        // true=本端触发
  localUserRole: 'caller' | 'callee' | 'participant'
  reason: HANGUP_REASON
  duration: number        // 毫秒
  endedBy?: string        // 挂断方 userId
}
```

### 事件方向标识

```ts
// ✅ 明确标识事件来源
onCallEnded((e) => {
  if (e.isLocal) {
    // 本端挂断
    showToast('你已挂断')
  } else {
    // 对端挂断或系统触发
    showToast('对方已挂断')
  }
})
```

---

## 7. 信令处理模式

### SignalRouter + Handler

```ts
// ✅ 一个 action 对应一个 Handler，责任明确
class SignalRouter {
  private handlers = new Map<string, SignalHandler[]>()

  register(action: string, handler: SignalHandler) {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, [])
    }
    this.handlers.get(action)!.push(handler)
  }

  dispatch(action: string, message: CmdMessage): SignalResult[] {
    const handlers = this.handlers.get(action) ?? []
    // 按优先级执行，第一个返回非空结果的 Handler 负责处理
    for (const handler of handlers) {
      const result = handler.handle(message)
      if (result.length > 0) {
        return result
      }
    }
    return []
  }
}

// ✅ Handler 明确过滤不属于自己领域的消息
class SingleCallSignalHandler implements SignalHandler {
  handleAnswerCall(message: CmdMessage): SignalResult[] {
    const currentState = this.stateMachine.getState()

    // 明确排除群聊
    const isGroupCall =
      currentState.type === CALL_TYPE.VIDEO_MULTI ||
      currentState.type === CALL_TYPE.AUDIO_MULTI
    if (isGroupCall) {
      return []  // 群聊交给 GroupCallSignalHandler
    }

    // 处理单聊 answer...
  }
}
```

---

## 8. 跨平台兼容模式

### 信令协议版本兼容

```ts
// ✅ 未知字段透传，不报错
function parseInviteExt(ext: unknown): InviteExt {
  const parsed = ext as Record<string, unknown>

  return {
    callId: String(parsed.callId ?? ''),
    channelName: String(parsed.channelName ?? ''),
    callerDevId: String(parsed.callerDevId ?? ''),
    calleeDevId: String(parsed.calleeDevId ?? ''),
    // 新版本字段：旧版本可能不存在，提供默认值
    ts: Number(parsed.ts ?? Date.now()),
    ext: parsed.ext as Record<string, unknown> ?? {},
  }
}
```

### 多端状态同步

```ts
// ✅ 设备标识校验
function validateDeviceTarget(message: CmdMessage): boolean {
  const ext = message.ext as { calleeDevId?: string }
  const currentDeviceId = chatClientStore.getClientDeviceId

  // 如果信令指定了目标设备，必须匹配
  if (ext?.calleeDevId && ext.calleeDevId !== currentDeviceId) {
    return false  // 忽略：不是发给我的
  }

  return true
}
```

---

## 9. 性能模式

### 视频轨道管理

```ts
// ✅ 限制同时解码的视频数量
const MAX_DECODED_VIDEOS = 6

function manageRemoteVideos(participants: Participant[]) {
  const videoParticipants = participants.filter(p => p.hasVideo)

  // 优先显示说话者 + 最近加入者
  const prioritized = videoParticipants.sort((a, b) => {
    if (a.isSpeaking && !b.isSpeaking) return -1
    if (!a.isSpeaking && b.isSpeaking) return 1
    return b.joinTime - a.joinTime
  })

  // 只订阅前 N 个
  prioritized.slice(0, MAX_DECODED_VIDEOS).forEach(p => {
    subscribeVideo(p.uid)
  })

  // 取消订阅超出限制的
  prioritized.slice(MAX_DECODED_VIDEOS).forEach(p => {
    unsubscribeVideo(p.uid)
  })
}
```

### 重渲染优化

```ts
// ✅ 使用 shallowRef 避免深层响应式开销
const participants = shallowRef<Map<string, Participant>>(new Map())

// ✅ 使用 computed 缓存派生状态
const joinedParticipants = computed(() =>
  Array.from(participants.value.values()).filter(p => p.state === 'joined')
)

// ✅ 使用 v-memo 在列表中
<ParticipantVideo
  v-for="p in joinedParticipants"
  :key="p.userId"
  v-memo="[p.hasVideo, p.isSpeaking]"
  :participant="p"
/>
```
