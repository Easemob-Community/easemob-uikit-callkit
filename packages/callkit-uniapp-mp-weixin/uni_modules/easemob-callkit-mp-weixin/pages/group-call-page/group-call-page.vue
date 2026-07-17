<template>
  <view class="group-call-page">
    <!-- 背景 -->
    <image
      v-if="groupState.session?.callType === 'video'"
      class="call-bg"
      src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/images/callkit_bg.png"
      mode="aspectFill"
    />
    <view v-else class="call-bg" />

    <!-- 待接听界面 -->
    <view v-if="showRingingUI" class="ringing-ui">
      <view class="ringing-content">
        <view class="ringing-avatar">
          <image v-if="callerInfo.avatarURL" class="ringing-avatar-img" :src="callerInfo.avatarURL" mode="aspectFill" />
          <view v-else class="ringing-avatar-fallback">{{ callerName.charAt(0).toUpperCase() }}</view>
        </view>
        <view class="ringing-info">
          <text class="ringing-title">邀请你进行</text>
          <text class="ringing-group-name">{{ groupState.session?.groupName || '群聊' }}</text>
          <text class="ringing-type">{{ groupState.session?.callType === 'video' ? '群视频通话' : '群语音通话' }}</text>
          <text class="ringing-members">{{ invitedMemberNames }}</text>
        </view>
      </view>

      <view class="ringing-actions">
        <view class="ringing-btn reject" @click="rejectCall">
          <image class="ringing-btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
          <text class="ringing-btn-label">拒绝</text>
        </view>
        <view class="ringing-btn accept" @click="acceptCall">
          <image class="ringing-btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_pick.svg" />
          <text class="ringing-btn-label">接听</text>
        </view>
      </view>
    </view>

    <!-- 通话界面 -->
    <template v-else>
      <!-- 顶部信息栏 -->
      <view class="top-bar" :style="{ paddingTop: `${topSafeArea}px` }">
        <view class="group-info">
          <text class="group-name">{{ groupState.session?.groupName || '群聊' }}</text>
          <text class="call-duration">{{ formattedDuration }}</text>
        </view>
        <view v-if="networkStatus.show" class="network-toast" :class="networkStatus.type">
          <text class="network-toast-text">{{ networkStatus.message }}</text>
        </view>
      </view>

      <!-- 视频网格 -->
      <view v-if="groupState.session?.callType === 'video'" class="video-grid">
        <!-- 主画面 -->
        <view v-if="mainParticipant" class="main-video">
          <agora-player
            v-if="mainParticipant.streamUrl"
            class="main-player"
            :url="mainParticipant.streamUrl"
            :uid="mainParticipant.userId"
            :x="0"
            :y="0"
            :width="screenWidth"
            :height="mainVideoHeight"
            :debug="false"
            @netstatus="onRemoteNetStatus"
            @statechange="onRemoteStateChange"
          />
          <view v-else class="main-placeholder">
            <image v-if="mainParticipant.avatarURL" class="main-avatar" :src="mainParticipant.avatarURL" mode="aspectFill" />
            <view v-else class="main-avatar-fallback">{{ mainParticipant.nickname.charAt(0).toUpperCase() }}</view>
            <text class="main-nickname">{{ mainParticipant.nickname }}</text>
          </view>
          <view class="main-overlay">
            <text class="main-name">{{ mainParticipant.nickname }}</text>
          </view>
        </view>

        <!-- 小窗列表 -->
        <scroll-view class="thumbnails" scroll-x>
          <view
            v-for="p in thumbnailParticipants"
            :key="p.userId"
            class="thumbnail"
            :class="{ active: p.userId === mainParticipant?.userId }"
            @click="selectMainParticipant(p)"
          >
            <agora-player
              v-if="p.streamUrl && p.isCameraOn"
              class="thumbnail-player"
              :url="p.streamUrl"
              :uid="p.userId"
              :x="0"
              :y="0"
              :width="thumbnailSize"
              :height="thumbnailSize"
              :debug="false"
            />
            <image v-else-if="p.avatarURL" class="thumbnail-avatar" :src="p.avatarURL" mode="aspectFill" />
            <view v-else class="thumbnail-fallback">{{ p.nickname.charAt(0).toUpperCase() }}</view>
            <view v-if="p.isMuted" class="thumbnail-mute">
              <image class="mute-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_slash.svg" />
            </view>
            <text class="thumbnail-name">{{ p.nickname }}</text>
          </view>
        </scroll-view>
      </view>

      <!-- 音频网格 -->
      <view v-else class="audio-grid">
        <view
          v-for="p in groupState.participants"
          :key="p.userId"
          class="audio-tile"
          :class="{ speaking: p.isSpeaking }"
        >
          <image v-if="p.avatarURL" class="audio-avatar" :src="p.avatarURL" mode="aspectFill" />
          <view v-else class="audio-fallback">{{ p.nickname.charAt(0).toUpperCase() }}</view>
          <text class="audio-name">{{ p.nickname }}</text>
          <view v-if="p.isMuted" class="audio-mute">
            <image class="mute-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_slash.svg" />
          </view>
        </view>
      </view>

      <!-- 本地小窗 -->
      <agora-pusher
        v-if="callState.localStreamUrl"
        ref="localPusherRef"
        class="local-pusher"
        :style="localPusherStyle"
        :url="callState.localStreamUrl"
        :x="0"
        :y="0"
        :width="localPusherWidth"
        :height="localPusherHeight"
        :muted="!callState.audioEnabled"
        :enable-camera="callState.videoEnabled"
        aspect="9:16"
        :debug="false"
        @netstatus="onLocalNetStatus"
        @statechange="onLocalStateChange"
      />

      <!-- 底部控制栏 -->
      <view class="call-controls-mask" />
      <view class="call-controls" :style="{ paddingBottom: `${bottomSafeArea + 30}rpx` }">
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

        <view v-if="groupState.session?.callType === 'video'" class="control-item" @click="toggleVideo">
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

        <view v-if="groupState.session?.callType === 'video'" class="control-item" @click="switchCamera">
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
    </template>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { onLoad, onUnload, onShow, onHide } from '@dcloudio/uni-app'
import { useCallState, useGroupCallState, CALL_TYPE } from '@/uni_modules/easemob-callkit-mp-weixin'
import { getMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin/src/utils/logger'

const logger = getMpWeixinLogger()
const { state: callState } = useCallState()
const { state: groupState, removeParticipant, updateParticipantState } = useGroupCallState()

const localPusherRef = ref(null)

// 屏幕尺寸
const screenWidth = ref(375)
const screenHeight = ref(667)
const topSafeArea = ref(0)
const bottomSafeArea = ref(0)

// 本地小窗尺寸
const localPusherWidth = ref(105)
const localPusherHeight = ref(187)
const localPusherX = ref(254)
const localPusherY = ref(100)

// 视频布局
const thumbnailSize = ref(80)
const mainVideoHeight = ref(500)

// 当前选中主画面的参与者
const mainParticipantId = ref('')

function initSafeArea() {
  try {
    const sysInfo = uni.getSystemInfoSync()
    screenWidth.value = sysInfo.windowWidth || 375
    screenHeight.value = sysInfo.windowHeight || 667
    bottomSafeArea.value = sysInfo.safeAreaInsets?.bottom || 0
    const menu = uni.getMenuButtonBoundingClientRect?.()
    topSafeArea.value = menu?.bottom || sysInfo.statusBarHeight || 0

    // 本地小窗
    const width = Math.floor(screenWidth.value * 0.28)
    const height = Math.floor((width * 16) / 9)
    localPusherWidth.value = width
    localPusherHeight.value = height
    localPusherX.value = screenWidth.value - width - 16
    localPusherY.value = topSafeArea.value + 60

    // 视频布局
    thumbnailSize.value = Math.floor(screenWidth.value / 5)
    mainVideoHeight.value = Math.floor(screenHeight.value * 0.6)
  } catch (e) {
    logger.warn('[group-call-page] initSafeArea failed', e)
  }
}

// 网络状态提示
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

// 计算属性
const showRingingUI = computed(() => groupState.callStatus === 'ringing')

const callerInfo = computed(() => {
  const callerId = groupState.invitedParticipants.find((p) => p.isLocal)?.userId || ''
  return callState.userInfoMap[callerId] || { nickname: callerId, avatarURL: '' }
})

const callerName = computed(() => callerInfo.value.nickname || '未知用户')

const invitedMemberNames = computed(() => {
  return groupState.invitedParticipants
    .filter((p) => !p.isLocal)
    .map((p) => p.nickname)
    .join('、')
})

const formattedDuration = computed(() => {
  const m = Math.floor(callState.duration / 60).toString().padStart(2, '0')
  const s = (callState.duration % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

const remoteParticipants = computed(() =>
  groupState.participants.filter((p) => !p.isLocal && p.state !== 'left')
)

const mainParticipant = computed(() => {
  if (!mainParticipantId.value) {
    return remoteParticipants.value[0] || null
  }
  return remoteParticipants.value.find((p) => p.userId === mainParticipantId.value) || remoteParticipants.value[0] || null
})

const thumbnailParticipants = computed(() => {
  if (!mainParticipant.value) return remoteParticipants.value
  return remoteParticipants.value.filter((p) => p.userId !== mainParticipant.value?.userId)
})

const localPusherStyle = computed(() => ({
  position: 'absolute',
  top: `${localPusherY.value}px`,
  left: `${localPusherX.value}px`,
  width: `${localPusherWidth.value}px`,
  height: `${localPusherHeight.value}px`,
  zIndex: 2,
  borderRadius: '16rpx',
  overflow: 'hidden',
  boxShadow: '0 4rpx 20rpx rgba(0,0,0,0.25)',
  border: '2rpx solid rgba(255,255,255,0.15)'
}))

// 方法
function selectMainParticipant(participant) {
  mainParticipantId.value = participant.userId
}

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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
}

/* 待接听界面 */
.ringing-ui {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 60rpx;
  box-sizing: border-box;
}

.ringing-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 120rpx;
}

.ringing-avatar {
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  margin-bottom: 40rpx;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ringing-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.ringing-avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 96rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.ringing-info {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ringing-title {
  font-size: 48rpx;
  color: #fff;
  margin-bottom: 20rpx;
}

.ringing-group-name {
  font-size: 64rpx;
  font-weight: bold;
  color: #fff;
  margin-bottom: 20rpx;
  text-align: center;
}

.ringing-type {
  font-size: 36rpx;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 20rpx;
}

.ringing-members {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  max-width: 600rpx;
}

.ringing-actions {
  display: flex;
  gap: 120rpx;
}

.ringing-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.ringing-btn-icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  padding: 24rpx;
  box-sizing: border-box;
}

.ringing-btn.accept .ringing-btn-icon {
  background: rgba(82, 196, 26, 0.9);
}

.ringing-btn.reject .ringing-btn-icon {
  background: rgba(239, 68, 68, 0.9);
}

.ringing-btn-label {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.9);
}

.call-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  background: #1a1a1a;
}

.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: 0 32rpx;
}

.group-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20rpx 0;
}

.group-name {
  font-size: 36rpx;
  font-weight: 600;
  color: #fff;
}

.call-duration {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 8rpx;
}

.network-toast {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 16rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.network-toast.warning {
  background: rgba(245, 166, 35, 0.9);
}

.network-toast.danger {
  background: rgba(239, 68, 68, 0.9);
}

.network-toast-text {
  font-size: 26rpx;
  color: #fff;
  font-weight: 500;
}

/* 视频网格 */
.video-grid {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: flex;
  flex-direction: column;
}

.main-video {
  position: relative;
  width: 100%;
  flex: 1;
  overflow: hidden;
}

.main-player {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.main-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
}

.main-avatar {
  width: 200rpx;
  height: 200rpx;
  border-radius: 50%;
}

.main-avatar-fallback {
  width: 200rpx;
  height: 200rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 80rpx;
  font-weight: 600;
  color: #fff;
}

.main-nickname {
  font-size: 36rpx;
  color: #fff;
  margin-top: 24rpx;
}

.main-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20rpx 32rpx;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
}

.main-name {
  font-size: 32rpx;
  color: #fff;
  font-weight: 500;
}

.thumbnails {
  position: absolute;
  bottom: 200rpx;
  left: 0;
  right: 0;
  height: 200rpx;
  white-space: nowrap;
  padding: 0 16rpx;
  box-sizing: border-box;
}

.thumbnail {
  display: inline-block;
  width: 160rpx;
  height: 160rpx;
  margin: 0 8rpx;
  border-radius: 16rpx;
  overflow: hidden;
  position: relative;
  border: 4rpx solid transparent;
  vertical-align: top;
}

.thumbnail.active {
  border-color: #2979ff;
}

.thumbnail-player {
  width: 100%;
  height: 100%;
}

.thumbnail-avatar {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
}

.thumbnail-fallback {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  font-weight: 600;
  color: #fff;
}

.thumbnail-mute {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 40rpx;
  height: 40rpx;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mute-icon {
  width: 24rpx;
  height: 24rpx;
}

.thumbnail-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 22rpx;
  color: #fff;
  text-align: center;
  background: rgba(0, 0, 0, 0.5);
  padding: 4rpx 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 音频网格 */
.audio-grid {
  position: absolute;
  top: 120rpx;
  left: 0;
  right: 0;
  bottom: 200rpx;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: flex-start;
  padding: 40rpx 20rpx;
  box-sizing: border-box;
  overflow-y: auto;
}

.audio-tile {
  width: 200rpx;
  margin: 20rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.audio-tile.speaking {
  opacity: 1;
}

.audio-avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
}

.audio-fallback {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 64rpx;
  font-weight: 600;
  color: #fff;
}

.audio-name {
  font-size: 28rpx;
  color: #fff;
  margin-top: 16rpx;
  max-width: 200rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audio-mute {
  position: absolute;
  top: 120rpx;
  right: 20rpx;
  width: 40rpx;
  height: 40rpx;
  background: rgba(239, 68, 68, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 本地小窗 */
.local-pusher {
  position: absolute;
  border-radius: 16rpx;
  overflow: hidden;
  z-index: 2;
}

/* 底部控制栏 */
.call-controls-mask {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 240rpx;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0));
  z-index: 9;
  pointer-events: none;
}

.call-controls {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  gap: 20rpx;
  padding: 0 32rpx;
}

.control-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.control-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  width: 120rpx;
  height: 120rpx;
  padding: 0;
  background: rgba(255, 255, 255, 0.15);
  border: 3rpx solid rgba(255, 255, 255, 0.2);
  border-radius: 20rpx;
  color: #fff;
  box-sizing: border-box;
}

.control-btn.active {
  background: rgba(239, 68, 68, 0.9);
  border-color: rgba(239, 68, 68, 1);
}

.control-btn.danger {
  background: rgba(239, 68, 68, 0.9);
  border-color: rgba(239, 68, 68, 1);
}

.btn-icon {
  width: 44rpx;
  height: 44rpx;
}

.btn-label {
  font-size: 22rpx;
  font-weight: 500;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.9);
}
</style>
