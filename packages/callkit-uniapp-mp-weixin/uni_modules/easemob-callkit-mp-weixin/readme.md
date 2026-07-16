# Easemob CallKit UniApp 微信小程序插件

环信 CallKit UniApp 微信小程序插件，基于 `@easemob-community/callkit-core` 构建，支持音视频单聊与群聊。

## 平台支持

- ✅ UniApp Vue3
- ✅ 微信小程序
- ❌ App（见 `skills/callkit-uniapp-mp-weixin-plugin.md`，App 将单独建包）

## 安装

在 HBuilderX 中导入本插件到 `uni_modules/` 目录。

## 使用

宿主项目只需要引入环信 IM SDK 并登录，然后把 `imClient` 传给 CallKit：

```ts
import { createUniappMpWeixinCallKit } from '@/uni_modules/easemob-callkit-mp-weixin'

const imClient = await EasemobIM.createConnection({ ... })
await imClient.open({ user: 'xxx', accessToken: 'xxx' })

const callKit = createUniappMpWeixinCallKit({ imClient })
```

用户无需手动安装：
- `@easemob-community/callkit-core`（已 vendor 到插件内）
- `agora-miniapp-sdk`（已 vendor 到插件内）

## 来电处理

插件提供两种来电处理方式，宿主项目可按需选择：

### 1. 自行处理来电（推荐）

通过 `onIncomingCall` 回调拦截默认行为，完全由宿主项目决定展示方式：

```ts
const callKit = createUniappMpWeixinCallKit({
  imClient,
  onIncomingCall: (payload) => {
    // payload: { callerUserId, callType, callId }
    console.log('收到来电', payload)
    // 返回 true 表示宿主已自行处理，插件不再自动跳转全屏通话页
    return true
  }
})
```

### 2. 使用插件内置通知条

在 `App.vue` 根节点放置 `<invitation-notification />` 组件：

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

组件会自动监听 core 的 `incomingCall` 事件，在顶部显示来电通知条，并提供接听/拒绝按钮。

如果不传 `userInfoMap`，通知条会显示主叫用户 ID。

### 3. 默认行为

如果既未设置 `onIncomingCall`，也未使用 `invitation-notification`，收到来电时插件会默认自动跳转到全屏通话页（`pages/meeting/meeting`）。

## 开发

```bash
# 同步 callkit-core + agora-miniapp-sdk 到插件 vendor/
pnpm sync:all
```

详细开发规范见 `skills/callkit-uniapp-mp-weixin-plugin.md`。
