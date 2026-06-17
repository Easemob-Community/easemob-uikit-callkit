---
"@easemob-community/callkit-core": patch
"@easemob-community/callkit-vue3": patch
---

- fix(vue3): `initConfig.logLevel` 现在同时控制 `@easemob-community/callkit-core` 的核心日志输出
- fix(provider): callkit-core 版本号使用 WARN 级别输出，确保生产环境可见
- style(single-call): 一对一视频通话本地预览小窗改为纵向长方形
- chore(release): 完善发布流程，增加 typecheck、core 单测、自动 git tag
- docs: 补充日志级别与核心日志的关系说明
