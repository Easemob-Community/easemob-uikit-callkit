<template>
  <view class="single-call-page" :class="{ 'is-audio': callState.callType === 'audio' }">
    <!-- 临时调试：确认 localUrl / remoteUrl 是否到达 -->
    <view class="debug-panel">
      <text>local: {{ callState.localStreamUrl ? '✓' : '✗' }} {{ (callState.localStreamUrl || '').slice(0, 30) }}...</text>
      <text>remote: {{ callState.remoteStreamUrl ? '✓' : '✗' }} {{ (callState.remoteStreamUrl || '').slice(0, 30) }}...</text>
    </view>

    <!-- 背景：视频通话显示背景图，语音通话显示 #1a1a1a -->
    <image
      v-if="callState.callType === 'video'"
      class="call-bg"
      src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/images/callkit_bg.png"
      mode="aspectFill"
    />
    <view v-else class="call-bg" />

    <!-- 视频通话中：远端画面 + 本地小窗 -->
    <view v-if="showVideoLayout" class="video-layout">
      <agora-player
        v-if="callState.remoteStreamUrl"
        class="remote-player"
        :style="remotePlayerStyle"
        :url="callState.remoteStreamUrl"
        :uid="callState.remoteUserId || targetUserId"
        :x="0"
        :y="0"
        :width="screenWidth"
        :height="screenHeight"
        :debug="false"
      />
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
      />
    </view>

    <!-- 主内容区：等待/响铃/语音通话 -->
    <view v-else class="call-content">
      <view class="caller-info">
        <view class="caller-avatar">
          <image
            v-if="targetUserInfo.avatarURL"
            class="avatar-img"
            :src="targetUserInfo.avatarURL"
            mode="aspectFill"
          />
          <view v-else class="avatar-fallback">{{ displayName.charAt(0).toUpperCase() }}</view>
        </view>

        <view class="caller-details">
          <text class="call-title">{{ pageTitle }}</text>
          <text class="caller-name">{{ displayName }}</text>
          <text class="call-type-indicator">{{ callState.callType === 'video' ? '视频通话' : '语音通话' }}</text>
          <text v-if="showTimer" class="waiting-timer">{{ formattedDuration || waitingTime + 's' }}</text>
        </view>
      </view>
    </view>

    <!-- 底部控制栏 -->
    <view class="call-controls">
      <!-- 被叫待接听：接听 / 拒绝 -->
      <template v-if="callState.status === 'ringing' && !callState.isCaller">
        <view class="control-item" @click="rejectCall">
          <view class="control-btn danger">
            <image class="btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
          </view>
          <text class="btn-label">拒绝</text>
        </view>

        <view class="control-item" @click="acceptCall">
          <view class="control-btn accept">
            <image class="btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_pick.svg" />
          </view>
          <text class="btn-label">接听</text>
        </view>
      </template>

      <!-- 主叫等待中：取消 -->
      <template v-else-if="callState.status === 'inviting'">
        <view class="control-item" @click="hangup">
          <view class="control-btn danger">
            <image class="btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
          </view>
          <text class="btn-label">取消呼叫</text>
        </view>
      </template>

      <!-- 通话中：静音、摄像头、切换摄像头、挂断 -->
      <template v-else>
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

        <view v-if="callState.callType === 'video'" class="control-item" @click="toggleVideo">
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

        <view v-if="callState.callType === 'video'" class="control-item" @click="switchCamera">
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
      </template>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { onLoad, onUnload, onShow, onHide } from '@dcloudio/uni-app'
import { useCallState, CALL_TYPE } from '@/uni_modules/easemob-callkit-mp-weixin'

const targetUserId = ref('')
const callType = ref('audio')
const { state: callState } = useCallState()
const localPusherRef = ref(null)

// 屏幕尺寸（用于原生媒体组件绝对定位，单位 px）
const screenWidth = ref(375)
const screenHeight = ref(667)
const localPusherWidth = ref(105)
const localPusherHeight = ref(187)
const localPusherX = ref(254)
const localPusherY = ref(100)

function initScreenSize() {
  const sysInfo = uni.getSystemInfoSync()
  screenWidth.value = sysInfo.windowWidth || 375
  screenHeight.value = sysInfo.windowHeight || 667

  // 预留微信小程序右上角胶囊安全区，避免本地画面被遮挡
  const menu = uni.getMenuButtonBoundingClientRect?.()
  const safeTop = menu ? menu.bottom + 8 : (sysInfo.statusBarHeight || 0) + 44

  // 本地画面采用竖屏 9:16 比例小窗
  const width = Math.floor(screenWidth.value * 0.28)
  const height = Math.floor((width * 16) / 9)

  localPusherWidth.value = width
  localPusherHeight.value = height
  localPusherX.value = screenWidth.value - width - 16
  localPusherY.value = safeTop
}

const targetUserInfo = computed(() => ({
  avatarURL: '',
  nickname: ''
}))

const displayName = computed(() => targetUserInfo.value.nickname || targetUserId.value || '')

const pageTitle = computed(() => {
  if (callState.status === 'ringing' && !callState.isCaller) return '邀请你进行'
  if (callState.status === 'inviting') return '正在呼叫'
  return ''
})

const showTimer = computed(() =>
  callState.status === 'in_call' || callState.status === 'inviting'
)

const showVideoLayout = computed(() =>
  callState.status === 'in_call' && callState.callType === 'video'
)

const formattedDuration = computed(() => {
  const m = Math.floor(callState.duration / 60).toString().padStart(2, '0')
  const s = (callState.duration % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// 微信小程序自定义组件默认不继承外部 class，因此用内联 style 确保层叠与尺寸生效
const remotePlayerStyle = computed(() => ({
  position: 'absolute',
  top: '0px',
  left: '0px',
  width: `${screenWidth.value}px`,
  height: `${screenHeight.value}px`,
  zIndex: 1
}))

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

// 主叫等待计时
const waitingTime = ref(0)
let waitingTimer = null
function startWaitingTimer() {
  stopWaitingTimer()
  waitingTime.value = 0
  waitingTimer = setInterval(() => {
    waitingTime.value++
  }, 1000)
}
function stopWaitingTimer() {
  if (waitingTimer) {
    clearInterval(waitingTimer)
    waitingTimer = null
  }
}

onLoad((options) => {
  initScreenSize()
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'

  const callKit = uni.$callKit
  if (!callKit || !targetUserId.value) return

  if (callState.status === 'idle') {
    callState.status = 'inviting'
    callState.targetUserId = targetUserId.value
    callState.callType = callType.value
    callState.isCaller = true
    callState.audioEnabled = true
    callState.videoEnabled = callType.value === 'video'

    startWaitingTimer()

    callKit.core.inviteCall({
      calleeUserId: targetUserId.value,
      callType: callType.value === 'video' ? CALL_TYPE.VIDEO_1V1 : CALL_TYPE.AUDIO_1V1
    }).catch((err) => {
      console.error('[inviteCall error]', err)
      uni.showToast({ title: '呼叫失败', icon: 'none' })
    })
  }
})

onUnload(() => {
  stopWaitingTimer()
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.leaveChannel()
})

onShow(() => {
  // 切回前台后恢复媒体组件
  console.log('[single-call-page] onShow')
})

onHide(() => {
  // 切后台时暂停推流/拉流
  console.log('[single-call-page] onHide')
})

watch(() => callState.status, (status) => {
  if (status === 'in_call') {
    stopWaitingTimer()
  }
  if (status === 'idle') {
    stopWaitingTimer()
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    if (current && current.route?.includes('single-call-page')) {
      uni.navigateBack({ delta: 1 })
    }
  }
})

function acceptCall() {
  const callKit = uni.$callKit
  if (!callState.callId) {
    console.warn('[acceptCall] callId is empty')
    return
  }
  callKit?.core?.answerCall?.({
    callId: callState.callId,
    result: 'accept'
  })
}

function rejectCall() {
  stopWaitingTimer()
  const callKit = uni.$callKit
  if (!callState.callId) {
    console.warn('[rejectCall] callId is empty')
    uni.navigateBack({ delta: 1 })
    return
  }
  callKit?.core
    ?.answerCall?.({
      callId: callState.callId,
      result: 'refuse'
    })
    .catch((err) => {
      console.error('[rejectCall error]', err)
    })
    .finally(() => {
      uni.navigateBack({ delta: 1 })
    })
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
  console.log('[single-call-page] switchCamera')
  // 声网小程序 SDK 未暴露切换摄像头 API，需调用原生 live-pusher 组件实例方法
  localPusherRef.value?.switchCamera?.()
  // 同步通知 adapter，便于后续埋点/日志扩展
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.switchCamera?.()
}

function hangup() {
  stopWaitingTimer()
  const callKit = uni.$callKit
  const reason = callState.status === 'inviting' ? 'cancel' : 'normal'
  callKit?.core
    ?.hangup?.({
      callId: callState.callId,
      reason
    })
    .catch((err) => {
      console.error('[hangup error]', err)
    })
    .finally(() => {
      uni.navigateBack({ delta: 1 })
    })
}
</script>

<style scoped>
.single-call-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  overflow: hidden;
  color: #fff;
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

.debug-panel {
  position: absolute;
  top: 120rpx;
  left: 16rpx;
  right: 16rpx;
  z-index: 100;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12rpx;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  font-size: 20rpx;
  color: #0f0;
  pointer-events: none;
}

.video-layout {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.remote-player {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.local-pusher {
  position: absolute;
  border-radius: 16rpx;
  overflow: hidden;
  z-index: 2;
}

.call-content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 60rpx;
}

.caller-info {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.caller-avatar {
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

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.avatar-fallback {
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

.caller-details {
  text-align: center;
}

.call-title {
  display: block;
  font-size: 48rpx;
  font-weight: normal;
  margin-bottom: 20rpx;
}

.caller-name {
  display: block;
  font-size: 64rpx;
  font-weight: bold;
  margin-bottom: 20rpx;
}

.call-type-indicator {
  display: block;
  font-size: 36rpx;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 20rpx;
}

.waiting-timer {
  display: block;
  font-size: 40rpx;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

.call-controls {
  position: absolute;
  bottom: 60rpx;
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

.control-btn.accept {
  background: rgba(82, 196, 26, 0.9);
  border-color: rgba(82, 196, 26, 1);
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
