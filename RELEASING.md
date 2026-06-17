# 发布流程

本项目使用 [Changesets](https://github.com/changesets/changesets) 管理版本和 CHANGELOG，结合 `scripts/publish.mjs` 完成实际发布。

## 开发阶段

每次提交对用户有影响的变更时，都应添加一个 changeset 文件：

```bash
pnpm changeset
```

如果交互式命令不可用，也可以手动在 `.changeset/` 目录下创建 `.md` 文件，格式如下：

```md
---
"@easemob-community/callkit-core": patch
"@easemob-community/callkit-vue3": patch
---

简要描述本次变更。
```

> 注意：`@easemob-community/callkit-core` 与 `@easemob-community/callkit-vue3` 在 `.changeset/config.json` 中已配置为 `fixed`，会保持相同版本号。

## 版本冻结

准备发布前，执行：

```bash
pnpm run version-packages
```

这会：
1. 根据所有未消费的 changeset 文件计算新版本号
2. 自动更新 `packages/callkit-core/package.json` 和 `packages/callkit-vue3/package.json` 的版本号
3. 更新根目录 `CHANGELOG.md`
4. 删除已消费的 changeset 文件

然后提交生成的变更：

```bash
git add .
git commit -m "chore(release): bump versions"
```

## 认证准备

发布脚本会在运行期间临时修改 `packages/callkit-vue3/package.json`（将 `workspace:*` 替换为实际版本），导致 pnpm 的 git 干净性检查失败。脚本已内置 `--no-git-checks`，但仍需有效的 npm 认证。

### 推荐：使用 bypass 2FA 的 access token

如果 npm 账号启用了双因素认证（2FA），普通登录会话在执行 `npm publish` 时会要求 OTP。为了支持自动化/本地一键发布，建议使用 **granular access token** 并开启 **"Bypass two-factor authentication"**：

1. 访问 https://www.npmjs.com/settings/huangfeipeng/tokens/new
2. 选择 **Granular access token**
3. 授权以下包：
   - `@easemob-community/callkit-core`
   - `@easemob-community/callkit-vue3`
   - `easemob-chat-callkit-vue3`（如需自动废弃老包）
4. 权限选择 **Read and write**
5. **勾选 "Bypass two-factor authentication"**
6. 生成并复制 token

> 注意：`npm_...` 开头的 legacy token 将于 2025 年 11 月被 npm 移除，建议优先使用 granular access token。

### 临时使用 token 发布

在项目根目录创建临时 `.npmrc`（不要提交到 git）：

```bash
echo "//registry.npmjs.org/:_authToken=<your-token>" > .npmrc
pnpm run release
rm -f .npmrc
```

### 使用 npm login + OTP

如果没有 bypass 2FA 的 token，也可以先用有发布权限的账号登录：

```bash
npm login
```

执行发布时如果要求 OTP，脚本会失败（当前不支持交互式输入）。此时需要改用上述 token 方式，或手动执行：

```bash
pnpm run build:all
cd packages/callkit-core && npm publish --access public --otp=<6位验证码>
cd ../callkit-vue3 && npm publish --access public --otp=<6位验证码>
```

## 正式发布

确保认证有效（以 token 方式为例）：

```bash
echo "//registry.npmjs.org/:_authToken=<your-token>" > .npmrc
pnpm run release
rm -f .npmrc
```

或演练模式：

```bash
pnpm run release -- --dry-run
```

`scripts/publish.mjs` 会按顺序执行：
1. 校验两个包版本号一致
2. `pnpm run typecheck`
3. `pnpm --filter @easemob-community/callkit-core run test`
4. `pnpm run build:all`
5. 临时将 callkit-vue3 的 callkit-core 依赖从 `workspace:*` 改为 `^版本`
6. `pnpm publish @easemob-community/callkit-core --access public --no-git-checks`
7. `pnpm publish @easemob-community/callkit-vue3 --access public --no-git-checks`
8. 生成 tgz 到 `release/`
9. `npm deprecate easemob-chat-callkit-vue3@*`（可用 `--skip-deprecated` 跳过）
10. 打 `git tag v<version>` 并推送
11. 恢复 `workspace:*` 依赖

> 废弃老包需要 `easemob-chat-callkit-vue3` 的 write 权限。如果当前 token 没有权限，会 403 失败，可跳过此步，之后用有权限的账号/token 手动执行 `npm deprecate`。

## 发布后验证

1. 在 npm 官网确认包已发布：
   - https://www.npmjs.com/package/@easemob-community/callkit-core
   - https://www.npmjs.com/package/@easemob-community/callkit-vue3
2. 在 GitHub 查看 tag：
   - https://github.com/Easemob-Community/easemob-uikit-callkit/releases
3. 在独立项目中安装验证：
   ```bash
   pnpm add @easemob-community/callkit-vue3
   ```
