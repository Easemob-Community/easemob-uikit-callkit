# 更新日志

## 2.3.0

- 单聊视频/语音通话已调通，本地小窗、胶囊安全区、切换摄像头正常
- 新增统一日志系统 `createMpWeixinLogger`，支持按环境自动收敛日志级别
- 声网小程序 SDK 日志级别与平台 logger 对齐
- 新增弱网提示条与通话结束状态 Toast
- 修复 review 中列出的多项瑕疵：
  - 移除本地流错误上报的 `userPublished` 事件
  - 增加 Agora uid → 环信 userId 映射
  - 支持显示对方昵称/头像（写入 `userInfoMap`）
  - 来电通知条与底部控制栏增加安全区适配
  - `acceptCall` 增加失败处理
  - 组件日志统一为平台 logger

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
