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

## 开发

```bash
# 同步 callkit-core + agora-miniapp-sdk 到插件 vendor/
pnpm sync:all
```

详细开发规范见 `skills/callkit-uniapp-mp-weixin-plugin.md`。
