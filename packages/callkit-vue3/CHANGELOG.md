# @easemob-community/callkit-vue3

## 2.0.2

### Patch Changes

- fix(vue3): 修正依赖声明与产物形态

  - 将 `pinia` 从 `peerDependencies` 移入 `dependencies`，并在构建时内联打包，用户无需手动安装 Pinia。
  - 移除未在代码中使用的 `vue-i18n` 幽灵依赖声明。
  - 修复 CSS 产物文件名：`dist/callkit-vue3.css` 统一输出为 `dist/style.css`，与 `exports["./style.css"]` 保持一致。
  - 更新 README 中关于依赖自动带入和 UMD/CDN 使用的说明。
  - 修复 `test/scripts/switch-mode.mjs` 与 `test/package.json` 中错误的 tgz 文件名。
  - 为 `test` 项目 source 模式补充 `pinia` devDependency。
  - @easemob-community/callkit-core@2.0.2

## 2.0.1

### Patch Changes

- 055347c: - fix(vue3): `initConfig.logLevel` 现在同时控制 `@easemob-community/callkit-core` 的核心日志输出
  - fix(provider): callkit-core 版本号使用 WARN 级别输出，确保生产环境可见
  - style(single-call): 一对一视频通话本地预览小窗改为纵向长方形
  - chore(release): 完善发布流程，增加 typecheck、core 单测、自动 git tag
  - docs: 补充日志级别与核心日志的关系说明
- Updated dependencies [055347c]
  - @easemob-community/callkit-core@2.0.1
