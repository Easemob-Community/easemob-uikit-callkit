---
name: callkit-uniapp-mp-weixin-call-pages
description: >
  指导如何在 UniApp 微信小程序 CallKit 插件内拆分、放置单聊/群聊通话页面，
  利用 uni_modules 的 pages_init.json、wxcomponents 与 easycom 能力，
  使插件自包含通话 UI，宿主项目只需初始化 CallKit 即可。
  触发时机：用户提到"通话页拆分"、"pages_init.json"、"uni_modules 页面"、
  "单聊群聊分开页面"、"小程序 live-pusher/live-player" 时。
  关联文档：skills/callkit-uniapp-mp-weixin-plugin.md、
  skills/callkit-core-integration.md
---

# UniApp 微信小程序 CallKit 通话页面架构指南

> **适用范围**：`packages/callkit-uniapp-mp-weixin/uni_modules/easemob-callkit-mp-weixin/`
>
> **目标**：把通话页面从宿主项目迁到插件内部，单聊/群聊分页面，利用小程序原生媒体组件，
> 让宿主项目零页面配置即可使用 CallKit。

---

## 一、为什么要把页面迁到 uni_modules 内部

### 当前问题

- 宿主项目需要自行维护 `pages/meeting/meeting.vue`
- 单聊和群聊如果共用一个页面，状态机、UI 布局、媒体组件管理会快速膨胀
- 小程序没有全局浮层/overlay，通话页必须在页面栈内，插件应自带页面

### 迁到插件内部的好处

| 收益 | 说明 |
|---|---|
| 自包含 | 宿主项目只需要初始化 CallKit，不需要写任何通话页面 |
| 可升级 | 插件升级时页面一起升级，避免宿主页面代码落后 |
| 可拆分 | 单聊页专注 1v1 状态机，群聊页专注 grid + 轨道管理 |
| 易发布 | DCloud 插件市场要求插件功能完整，自带页面更符合规范 |

---

## 二、目录结构

```text
uni_modules/easemob-callkit-mp-weixin/
├── components/
│   ├── invitation-notification.vue      # 顶部来电通知条
│   ├── single-call-panel.vue            # 单聊控制栏（可复用）
│   ├── group-call-grid.vue              # 群聊视频网格
│   └── media-controls.vue               # 静音/摄像头/挂断
├── pages/
│   ├── single-call-page/
│   │   └── single-call-page.vue         # 单聊：等待/响铃/通话中
│   └── group-call-page/
│       └── group-call-page.vue          # 群聊：网格通话
├── wxcomponents/                        # 微信小程序原生媒体组件包装
│   ├── agora-pusher/
│   │   ├── agora-pusher.wxml
│   │   ├── agora-pusher.wxss
│   │   ├── agora-pusher.js
│   │   └── agora-pusher.json
│   └── agora-player/
│       ├── agora-player.wxml
│       ├── agora-player.wxss
│       ├── agora-player.js
│       └── agora-player.json
├── pages_init.json                      # 插件页面声明，HBuilderX 自动合并到宿主 pages.json
├── index.ts
├── src/
│   ├── core-adapter.ts
│   └── ...
└── readme.md
```

**注意**：
- 插件内部**不要**放 `manifest.json`、`pages.json`、`App.vue`、`main.js`
- 页面路径统一以 `/uni_modules/easemob-callkit-mp-weixin/pages/...` 开头

---

## 三、pages_init.json 规则

`uni_modules` 插件可以通过 `pages_init.json` 向宿主项目注入页面。
HBuilderX 编译时会自动合并到宿主 `pages.json`。

```json
{
  "pages": [
    {
      "path": "uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page",
      "style": {
        "navigationStyle": "custom"
      }
    },
    {
      "path": "uni_modules/easemob-callkit-mp-weixin/pages/group-call-page/group-call-page",
      "style": {
        "navigationStyle": "custom"
      }
    }
  ]
}
```

### 校验点

- 路径必须是 `uni_modules/<plugin-id>/pages/...` 形式
- 插件内不要有 `pages.json`（那是宿主项目的文件）
- 合并后宿主 `pages.json` 里不应再出现旧的 `pages/meeting/meeting`

---

## 四、单聊页状态设计

单聊页只需要处理 1v1 的三种状态：

```ts
type SingleCallStatus = 'inviting' | 'ringing' | 'in_call'
```

### 页面进入方式

1. **主叫主动发起**：宿主调用 `core.inviteCall(...)` 后，由插件自动/宿主手动跳转到单聊页
2. **被叫收到来电**：
   - 如果宿主未拦截 `onIncomingCall`，插件默认自动跳转
   - 如果使用 `invitation-notification`，用户点击“接听”后跳转

### 状态流转

```
主叫进入 -> status = inviting -> 等待对方接受
被叫进入 -> status = ringing  -> 显示接听/拒绝
双方接通 -> status = in_call  -> 显示静音/摄像头/挂断
```

### 接听/拒绝/挂断 API

```ts
// 接听
core.answerCall({ callId, result: 'accept' })

// 拒绝
core.answerCall({ callId, result: 'refuse' })

// 主叫取消 / 通话中挂断
core.hangup({ callId, reason: callState.status === 'inviting' ? 'cancel' : 'normal' })
```

---

## 五、群聊页状态设计

群聊页专注**已接通**状态，布局由参与者数量决定。

### 与单聊的关键差异

| 差异点 | 单聊 | 群聊 |
|---|---|---|
| 进入时机 | 邀请发出/收到即进入 | 一般接通后进入，或邀请阶段由通知条处理 |
| 布局 | 大头像 + 底部控制栏 | 等分 grid |
| 媒体组件 | 1 个 pusher + 1 个 player | 1 个 pusher + N 个 player |
| 状态模型 | caller/callee 二元 | participants 集合 |

### 布局策略

参考 Agora 教程，按当前在线人数动态计算每个视频块的位置和大小：

```ts
function getLayout(count: number): LayoutItem[] {
  switch (count) {
    case 1: return [{ x: 0, y: 0, w: 100, h: 100 }]
    case 2: return [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 100 }
    ]
    // ...
  }
}
```

---

## 六、小程序原生媒体组件

小程序音视频通话必须使用 `live-pusher` / `live-player`。
UniApp 支持在 Vue 模板中直接使用这些原生标签，但推荐包装成 `wxcomponents` 原生组件，
以获得更稳定的事件处理和样式隔离。

### wxcomponents/agora-pusher

```html
<!-- agora-pusher.wxml -->
<live-pusher
  url="{{url}}"
  mode="RTC"
  autopush
  muted="{{muted}}"
  enable-camera="{{enableCamera}}"
  beauty="{{beauty}}"
  bindstatechange="onStateChange"
  bindnetstatus="onNetStatus"
/>
```

### wxcomponents/agora-player

```html
<!-- agora-player.wxml -->
<live-player
  src="{{url}}"
  mode="RTC"
  autoplay
  muted="{{muted}}"
  object-fit="contain"
  bindstatechange="onStateChange"
/>
```

### 注意事项

- `live-pusher` / `live-player` 是原生组件，层级最高，会覆盖普通 view
- 切后台会中断推流/拉流，需在 `onShow` / `onHide` 中恢复
- 不要在一个页面中创建过多 `live-player`（小程序有性能限制）

---

## 七、跳转路径规范

插件内部统一使用绝对路径：

```ts
// 单聊页
uni.navigateTo({
  url: '/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=xxx&callType=audio'
})

// 群聊页
uni.navigateTo({
  url: '/uni_modules/easemob-callkit-mp-weixin/pages/group-call-page/group-call-page?groupId=xxx&callType=video'
})
```

`core-adapter.ts` 中的默认跳转也要使用上述路径。

---

## 八、AI 实施 checklist

当用户要求“拆分单聊/群聊通话页”时，按以下顺序执行：

1. 阅读本文件和 `skills/callkit-uniapp-mp-weixin-plugin.md`
2. 在插件内创建 `pages_init.json`
3. 创建 `pages/single-call-page/single-call-page.vue`
4. （可选）创建 `pages/group-call-page/group-call-page.vue`
5. 创建/完善 `wxcomponents/agora-pusher` 和 `wxcomponents/agora-player`
6. 更新 `core-adapter.ts` 的默认跳转路径
7. 从宿主项目 `pages.json` 中移除旧页面
8. 更新 `readme.md` 和 `changelog.md`
9. 运行 `pnpm typecheck` 和 HBuilderX 真机/模拟器验证

---

## 九、禁止事项

- ❌ 不要把插件页面放到宿主 `pages/` 目录下长期维护
- ❌ 不要在单聊页里硬编码群聊 grid 逻辑
- ❌ 不要把 `manifest.json` / `pages.json` / `App.vue` 放进 `uni_modules/easemob-callkit-mp-weixin/`
- ❌ 不要直接用 `live-pusher` / `live-player` 而不做后台恢复处理
