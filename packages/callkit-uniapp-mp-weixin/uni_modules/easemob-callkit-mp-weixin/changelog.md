# 更新日志

## 2.2.0

- 新增 `onIncomingCall` 回调，宿主项目可拦截默认来电跳转行为
- 新增内置 `invitation-notification` 组件（顶部来电通知条）
- 单聊通话页从宿主项目迁到插件内部 `pages/single-call-page/`
- 新增 `pages_init.json`，HBuilderX 自动合并页面到宿主项目
- 接入声网小程序 SDK，实现单聊语音/视频通话
- 新增 `wxcomponents/agora-pusher` 和 `wxcomponents/agora-player` 原生媒体组件
- 视频通话支持本地小窗预览、远端全屏、切换摄像头
- 更新示例 `App.vue`，演示回调与通知条两种用法

## 2.1.0

- 初始骨架版本
- 集成 `@easemob-community/callkit-core` 信令核心
- 预留 UniApp App 分包扩展设计
