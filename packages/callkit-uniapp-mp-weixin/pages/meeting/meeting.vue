<template>
  <view class="single-call-page" :class="{ 'audio-call': callState.callType === 'audio' }">
    <!-- 视频通话背景图（语音通话用深色纯色） -->
    <image
      v-if="callState.callType === 'video'"
      class="call-bg"
      src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/images/callkit_bg.png"
      mode="aspectFill"
    />
    <view v-else class="call-bg audio-bg" />

    <!-- 顶部信息栏 -->
    <view class="header-info">
      <view class="avatar-wrap">
        <image
          v-if="targetUserInfo.avatarURL"
          class="avatar"
          :src="targetUserInfo.avatarURL"
          mode="aspectFill"
        />
        <view v-else class="avatar avatar-fallback">{{ displayName.charAt(0).toUpperCase() }}</view>
      </view>
      <text class="target-name">{{ displayName }}</text>
      <text class="call-status">{{ statusText }}</text>
      <text v-if="callState.status === 'in_call'" class="call-timer">{{ formattedDuration }}</text>
    </view>

    <!-- 底部控制栏 -->
    <view class="control-bar">
      <!-- 被叫待接听 -->
      <template v-if="callState.status === 'ringing' && !callState.isCaller">
        <view class="control-row">
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
        </view>
      </template>

      <!-- 主叫等待 / 通话中 -->
      <template v-else>
        <view class="control-row">
          <view class="control-item" @click="toggleAudio">
            <view class="control-btn" :class="{ muted: !callState.audioEnabled }">
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
            <view class="control-btn" :class="{ muted: !callState.videoEnabled }">
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

          <view class="control-item" @click="hangup">
            <view class="control-btn danger">
              <image class="btn-icon" src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg" />
            </view>
            <text class="btn-label">挂断</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { useCallState, CALL_TYPE } from '@/uni_modules/easemob-callkit-mp-weixin'

const targetUserId = ref('')
const callType = ref('audio')
const { state: callState } = useCallState()

const targetUserInfo = computed(() => ({
  avatarURL: '',
  nickname: ''
}))

const displayName = computed(() => targetUserInfo.value.nickname || targetUserId.value || '')

const statusText = computed(() => {
  if (callState.status === 'ringing' && !callState.isCaller) return '邀请你进行语音通话'
  if (callState.status === 'inviting') return callState.callType === 'video' ? '正在呼叫对方...' : '正在呼叫对方...'
  if (callState.status === 'in_call') return callState.callType === 'video' ? '视频通话中' : '语音通话中'
  return '通话结束'
})

const formattedDuration = computed(() => {
  const m = Math.floor(callState.duration / 60).toString().padStart(2, '0')
  const s = (callState.duration % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

onLoad((options) => {
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'

  const callKit = uni.$callKit
  if (!callKit || !targetUserId.value) return

  // 空闲状态说明是主叫主动发起
  if (callState.status === 'idle') {
    callState.status = 'inviting'
    callState.targetUserId = targetUserId.value
    callState.callType = callType.value
    callState.isCaller = true
    callState.audioEnabled = true
    callState.videoEnabled = callType.value === 'video'

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
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.leaveChannel()
})

watch(() => callState.status, (status) => {
  if (status === 'idle') {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    if (current && current.route?.includes('meeting')) {
      uni.navigateBack({ delta: 1 })
    }
  }
})

function acceptCall() {
  const callKit = uni.$callKit
  callKit?.core?.answerCall?.({
    callerUserId: targetUserId.value,
    callType: callType.value === 'video' ? CALL_TYPE.VIDEO_1V1 : CALL_TYPE.AUDIO_1V1
  })
}

function rejectCall() {
  const callKit = uni.$callKit
  callKit?.core?.rejectCall?.({ callerUserId: targetUserId.value })
}

function toggleAudio() {
  callState.audioEnabled = !callState.audioEnabled
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.setAudioEnabled(callState.audioEnabled)
}

function toggleVideo() {
  callState.videoEnabled = !callState.videoEnabled
  const callKit = uni.$callKit
  callKit?.rtcAdapter?.setVideoEnabled(callState.videoEnabled)
}

function hangup() {
  const callKit = uni.$callKit
  callKit?.core?.hangup?.()
}
</script>

<style scoped>
.single-call-page {
  position: relative;
  width: 100vw;
  height: 100vh;
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
}
.audio-bg {
  background: #1a1a2e;
}

.header-info {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 180rpx;
}
.avatar-wrap {
  width: 200rpx;
  height: 200rpx;
  border-radius: 50%;
  overflow: hidden;
  margin-bottom: 40rpx;
  background: rgba(255, 255, 255, 0.15);
}
.avatar {
  width: 100%;
  height: 100%;
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 80rpx;
  color: #fff;
}
.target-name {
  font-size: 48rpx;
  font-weight: 600;
  margin-bottom: 20rpx;
}
.call-status {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 16rpx;
}
.call-timer {
  font-size: 32rpx;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.control-bar {
  position: absolute;
  bottom: 120rpx;
  left: 0;
  right: 0;
  z-index: 1;
  padding: 0 80rpx;
}
.control-row {
  display: flex;
  justify-content: space-around;
  align-items: center;
}
.control-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.control-btn {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16rpx;
}
.control-btn.muted {
  background: rgba(255, 255, 255, 0.9);
}
.control-btn.danger {
  background: #ff4d4f;
}
.control-btn.accept {
  background: #52c41a;
}
.btn-icon {
  width: 56rpx;
  height: 56rpx;
}
.control-btn.muted .btn-icon {
  filter: invert(1);
}
.btn-label {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
}
</style>
