<template>
  <view class="meeting-page">
    <text class="tip">通话页面占位 - targetUserId: {{ targetUserId }}, callType: {{ callType }}</text>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const targetUserId = ref('')
const callType = ref('audio')

onLoad((options) => {
  targetUserId.value = options?.targetUserId || ''
  callType.value = options?.callType || 'audio'
  console.log('[meeting] onLoad', options)
})
</script>

<style>
.meeting-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #1a1a1a;
}
.tip {
  color: #fff;
  font-size: 28rpx;
}
</style>
