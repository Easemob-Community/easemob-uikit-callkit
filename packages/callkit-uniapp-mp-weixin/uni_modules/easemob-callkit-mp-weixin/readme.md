# Easemob CallKit UniApp 微信小程序插件

环信 CallKit UniApp 微信小程序插件，基于 `@easemob-community/callkit-core` 构建，支持音视频单聊与群聊。

## 平台支持

- ✅ UniApp Vue3
- ✅ 微信小程序
- ❌ App（见 `skills/callkit-uniapp-mp-weixin-plugin.md`，App 将单独建包）

## 安装

在 HBuilderX 中导入本插件到 `uni_modules/` 目录。

## 使用

```ts
import { createUniappMpWeixinCallKit } from '@/uni_modules/easemob-callkit-mp-weixin'

const callKit = createUniappMpWeixinCallKit(imClient)
```

详细 API 文档待补充。
