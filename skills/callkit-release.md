---
name: callkit-release
description: >
  指导用户或 AI 手动发布 @easemob-community/callkit-core 与
  @easemob-community/callkit-vue3 到 npm。用于 GitHub Actions 失效或需要
  本地一键发版的场景。
  触发时机：用户说"发版"、"publish"、"发布到 npm"、"手动发包"。
  关联文档：RELEASING.md、.changeset/config.json、scripts/publish.mjs
---

# CallKit 手动发包指南

> 本文档用于 GitHub Actions 不可用或需要本地控制发版流程的场景。
> 两个包 `@easemob-community/callkit-core` 与 `@easemob-community/callkit-vue3`
> 在 `.changeset/config.json` 中已配置为 `fixed`，**必须保持相同版本号**。

---

## 一、发版前准备

### 1. 确认 npm 认证

你需要一个具有 `read and write` 权限的 npm access token：

- 访问 https://www.npmjs.com/settings/tokens
- 生成 **Granular access token**（推荐）或 **Classic token**
- 授权包：
  - `@easemob-community/callkit-core`
  - `@easemob-community/callkit-vue3`
  - `easemob-chat-callkit-vue3`（如需废弃老包）

### 2. 写入 `.npmrc`

在项目根目录创建临时 `.npmrc`（已加入 `.gitignore`，不会提交）：

```bash
cd /Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3
echo "//registry.npmjs.org/:_authToken=<your-token>" > .npmrc
```

验证登录状态：

```bash
npm whoami
```

---

## 二、方案 A：使用发布脚本（推荐）

`scripts/publish.mjs` 已封装完整流程，会自动处理 `workspace:*` 依赖替换。

**注意**：脚本已修复 `pnpm publish` 与 `npm deprecate` 认证上下文不一致的 BUG，
现在统一使用 `npm publish <path>` 执行发布，确保认证会话不会中途失效。

```bash
cd /Users/neohuang/Desktop/WorkCommonUse/UIKIT/easemob-uikit-callkit-vue3

# 方式 1：npm 交互式登录（推荐，会自动打开浏览器验证）
npm login

# 方式 2：使用 token 写入 .npmrc（CI 或自动化场景）
# echo "//registry.npmjs.org/:_authToken=<your-token>" > .npmrc

# 验证登录
npm whoami

# 执行发布
node scripts/publish.mjs

# 如果使用了 .npmrc，发布完成后删除
# rm -f .npmrc
```

可选参数：

```bash
# 演练模式：构建但不真正发布
node scripts/publish.mjs --dry-run

# 跳过废弃老包 easemob-chat-callkit-vue3
node scripts/publish.mjs --skip-deprecated
```

脚本会依次执行：

1. 校验两个包版本号一致
2. `pnpm run typecheck`
3. `pnpm --filter @easemob-community/callkit-core run test`
4. `pnpm run build:all`
5. 临时将 callkit-vue3 的 `workspace:*` 替换为实际版本
6. `npm publish packages/callkit-core`（统一使用 npm 认证上下文）
7. `npm publish packages/callkit-vue3`（统一使用 npm 认证上下文）
8. 生成 tgz 到 `release/`
9. `npm deprecate easemob-chat-callkit-vue3@*`（与 publish 共享认证上下文）
10. 打 `git tag v<version>` 并推送
11. 恢复 `workspace:*` 依赖

---

## 三、方案 B：完全手动分步发布

如果脚本不可用，按以下顺序执行：

### Step 1：版本号与 changeset 检查

```bash
# 确认两个包版本号一致
grep '"version"' packages/callkit-core/package.json packages/callkit-vue3/package.json

# 确认没有未消费的 changeset（或已执行 version-packages）
ls .changeset/
```

### Step 2：类型检查与构建

```bash
pnpm run typecheck
pnpm run build:all
```

### Step 3：发布 callkit-core

```bash
cd packages/callkit-core
npm publish --access public --no-git-checks
cd ../..
```

### Step 4：替换 workspace 依赖

`callkit-vue3/package.json` 中 `@easemob-community/callkit-core` 是 `workspace:*`，
npm 不接受这种依赖。需要临时改成实际版本号：

```bash
# 示例：当前版本为 2.1.0
sed -i '' 's/"workspace:\*"/"^2.1.0"/' packages/callkit-vue3/package.json
```

### Step 5：发布 callkit-vue3

```bash
cd packages/callkit-vue3
npm publish --access public --no-git-checks
cd ../..
```

### Step 6：恢复 workspace 依赖

```bash
sed -i '' 's/"\^2.1.0"/"workspace:*"/' packages/callkit-vue3/package.json
```

### Step 7：打 tag 并推送

```bash
git tag v2.1.0
git push origin v2.1.0
```

### Step 8：废弃老包（可选）

```bash
npm deprecate easemob-chat-callkit-vue3@* "请迁移到 @easemob-community/callkit-vue3"
```

---

## 四、用户指定的简化命令为什么不直接用

你可能会想直接执行：

```bash
pnpm --filter @easemob-community/callkit-vue3 publish --access public --no-git-checks
```

**这个命令会失败**，原因：

1. `callkit-vue3/package.json` 中 `@easemob-community/callkit-core` 是 `workspace:*`，
   npm 不允许发布带 workspace 协议的依赖。
2. 没有先发布 `callkit-core`，vue3 即使发布出去，安装时也可能找不到对应版本的 core。

正确做法是先发 core，再替换 workspace 依赖，最后发 vue3；或者直接用 `scripts/publish.mjs`。

---

## 五、常见失败与处理

### 1. `E401 Unauthorized`

- token 无效或已过期
- token 没有对应包的 write 权限
- `.npmrc` 未正确写入

### 2. `E403 Forbidden`

- 该版本已经存在，不能重复发布
- token 没有废弃老包 `easemob-chat-callkit-vue3` 的权限
  - 用 `--skip-deprecated` 跳过，之后手动废弃

### 3. `E422 Unprocessable Entity`

- 废弃老包时可能出现，通常是认证会话过期或权限不足
- 解决：确保 `npm login` 后直接使用 `node scripts/publish.mjs`（脚本已统一 npm 认证上下文）
- 或者单独执行：`npm deprecate easemob-chat-callkit-vue3@* "..."`

### 4. `workspace:*` 被拒绝

- 必须先替换为实际版本号再 publish
- 或者用 `scripts/publish.mjs`

### 5. `npm publish` 报 `git ls-remote ssh://git@github.com/packages/...` / `Repository not found`

- 原因：`npm publish packages/callkit-core` 这种不带 `./` 前缀的相对路径会被 npm 误解析为 GitHub shorthand（`org/repo`），去访问不存在的仓库
- 解决：路径必须写成 `./packages/callkit-core`（`scripts/publish.mjs` 已修复此问题）

### 4. 构建失败

- 执行 `pnpm run typecheck` 和 `pnpm run build:all` 单独排查
- 常见原因：类型错误、依赖未安装

---

## 六、发布后验证

```bash
# 确认 npm 上版本已更新
npm view @easemob-community/callkit-core version
npm view @easemob-community/callkit-vue3 version

# 在独立项目中安装验证
pnpm add @easemob-community/callkit-vue3@latest
```

浏览器打开确认：

- https://www.npmjs.com/package/@easemob-community/callkit-core
- https://www.npmjs.com/package/@easemob-community/callkit-vue3
- https://github.com/Easemob-Community/easemob-uikit-callkit/tags

---

## 七、AI 执行发包前的自检 Prompt

```text
[ ] 当前工作目录是否是项目根目录？
[ ] 是否已确认两个包的 version 一致？
[ ] 是否已创建 .npmrc 并验证 npm whoami？
[ ] 是否已执行 typecheck 并通过？
[ ] 是否已执行 build:all 并通过？
[ ] 是否先发布 callkit-core？
[ ] 是否已将 callkit-vue3 的 workspace:* 替换为实际版本？
[ ] 发布完成后是否恢复 workspace:*？
[ ] 是否已打 tag v<version> 并推送？
[ ] 是否已验证 npm 上版本已更新？
```

全部勾选后，方可认为发版流程完成。
