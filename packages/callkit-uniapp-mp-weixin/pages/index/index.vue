<template>
  <view class="content">
    <view class="logo-section">
      <text class="h1">Easemob CallKit</text>
      <text class="h2">UniApp 微信小程序</text>
    </view>

    <view class="form-section">
      <input
        class="input"
        placeholder="输入对方用户 ID"
        v-model="targetUserId"
      />
      <view class="btn-group">
        <button class="btn primary" @click="startAudioCall">语音呼叫</button>
        <button class="btn primary" @click="startVideoCall">视频呼叫</button>
      </view>
    </view>

    <view class="footer">
      <text>当前用户：{{ currentUserId || '未登录' }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'

const currentUserId = ref('')
const targetUserId = ref('')

// TODO: 接入环信 IM 登录后填充 currentUserId

function startAudioCall() {
  if (!targetUserId.value) {
    uni.showToast({ title: '请输入对方用户 ID', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/meeting/meeting?targetUserId=${targetUserId.value}&callType=audio`
  })
}

function startVideoCall() {
  if (!targetUserId.value) {
    uni.showToast({ title: '请输入对方用户 ID', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/meeting/meeting?targetUserId=${targetUserId.value}&callType=video`
  })
}
</script>

<style>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 60rpx;
}
.logo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 80rpx;
}
.h1 {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
}
.h2 {
  font-size: 28rpx;
  color: #666;
  margin-top: 12rpx;
}
.form-section {
  width: 100%;
}
.input {
  width: 100%;
  height: 88rpx;
  border: 1rpx solid #ddd;
  border-radius: 12rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  margin-bottom: 40rpx;
}
.btn-group {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 12rpx;
  font-size: 32rpx;
}
.btn.primary {
  background-color: #2979ff;
  color: #fff;
}
.footer {
  margin-top: auto;
  padding-top: 80rpx;
  font-size: 24rpx;
  color: #999;
}
</style>
