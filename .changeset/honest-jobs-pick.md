---
"@easemob-community/callkit-core": patch
---

fix(core): 版本号从 package.json 动态注入，避免硬编码与实际版本不一致

- 移除 `src/index.ts` 中硬编码的 `VERSION = '1.1.0'`
- 通过 Vite `define` 注入 `__CALLKIT_VERSION__`，与 `package.json.version` 保持一致
