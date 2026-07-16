---
name: callkit-uniapp-mp-weixin-plugin
description: >
  指导 AI 在当前 monorepo 中开发 UniApp/微信小程序平台的 CallKit，以 uni_modules
  插件形态发布到 DCloud 插件市场。明确目录结构、core 引入方式、HBuilderX 开发
  流程和禁止行为，防止方案跑偏。
  触发时机：用户提到"UniApp CallKit"、"微信小程序 CallKit"、"uni_modules 插件"、
  "callkit-uniapp-mp-weixin"、"把 CallKit 做到小程序里"。
  关联文档：skills/callkit-core-integration.md、skills/callkit-platform-porting.md、
  skills/callkit-platform-pitfalls.md、packages/callkit-core/README.md
---

# UniApp / 微信小程序 CallKit 插件开发指南

> **本指南约束的是：在当前 `easemob-uikit-callkit-vue3` monorepo 内如何新增 `packages/callkit-uniapp-mp-weixin` 包，并最终以 `uni_modules` 形态发布到 DCloud 插件市场。**
>
> 不涉及具体业务实现细节（如单聊/群聊状态机），那些规则见 `skills/callkit-core-integration.md` 和 `skills/callkit-platform-porting.md`。

---

## 一、总体设计决策（已确定，不可擅自更改）

| 决策项 | 已确定方案 | 理由 |
|---|---|---|
| 包位置 | `packages/callkit-uniapp-mp-weixin/` | 与 `callkit-core`、`callkit-vue3` 同层管理 |
| 运行形态 | `packages/callkit-uniapp-mp-weixin/` 本身是一个**可运行的 UniApp 宿主项目** | HBuilderX 必须打开一个完整 UniApp 项目才能编译到微信小程序 |
| 插件形态 | 宿主项目内部包含 `uni_modules/easemob-callkit-mp-weixin/` 作为真正的插件 | 符合 DCloud `uni_modules` 规范，便于发布到插件市场 |
| core 引入方式 | **复制 `callkit-core` 构建产物到插件内**，不走 npm / workspace 依赖 | HBuilderX 对 pnpm node_modules / workspace 解析支持不佳，copy 产物可避免大量工具链调试 |
| IM SDK | 由宿主项目引入 `easemob-websdk` 小程序版本并自行创建/登录 connection | core 把它作为 peer dependency，插件只通过 `createIMConnectionAdapter` 做一层薄包装 |
| RTC SDK | 插件内部 vendor 声网小程序 SDK（`agora-miniapp-sdk`） | 小程序端必须用 `live-pusher` / `live-player`，且和 Web SDK API 完全不同 |
| App 支持策略 | **App 不是本包目标**，未来单独建 `packages/callkit-uniapp-app/` | 微信小程序和 App 的 RTC SDK/原生组件差异过大，放在一个包里会用大量 `#ifdef`，维护成本高 |

**关于声网 SDK 的放置位置**：
- JS 运行时必须放在 `uni_modules/easemob-callkit-mp-weixin/static/agora-miniapp-sdk.js`。
- 类型声明 `agora-miniapp-sdk.d.ts` 放在 `uni_modules/easemob-callkit-mp-weixin/src/vendor/`（仅开发期使用）。

原因：HBuilderX 编译到微信小程序时，只有把文件放在 `static/` 下才会原样复制到输出包；若把 `agora-miniapp-sdk.js` 放在 `src/vendor/` 并通过 `require('./vendor/...')` 引用，编译后文件不会被复制，运行时会报 `module is not defined`。

**核心原则**：`callkit-uniapp-mp-weixin` 只解决微信小程序场景，不要提前把 App 的适配塞进来。用户只需要提供环信 IM client，core 和声网 SDK 都由插件内部提供。

**AI 禁止行为**：
- ❌ 不要把 `callkit-uniapp-mp-weixin` 设计成纯 npm 库包（没有 `manifest.json`/`pages.json`/`App.vue`）
- ❌ 不要尝试在插件内部用 `workspace:*` 或 npm 安装 `@easemob-community/callkit-core`
- ❌ 不要把 `easemob-websdk` 打包进插件 vendor 目录
- ❌ 不要把完整 UniApp 项目的 `manifest.json`、`pages.json`、`App.vue` 放到 `uni_modules/easemob-callkit-mp-weixin/` 内部

---

## 二、目录结构

```
packages/callkit-uniapp-mp-weixin/                    # 宿主 UniApp 项目，可被 HBuilderX 直接打开
├── App.vue                                 # 宿主应用入口
├── main.js                                 # 宿主应用入口
├── manifest.json                           # 宿主应用配置
├── pages.json                              # 宿主页面配置
├── pages/                                  # 示例页面：登录、拨号、通话中
│   ├── index/index.vue
│   └── meeting/meeting.vue
├── static/                                 # 宿主静态资源
├── package.json                            # 本包的 npm 元数据
├── tsconfig.json
├── vite.config.ts                          # 如使用 CLI 构建
├── scripts/
│   ├── sync-core.js                        # 自动同步 callkit-core 产物到插件内
│   └── sync-agora.js                       # 自动同步声网小程序 SDK 到插件内
└── uni_modules/                            # 真正的插件目录
    └── easemob-callkit-mp-weixin/          # DCloud 插件 ID
        ├── package.json                    # DCloud 插件配置
        ├── index.ts                          # 插件入口（必须，否则 HB 目录导入报错）
        ├── readme.md
        ├── changelog.md
        ├── license.md
        ├── components/                     # Vue 组件（支持 easycom）
        │   ├── easemob-callkit-shell.vue
        │   ├── single-call-panel.vue
        │   └── group-call-grid.vue
        ├── pages/                          # 插件内置页面
        │   └── call-page/call-page.vue
        ├── static/                         # 插件静态资源
        │   └── agora-miniapp-sdk.js        # 声网小程序 SDK 运行时（必须放 static/）
        ├── wxcomponents/                   # 微信小程序原生组件
        │   ├── agora-pusher/
        │   └── agora-player/
        └── src/                            # 插件 TypeScript 核心
            ├── index.ts                    # 插件对外入口
            ├── core-adapter.ts             # 对接 callkit-core 的 adapter
            ├── im/                         # 环信 IM SDK 适配（只包装，不创建 connection）
            │   └── IMConnectionAdapter.ts  # 把宿主传入的 connection 包装成 core 需要的 EasemobConnection
            ├── rtc/
            │   ├── RtcAdapter.ts           # 抽象接口（为 future App 包预留）
            │   └── MpWeixinRtcAdapter.ts   # 声网小程序 SDK 实现
            ├── store/
            │   └── callState.ts            # 平台响应式状态（可用 Vue3 reactive/Pinia）
            └── vendor/                     # callkit-core 产物 + 声网 SDK 类型声明
                ├── callkit-core.esm.js     # copy from ../../callkit-core/dist/index.js
                ├── callkit-core.cjs.js     # copy from ../../callkit-core/dist/index.cjs
                ├── callkit-core.d.ts       # copy from ../../callkit-core/dist/index.d.ts
                ├── agora-miniapp-sdk.d.ts  # copy from ../node_modules/agora-miniapp-sdk/build/
                ├── version.txt             # 记录 core 版本
                └── agora-version.txt       # 记录 agora SDK 版本
```

---

## 三、core 产物同步规则

### 3.1 为什么用 copy 而不是 npm/workspace

- HBuilderX 对 pnpm 的硬链接/符号链接支持不稳定
- `uni_modules` 插件最终需要自包含，发布到 DCloud 时不应要求用户再 `npm install`
- copy 产物是 UniApp 插件生态中最常见、最稳定的依赖方式

### 3.2 必须脚本化，禁止手动 copy

在 `packages/callkit-uniapp-mp-weixin/package.json` 中定义：

```json
{
  "scripts": {
    "sync:core": "node scripts/sync-core.js",
    "sync:agora": "node scripts/sync-agora.js",
    "sync:all": "pnpm sync:core && pnpm sync:agora",
    "build": "pnpm sync:all"
  }
}
```

`scripts/sync-core.js` 必须完成：

1. 从 `packages/callkit-core/dist/` 复制以下文件到 `uni_modules/easemob-callkit-mp-weixin/src/vendor/`：
   - `index.js` → `callkit-core.esm.js`
   - `index.cjs` → `callkit-core.cjs.js`
   - `index.d.ts` → `callkit-core.d.ts`
2. 读取 `packages/callkit-core/package.json` 的 `version`，写入 `vendor/version.txt`
3. 不复制 `.map` 文件（减少体积）
4. 如果目标目录不存在则自动创建

`scripts/sync-agora.js` 必须完成：

1. 从 `node_modules/agora-miniapp-sdk/build/` 复制文件：
   - `agora-miniapp-sdk.js` → 插件 `static/agora-miniapp-sdk.js`（**必须放 static**，否则 HBuilderX 不会复制到小程序输出包）
   - `index.d.ts` → 插件 `src/vendor/agora-miniapp-sdk.d.ts`（仅开发期类型提示）
2. 读取 `node_modules/agora-miniapp-sdk/package.json` 的 `version`，写入 `src/vendor/agora-version.txt`
3. 不要留下 `src/vendor/agora-miniapp-sdk.js` 这个不会被复制的冗余文件

### 3.3 插件内引用方式

```ts
// uni_modules/easemob-callkit-mp-weixin/src/core-adapter.ts
import { CallKitCore } from './vendor/callkit-core.esm.js';
```

```ts
// uni_modules/easemob-callkit-mp-weixin/src/rtc/MpWeixinRtcAdapter.ts
// 声网小程序 SDK 是 UMD 包，且必须引用 static/ 下的文件才能被复制到输出包
declare const require: (path: string) => any
const AgoraMiniappSDK = require('../../static/agora-miniapp-sdk.js')
```

TypeScript 类型从同目录的 `callkit-core.d.ts` 解析；声网 SDK 运行时通过 `require` 引入并 cast 为 `any` 使用。

### 3.4 版本一致性校验

发布前必须保证：

```
packages/callkit-core/package.json.version
  ===
packages/callkit-uniapp-mp-weixin/uni_modules/easemob-callkit-mp-weixin/src/vendor/version.txt

node_modules/agora-miniapp-sdk/package.json.version
  ===
packages/callkit-uniapp-mp-weixin/uni_modules/easemob-callkit-mp-weixin/src/vendor/agora-version.txt
```

同时确认 `uni_modules/easemob-callkit-mp-weixin/static/agora-miniapp-sdk.js` 存在且大小合理（约 160 KB）。

### 3.5 用户使用方式

插件使用者（宿主 UniApp 项目）需要：

1. 引入并登录环信 IM SDK（`easemob-websdk` 小程序版本）
2. 把登录后的 `connection` 通过 `createIMConnectionAdapter` 包装
3. 将包装后的 `imClient` 传给 `createUniappMpWeixinCallKit`

```ts
import SDK from 'easemob-websdk/uniApp/Easemob-chat'
import {
  createIMConnectionAdapter,
  createUniappMpWeixinCallKit
} from '@/uni_modules/easemob-callkit-mp-weixin'

const WebIM = SDK
const conn = new WebIM.connection({
  appKey: 'your-app-key',
  url: 'wss://im-api-wechat.easemob.com/websocket',
  apiUrl: 'https://a1.easemob.com',
  useOwnUploadFun: true,
  isHttpDNS: false,
  isAutoLogin: false
})

await conn.open({ user: 'xxx', pwd: 'xxx' })

const imClient = createIMConnectionAdapter(conn)
const callKit = createUniappMpWeixinCallKit({ imClient })
```

**用户不需要**：
- 安装 `@easemob-community/callkit-core`
- 安装 `agora-miniapp-sdk`
- 手动初始化声网 client

这些都由插件内部通过 vendor / static 目录提供。

**插件不负责**：
- 创建 IM connection
- 管理 IM 登录态
- 选择 IM 数据中心

这些属于宿主项目职责，避免插件替用户做假设。

---

## 四、开发 workflow

### 4.1 初始化

1. 在 `packages/` 下新建 `callkit-uniapp-mp-weixin/`
2. 按上述目录结构创建文件
3. 运行 `pnpm sync:all`，确认产物进入：
   - `uni_modules/easemob-callkit-mp-weixin/src/vendor/`（callkit-core + 类型声明）
   - `uni_modules/easemob-callkit-mp-weixin/static/`（声网 SDK 运行时）
4. 用 HBuilderX 打开 `packages/callkit-uniapp-mp-weixin/` 整个目录
5. 在 HB 中运行到微信小程序开发者工具

### 4.2 日常开发

- 改 `callkit-core` 源码 → 先 `pnpm build:core` → 再 `pnpm sync:all` → 再在 HB 中重新编译小程序
- 升级 `agora-miniapp-sdk` → `pnpm install agora-miniapp-sdk@x.x.x` → `pnpm sync:all`
- 改插件 UI/逻辑 → 直接改 `uni_modules/easemob-callkit-mp-weixin/` 下文件 → HB 中重新编译
- 改宿主示例页面 → 改 `pages/` 下文件

### 4.3 发布 workflow

1. `pnpm build:core` 生成最新 core 产物
2. `pnpm --filter @easemob-community/callkit-uniapp-mp-weixin sync:all`
3. 校验 `version.txt` / `agora-version.txt` 与依赖版本一致
4. 在 HBuilderX 中右键 `uni_modules/easemob-callkit-mp-weixin/` → 上传插件市场

---

## 五、uni_modules 插件规范 checklist

- [ ] `uni_modules/easemob-callkit-mp-weixin/` 内**没有** `manifest.json`、`pages.json`、`App.vue`、`main.js`、`uni.scss`
- [ ] 页面在 `pages_init.json` 中声明，由宿主项目自动合并
- [ ] 组件符合 easycom 规范，命名避免冲突
- [ ] 静态资源只放在 `uni_modules/easemob-callkit-mp-weixin/static/`
- [ ] 资源引用使用相对路径
- [ ] `package.json` 中正确声明 DCloud 插件信息（id、name、version、description）
- [ ] 插件内部引用的 npm 包必须在 `package.json` 中声明依赖

---

## 六、技术约束与坑点

| 坑点 | 说明 | 对策 |
|---|---|---|
| **小程序 RTC SDK 不同** | 必须用声网小程序 SDK，不能用 `agora-rtc-sdk-ng` | 在 `src/rtc/MpWeixinRtcAdapter.ts` 中实现适配层 |
| **媒体组件是原生标签** | 小程序用 `<live-pusher>` / `<live-player>` | 封装在 `wxcomponents/` 下，不要在 Vue 模板里直接写原生语法 |
| **声网 SDK 必须放 static/** | HBuilderX 不会把 `src/vendor/` 下仅被 `require` 引用的 JS 复制到小程序包 | 同步脚本把 `agora-miniapp-sdk.js` 放到 `static/`，代码里用 `require('../../static/agora-miniapp-sdk.js')` |
| **权限申请** | 需要 `scope.record`、`scope.camera` | 在宿主项目 `App.vue` 的 `onLaunch` 中申请 |
| **后台/锁屏** | 切后台后推流/拉流会中断 | 在 `onShow` / `onHide` 中恢复/暂停 |
| **包体积限制** | 小程序对包大小敏感 | 不带 `.map`，按需引入组件，IM SDK 不打包 |
| **HB 与 pnpm** | 硬链接/符号链接可能异常 | copy core 产物，避免依赖 HB 解析 node_modules |
| **VoIP 来电唤醒** | 微信小程序音频/视频通话需要 VoIP 推送 | 不在 core 内处理，由宿主项目接入微信 VoIP 能力 |

---

## 七、与现有平台包的关系

- `packages/callkit-core/`：唯一信令核心，**所有平台共用**
- `packages/callkit-vue3/`：Web/Vue3 参考实现，UniApp 包可以参考其事件处理逻辑，但**不能引用其 store/service/component**
- `packages/callkit-uniapp-mp-weixin/`：当前 UniApp → 微信小程序实现，只依赖 core 产物，独立实现 `RtcAdapter`、状态层、UI 层
- `packages/callkit-uniapp-app/`（未来）：UniApp → App 实现，复用 `RtcAdapter` 接口定义和部分 UI 抽象，但 RTC 实现使用 UniApp 原生插件

## 八、未来扩展 App 的预留设计

当需要支持 UniApp App 时，按以下方式扩展，而不是在当前包里加 `#ifdef`：

```text
packages/
├── callkit-core/                    # 信令核心（不变）
├── callkit-vue3/                    # Web/Vue3
├── callkit-uniapp-mp-weixin/        # 微信小程序（当前）
└── callkit-uniapp-app/              # App（未来）
```

App 包应直接复用：

- `callkit-core` 信令逻辑（通过同样的 vendor copy 方式）
- `rtc/RtcAdapter.ts` 接口定义
- 平台无关的 UI 组件抽象（如果当前小程序包已经抽象得好）

App 包必须重新实现：

- `AppRtcAdapter.ts`（对接 UniApp 原生插件）
- 媒体组件（App 端不是 `live-pusher/live-player`）

---

## 九、给 AI 的极简执行口令

当用户要求"做一个 UniApp 微信小程序 CallKit"时，按以下顺序执行：

1. 阅读本文件和 `skills/callkit-core-integration.md`
2. 在 `packages/callkit-uniapp-mp-weixin/` 创建宿主项目 + `uni_modules/easemob-callkit-mp-weixin/` 插件骨架
3. 编写 `scripts/sync-core.js` 和 `scripts/sync-agora.js`，把 core 与声网 SDK 同步到插件 `vendor/`
4. 实现 `uni_modules/easemob-callkit-mp-weixin/src/im/IMConnectionAdapter.ts`（只包装，不创建 connection）
5. 实现 `uni_modules/easemob-callkit-mp-weixin/src/rtc/RtcAdapter.ts` 接口
6. 实现 `uni_modules/easemob-callkit-mp-weixin/src/rtc/MpWeixinRtcAdapter.ts`
7. 实现 `uni_modules/easemob-callkit-mp-weixin/src/core-adapter.ts` 封装 `CallKitCore`
8. 编写最小可运行 Demo 页面，验证 HBuilderX 能编译到微信小程序
9. 最后再补充单聊/群聊 UI 组件
