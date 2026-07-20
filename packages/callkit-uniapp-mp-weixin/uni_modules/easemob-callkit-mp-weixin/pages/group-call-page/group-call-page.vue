<template>
  <view class="group-call-page">
    <view class="call-bg" />

    <!-- 待接听界面 -->
    <view v-if="showRingingUI" class="ringing-ui">
      <view class="ringing-content">
        <view class="ringing-avatar">
          <image v-if="callerInfo.avatarURL" class="ringing-avatar-img" :src="callerInfo.avatarURL" mode="aspectFill" />
          <view v-else class="ringing-avatar-fallback">{{ callerName.charAt(0).toUpperCase() }}</view>
        </view>
        <view class="ringing-info">
          <text class="ringing-title">{{ callerName }} 邀请你加入</text>
          <text class="ringing-group-name">{{ groupState.session?.groupName || '群聊' }}</text>
          <text class="ringing-type">{{ isVideoCall ? '群视频通话' : '群语音通话' }}</text>
          <text class="ringing-members">{{ invitedMemberNames }}</text>
        </view>
      </view>

      <view class="ringing-actions">
        <view class="ringing-btn reject" @click="rejectCall">
          <view class="ringing-btn-circle">
            <image class="ringing-btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
          </view>
          <text class="ringing-btn-label">拒绝</text>
        </view>
        <view class="ringing-btn accept" @click="acceptCall">
          <view class="ringing-btn-circle">
            <image class="ringing-btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_pick.svg" />
          </view>
          <text class="ringing-btn-label">接听</text>
        </view>
      </view>
    </view>

    <!-- 通话界面 -->
    <template v-else>
      <!-- 网络状态提示 -->
      <view v-if="networkStatus.show" class="network-toast" :class="networkStatus.type" :style="{ top: `${topSafeArea}px` }">
        <text class="network-toast-text">{{ networkStatus.message }}</text>
      </view>

      <!-- 顶部信息栏 -->
      <view class="top-bar" :style="{ paddingTop: `${topSafeArea + 8}px` }">
        <text class="group-name">{{ groupState.session?.groupName || '群聊' }}</text>
        <text class="call-status-line">{{ formattedDuration }} · {{ activeCount }}人通话中<template v-if="pendingCount > 0">，等待 {{ pendingCount }} 人加入</template></text>
      </view>

      <!-- ============ 视频模式：自适应网格 ============ -->
      <block v-if="isVideoCall">
        <view class="grid-area" :style="gridAreaStyle">
          <!-- 远端可见播放器（前 MAX_VISIBLE_PLAYERS 路有流成员） -->
          <agora-player
            v-for="t in visiblePlayerTiles"
            :key="`player-${t.userId}`"
            :url="t.streamUrl"
            :uid="t.userId"
            :name="t.displayName"
            :x="t.rect.x"
            :y="t.rect.y"
            :width="t.rect.w"
            :height="t.rect.h"
            :debug="false"
            :logger="logger"
            @netstatus="onRemoteNetStatus"
            @statechange="onRemoteStateChange"
          />
          <!-- 超出可见路数的远端：1px 隐藏 player 保活音频 -->
          <agora-player
            v-for="t in hiddenPlayerTiles"
            :key="`player-hidden-${t.userId}`"
            class="audio-only-player"
            :url="t.streamUrl"
            :uid="t.userId"
            :x="0"
            :y="0"
            :width="1"
            :height="1"
            :debug="false"
            :logger="logger"
          />
          <!-- 本地 pusher：绑定本地瓦片位置 -->
          <agora-pusher
            v-if="callState.localStreamUrl && localTileRect"
            ref="localPusherRef"
            :url="callState.localStreamUrl"
            :x="localTileRect.x"
            :y="localTileRect.y"
            :width="localTileRect.w"
            :height="localTileRect.h"
            :muted="!callState.audioEnabled"
            :enable-camera="callState.videoEnabled"
            aspect="3:4"
            :debug="false"
            :logger="logger"
            @netstatus="onLocalNetStatus"
            @statechange="onLocalStateChange"
          />

          <!-- 瓦片覆盖层：占位头像 / 名称 / 状态 -->
          <view
            v-for="t in gridTiles"
            :key="`overlay-${t.userId}`"
            class="tile-overlay"
            :style="rectStyle(t.rect)"
          >
            <!-- 等待加入 / 无画面占位 -->
            <view v-if="t.showPlaceholder" class="tile-placeholder">
              <image v-if="t.avatarURL" class="tile-avatar" :src="t.avatarURL" mode="aspectFill" />
              <view v-else class="tile-avatar-fallback">{{ t.displayName.charAt(0).toUpperCase() }}</view>
              <text v-if="t.pending" class="tile-pending-text">等待加入…</text>
            </view>
            <!-- 名称条 -->
            <view class="tile-name-bar">
              <image
                v-if="t.isLocal && !callState.audioEnabled"
                class="tile-mute-icon"
                src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_slash.svg"
              />
              <text class="tile-name">{{ t.isLocal ? `${t.displayName}(我)` : t.displayName }}</text>
            </view>
          </view>

          <!-- 仅自己在线时的等待提示 -->
          <view v-if="activeCount <= 1" class="waiting-hint">
            <text class="waiting-hint-text">正在等待成员加入…</text>
          </view>
        </view>
      </block>

      <!-- ============ 音频模式：头像网格 ============ -->
      <block v-else>
        <!-- 远端音频保活 player（隐藏） -->
        <agora-player
          v-for="t in audioStreamTiles"
          :key="`audio-player-${t.userId}`"
          class="audio-only-player"
          :url="t.streamUrl"
          :uid="t.userId"
          :x="0"
          :y="0"
          :width="1"
          :height="1"
          :debug="false"
          :logger="logger"
        />
        <!-- 本地推流保活（隐藏，关摄像头只推音频） -->
        <agora-pusher
          v-if="callState.localStreamUrl"
          ref="localPusherRef"
          class="audio-only-pusher"
          :url="callState.localStreamUrl"
          :x="0"
          :y="0"
          :width="1"
          :height="1"
          :muted="!callState.audioEnabled"
          :enable-camera="false"
          :debug="false"
          :logger="logger"
          @netstatus="onLocalNetStatus"
          @statechange="onLocalStateChange"
        />

        <scroll-view class="audio-grid" scroll-y :style="audioGridStyle">
          <view class="audio-grid-inner">
            <view
              v-for="t in audioTiles"
              :key="`audio-${t.userId}`"
              class="audio-tile"
              :class="{ pending: t.pending }"
            >
              <view class="audio-avatar-wrap">
                <image v-if="t.avatarURL" class="audio-avatar" :src="t.avatarURL" mode="aspectFill" />
                <view v-else class="audio-avatar-fallback">{{ t.displayName.charAt(0).toUpperCase() }}</view>
                <view v-if="t.isLocal && !callState.audioEnabled" class="audio-mute-badge">
                  <image class="mute-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_slash.svg" />
                </view>
              </view>
              <text class="audio-name">{{ t.isLocal ? `${t.displayName}(我)` : t.displayName }}</text>
              <text v-if="t.pending" class="audio-pending-text">等待加入…</text>
            </view>
          </view>
        </scroll-view>
      </block>

      <!-- 底部控制栏 -->
      <view class="call-controls-mask" />
      <view class="call-controls" :style="{ paddingBottom: `${bottomSafeArea + 30}rpx` }">
        <view class="control-item" @click="openInvitePanel">
          <view class="control-btn">
            <image
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/person_add.svg"
            />
          </view>
          <text class="btn-label">邀请</text>
        </view>

        <view class="control-item" @click="toggleAudio">
          <view class="control-btn" :class="{ active: !callState.audioEnabled }">
            <image
              v-if="callState.audioEnabled"
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_on.svg"
            />
            <image
              v-else
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_slash.svg"
            />
          </view>
          <text class="btn-label">{{ callState.audioEnabled ? '静音' : '取消静音' }}</text>
        </view>

        <view v-if="isVideoCall" class="control-item" @click="toggleVideo">
          <view class="control-btn" :class="{ active: !callState.videoEnabled }">
            <image
              v-if="callState.videoEnabled"
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/video_camera.svg"
            />
            <image
              v-else
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/video_camera_slash.svg"
            />
          </view>
          <text class="btn-label">{{ callState.videoEnabled ? '关闭摄像头' : '打开摄像头' }}</text>
        </view>

        <view v-if="isVideoCall" class="control-item" @click="switchCamera">
          <view class="control-btn">
            <image
              class="btn-icon"
              src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/camera_fill_arrows.svg"
            />
          </view>
          <text class="btn-label">切换摄像头</text>
        </view>

        <view class="control-item" @click="hangup">
          <view class="control-btn danger">
            <image class="btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
          </view>
          <text class="btn-label">挂断</text>
        </view>
      </view>

      <!-- 邀请成员：底部半屏面板 -->
      <view v-if="invitePanel.show" class="invite-mask" @click="closeInvitePanel">
        <view class="invite-panel" :style="{ paddingBottom: `${bottomSafeArea}px` }" @click.stop>
          <view class="invite-header">
            <text class="invite-title">邀请成员</text>
            <text class="invite-cancel" @click="closeInvitePanel">取消</text>
          </view>

          <scroll-view class="invite-list" scroll-y>
            <view v-if="invitePanel.loading" class="invite-empty">
              <text class="invite-empty-text">加载中…</text>
            </view>
            <view v-else-if="invitePanel.members.length === 0" class="invite-empty">
              <text class="invite-empty-text">暂无可邀请成员</text>
            </view>
            <view v-else class="invite-cells">
              <view
                v-for="m in invitePanel.members"
                :key="m.userId"
                class="invite-cell"
                :class="{ disabled: m.inCall }"
                @click="toggleInviteMember(m)"
              >
                <image v-if="m.avatarURL" class="invite-cell-avatar" :src="m.avatarURL" mode="aspectFill" />
                <view v-else class="invite-cell-avatar-fallback">{{ m.displayName.charAt(0).toUpperCase() }}</view>
                <text class="invite-cell-name">{{ m.displayName }}</text>
                <view v-if="m.inCall" class="invite-cell-status">
                  <text class="invite-cell-status-text">已加入</text>
                </view>
                <view v-else class="invite-cell-check" :class="{ checked: m.selected }">
                  <text v-if="m.selected" class="invite-cell-check-mark">✓</text>
                </view>
              </view>
            </view>
          </scroll-view>

          <view class="invite-footer">
            <view
              class="invite-confirm"
              :class="{ disabled: selectedInviteCount === 0 }"
              @click="confirmInvite"
            >
              <text class="invite-confirm-text">邀请{{ selectedInviteCount > 0 ? `（${selectedInviteCount}）` : '' }}</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { onLoad, onUnload, onShow, onHide } from '@dcloudio/uni-app'
import { useCallState, useGroupCallState } from '@/uni_modules/easemob-callkit-mp-weixin'
import { getMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin/src/utils/logger'

const logger = getMpWeixinLogger()
const { state: callState } = useCallState()
const { state: groupState } = useGroupCallState()

const localPusherRef = ref(null)

/** 可见远端视频流上限（live-player 并发建议 ≤4） */
const MAX_VISIBLE_PLAYERS = 4
/** 网格最多展示的瓦片数 */
const MAX_TILES = 9

// 屏幕尺寸与安全区
const screenWidth = ref(375)
const screenHeight = ref(667)
const topSafeArea = ref(0)
const bottomSafeArea = ref(0)
/** 底部控制栏预留高度（px） */
const controlsReserve = ref(130)

function initSafeArea() {
  try {
    const sysInfo = uni.getSystemInfoSync()
    screenWidth.value = sysInfo.windowWidth || 375
    screenHeight.value = sysInfo.windowHeight || 667
    bottomSafeArea.value = sysInfo.safeAreaInsets?.bottom || 0
    const menu = uni.getMenuButtonBoundingClientRect?.()
    topSafeArea.value = menu?.bottom || sysInfo.statusBarHeight || 0
  } catch (e) {
    logger.warn('[group-call-page] initSafeArea failed', e)
  }
}

// ============ 网络状态提示 ============
const networkStatus = ref({
  show: false,
  type: 'warning',
  message: ''
})
let networkHideTimer = null

function showNetworkToast(type, message, duration = 3000) {
  networkStatus.value = { show: true, type, message }
  if (networkHideTimer) {
    clearTimeout(networkHideTimer)
    networkHideTimer = null
  }
  networkHideTimer = setTimeout(() => {
    networkStatus.value.show = false
  }, duration)
}

function hideNetworkToast() {
  networkStatus.value.show = false
  if (networkHideTimer) {
    clearTimeout(networkHideTimer)
    networkHideTimer = null
  }
}

function parseNetQuality(detail) {
  const quality = Number(detail?.netQuality ?? 0)
  return Number.isNaN(quality) ? 0 : quality
}

function onLocalNetStatus(e) {
  const quality = parseNetQuality(e?.detail)
  if (quality >= 6) {
    showNetworkToast('danger', '网络异常，请检查网络连接', 5000)
  } else if (quality >= 4) {
    showNetworkToast('warning', '当前网络较差，可能影响通话质量')
  } else if (quality > 0 && quality <= 2) {
    if (networkStatus.value.type !== 'danger') {
      hideNetworkToast()
    }
  }
}

function onRemoteNetStatus(e) {
  const quality = parseNetQuality(e?.detail)
  if (quality >= 6) {
    showNetworkToast('danger', '对方网络异常', 5000)
  } else if (quality >= 4) {
    showNetworkToast('warning', '对方网络较差')
  } else if (quality > 0 && quality <= 2) {
    if (networkStatus.value.type !== 'danger') {
      hideNetworkToast()
    }
  }
}

function onLocalStateChange(e) {
  const code = e?.detail?.code
  if (code === -1307 || code === 1007) {
    showNetworkToast('danger', '本地推流失败，请检查网络', 5000)
  } else if (code === -1301 || code === -1302) {
    showNetworkToast('danger', '摄像头/麦克风启动失败', 5000)
  }
}

function onRemoteStateChange(e) {
  const code = e?.detail?.code
  if (code === -2301 || code === 2003) {
    showNetworkToast('danger', '远端连接断开，正在尝试恢复', 5000)
  }
}

// ============ 基础计算属性 ============
const showRingingUI = computed(() => groupState.callStatus === 'ringing')
const isVideoCall = computed(() => groupState.session?.callType === 'video')

const callerInfo = computed(() => {
  const callerId = groupState.session?.callerUserId || ''
  return callState.userInfoMap[callerId] || { nickname: callerId, avatarURL: '' }
})

const callerName = computed(() => callerInfo.value.nickname || '未知用户')

const invitedMemberNames = computed(() => {
  return groupState.invitedParticipants
    .filter((p) => !p.isLocal)
    .map((p) => resolveDisplayName(p.userId, p.nickname))
    .join('、')
})

const formattedDuration = computed(() => {
  const m = Math.floor(callState.duration / 60).toString().padStart(2, '0')
  const s = (callState.duration % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

/** 昵称解析优先级：userInfoMap > participant.nickname > userId */
function resolveDisplayName(userId, fallback) {
  return callState.userInfoMap[userId]?.nickname || fallback || userId
}

// ============ 瓦片模型 ============
/**
 * 统一构建本地 + 远端瓦片：
 * - 本地瓦片始终存在（即使 core 未把本人计入 participants）
 * - 远端过滤已离开成员，最多保留 MAX_TILES - 1 个
 */
const allTiles = computed(() => {
  const tiles = []
  const localUserId = callState.localUserId

  // 本地瓦片
  const localParticipant = groupState.participants.find((p) => p.isLocal)
  const localName = resolveDisplayName(localUserId, localParticipant?.nickname) || '我'
  tiles.push({
    userId: localUserId || '__local__',
    isLocal: true,
    displayName: localName,
    avatarURL: callState.userInfoMap[localUserId]?.avatarURL || localParticipant?.avatarURL || '',
    streamUrl: callState.localStreamUrl,
    pending: false,
    cameraOn: callState.videoEnabled
  })

  // 远端瓦片（未离开）
  const remotes = groupState.participants.filter((p) => !p.isLocal && p.state !== 'left')
  for (const p of remotes) {
    tiles.push({
      userId: p.userId,
      isLocal: false,
      displayName: resolveDisplayName(p.userId, p.nickname),
      avatarURL: callState.userInfoMap[p.userId]?.avatarURL || p.avatarURL || '',
      streamUrl: p.streamUrl,
      // 已接受或已入 RTC 但尚无流：视为等待中
      pending: !p.streamUrl,
      cameraOn: true // 远端摄像头状态信令暂未透传，有流即渲染画面
    })
  }

  return tiles.slice(0, MAX_TILES)
})

const activeCount = computed(() => allTiles.value.filter((t) => !t.pending).length)
const pendingCount = computed(() => allTiles.value.filter((t) => t.pending).length)

// ============ 视频网格布局 ============
const gridAreaStyle = computed(() => {
  const top = topSafeArea.value + 76 // 顶部信息栏之下
  const bottom = screenHeight.value - bottomSafeArea.value - controlsReserve.value
  return {
    top: `${top}px`,
    height: `${Math.max(bottom - top, 200)}px`
  }
})

const gridRect = computed(() => {
  // 瓦片坐标相对 .grid-area 容器（容器本身已通过 top/height 定位，不可重复加偏移）
  const top = topSafeArea.value + 76
  const bottom = screenHeight.value - bottomSafeArea.value - controlsReserve.value
  return {
    x: 0,
    y: 0,
    w: screenWidth.value,
    h: Math.max(bottom - top, 200)
  }
})

/**
 * 自适应网格：
 * - 1 人：全屏
 * - 2 人：上下两栏（竖屏视频裁切最少）
 * - 3 人：上一大 + 下两小
 * - 4 人：2×2；5~6 人：2列×3行；7~9 人：3×3（末行居中）
 */
function computeGrid(n, area) {
  const gap = 2
  const { w: W, h: H } = area
  const rects = []
  if (n <= 0) return rects
  if (n === 1) {
    rects.push({ x: 0, y: 0, w: W, h: H })
  } else if (n === 3) {
    const topH = Math.floor(H / 2)
    const cw = Math.floor(W / 2)
    rects.push({ x: 0, y: 0, w: W, h: topH })
    rects.push({ x: 0, y: topH, w: cw, h: H - topH })
    rects.push({ x: cw, y: topH, w: W - cw, h: H - topH })
  } else {
    const cols = n === 2 ? 1 : n <= 6 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const cw = Math.floor(W / cols)
    const ch = Math.floor(H / rows)
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const isLastRow = r === rows - 1
      const lastRowCount = n - r * cols
      const offsetX = isLastRow ? Math.floor(((cols - lastRowCount) * cw) / 2) : 0
      rects.push({
        x: c * cw + offsetX,
        y: r * ch,
        w: c === cols - 1 ? W - c * cw : cw,
        h: r === rows - 1 ? H - r * ch : ch
      })
    }
  }
  // 应用间隙并取整（原生组件需要整数 px）
  return rects.map((r) => ({
    x: Math.floor(area.x + r.x + gap),
    y: Math.floor(area.y + r.y + gap),
    w: Math.max(Math.floor(r.w - gap * 2), 1),
    h: Math.max(Math.floor(r.h - gap * 2), 1)
  }))
}

/** 带位置信息的网格瓦片 */
const gridTiles = computed(() => {
  const tiles = allTiles.value
  const rects = computeGrid(tiles.length, gridRect.value)
  // 统计远端有流成员中可见播放器占用名额
  let visibleCount = 0
  return tiles.map((t, i) => {
    let showPlaceholder = false
    if (t.isLocal) {
      // 本地：摄像头关闭时显示头像占位
      showPlaceholder = !t.cameraOn
    } else if (t.pending) {
      showPlaceholder = true
    } else if (t.streamUrl) {
      visibleCount += 1
      // 超出可见路数：头像占位（音频由隐藏 player 保活）
      showPlaceholder = visibleCount > MAX_VISIBLE_PLAYERS
    } else {
      showPlaceholder = true
    }
    return { ...t, rect: rects[i], showPlaceholder }
  })
})

/** 可见远端播放器瓦片 */
const visiblePlayerTiles = computed(() =>
  gridTiles.value.filter((t) => !t.isLocal && !t.pending && t.streamUrl && !t.showPlaceholder)
)

/** 隐藏保活音频的远端瓦片（超出可见路数） */
const hiddenPlayerTiles = computed(() =>
  gridTiles.value.filter((t) => !t.isLocal && !t.pending && t.streamUrl && t.showPlaceholder)
)

/** 本地瓦片 rect（供 pusher 绑定） */
const localTileRect = computed(() => {
  const local = gridTiles.value.find((t) => t.isLocal)
  return local?.rect || null
})

function rectStyle(rect) {
  if (!rect) return {}
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`
  }
}

// ============ 音频头像网格 ============
const audioGridStyle = computed(() => ({
  top: `${topSafeArea.value + 76}px`,
  bottom: `${bottomSafeArea.value + controlsReserve.value}px`
}))

/** 音频模式瓦片（无需 rect） */
const audioTiles = computed(() =>
  allTiles.value.map((t) => ({
    ...t,
    pending: t.isLocal ? false : t.pending
  }))
)

/** 音频模式下需要保活的远端流 */
const audioStreamTiles = computed(() =>
  allTiles.value.filter((t) => !t.isLocal && !t.pending && t.streamUrl)
)

// ============ 邀请成员面板 ============
const invitePanel = ref({
  show: false,
  loading: false,
  members: [] // { userId, displayName, avatarURL, inCall, selected }
})

const selectedInviteCount = computed(
  () => invitePanel.value.members.filter((m) => m.selected && !m.inCall).length
)

async function openInvitePanel() {
  const callKit = uni.$callKit
  const groupId = groupState.session?.groupId
  if (!callKit?.getGroupMembers) {
    uni.showToast({ title: '宿主未配置群成员数据源', icon: 'none' })
    return
  }
  if (!groupId) {
    uni.showToast({ title: '群组信息缺失', icon: 'none' })
    return
  }

  invitePanel.value = { show: true, loading: true, members: [] }
  try {
    const list = await callKit.getGroupMembers(groupId)
    // 已在通话中的成员（含自己）置灰不可选
    const inCallIds = new Set(
      groupState.participants.filter((p) => p.state !== 'left').map((p) => p.userId)
    )
    if (callState.localUserId) {
      inCallIds.add(callState.localUserId)
    }

    // 顺手把成员资料写入 userInfoMap，新成员上屏时能显示昵称头像
    const infoMap = {}
    for (const m of list || []) {
      if (m?.userId) {
        infoMap[m.userId] = { nickname: m.nickname || m.userId, avatarURL: m.avatarURL || '' }
      }
    }
    callKit.setUserInfoMap?.(infoMap)

    // 对缺失昵称/头像的成员，尝试调用环信用户属性接口补全
    const memberIds = (list || []).filter((m) => m?.userId).map((m) => m.userId)
    const needResolveIds = memberIds.filter((id) => {
      const cached = callState.userInfoMap[id]
      return !cached?.nickname && !cached?.avatarURL
    })
    if (needResolveIds.length) {
      try {
        await callKit.resolveUserProfiles?.(needResolveIds)
      } catch (e) {
        logger.warn('[group-call-page] resolveUserProfiles 失败', e)
      }
    }

    invitePanel.value.members = memberIds.map((userId) => ({
      userId,
      displayName: callState.userInfoMap[userId]?.nickname || userId,
      avatarURL: callState.userInfoMap[userId]?.avatarURL || '',
      inCall: inCallIds.has(userId),
      selected: false
    }))
  } catch (e) {
    logger.error('[group-call-page] getGroupMembers error', e)
    uni.showToast({ title: '获取成员列表失败', icon: 'none' })
    invitePanel.value.show = false
  } finally {
    invitePanel.value.loading = false
  }
}

function toggleInviteMember(member) {
  if (member.inCall) return
  member.selected = !member.selected
}

function closeInvitePanel() {
  invitePanel.value.show = false
}

async function confirmInvite() {
  const ids = invitePanel.value.members
    .filter((m) => m.selected && !m.inCall)
    .map((m) => m.userId)
  if (ids.length === 0) return

  const callKit = uni.$callKit
  try {
    await callKit?.inviteMoreParticipants?.(ids)
    uni.showToast({ title: '已发送邀请', icon: 'none' })
    closeInvitePanel()
  } catch (e) {
    logger.error('[group-call-page] inviteMoreParticipants error', e)
    uni.showToast({ title: '邀请失败，请重试', icon: 'none' })
  }
}

// ============ 控制操作 ============
function toggleAudio() {
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.setAudioEnabled(!callState.audioEnabled)
}

function toggleVideo() {
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.setVideoEnabled(!callState.videoEnabled)
}

function switchCamera() {
  logger.debug('[group-call-page] switchCamera')
  localPusherRef.value?.switchCamera?.()
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.switchCamera?.()
}

function hangup() {
  const callKit = uni.$callKit
  callKit?.core
    ?.hangup?.({ callId: callState.callId, reason: 'normal' })
    .catch((err) => {
      logger.error('[group-call-page] hangup error', err)
    })
    .finally(() => {
      uni.navigateBack({ delta: 1 })
    })
}

function acceptCall() {
  const callKit = uni.$callKit
  if (!callState.callId) {
    logger.warn('[group-call-page] acceptCall: callId is empty')
    return
  }
  groupState.callStatus = 'in_call'
  // 兜底：先用被邀请成员列表铺参与者（pending 等待态），
  // 后续 participantJoined / 流事件会逐个刷新为真实状态
  if (groupState.participants.length === 0 && groupState.invitedParticipants.length > 0) {
    groupState.participants = groupState.invitedParticipants.map((p) => ({ ...p, isLocal: false }))
  }
  callKit?.core
    ?.answerCall?.({
      callId: callState.callId,
      result: 'accept'
    })
    .catch((err) => {
      logger.error('[group-call-page] answerCall error', err)
      uni.showToast({ title: '接听失败', icon: 'none' })
      uni.navigateBack({ delta: 1 })
    })
}

function rejectCall() {
  const callKit = uni.$callKit
  callKit?.core
    ?.answerCall?.({
      callId: callState.callId,
      result: 'refuse'
    })
    .catch((err) => {
      logger.error('[group-call-page] rejectCall error', err)
    })
    .finally(() => {
      uni.navigateBack({ delta: 1 })
    })
}

onLoad((options) => {
  initSafeArea()
  logger.debug('[group-call-page] onLoad', options)

  // 尝试补全主叫方/被邀请成员的昵称头像（未传入 userInfoMap 时走环信用户属性接口）
  const callKit = uni.$callKit
  const idsToResolve = [
    groupState.session?.callerUserId,
    ...groupState.invitedParticipants.map((p) => p.userId),
    ...groupState.participants.map((p) => p.userId)
  ].filter(Boolean)
  const uniqueIds = [...new Set(idsToResolve)]
  if (callKit?.resolveUserProfiles && uniqueIds.length) {
    callKit.resolveUserProfiles(uniqueIds).catch((err) => {
      logger.warn('[group-call-page] resolveUserProfiles 失败', err)
    })
  }
})

onUnload(() => {
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.leaveChannel()
})

onShow(() => {
  logger.debug('[group-call-page] onShow')
})

onHide(() => {
  logger.debug('[group-call-page] onHide')
})

watch(() => groupState.callStatus, (status) => {
  if (status === 'idle') {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    if (current && current.route?.includes('group-call-page')) {
      uni.navigateBack({ delta: 1 })
    }
  }
})
</script>

<style scoped>
.group-call-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  color: #fff;
  background: #101014;
}

.call-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  background: #101014;
}

/* ============ 待接听界面 ============ */
.ringing-ui {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 160rpx 60rpx 140rpx;
  box-sizing: border-box;
  background: linear-gradient(180deg, #1c1c22 0%, #101014 100%);
}

.ringing-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ringing-avatar {
  width: 220rpx;
  height: 220rpx;
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.08);
  margin-bottom: 48rpx;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ringing-avatar-img {
  width: 100%;
  height: 100%;
}

.ringing-avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 88rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.ringing-info {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ringing-title {
  font-size: 32rpx;
  color: rgba(255, 255, 255, 0.75);
  margin-bottom: 16rpx;
}

.ringing-group-name {
  font-size: 52rpx;
  font-weight: 600;
  color: #fff;
  margin-bottom: 16rpx;
  text-align: center;
  max-width: 600rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ringing-type {
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 24rpx;
}

.ringing-members {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  max-width: 560rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ringing-actions {
  display: flex;
  gap: 160rpx;
}

.ringing-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}

.ringing-btn-circle {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ringing-btn.accept .ringing-btn-circle {
  background: #22c55e;
}

.ringing-btn.reject .ringing-btn-circle {
  background: #ef4444;
}

.ringing-btn-icon {
  width: 56rpx;
  height: 56rpx;
}

.ringing-btn-label {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.85);
}

/* ============ 顶部信息栏 ============ */
.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.group-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
  max-width: 480rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.5);
}

.call-status-line {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 8rpx;
  text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.5);
}

.network-toast {
  position: absolute;
  left: 0;
  right: 0;
  padding: 16rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.network-toast.warning {
  background: rgba(245, 166, 35, 0.92);
}

.network-toast.danger {
  background: rgba(239, 68, 68, 0.92);
}

.network-toast-text {
  font-size: 26rpx;
  color: #fff;
  font-weight: 500;
}

/* ============ 视频网格 ============ */
.grid-area {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 1;
}

.tile-overlay {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border-radius: 8rpx;
  overflow: hidden;
}

.tile-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #26262e;
}

.tile-avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
}

.tile-avatar-fallback {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52rpx;
  font-weight: 600;
  color: #fff;
}

.tile-pending-text {
  margin-top: 20rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.5);
}

.tile-name-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 16rpx;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
}

.tile-mute-icon {
  width: 24rpx;
  height: 24rpx;
  flex-shrink: 0;
}

.tile-name {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.waiting-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 24rpx;
  display: flex;
  justify-content: center;
  z-index: 4;
  pointer-events: none;
}

.waiting-hint-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.45);
  padding: 12rpx 32rpx;
  border-radius: 32rpx;
}

.audio-only-player,
.audio-only-pusher {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ============ 音频头像网格 ============ */
.audio-grid {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 1;
}

.audio-grid-inner {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: flex-start;
  padding: 32rpx 24rpx;
  box-sizing: border-box;
}

.audio-tile {
  width: 33.33%;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 28rpx 0;
  position: relative;
}

.audio-tile.pending {
  opacity: 0.45;
}

.audio-avatar-wrap {
  position: relative;
  width: 150rpx;
  height: 150rpx;
}

.audio-avatar {
  width: 150rpx;
  height: 150rpx;
  border-radius: 24rpx;
}

.audio-avatar-fallback {
  width: 150rpx;
  height: 150rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 60rpx;
  font-weight: 600;
  color: #fff;
}

.audio-mute-badge {
  position: absolute;
  right: -8rpx;
  bottom: -8rpx;
  width: 44rpx;
  height: 44rpx;
  background: rgba(239, 68, 68, 0.95);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mute-icon {
  width: 26rpx;
  height: 26rpx;
}

.audio-name {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.92);
  margin-top: 16rpx;
  max-width: 200rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.audio-pending-text {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 6rpx;
}

/* ============ 底部控制栏 ============ */
.call-controls-mask {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 280rpx;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  z-index: 9;
  pointer-events: none;
}

.call-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: 28rpx;
  padding: 0 32rpx;
  box-sizing: border-box;
}

.control-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  box-sizing: border-box;
}

.control-btn.active {
  background: rgba(239, 68, 68, 0.9);
}

.control-btn.danger {
  background: #ef4444;
}

.btn-icon {
  width: 48rpx;
  height: 48rpx;
}

.btn-label {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}

/* ============ 邀请成员面板 ============ */
.invite-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 50;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.invite-panel {
  background: #1f1f26;
  border-radius: 32rpx 32rpx 0 0;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.invite-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.08);
}

.invite-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
}

.invite-cancel {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.6);
  padding: 8rpx 16rpx;
}

.invite-list {
  max-height: 48vh;
  padding: 16rpx 24rpx;
  box-sizing: border-box;
}

.invite-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80rpx 0;
}

.invite-empty-text {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.45);
}

.invite-cells {
  display: flex;
  flex-direction: column;
}

.invite-cell {
  display: flex;
  align-items: center;
  padding: 24rpx 8rpx;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.08);
}

.invite-cell.disabled {
  opacity: 0.45;
}

.invite-cell-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 16rpx;
  margin-right: 24rpx;
  background: rgba(255, 255, 255, 0.08);
}

.invite-cell-avatar-fallback {
  width: 88rpx;
  height: 88rpx;
  border-radius: 16rpx;
  margin-right: 24rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  font-weight: 600;
  color: #fff;
}

.invite-cell-name {
  flex: 1;
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.invite-cell-status {
  margin-left: 16rpx;
}

.invite-cell-status-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.45);
}

.invite-cell-check {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  margin-left: 16rpx;
  background: rgba(255, 255, 255, 0.12);
  border: 2rpx solid rgba(255, 255, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.invite-cell-check.checked {
  background: #22c55e;
  border-color: #22c55e;
}

.invite-cell-check-mark {
  font-size: 26rpx;
  color: #fff;
  line-height: 1;
}

.invite-footer {
  padding: 24rpx 32rpx 32rpx;
}

.invite-confirm {
  height: 88rpx;
  border-radius: 44rpx;
  background: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
}

.invite-confirm.disabled {
  background: rgba(255, 255, 255, 0.15);
}

.invite-confirm-text {
  font-size: 30rpx;
  font-weight: 500;
  color: #fff;
}
</style>
