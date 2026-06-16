# CallKit 静态资源配置指南

## 📦 资源管理方式

CallKit 默认使用**本地静态资源路径**，资源需要放在项目的 `public/callkit-static-assets/` 目录下。

---

## 🚀 快速开始

### 步骤 1：复制静态资源

将 CallKit 的静态资源复制到你的项目 `public` 目录：

```bash
# 从你的 node_modules 复制（如果使用 npm/pnpm）
cp -r node_modules/@easemob-community/callkit-vue3/lib/callkit-static-assets ./public/

# 或者从源码复制（开发时）
cp -r /path/to/easemob-uikit-callkit/lib/callkit-static-assets ./public/
```

项目结构示例：
```
your-project/
├── public/
│   └── callkit-static-assets/
│       ├── icons/              # SVG 图标
│       │   ├── mic_on.svg
│       │   ├── mic_slash.svg
│       │   └── ...
│       └── images/
│           └── callkit_bg.png  # 默认背景图
├── src/
└── package.json
```

### 步骤 2：使用组件

```vue
<template>
  <!-- 单人通话 -->
  <EasemobChatSingleCall :target-user="userId" type="video" />
  
  <!-- 多人通话 -->
  <EasemobChatMultiCall type="video" />
</template>
```

无需额外配置，组件会自动使用 `/callkit-static-assets/` 路径加载资源。

---

## 🎨 自定义背景图

### 方式 1：替换默认背景图

直接替换 `public/callkit-static-assets/images/callkit_bg.png` 文件。

### 方式 2：Props 传入自定义 URL

```vue
<template>
  <EasemobChatSingleCall 
    :target-user="userId" 
    type="video"
    background-image="/my-custom-bg.jpg"
  />
</template>
```

### 方式 3：使用在线图片

```vue
<template>
  <EasemobChatSingleCall 
    :target-user="userId" 
    type="video"
    background-image="https://example.com/my-bg.jpg"
  />
</template>
```

---

## ⚙️ 高级配置

### 使用 CDN 加速

如果需要使用 CDN，修改 `lib/config/assets.ts`：

```typescript
// CDN 基础路径（可选，用于自定义 CDN）
const CDN_BASE_URL = 'https://your-cdn.com/callkit-static-assets';
```

或者通过构建时注入环境变量（需要修改代码支持）。

### 使用导出的资源常量

```vue
<script setup>
import { 
  EasemobChatSingleCall, 
  ICONS, 
  DEFAULT_BACKGROUND_IMAGE 
} from '@easemob-community/callkit-vue3'

// 查看默认背景图路径
console.log(DEFAULT_BACKGROUND_IMAGE)
// "/callkit-static-assets/images/callkit_bg.png"

// 查看图标路径
console.log(ICONS.MIC_ON)
// "/callkit-static-assets/icons/mic_on.svg"
</script>
```

---

## 📁 资源清单

### 必需资源

| 资源 | 路径 | 说明 |
|-----|------|------|
| `callkit_bg.png` | `/callkit-static-assets/images/callkit_bg.png` | 通话界面背景图 |

### 可选图标（自动加载）

| 图标常量 | 文件名 | 说明 |
|---------|-------|------|
| `ICONS.MIC_ON` | `mic_on.svg` | 麦克风开启 |
| `ICONS.MIC_OFF` | `mic_slash.svg` | 麦克风关闭 |
| `ICONS.CAMERA_ON` | `video_camera.svg` | 摄像头开启 |
| `ICONS.CAMERA_OFF` | `video_camera_slash.svg` | 摄像头关闭 |
| `ICONS.SPEAKER_ON` | `speaker_wave_2.svg` | 扬声器开启 |
| `ICONS.SPEAKER_OFF` | `speaker_xmark.svg` | 扬声器关闭 |
| `ICONS.PHONE_HANG` | `phone_hang.svg` | 挂断电话 |
| `ICONS.PHONE_PICK` | `phone_pick.svg` | 接听电话 |
| `ICONS.DEFAULT_AVATAR` | `default_avatar.png` | 默认头像 |

---

## 🔧 故障排查

### 背景图不显示

1. 检查资源是否存在：
```bash
ls public/callkit-static-assets/images/callkit_bg.png
```

2. 检查浏览器网络请求：
   - 打开浏览器 DevTools → Network
   - 过滤 `callkit_bg.png`
   - 查看请求是否 200

3. 检查路径是否正确：
```vue
<script setup>
import { DEFAULT_BACKGROUND_IMAGE } from '@easemob-community/callkit-vue3'
console.log('背景图路径:', DEFAULT_BACKGROUND_IMAGE)
// 应该输出: /callkit-static-assets/images/callkit_bg.png
</script>
```

### 图标不显示

```vue
<script setup>
import { ICONS, checkAssetAvailable } from '@easemob-community/callkit-vue3'

// 检查图标是否可访问
async function checkIcons() {
  const isAvailable = await checkAssetAvailable(ICONS.MIC_ON)
  console.log('麦克风图标可用:', isAvailable)
}

checkIcons()
</script>
```

---

## 📦 资源体积

| 资源类型 | 大小 | 说明 |
|---------|------|------|
| 背景图 | ~72KB | PNG 格式 |
| 全部 SVG 图标 | ~20KB | 按需加载 |
| 总计 | ~100KB | 首次加载 |

---

## 💡 最佳实践

1. **生产环境**：建议将资源部署到 CDN，修改 `CDN_BASE_URL`
2. **开发环境**：使用本地资源即可
3. **自定义主题**：替换 `callkit_bg.png` 或传入自定义 `background-image`
