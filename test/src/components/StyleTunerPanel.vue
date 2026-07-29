<template>
  <!-- 浮动入口按钮 -->
  <button class="tuner-fab" @click="visible = !visible" :title="visible ? '收起样式调试' : '样式调试'">
    🎨
  </button>

  <!-- 调试面板 -->
  <div v-if="visible" class="tuner-panel">
    <div class="tuner-header">
      <h3>CallKit 样式调试</h3>
      <button class="tuner-close" @click="visible = false">✕</button>
    </div>

    <!-- 实时预览（模拟主叫等待场景的昵称/头像） -->
    <div class="tuner-preview">
      <div class="preview-avatar">
        <div class="preview-avatar-fallback">{{ previewInitial }}</div>
      </div>
      <p class="preview-name">{{ previewName }}</p>
      <p class="preview-status">正在呼叫…</p>
      <div class="preview-placeholder">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    </div>

    <div class="tuner-controls">
      <div class="control-row">
        <label>昵称颜色</label>
        <input type="color" v-model="userNameColor" @input="apply('userNameColor')" />
        <button class="row-reset" @click="resetOne('userNameColor')">↺</button>
      </div>
      <div class="control-row">
        <label>昵称字号 {{ userNameSize }}px</label>
        <input type="range" min="12" max="40" v-model.number="userNameSize" @input="apply('userNameSize')" />
        <button class="row-reset" @click="resetOne('userNameSize')">↺</button>
      </div>
      <div class="control-row">
        <label>辅助文字颜色</label>
        <input type="color" v-model="statusTextColor" @input="apply('statusTextColor')" />
        <button class="row-reset" @click="resetOne('statusTextColor')">↺</button>
      </div>
      <div class="control-row">
        <label>头像圆角 {{ avatarRadius }}%</label>
        <input type="range" min="0" max="50" v-model.number="avatarRadius" @input="apply('avatarRadius')" />
        <button class="row-reset" @click="resetOne('avatarRadius')">↺</button>
      </div>
      <div class="control-row">
        <label>兜底渐变起</label>
        <input type="color" v-model="fallbackBgFrom" @input="apply('fallbackBgFrom')" />
        <button class="row-reset" @click="resetOne('fallbackBgFrom')">↺</button>
      </div>
      <div class="control-row">
        <label>兜底渐变止</label>
        <input type="color" v-model="fallbackBgTo" @input="apply('fallbackBgTo')" />
        <button class="row-reset" @click="resetOne('fallbackBgTo')">↺</button>
      </div>
      <div class="control-row">
        <label>兜底文字颜色</label>
        <input type="color" v-model="fallbackColor" @input="apply('fallbackColor')" />
        <button class="row-reset" @click="resetOne('fallbackColor')">↺</button>
      </div>
      <div class="control-row">
        <label>占位圆圈背景</label>
        <input type="color" v-model="placeholderBg" @input="apply('placeholderBg')" />
        <input type="range" min="0" max="100" v-model.number="placeholderBgAlpha" @input="apply('placeholderBg')" class="alpha-slider" :title="'不透明度 ' + placeholderBgAlpha + '%'" />
        <button class="row-reset" @click="resetOne('placeholderBg')">↺</button>
      </div>
      <div class="control-row">
        <label>占位圆圈边框</label>
        <input type="color" v-model="placeholderBorder" @input="apply('placeholderBorder')" />
        <input type="range" min="0" max="100" v-model.number="placeholderBorderAlpha" @input="apply('placeholderBorder')" class="alpha-slider" :title="'不透明度 ' + placeholderBorderAlpha + '%'" />
        <button class="row-reset" @click="resetOne('placeholderBorder')">↺</button>
      </div>
      <div class="control-row">
        <label>占位图标颜色</label>
        <input type="color" v-model="iconColor" @input="apply('iconColor')" />
        <input type="range" min="0" max="100" v-model.number="iconColorAlpha" @input="apply('iconColor')" class="alpha-slider" :title="'不透明度 ' + iconColorAlpha + '%'" />
        <button class="row-reset" @click="resetOne('iconColor')">↺</button>
      </div>
    </div>

    <div class="tuner-footer">
      <button class="tuner-btn reset-all" @click="resetAll">全部重置</button>
      <button class="tuner-btn copy-css" @click="copyCss">{{ copied ? '已复制 ✓' : '复制 CSS' }}</button>
    </div>
    <p class="tuner-tip">变量实时写入 :root 并持久化到 localStorage；发起通话即可在真实界面看到效果。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const visible = ref(false)
const copied = ref(false)
const previewName = ref('测试用户')
const previewInitial = computed(() => previewName.value[0] || '?')

const STORAGE_KEY = 'callkit-style-tuner'

// 每个控件：字段名 → CSS 变量名 + 序列化方式
// alpha 字段与主色字段配对（alpha 后缀 Alpha）
const VAR_MAP: Record<string, string> = {
  userNameColor: '--callkit-user-name-color',
  userNameSize: '--callkit-user-name-size',
  statusTextColor: '--callkit-status-text-color',
  avatarRadius: '--callkit-avatar-radius',
  fallbackBgFrom: '--callkit-avatar-fallback-bg',
  fallbackBgTo: '--callkit-avatar-fallback-bg',
  fallbackColor: '--callkit-avatar-fallback-color',
  placeholderBg: '--callkit-avatar-placeholder-bg',
  placeholderBorder: '--callkit-avatar-placeholder-border-color',
  iconColor: '--callkit-avatar-icon-color'
}

// 控件默认值（与 lib 内 fallback 一致）
const DEFAULTS = {
  userNameColor: '#ffffff',
  userNameSize: 32,
  statusTextColor: '#ffffff',
  avatarRadius: 50,
  fallbackBgFrom: '#667eea',
  fallbackBgTo: '#764ba2',
  fallbackColor: '#ffffff',
  placeholderBg: '#ffffff',
  placeholderBgAlpha: 15,
  placeholderBorder: '#ffffff',
  placeholderBorderAlpha: 20,
  iconColor: '#ffffff',
  iconColorAlpha: 60
}

const userNameColor = ref(DEFAULTS.userNameColor)
const userNameSize = ref(DEFAULTS.userNameSize)
const statusTextColor = ref(DEFAULTS.statusTextColor)
const avatarRadius = ref(DEFAULTS.avatarRadius)
const fallbackBgFrom = ref(DEFAULTS.fallbackBgFrom)
const fallbackBgTo = ref(DEFAULTS.fallbackBgTo)
const fallbackColor = ref(DEFAULTS.fallbackColor)
const placeholderBg = ref(DEFAULTS.placeholderBg)
const placeholderBgAlpha = ref(DEFAULTS.placeholderBgAlpha)
const placeholderBorder = ref(DEFAULTS.placeholderBorder)
const placeholderBorderAlpha = ref(DEFAULTS.placeholderBorderAlpha)
const iconColor = ref(DEFAULTS.iconColor)
const iconColorAlpha = ref(DEFAULTS.iconColorAlpha)

const fieldRefs: Record<string, { value: unknown }> = {
  userNameColor, userNameSize, statusTextColor, avatarRadius,
  fallbackBgFrom, fallbackBgTo, fallbackColor,
  placeholderBg, placeholderBgAlpha, placeholderBorder, placeholderBorderAlpha,
  iconColor, iconColorAlpha
}

// 记录哪些变量被用户改过（未改的不写入 :root，保持跟随 lib 默认值）
const dirtyFields = ref<Set<string>>(new Set())

function hexToRgba(hex: string, alphaPercent: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${(alphaPercent / 100).toFixed(2)})`
}

function computeVarValue(field: string): string {
  switch (field) {
    case 'userNameSize':
      return `${userNameSize.value}px`
    case 'avatarRadius':
      return `${avatarRadius.value}%`
    case 'fallbackBgFrom':
    case 'fallbackBgTo':
      return `linear-gradient(135deg, ${fallbackBgFrom.value} 0%, ${fallbackBgTo.value} 100%)`
    case 'placeholderBg':
      return hexToRgba(placeholderBg.value, placeholderBgAlpha.value)
    case 'placeholderBorder':
      return hexToRgba(placeholderBorder.value, placeholderBorderAlpha.value)
    case 'iconColor':
      return hexToRgba(iconColor.value, iconColorAlpha.value)
    default:
      return String(fieldRefs[field].value)
  }
}

function writeVar(field: string) {
  document.documentElement.style.setProperty(VAR_MAP[field], computeVarValue(field))
}

function apply(field: string) {
  dirtyFields.value.add(field)
  // 渐变是两个字段共用同一个变量，任一改即标记两个
  if (field === 'fallbackBgFrom' || field === 'fallbackBgTo') {
    dirtyFields.value.add('fallbackBgFrom').add('fallbackBgTo')
  }
  writeVar(field)
  persist()
}

function resetOne(field: string) {
  const varName = VAR_MAP[field]
  document.documentElement.style.removeProperty(varName)
  dirtyFields.value.delete(field)
  if (field === 'fallbackBgFrom' || field === 'fallbackBgTo') {
    dirtyFields.value.delete('fallbackBgFrom')
    dirtyFields.value.delete('fallbackBgTo')
    fallbackBgFrom.value = DEFAULTS.fallbackBgFrom
    fallbackBgTo.value = DEFAULTS.fallbackBgTo
  } else {
    fieldRefs[field].value = DEFAULTS[field as keyof typeof DEFAULTS]
  }
  persist()
}

function resetAll() {
  Object.values(VAR_MAP).forEach(v => document.documentElement.style.removeProperty(v))
  dirtyFields.value.clear()
  Object.entries(DEFAULTS).forEach(([k, v]) => { fieldRefs[k].value = v })
  localStorage.removeItem(STORAGE_KEY)
}

function persist() {
  const data: Record<string, unknown> = {}
  dirtyFields.value.forEach(f => { data[f] = fieldRefs[f].value })
  // 带 alpha 的字段需要一起存
  if (dirtyFields.value.has('placeholderBg')) data.placeholderBgAlpha = placeholderBgAlpha.value
  if (dirtyFields.value.has('placeholderBorder')) data.placeholderBorderAlpha = placeholderBorderAlpha.value
  if (dirtyFields.value.has('iconColor')) data.iconColorAlpha = iconColorAlpha.value
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as Record<string, unknown>
    Object.entries(data).forEach(([k, v]) => {
      if (fieldRefs[k]) {
        fieldRefs[k].value = v
        dirtyFields.value.add(k)
      }
    })
    dirtyFields.value.forEach(f => writeVar(f))
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

function copyCss() {
  const lines: string[] = [':root {']
  const written = new Set<string>()
  dirtyFields.value.forEach(f => {
    const varName = VAR_MAP[f]
    if (!written.has(varName)) {
      written.add(varName)
      lines.push(`  ${varName}: ${computeVarValue(f)};`)
    }
  })
  lines.push('}')
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}

onMounted(restore)
</script>

<style scoped>
.tuner-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 10000;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: #1a1a2e;
  color: #fff;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.tuner-panel {
  position: fixed;
  right: 20px;
  bottom: 80px;
  z-index: 10000;
  width: 300px;
  max-height: 70vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  padding: 16px;
  font-size: 13px;
  color: #333;
}

.tuner-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.tuner-header h3 {
  margin: 0;
  font-size: 15px;
}

.tuner-close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: #999;
}

/* 预览区：模拟 lib 内主叫等待界面，使用同一组 CSS 变量 */
.tuner-preview {
  background: #1a1a1a;
  border-radius: 8px;
  padding: 20px 12px;
  text-align: center;
  color: #fff;
  margin-bottom: 14px;
}

.preview-avatar {
  width: 72px;
  height: 72px;
  margin: 0 auto 10px;
  border-radius: var(--callkit-avatar-radius, 50%);
  overflow: hidden;
}

.preview-avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 600;
  color: var(--callkit-avatar-fallback-color, rgba(255, 255, 255, 0.8));
  background: var(--callkit-avatar-fallback-bg, linear-gradient(135deg, #667eea 0%, #764ba2 100%));
}

.preview-name {
  margin: 0 0 4px;
  font-weight: bold;
  font-size: var(--callkit-user-name-size, 20px);
  color: var(--callkit-user-name-color, inherit);
  max-height: 48px;
  overflow: hidden;
}

.preview-status {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--callkit-status-text-color, rgba(255, 255, 255, 0.7));
}

.preview-placeholder {
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: var(--callkit-avatar-radius, 50%);
  background: var(--callkit-avatar-placeholder-bg, rgba(255, 255, 255, 0.15));
  border: 2px solid var(--callkit-avatar-placeholder-border-color, rgba(255, 255, 255, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-icon {
  width: 28px;
  height: 28px;
  color: var(--callkit-avatar-icon-color, rgba(255, 255, 255, 0.6));
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.control-row label {
  flex: 1;
  min-width: 0;
}

.control-row input[type='color'] {
  width: 32px;
  height: 24px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}

.control-row input[type='range'] {
  width: 90px;
  flex-shrink: 0;
}

.control-row .alpha-slider {
  width: 48px;
}

.row-reset {
  border: none;
  background: none;
  cursor: pointer;
  color: #bbb;
  font-size: 13px;
  flex-shrink: 0;
  padding: 2px;
}

.row-reset:hover {
  color: #666;
}

.tuner-footer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.tuner-btn {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.reset-all {
  background: #f3f4f6;
  color: #666;
}

.copy-css {
  background: #1a1a2e;
  color: #fff;
}

.tuner-tip {
  margin: 10px 0 0;
  font-size: 11px;
  color: #999;
  line-height: 1.5;
}
</style>
