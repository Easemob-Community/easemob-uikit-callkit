<template>
  <view class="meeting-page">
    <view class="info">
      <text class="title">通话中</text>
      <text class="subtitle">对方：{{ targetUserId }}</text>
      <text class="subtitle">类型：{{ callType === 'video' ? '视频' : '语音' }}</text>
      <text class="subtitle">状态：{{ callState.status }}</text>
      <text v-if="callState.duration > 0" class="subtitle">时长：{{ callState.duration }}s</text>
    </view>

    <view class="toolbar">
      <button class="btn" @click="toggleAudio">{{ callState.audioEnabled ? '静音' : '取消静音' }}</button>
      <button v-if="callType === 'video'" class="btn" @click="toggleVideo">{{ callState.videoEnabled ? '关闭摄像头' : '打开摄像头' }}</button>
      <button class="btn danger" @click="hangup">挂断</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useCallState, CALL_TYPE } from '@/uni_modules/easemob-callkit-mp-weixin'

const targetUserId = ref('')
const callType = ref('audio')
const { state: callState } = useCallState()

onLoad((options) => {
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'

  // TODO: 通过 uni.$callKit.core.inviteCall 发起呼叫
  const callKit = uni.$callKit
  if (callKit && targetUserId.value) {
    callKit.core.inviteCall({
      calleeUserId: targetUserId.value,
      callType: callType.value === 'video' ? CALL_TYPE.VIDEO_SINGLE : CALL_TYPE.AUDIO_SINGLE
    }).catch((err) => {
      console.error('[inviteCall error]', err)
      uni.showToast({ title: '呼叫失败', icon: 'none' })
    })
  }
})

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
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #1a1a1a;
  color: #fff;
}
.info {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 80rpx;
}
.title {
  font-size: 48rpx;
  margin-bottom: 24rpx;
}
.subtitle {
  font-size: 28rpx;
  color: #ccc;
  margin-top: 12rpx;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  width: 80%;
}
.btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 12rpx;
  background-color: #444;
  color: #fff;
}
.btn.danger {
  background-color: #ff4d4f;
}
</style>
