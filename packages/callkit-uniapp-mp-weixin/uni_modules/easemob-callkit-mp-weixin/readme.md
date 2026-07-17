# Easemob CallKit UniApp 微信小程序插件

环信 CallKit UniApp 微信小程序插件，基于 `@easemob-community/callkit-core` 构建，提供开箱即用的 1v1 音视频通话能力。

## 平台支持

- ✅ UniApp Vue3
- ✅ 微信小程序
- ❌ App（App 端将单独建包）

## 快速开始

### 1. 导入插件

在 HBuilderX 中把本插件目录放入宿主项目的 `uni_modules/` 下：

```
your-project/
├── pages.json
├── manifest.json
├── App.vue
└── uni_modules/
    └── easemob-callkit-mp-weixin/   ← 本插件
```

### 2. 安装环信 IM SDK

宿主项目需要自行安装并初始化环信 IM SDK：

```bash
npm install easemob-websdk
# 或
pnpm add easemob-websdk
```

> 插件已内置 `@easemob-community/callkit-core` 和 `agora-miniapp-sdk`，无需额外安装。

### 3. 配置小程序权限与域名

在 `manifest.json` 的 `mp-weixin` 节点中声明音视频权限：

```json
{
  "mp-weixin": {
    "permission": {
      "scope.record": { "desc": "用于音视频通话" },
      "scope.camera": { "desc": "用于视频通话" }
    }
  }
}
```

并在微信小程序后台配置服务器域名：

- **socket 合法域名**：`wss://im-api-wechat.easemob.com`
- **uploadFile 合法域名**：`https://a1.easemob.com`
- **downloadFile 合法域名**：`https://a1.easemob.com`
- **live-pusher / live-player 域名**：按声网控制台配置（通常包含 `*.agoraio.cn` 等）

### 4. 初始化 CallKit

在宿主项目的 `App.vue` 或业务入口中：

```vue
<script setup>
import { createIMConnectionAdapter, createUniappMpWeixinCallKit } from '@/uni_modules/easemob-callkit-mp-weixin'
import SDK from 'easemob-websdk/uniApp/Easemob-chat'

// 1. 创建环信连接（宿主自行负责）
const conn = new SDK.connection({
  appKey: 'your-app-key',
  url: 'wss://im-api-wechat.easemob.com/websocket',
  apiUrl: 'https://a1.easemob.com'
})

// 2. 登录
await conn.open({ user: 'userId', accessToken: 'token' })

// 3. 包装成 CallKit 需要的形态
const imClient = createIMConnectionAdapter(conn)

// 4. 初始化 CallKit
const callKit = createUniappMpWeixinCallKit({
  imClient,
  userProfile: {
    userId: 'userId',
    nickname: '我的昵称',
    avatarURL: 'https://...'
  }
})

// 5. 挂载到全局，供其他页面/组件使用
uni.$callKit = callKit
</script>
```

### TypeScript 全局类型声明（可选）

如果宿主项目使用 TypeScript，建议在 `types/` 目录添加全局声明，让 `uni.$callKit` 有类型提示：

```ts
// types/global.d.ts
import type { CallKitInstance } from '@/uni_modules/easemob-callkit-mp-weixin'

declare global {
  interface UniApp {
    $callKit?: CallKitInstance
    $imClient?: any
  }
}

export {}
```

并在 `tsconfig.json` 的 `include` 中确保包含 `types/**/*.d.ts`。

### 5. 发起呼叫

在任意页面中：

```vue
<script setup>
function callUser(userId, callType) {
  uni.navigateTo({
    url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${userId}&callType=${callType}`
  })
}

// 语音呼叫
callUser('targetUserId', 'audio')

// 视频呼叫
callUser('targetUserId', 'video')
</script>
```

## 来电处理

插件提供三种来电处理方式，宿主可按需选择：

### 方式一：自行处理来电（推荐）

通过 `onIncomingCall` 回调完全自定义来电展示：

```ts
const callKit = createUniappMpWeixinCallKit({
  imClient,
  onIncomingCall: (payload) => {
    // payload: { callerUserId, callType, callId }
    console.log('收到来电', payload)
    // 展示自定义弹窗
    // 返回 true 表示宿主已处理，插件不再自动跳转
    return true
  }
})
```

### 方式二：使用内置通知条

在 `App.vue` 根节点放置组件：

```vue
<template>
  <view class="app-root">
    <invitation-notification :user-info-map="userInfoMap" />
    <!-- 页面内容 -->
  </view>
</template>

<script setup>
const userInfoMap = {
  'user1': { nickname: '张三', avatarURL: 'https://...' }
}
</script>
```

组件会自动监听 `incomingCall` 事件，在顶部显示来电通知条，并提供接听/拒绝按钮。

### 方式三：默认跳转

如果既未设置 `onIncomingCall`，也未使用 `invitation-notification`，收到来电时插件默认自动跳转到内置单聊通话页。

## 完整 API

### `createUniappMpWeixinCallKit(options)`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `imClient` | `IMAdaptedConnection` | 是 | 经 `createIMConnectionAdapter` 包装后的环信连接 |
| `userProfile` | `{ userId, nickname?, avatarURL? }` | 否 | 当前用户资料 |
| `rtcAdapter` | `RtcAdapter` | 否 | 自定义 RTC 适配器，默认使用声网小程序 SDK |
| `onIncomingCall` | `(payload) => boolean \| void` | 否 | 来电回调，返回 `true` 拦截默认跳转 |

**返回值**：`CallKitInstance`

| 属性/方法 | 说明 |
|---|---|
| `core` | `CallKitCore` 实例，提供 `inviteCall` / `answerCall` / `hangup` 等核心 API |
| `rtcAdapter` | `RtcAdapter` 实例，提供 RTC 原子操作 |

### `createIMConnectionAdapter(connection)`

把环信 IM SDK 的 `connection` 包装成 CallKit 需要的形态。

**参数**：环信 SDK 的 `connection` 实例

**返回值**：`IMAdaptedConnection`

### `useCallState()`

获取通话状态 Store：

```ts
import { useCallState } from '@/uni_modules/easemob-callkit-mp-weixin'

const { state } = useCallState()
// state.status: 'idle' | 'inviting' | 'ringing' | 'in_call' | 'ended'
// state.callType: 'audio' | 'video'
// state.duration: number
// ...
```

### `createMpWeixinLogger(options?)`

创建平台 Logger，可控制日志级别和上报：

```ts
import { createMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin'

const logger = createMpWeixinLogger({
  level: 'warn', // 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'silent'
  prefix: '[CallKit][微信小程序]'
})
```

默认根据环境自动判断：开发/体验版输出 `debug`，正式版只输出 `warn/error`。

## 常见问题

### 1. 真机上没有声音/画面

- 检查是否已申请 `scope.record` / `scope.camera` 权限
- 检查微信小程序后台是否配置了服务器域名（live-pusher/live-player 需要）
- 查看控制台是否有 `[CallKit][微信小程序]` 开头的错误日志

### 2. 收到来电没有弹窗

- 确认 `imClient` 已正确传入
- 确认 `onIncomingCall` 没有返回 `true`（否则插件不会自动跳转）
- 检查 IM 是否在线，是否能收到文本消息

### 3. 正式版日志太多

```ts
import { createMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin'

const logger = createMpWeixinLogger({ level: 'error' })
```

### 4. 如何自定义通话页面

通过 `onIncomingCall` 拦截来电后，自行导航到自定义页面，并调用 `core.answerCall` / `core.hangup` 等 API 控制通话。

## 开发

```bash
# 同步 callkit-core + agora-miniapp-sdk 到插件 vendor/
pnpm sync:all

# 类型检查
pnpm typecheck
```

详细开发规范见 `skills/callkit-uniapp-mp-weixin-plugin.md`。
