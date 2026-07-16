<template>
  <view class="meeting-page">
    <view class="info">
      <text class="title">{{ pageTitle }}</text>
      <text class="subtitle">对方：{{ targetUserId }}</text>
      <text class="subtitle">类型：{{ callType === 'video' ? '视频' : '语音' }}</text>
      <text class="subtitle">状态：{{ statusText }}</text>
      <text v-if="callState.duration > 0" class="subtitle">时长：{{ callState.duration }}s</text>
    </view>

    <view class="toolbar">
      <!-- 被叫待接听 -->
      <template v-if="callState.status === 'ringing' && !callState.isCaller">
        <button class="btn primary" @click="acceptCall">接听</button>
        <button class="btn danger" @click="rejectCall">拒绝</button>
      </template>

      <!-- 通话中/主叫等待中 -->
      <template v-else>
        <button class="btn" @click="toggleAudio">{{ callState.audioEnabled ? '静音' : '取消静音' }}</button>
        <button v-if="callType === 'video'" class="btn" @click="toggleVideo">{{ callState.videoEnabled ? '关闭摄像头' : '打开摄像头' }}</button>
        <button class="btn danger" @click="hangup">挂断</button>
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

const pageTitle = computed(() => {
  if (callState.status === 'ringing' && !callState.isCaller) return '来电中'
  if (callState.status === 'in_call') return '通话中'
  return '呼叫中'
})

const statusText = computed(() => {
  const map = {
    idle: '空闲',
    inviting: '呼叫中',
    ringing: callState.isCaller ? '等待对方接听' : '来电中',
    in_call: '通话中',
    ended: '已结束'
  }
  return map[callState.status] || callState.status
})

onLoad((options) => {
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'

  const callKit = uni.$callKit
  if (!callKit || !targetUserId.value) return

  // 如果当前是空闲状态，说明是主叫主动发起
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

// 监听通话结束自动返回
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
  uni.navigateBack()
}
</script>

<style>
.meeting-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 60rpx;
  height: 100vh;
  box-sizing: border-box;
}
.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 120rpx;
}
.title {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 40rpx;
}
.subtitle {
  font-size: 28rpx;
  color: #666;
  margin-top: 16rpx;
}
.toolbar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  margin-bottom: 60rpx;
}
.btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 12rpx;
  font-size: 32rpx;
  background-color: #f5f5f5;
  color: #333;
}
.btn.primary {
  background-color: #52c41a;
  color: #fff;
}
.btn.danger {
  background-color: #ff4d4f;
  color: #fff;
}
</style>
