# lib/ 目录已废弃

## 迁移说明

此目录下的代码已完整迁移至 `packages/callkit-vue3/src/`。

自 `@easemob-community/callkit-vue3` v0.1.0 起，**所有新开发和维护应在 `packages/callkit-vue3/` 下进行**。

## 新位置对照

| 原路径 | 新路径 |
|--------|--------|
| `lib/components/` | `packages/callkit-vue3/src/components/` |
| `lib/composables/` | `packages/callkit-vue3/src/composables/` |
| `lib/store/` | `packages/callkit-vue3/src/store/` |
| `lib/services/` | `packages/callkit-vue3/src/services/` |
| `lib/signaling/` | `packages/callkit-vue3/src/signaling/` |
| `lib/types/` | `packages/callkit-vue3/src/types/` |
| `lib/utils/` | `packages/callkit-vue3/src/utils/` |
| `lib/index.ts` | `packages/callkit-vue3/src/index.ts` |

## 保留原因

过渡期备份。方便在迁移后对比和回查历史实现。

## 删除计划

将在 **v2.0** 版本中正式删除此目录。

## 注意事项

- 不要在此目录下继续修改代码，修改不会被纳入构建
- 测试项目（`test/`）应尽快迁移到引用 `@easemob-community/callkit-vue3` 的新路径
