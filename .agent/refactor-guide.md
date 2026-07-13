# 重构规范

> 改旧代码时必须遵循的规则。AI 每次修改现有代码前必须阅读。

---

## 1. 重构原则

### 不可破坏的约束

1. **不要修改单聊 UI 组件的外部 props / emits 接口**（保持向后兼容）
2. **不要删除 `lib/deprecated/` 目录**（保留 git history 以外的备份）
3. **不要修改 `types/callstate.types.ts` 中的 CALL_STATUS / CALL_TYPE 枚举值**（与 iOS/Android SDK 兼容）
4. **不要一次性跨多个阶段实施**（必须逐阶段验证）

### 重构前检查清单

- [ ] 本次修改涉及哪个阶段？是否只改当前阶段的内容？
- [ ] 是否有单聊/群聊的公共代码被修改？是否会影响另一端？
- [ ] 是否引入了新的 Store 依赖？是否符合领域隔离原则？
- [ ] 是否删除了现有功能？是否有替代方案？

---

## 2. 阶段化实施

### 阶段 3：RTC 服务去状态化

#### 目标
`RtcService` 变成纯 SDK 封装，不读写任何 Store。

#### 实施步骤

**Step 1: RtcService 改造**

```ts
// 移除 import
- import { useRtcChannelStore } from '../store/rtcChannelStore'

// 改为回调传出
class RtcService {
  constructor(config: {
    onLocalStreamChange?: (stream: MediaStream | null) => void
    onUserRtcJoined?: (uid: string, userId?: string) => void
    onUserRtcLeft?: (uid: string, userId?: string) => void
    onUserPublished?: (uid: string, mediaType: 'audio' | 'video') => void
    onUserUnpublished?: (uid: string, mediaType: 'audio' | 'video') => void
  }) {
    this.callbacks = config
  }
}
```

**Step 2: 回调消费方**

- **单聊侧**：新建 `SingleCallRtcAdapter`，消费回调并写回 `callStateStore`
- **群聊侧**：`RtcMediaBridge` 直接消费回调，写回 `GroupCallStore`

**Step 3: useJoinChannel → RtcJoinService**

```ts
// 改为无状态类
class RtcJoinService {
  async joinChannel(params: JoinChannelParams): Promise<{ tracks: ILocalTrack[] }> {
    // 纯原子操作，不管理 isJoining 状态
  }
}

// 调用方自行管理状态
const isJoining = ref(false)
async function handleJoin() {
  isJoining.value = true
  try {
    const { tracks } = await rtcJoinService.joinChannel(params)
    // 处理 tracks
  } finally {
    isJoining.value = false
  }
}
```

#### 验证清单

- [ ] 单聊：视频通话双方都能看到对方画面
- [ ] 群聊：本地视频 + 远程视频都能正常渲染
- [ ] 静音/摄像头切换功能正常

---

### 阶段 4：rtcChannelStore 拆解与领域化

#### 目标
彻底消除全局 RTC 状态池。

#### 状态迁移表

| 当前字段 | 迁移目标 | 说明 |
|---|---|---|
| `callDuration` | 单聊：`callStateStore` 自管计时器；群聊：`GroupCallStore` 已有 | 各自 Store 内管理 |
| `localStream` | 单聊域自建 `localStream` ref | Composable 内管理 |
| `audioEnabled` / `videoEnabled` | 单聊域自建 | Composable 内管理 |
| `joinedRtcUsers` | 单聊域自建 Set | Composable 内管理 |
| `pendingUserIds` | 单聊域自建 Set | Composable 内管理 |
| `leftUsers` | 单聊域自建 Set | Composable 内管理 |
| `remoteStreams` | 单聊域自建 Record | Composable 内管理 |
| `channels` / `activeChannelId` / `isConnected` | 如业务不需要多频道共存，直接删除 | 简化模型 |

#### RtcMediaBridge 清理

- 删除所有 `rtcChannelStore.getUserIdByUid()` 回读兼容代码
- 只依赖 `GroupCallStore.uidToUserIdMap`

#### 验证清单

- [ ] 单聊通话时长计时器正常
- [ ] 群聊通话时长计时器正常
- [ ] 单聊挂断后重新发起通话正常
- [ ] 群聊挂断后重新发起通话正常

---

## 3. 代码迁移模式

### 模式 A：Store 字段迁移

```ts
// 迁移前：全局 Store
const rtcChannelStore = useRtcChannelStore()
const localStream = computed(() => rtcChannelStore.localStream)

// 迁移后：领域自建
// 在单聊 Composable 内
const localStream = ref<MediaStream | null>(null)

// 在群聊 Composable 内
const localStream = ref<MediaStream | null>(null)
```

### 模式 B：Service 回调化

```ts
// 迁移前：Service 直接写 Store
class OldRtcService {
  onUserPublished(uid: string, mediaType: 'audio' | 'video') {
    const store = useRtcChannelStore()
    store.setRemotePublished(uid, mediaType)
  }
}

// 迁移后：Service 通过回调传出
class NewRtcService {
  constructor(private callbacks: RtcCallbacks) {}

  onUserPublished(uid: string, mediaType: 'audio' | 'video') {
    this.callbacks.onUserPublished?.(uid, mediaType)
  }
}

// 消费方：单聊 Adapter
class SingleCallRtcAdapter {
  constructor(private store: ReturnType<typeof useCallStateStore>) {}

  onUserPublished(uid: string, mediaType: 'audio' | 'video') {
    // 单聊逻辑：只关心对端
    if (mediaType === 'video') {
      this.store.setRemoteVideoEnabled(true)
    }
  }
}

// 消费方：群聊 Bridge
class RtcMediaBridge {
  constructor(private store: ReturnType<typeof useGroupCallStore>) {}

  onUserPublished(uid: string, mediaType: 'audio' | 'video') {
    // 群聊逻辑：更新参与者状态
    const userId = this.store.uidToUserIdMap.get(uid)
    if (userId) {
      this.store.updateParticipantMedia(userId, mediaType, true)
    }
  }
}
```

### 模式 C：Composable 拆分

```ts
// 迁移前：一个大的 useRtcChannel
export function useRtcChannel() {
  const store = useRtcChannelStore()
  // 同时处理单聊和群聊逻辑
}

// 迁移后：按领域拆分
// 单聊
export function useSingleCallRtc() {
  const store = useCallStateStore()
  const adapter = new SingleCallRtcAdapter(store)
  const rtcService = new RtcService(adapter)
  // ...
}

// 群聊
export function useGroupCallRtc() {
  const store = useGroupCallStore()
  const bridge = new RtcMediaBridge(store)
  const rtcService = new RtcService(bridge)
  // ...
}
```

---

## 4. 兼容性处理

### 保留旧代码

```ts
// TODO(stage-4): 移除兼容代码
// 保留旧函数签名，内部转发到新实现
export function useRtcChannelStore() {
  console.warn('[DEPRECATED] useRtcChannelStore is deprecated, will be removed in stage 4')
  return newProxyStore()
}
```

### 渐进式迁移

```ts
// 步骤 1：新增新接口，旧接口标记 deprecated
// 步骤 2：内部实现切换到新接口
// 步骤 3：验证所有调用方正常
// 步骤 4：删除旧接口
```

---

## 5. 验证流程

### 每次重构后必须执行

1. **类型检查**
   ```bash
   npx vue-tsc --noEmit --skipLibCheck
   ```

2. **手动验证**（无自动化测试）
   - 启动测试项目：`cd test && pnpm dev`
   - 打开 `http://localhost:5173`
   - 按验证清单逐项测试

3. **提交规范**
   ```bash
   git commit -m "refactor(arch): stage 3 — RTC 服务去状态化

   - RtcService 改为纯回调接口
   - 新增 SingleCallRtcAdapter
   - RtcMediaBridge 直接消费回调
   - useJoinChannel → RtcJoinService"
   ```

4. **不执行 `git push`**（等待用户确认）

---

## 6. 常见重构陷阱

### 陷阱 1：并发修改同一状态

```ts
// ❌ 错误：多个回调同时修改同一个 ref
const remoteStreams = ref<Record<string, MediaStream>>({})

// 并发到达时可能丢失更新
function onUserPublished(uid: string) {
  remoteStreams.value[uid] = stream  // 非原子操作
}

// ✅ 正确：使用 reactive 或确保原子性
const remoteStreams = reactive<Record<string, MediaStream>>({})

function onUserPublished(uid: string) {
  remoteStreams[uid] = stream  // reactive 是响应式的
}
```

### 陷阱 2：异步窗口期信令丢失

```ts
// ❌ 错误：异步操作期间状态机未就绪，信令被丢弃
async function handleInvite() {
  const token = await fetchRtcToken(channel)  // 状态机还是 IDLE
  // 期间 cancelCall 到达，因状态不匹配被忽略
  initStateMachine()
}

// ✅ 正确：维护 pending 集合拦截关键信令
const pendingInvites = new Map<string, { aborted: boolean }>()

async function handleInvite(callId: string) {
  pendingInvites.set(callId, { aborted: false })
  const token = await fetchRtcToken(channel)
  const pending = pendingInvites.get(callId)
  if (pending?.aborted) {
    pendingInvites.delete(callId)
    return  // 已取消，不初始化
  }
  initStateMachine()
}

function handleCancel(callId: string) {
  const pending = pendingInvites.get(callId)
  if (pending) {
    pending.aborted = true  // 标记取消
    return
  }
  // 正常处理...
}
```

### 陷阱 3：RTC 资源泄漏

```ts
// ❌ 错误：不清理 RTC 资源
onUnmounted(() => {
  // 什么都没做
})

// ✅ 正确：完整清理
onUnmounted(() => {
  // 1. 停止所有轨道
  localTracks.forEach(track => {
    track.stop()
    track.close()
  })

  // 2. 离开频道
  await rtcService.leaveChannel()

  // 3. 清理 DOM
  if (videoContainer.value) {
    videoContainer.value.innerHTML = ''
  }

  // 4. 重置状态
  callStateStore.reset()
})
```
