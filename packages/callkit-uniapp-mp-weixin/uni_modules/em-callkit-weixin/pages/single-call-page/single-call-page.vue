<template>
  <view class="single-call-page" :class="{ 'is-audio': callState.callType === 'audio' }">
    <!-- 背景：视频通话显示背景图，语音通话显示 #1a1a1a -->
    <image
      v-if="callState.callType === 'video'"
      class="call-bg"
      src="../../static/callkit/images/callkit_bg.png"
      mode="aspectFill"
    />
    <view v-else class="call-bg" />

    <view v-if="networkStatus.show" class="network-toast" :class="networkStatus.type">
      <text class="network-toast-text">{{ networkStatus.message }}</text>
    </view>

    <!-- 媒体层：通话中始终维持 RTC 推流/拉流组件，视频时显示、语音时隐藏 -->
    <view v-if="showMediaLayer" class="media-layer">
      <agora-player
        v-if="callState.remoteStreamUrl"
        ref="remotePlayerRef"
        class="remote-player"
        :class="{ 'audio-only': callState.callType === 'audio' }"
        :style="remotePlayerStyle"
        :url="callState.remoteStreamUrl"
        :uid="callState.remoteUserId || targetUserId"
        :x="0"
        :y="0"
        :width="screenWidth"
        :height="screenHeight"
        :debug="false"
        :logger="logger"
        @netstatus="onRemoteNetStatus"
        @statechange="onRemoteStateChange"
      />
      <agora-pusher
        v-if="callState.localStreamUrl"
        ref="localPusherRef"
        class="local-pusher"
        :class="{ 'audio-only': callState.callType === 'audio' }"
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
        :logger="logger"
        @netstatus="onLocalNetStatus"
        @statechange="onLocalStateChange"
      />
    </view>

    <!-- 主内容区：等待/响铃/语音通话 -->
    <view v-if="!showVideoLayout" class="call-content">
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
    <view class="call-controls-mask" />
    <view class="call-controls" :style="{ paddingBottom: `${bottomSafeArea + 30}rpx` }">
      <!-- 被叫待接听：接听 / 拒绝 -->
      <template v-if="callState.status === 'ringing' && !callState.isCaller">
        <view class="control-item" @click="rejectCall">
          <view class="control-btn danger">
            <image class="btn-icon" src="../../static/callkit/icons/phone_hang.svg" />
          </view>
          <text class="btn-label">拒绝</text>
        </view>

        <view class="control-item" @click="acceptCall">
          <view class="control-btn accept">
            <image class="btn-icon" src="../../static/callkit/icons/phone_pick.svg" />
          </view>
          <text class="btn-label">接听</text>
        </view>
      </template>

      <!-- 主叫等待中：取消 -->
      <template v-else-if="callState.status === 'inviting'">
        <view class="control-item" @click="hangup">
          <view class="control-btn danger">
            <image class="btn-icon" src="../../static/callkit/icons/phone_hang.svg" />
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
              src="../../static/callkit/icons/mic_on.svg"
            />
            <image
              v-else
              class="btn-icon"
              src="../../static/callkit/icons/mic_slash.svg"
            />
          </view>
          <text class="btn-label">{{ callState.audioEnabled ? '静音' : '取消静音' }}</text>
        </view>

        <view v-if="callState.callType === 'video'" class="control-item" @click="toggleVideo">
          <view class="control-btn" :class="{ active: !callState.videoEnabled }">
            <image
              v-if="callState.videoEnabled"
              class="btn-icon"
              src="../../static/callkit/icons/video_camera.svg"
            />
            <image
              v-else
              class="btn-icon"
              src="../../static/callkit/icons/video_camera_slash.svg"
            />
          </view>
          <text class="btn-label">{{ callState.videoEnabled ? '关闭摄像头' : '打开摄像头' }}</text>
        </view>

        <view v-if="callState.callType === 'video'" class="control-item" @click="switchCamera">
          <view class="control-btn">
            <image
              class="btn-icon"
              src="../../static/callkit/icons/camera_fill_arrows.svg"
            />
          </view>
          <text class="btn-label">切换摄像头</text>
        </view>

        <view class="control-item" @click="hangup">
          <view class="control-btn danger">
            <image class="btn-icon" src="../../static/callkit/icons/phone_hang.svg" />
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
import { useCallState, CALL_TYPE, resetCallState } from '@/uni_modules/em-callkit-weixin'
import { getMpWeixinLogger } from '@/uni_modules/em-callkit-weixin/src/utils/logger'

const logger = getMpWeixinLogger()

const targetUserId = ref('')
const callType = ref('audio')
const { state: callState } = useCallState()
const localPusherRef = ref(null)
const remotePlayerRef = ref(null)

// 屏幕尺寸（用于原生媒体组件绝对定位，单位 px）
const screenWidth = ref(375)
const screenHeight = ref(667)
const localPusherWidth = ref(105)
const localPusherHeight = ref(187)
const localPusherX = ref(254)
const localPusherY = ref(100)

// 底部控制栏安全区（适配 iPhone Home Indicator）
const bottomSafeArea = ref(0)
function initSafeArea() {
  try {
    const sysInfo = uni.getSystemInfoSync()
    bottomSafeArea.value = sysInfo.safeAreaInsets?.bottom || 0
  } catch (e) {
    bottomSafeArea.value = 0
  }
}

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

const targetUserInfo = computed(() => {
  const userId = callState.remoteUserId || targetUserId.value
  return callState.userInfoMap[userId] || {
    avatarURL: '',
    nickname: ''
  }
})

const displayName = computed(() => targetUserInfo.value.nickname || callState.remoteUserId || targetUserId.value || '')

/** 当前页面需要展示的对端用户 ID */
const displayUserId = computed(() => callState.remoteUserId || targetUserId.value || '')

const pageTitle = computed(() => {
  if (callState.status === 'ringing' && !callState.isCaller) return '邀请你进行'
  if (callState.status === 'inviting') return '正在呼叫'
  return ''
})

const showTimer = computed(() =>
  callState.status === 'in_call' || callState.status === 'inviting'
)

const showMediaLayer = computed(() => callState.status === 'in_call')

const showVideoLayout = computed(() =>
  callState.status === 'in_call' && callState.callType === 'video'
)

const formattedDuration = computed(() => {
  const m = Math.floor(callState.duration / 60).toString().padStart(2, '0')
  const s = (callState.duration % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// 远端画面：视频通话全屏，语音通话 1x1 隐藏但保持播放
const remotePlayerStyle = computed(() => {
  if (callState.callType === 'audio') {
    return {
      position: 'absolute',
      top: '0px',
      left: '-9999px',
      width: '1px',
      height: '1px',
      opacity: 0
    }
  }
  return {
    position: 'absolute',
    top: '0px',
    left: '0px',
    width: `${screenWidth.value}px`,
    height: `${screenHeight.value}px`
  }
})

// 微信小程序自定义组件默认不继承外部 class，本地小窗用内联 style 确保层叠与尺寸生效
const localPusherStyle = computed(() => {
  if (callState.callType === 'audio') {
    return {
      position: 'absolute',
      top: '0px',
      left: '-9999px',
      width: '1px',
      height: '1px',
      opacity: 0,
      zIndex: 2
    }
  }
  return {
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
  }
})

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
  // 微信小程序 live-pusher/live-player netstatus 中的 netQuality
  // 0 未知，1 最好，2 好，3 一般，4 差，5 很差，6 失败
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
    // 网络恢复，无论当前是 warning 还是 danger 都立即隐藏
    hideNetworkToast()
  }
}

function onRemoteNetStatus(e) {
  const quality = parseNetQuality(e?.detail)
  if (quality >= 6) {
    showNetworkToast('danger', '对方网络异常', 5000)
  } else if (quality >= 4) {
    showNetworkToast('warning', '对方网络较差')
  } else if (quality > 0 && quality <= 2) {
    hideNetworkToast()
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

onLoad(async (options) => {
  initSafeArea()
  initScreenSize()
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'

  const callKit = uni.$callKit
  if (!callKit || !targetUserId.value) return

  // 尝试补全对方昵称头像（未传入 userInfoMap 时走环信用户属性接口）
  if (targetUserId.value) {
    callKit.resolveUserProfiles?.([targetUserId.value]).catch((err) => {
      logger.warn('[single-call-page] resolveUserProfiles 失败', err)
    })
  }

  // 被叫方：core-adapter 已把状态设为 ringing，只展示待接听页面，不发起呼叫
  if (callState.status === 'ringing' && !callState.isCaller) {
    logger.debug('[single-call-page] 被叫方进入待接听页')
    return
  }

  // 主叫方：若当前已在通话中，不允许重复发起，直接返回
  if (callState.status === 'in_call') {
    logger.warn('[single-call-page] 当前已在通话中，无法发起新呼叫')
    uni.showToast({ title: '当前正在通话中', icon: 'none' })
    uni.navigateBack({ delta: 1 })
    return
  }

  // 主叫方：若当前正在呼叫/响铃中，先挂断旧呼叫再发起新呼叫
  if (callState.status === 'inviting' || callState.status === 'ringing') {
    logger.warn('[single-call-page] 存在进行中的呼叫，先挂断', { status: callState.status })
    try {
      await callKit.core.hangup({ callId: callState.callId, reason: 'cancel' })
    } catch (err) {
      logger.error('[single-call-page] 挂断旧呼叫失败', err)
    }
    uni.showToast({ title: '已结束上一次呼叫', icon: 'none' })
    resetCallState()
  }

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
    logger.error('[inviteCall error]', err)
    uni.showToast({ title: '呼叫失败', icon: 'none' })
  })
})

onUnload(() => {
  stopWaitingTimer()
  hideNetworkToast()
  const callKit = uni.$callKit

  // 页面被关闭/返回时，若仍有进行中的通话，主动挂断并通知对方
  if (callState.status === 'in_call' || callState.status === 'inviting' || callState.status === 'ringing') {
    const reason = callState.status === 'in_call' ? 'normal' : 'cancel'
    callKit?.core
      ?.hangup?.({ callId: callState.callId, reason })
      .catch((err) => {
        logger.error('[single-call-page] onUnload hangup failed', err)
      })
  }

  callKit?.rtcAdapter?.leaveChannel()
})

onShow(() => {
  logger.debug('[single-call-page] onShow')
  // 切回前台后恢复远端播放；本地推流依赖 background-mute 已静音，无需重启
  if (callState.status === 'in_call') {
    remotePlayerRef.value?.start?.()
  }
})

onHide(() => {
  logger.debug('[single-call-page] onHide')
  // 切后台时远端播放由系统暂停，本地推流 background-mute=true 保持静音推流
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

// 对端用户 ID 变化时（如被叫方从 URL 参数切换到 core 设置的 remoteUserId），自动补全资料
watch(displayUserId, (userId) => {
  if (!userId) return
  const callKit = uni.$callKit
  const cached = callState.userInfoMap[userId]
  if (callKit?.resolveUserProfiles && !cached?.nickname && !cached?.avatarURL) {
    callKit.resolveUserProfiles([userId]).catch((err) => {
      logger.warn('[single-call-page] resolveUserProfiles 失败', err)
    })
  }
})

function acceptCall() {
  const callKit = uni.$callKit
  if (!callState.callId) {
    logger.warn('[acceptCall] callId is empty')
    return
  }
  callKit?.core
    ?.answerCall?.({
      callId: callState.callId,
      result: 'accept'
    })
    .catch((err) => {
      logger.error('[acceptCall error]', err)
      uni.showToast({ title: '接听失败', icon: 'none' })
    })
}

function rejectCall() {
  stopWaitingTimer()
  const callKit = uni.$callKit
  if (!callState.callId) {
    logger.warn('[rejectCall] callId is empty')
    uni.navigateBack({ delta: 1 })
    return
  }
  callKit?.core
    ?.answerCall?.({
      callId: callState.callId,
      result: 'refuse'
    })
    .catch((err) => {
      logger.error('[rejectCall error]', err)
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
  logger.debug('[single-call-page] switchCamera')
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
      logger.error('[hangup error]', err)
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

.network-toast {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 16rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s ease;
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

.media-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.remote-player {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.remote-player.audio-only {
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.local-pusher {
  position: absolute;
  border-radius: 16rpx;
  overflow: hidden;
  z-index: 2;
}

.local-pusher.audio-only {
  width: 1px !important;
  height: 1px !important;
  opacity: 0;
  pointer-events: none;
}

.call-content {
  position: relative;
  z-index: 2;
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
