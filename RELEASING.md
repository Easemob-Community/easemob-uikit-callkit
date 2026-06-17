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

## 正式发布

确保已登录 npm 并有发布权限：

```bash
npm whoami
```

执行发布脚本：

```bash
pnpm run release
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
6. `npm publish @easemob-community/callkit-core --access public`
7. `npm publish @easemob-community/callkit-vue3 --access public`
8. 生成 tgz 到 `release/`
9. `npm deprecate easemob-chat-callkit-vue3@*`（可用 `--skip-deprecated` 跳过）
10. 打 `git tag v<version>` 并推送
11. 恢复 `workspace:*` 依赖

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
