# callkit-uniapp-mp-weixin 代码审查修复建议

> 审查范围: `uni_modules/em-callkit-weixin/` 插件及配套脚本
> 审查依据: uni_modules 开发规范、项目技能文档 `skills/callkit-uniapp-mp-weixin-plugin.md`
> 生成日期: 2026-07-20

---

## 🔴 Critical Issues（必须修复）

### 1. `onLocalMediaState` 回调中 userId 使用错误

**文件**: `uni_modules/em-callkit-weixin/src/core-adapter.ts` L187-L198

**问题**: 本地麦克风/摄像头静音事件上报时 `payload.userId` 使用了 `state.targetUserId`（对端用户），实际应为 `state.localUserId`（本地用户）。

**当前代码**:
```typescript
onLocalMediaState: (type, enabled) => {
    core.reportRtcEvent({
        type: enabled
            ? type === 'audio'
                ? 'userAudioUnmuted'
                : 'userVideoUnmuted'
            : type === 'audio'
                ? 'userAudioMuted'
                : 'userVideoMuted',
        payload: { userId: state.targetUserId } // ❌ 错误：应为本端用户
    })
},
```

**修复**:
```typescript
onLocalMediaState: (type, enabled) => {
    core.reportRtcEvent({
        type: enabled
            ? type === 'audio'
                ? 'userAudioUnmuted'
                : 'userVideoUnmuted'
            : type === 'audio'
                ? 'userAudioMuted'
                : 'userVideoMuted',
        payload: { userId: state.localUserId } // ✅ 正确：本端用户 ID
    })
},
```

---

### 2. 缺少 `license.md` 文件

**文件**: 需新建 `uni_modules/em-callkit-weixin/license.md`

**问题**: uni_modules 插件规范要求必须包含 `license.md`。`readme.md`、`changelog.md` 已具备，仅缺此文件。

**修复**: 在插件根目录创建 `license.md`，内容如下：

```markdown
# License

MIT License

Copyright (c) Easemob

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🟡 Warnings（建议修复）

### 3. RTC 操作的 Promise rejection 未处理

**文件**: `uni_modules/em-callkit-weixin/src/core-adapter.ts` L416-L439

**问题**: `shouldJoinRtc`、`shouldPublishTracks`、`shouldLeaveRtc` 三个事件处理中调用了 `rtcAdapter` 的异步方法，但均未 `await` 也未 `.catch()`，导致网络异常时 Promise rejection 变为未处理异常。

**当前代码**（三处类似）:
```typescript
case 'shouldJoinRtc': {
    const payload = event.payload || {}
    rtcAdapter.joinChannel({...}) // ❌ Promise 未处理
    break
}
case 'shouldPublishTracks': {
    const payload = event.payload || {}
    rtcAdapter.publishLocalTracks(payload.trackTypes || []) // ❌ Promise 未处理
    break
}
case 'shouldLeaveRtc':
    rtcAdapter.leaveChannel() // ❌ Promise 未处理
    break
```

**修复**:
```typescript
case 'shouldJoinRtc': {
    const payload = event.payload || {}
    rtcAdapter.joinChannel({
        channel: payload.channel,
        token: payload.token,
        uid: payload.uid,
        appId: payload.appId,
        callType: getCallTypeName(payload.callType),
        knownParticipants: groupState.session
            ? groupState.participants
                .filter((p) => !p.isLocal)
                .map((p) => ({ uid: p.uid || 0, userId: p.userId }))
            : undefined
    }).catch((err) => {
        logger.error('[CallKit] joinChannel failed', err)
    })
    break
}
case 'shouldPublishTracks': {
    const payload = event.payload || {}
    rtcAdapter.publishLocalTracks(payload.trackTypes || []).catch((err) => {
        logger.error('[CallKit] publishLocalTracks failed', err)
    })
    break
}
case 'shouldLeaveRtc':
    rtcAdapter.leaveChannel().catch((err) => {
        logger.error('[CallKit] leaveChannel failed', err)
    })
    break
```

---

### 4. `networkHideTimer` 未在 `onUnload` 中清理

**文件**:
- `uni_modules/em-callkit-weixin/pages/single-call-page/single-call-page.vue` L304
- `uni_modules/em-callkit-weixin/pages/group-call-page/group-call-page.vue` L345

**问题**: 两个通话页面的 `onUnload` 中均未清理 `networkHideTimer`。若页面在网络 Toast 定时器触发前被卸载，定时器回调仍会尝试操作已销毁组件的响应式状态。

**修复**: 分别在两个页面的 `onUnload` 中添加 `hideNetworkToast()`:

```typescript
// single-call-page.vue
onUnload(() => {
    stopWaitingTimer()
    hideNetworkToast() // ✅ 新增
    const callKit = uni.$callKit
    // ... 其余代码不变
})

// group-call-page.vue
onUnload(() => {
    hideNetworkToast() // ✅ 新增
    const callKit = uni.$callKit
    callKit?.rtcAdapter?.leaveChannel()
})
```

---

### 5. `single-call-page.vue` onLoad 中挂断旧呼叫与状态重置存在竞态

**文件**: `uni_modules/em-callkit-weixin/pages/single-call-page/single-call-page.vue` L422-L428

**问题**: 存在进行中的呼叫时，先 fire-and-forget 调用 `callKit.core.hangup()` 不 await，然后立即同步执行 `resetCallState()`。若后续 `inviteCall` 紧接着发起，可能出现信令乱序。

**当前代码**:
```typescript
if (callState.status === 'inviting' || callState.status === 'ringing') {
    logger.warn('[single-call-page] 存在进行中的呼叫，先挂断', { status: callState.status })
    uni.showToast({ title: '已结束上一次呼叫', icon: 'none' })
    callKit.core.hangup({ callId: callState.callId, reason: 'cancel' }).catch((err) => {
        logger.error('[single-call-page] 挂断旧呼叫失败', err)
    })
    resetCallState() // ❌ 与上方 hangup 存在竞态
}
```

**修复**:
```typescript
if (callState.status === 'inviting' || callState.status === 'ringing') {
    logger.warn('[single-call-page] 存在进行中的呼叫，先挂断', { status: callState.status })
    try {
        await callKit.core.hangup({ callId: callState.callId, reason: 'cancel' })
    } catch (err) {
        logger.error('[single-call-page] 挂断旧呼叫失败', err)
    }
    uni.showToast({ title: '已结束上一次呼叫', icon: 'none' })
    resetCallState()
}
```

---

### 6. `invitation-notification` 群聊接听跳转 URL 缺少查询参数

**文件**: `uni_modules/em-callkit-weixin/components/invitation-notification.vue` L163-L165

**问题**: 群聊接听后跳转 `group-call-page` 时 URL 不携带参数，而 `core-adapter.ts` 中两处跳转同一页面都携带 `groupId` 和 `callType`，存在"同一页面两种跳转契约"的维护隐患。

**当前代码**:
```typescript
if (isGroupCall.value) {
    const groupState = uni.$callKit?.groupState
    uni.navigateTo({
        url: `/uni_modules/em-callkit-weixin/pages/group-call-page/group-call-page` // ❌ 缺参数
    })
    return
}
```

**修复**:
```typescript
if (isGroupCall.value) {
    const callKit = uni.$callKit
    // 注意: 需要 CallKitInstance 暴露 groupState 属性（详见建议项 #9）
    uni.navigateTo({
        url: `/uni_modules/em-callkit-weixin/pages/group-call-page/group-call-page?callType=${callType.value}`
    })
    return
}
```

---

### 7. `invitation-notification` 组件挂载时 `uni.$callKit` 可能未就绪

**文件**: `uni_modules/em-callkit-weixin/components/invitation-notification.vue` L202-L207

**问题**: `onMounted` 中直接读取 `uni.$callKit`。若组件先于 CallKit 初始化挂载，`uni.$callKit` 为 `undefined`，组件静默退出后即使 CallKit 就绪也不会再尝试订阅，导致来电通知永久失效。

**当前代码**:
```typescript
onMounted(() => {
    const callKit = uni.$callKit
    if (!callKit?.core?.onEvent) {
        logger.warn('[InvitationNotification] uni.$callKit.core.onEvent is not available')
        return // ❌ 静默退出，不再重试
    }
    // ... 订阅事件
})
```

**修复方案**（推荐轮询方式）:
```typescript
let retryTimer = null

function trySubscribe() {
    const callKit = uni.$callKit
    if (!callKit?.core?.onEvent) {
        // 每 500ms 重试一次，最多 20 次（10 秒）
        if (!retryTimer) {
            let retryCount = 0
            retryTimer = setInterval(() => {
                retryCount++
                const ck = uni.$callKit
                if (ck?.core?.onEvent) {
                    clearInterval(retryTimer)
                    retryTimer = null
                    doSubscribe(ck)
                } else if (retryCount >= 20) {
                    clearInterval(retryTimer)
                    retryTimer = null
                    logger.warn('[InvitationNotification] uni.$callKit 超时未就绪')
                }
            }, 500)
        }
        return
    }
    doSubscribe(callKit)
}

function doSubscribe(callKit) {
    unsubscribe = callKit.core.onEvent((event) => {
        // ... 事件处理
    })
}

onMounted(() => {
    trySubscribe()
})

onUnmounted(() => {
    if (retryTimer) {
        clearInterval(retryTimer)
        retryTimer = null
    }
    if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
    }
})
```

---

### 8. 静态资源引用使用了绝对路径而非相对路径

**涉及文件**:
- `uni_modules/em-callkit-weixin/components/invitation-notification.vue`（4 处）
- `uni_modules/em-callkit-weixin/pages/single-call-page/single-call-page.vue`（10 处）
- `uni_modules/em-callkit-weixin/pages/group-call-page/group-call-page.vue`（11 处）

**问题**: 所有 `<image>` 标签的 `src` 使用 `/uni_modules/em-callkit-weixin/` 开头的绝对路径，共 25 处。DCloud 官方建议使用相对路径以增强可移植性。

**修复规则**:

| 文件所在目录 | 引用目标 | 相对路径前缀 |
|---|---|---|
| `components/` | `static/callkit/icons/` | `../static/callkit/icons/` |
| `pages/single-call-page/` | `static/callkit/icons/` | `../../static/callkit/icons/` |
| `pages/group-call-page/` | `static/callkit/icons/` | `../../static/callkit/icons/` |

**示例**（`invitation-notification.vue` 位于 `components/` 下）:
```html
<!-- 修改前 -->
<image src="/uni_modules/em-callkit-weixin/static/callkit/icons/phone_hang.svg" />
<!-- 修改后 -->
<image src="../static/callkit/icons/phone_hang.svg" />
```

> **注意**: `uni.navigateTo` 中的页面路径保持绝对路径是正确的，无需修改。

---

## 💡 Suggestions（建议优化）

### 9. 删除死代码 `invitation-notification.vue` 中不存在的 `groupState` 引用

**文件**: `uni_modules/em-callkit-weixin/components/invitation-notification.vue` L162

```typescript
// ❌ 删除此行（groupState 不在 CallKitInstance 接口上，始终为 undefined）
const groupState = uni.$callKit?.groupState
```

---

### 10. IM 连接状态 Toast 应可配置关闭

**文件**: `uni_modules/em-callkit-weixin/src/core-adapter.ts` L119-L126

**问题**: IM 连接/断开的 Toast 无条件显示，若宿主已有提示会重复。

**修复**: 在 `CreateCallKitOptions` 中增加开关：

```typescript
export interface CreateCallKitOptions {
    // ... 现有字段 ...
    /** 是否显示 IM 连接状态 Toast。默认为 true */
    showConnectionToast?: boolean
}

// 使用时:
const { showConnectionToast = true } = options

imClient.onConnected = () => {
    logger.info('[CallKit] IM 已重新连接')
    if (showConnectionToast) {
        uni.showToast({ title: 'IM 已重新连接', icon: 'none', duration: 1500 })
    }
}
imClient.onDisconnected = () => {
    logger.warn('[CallKit] IM 已断开连接')
    if (showConnectionToast) {
        uni.showToast({ title: 'IM 连接已断开，等待重连', icon: 'none', duration: 2000 })
    }
}
```

---

### 11. 删除遗留空目录 `pages/call-page/`

**路径**: `uni_modules/em-callkit-weixin/pages/call-page/`

**问题**: 目录存在但为空，不在 `pages_init.json` 中注册，不被任何代码引用。属于早期开发遗留，易造成维护困惑。

**操作**: 直接删除该空目录。

---

## 📊 修复优先级建议

| 优先级 | 编号 | 问题 | 影响范围 |
|--------|------|------|----------|
| P0 | #1 | userId 使用错误 | 核心层信令上报准确性 |
| P0 | #2 | 缺少 license.md | 无法通过 DCloud 插件市场审核 |
| P1 | #3 | RTC Promise 未处理 | 异常时可能静默失败 |
| P1 | #7 | invitation-notification 初始化时序 | 导致来电通知失效 |
| P2 | #4 | networkHideTimer 泄漏 | 控制台可能有警告 |
| P2 | #5 | hangup 与 reset 竞态 | 连续快速操作时可能异常 |
| P2 | #6 | group-call 跳转 URL 缺参 | 未来重构时可能断裂 |
| P3 | #8 | 绝对路径 → 相对路径 | 可移植性优化 |
| P3 | #9 | 删除死代码 | 代码清洁度 |
| P3 | #10 | Toast 可配置化 | 用户体验优化 |
| P3 | #11 | 删除空目录 | 代码清洁度 |

---

## ✅ uni_modules 规范合规情况

| 检查项 | 状态 |
|--------|------|
| 插件目录无 `manifest.json`、`pages.json`、`App.vue`、`main.js`、`uni.scss` | ✅ |
| `pages_init.json` 正确声明页面 | ✅ |
| 组件符合 easycom 规范 | ✅ |
| 静态资源仅存放于 `static/` | ✅ |
| `package.json` DCloud 插件信息完整 | ✅ |
| `readme.md`、`changelog.md` 存在 | ✅ |
| `license.md` 存在 | ❌ 缺失 |
| 资源引用使用相对路径 | ❌ 使用了绝对路径 |
