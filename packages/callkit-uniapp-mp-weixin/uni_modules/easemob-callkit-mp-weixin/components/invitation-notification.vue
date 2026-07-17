<template>
  <view v-if="visible" class="invitation-notification" :style="{ paddingTop: `${topSafeArea + 20}rpx` }">
    <view class="invitation-content">
      <!-- 头像 -->
      <view class="invitation-avatar">
        <image
          v-if="callerAvatar"
          class="avatar-img"
          :src="callerAvatar"
          mode="aspectFill"
        />
        <view v-else class="avatar-fallback">
          {{ callerName.charAt(0).toUpperCase() || '?' }}
        </view>
        <view class="call-type-badge">
          <image
            v-if="callType === 'video'"
            class="badge-icon"
            src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/video_camera.svg"
          />
          <image
            v-else
            class="badge-icon"
            src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/mic_on.svg"
          />
        </view>
      </view>

      <!-- 信息 -->
      <view class="invitation-info">
        <text class="caller-name">{{ callerName }}</text>
        <text class="call-description">{{ callDescription }}</text>
      </view>

      <!-- 操作按钮 -->
      <view class="invitation-actions">
        <view class="action-btn reject" :class="{ disabled: processing }" @click="handleReject">
          <image
            class="btn-icon"
            src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_hang.svg"
          />
        </view>
        <view class="action-btn accept" :class="{ disabled: processing }" @click="handleAccept">
          <image
            class="btn-icon"
            src="/uni_modules/easemob-callkit-mp-weixin/static/callkit/icons/phone_pick.svg"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  /**
   * 可选的用户资料映射表，用于查询主叫方昵称/头像。
   * 键为用户 ID，值为 { nickname, avatarURL }。
   * 若未提供或查不到，则回退到主叫用户 ID。
   */
  userInfoMap: {
    type: Object,
    default: () => ({})
  }
})

const visible = ref(false)
const processing = ref(false)
const callId = ref('')
const callerUserId = ref('')
const callTypeValue = ref(0)
let unsubscribe = null

// 顶部安全区，避免被微信小程序胶囊/状态栏遮挡
const topSafeArea = ref(0)
onMounted(() => {
  try {
    const sysInfo = uni.getSystemInfoSync()
    const menu = uni.getMenuButtonBoundingClientRect?.()
    topSafeArea.value = menu?.top || sysInfo.statusBarHeight || 0
  } catch (e) {
    topSafeArea.value = 0
  }
})

const callType = computed(() => {
  return callTypeValue.value === 1 || callTypeValue.value === 2 ? 'video' : 'audio'
})

const callerInfo = computed(() => props.userInfoMap[callerUserId.value] || {})

const callerName = computed(() => {
  return callerInfo.value.nickname || callerUserId.value || '未知用户'
})

const callerAvatar = computed(() => {
  return callerInfo.value.avatarURL || ''
})

const callDescription = computed(() => {
  return callType.value === 'video' ? '视频通话邀请' : '语音通话邀请'
})

function showNotification(payload) {
  callId.value = payload.callId || ''
  callerUserId.value = payload.callerUserId || ''
  callTypeValue.value = payload.callType || 0
  visible.value = true
}

function hideNotification() {
  visible.value = false
  processing.value = false
  callId.value = ''
  callerUserId.value = ''
  callTypeValue.value = 0
}

function isOnSingleCallPage() {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  return current && current.route?.includes('single-call-page')
}

function handleAccept() {
  if (processing.value || !callId.value) return
  processing.value = true

  const callKit = uni.$callKit
  callKit?.core
    ?.answerCall?.({ callId: callId.value, result: 'accept' })
    .then(() => {
      hideNotification()
      // 如果当前已在通话页，则不再重复跳转
      if (isOnSingleCallPage()) return
      uni.navigateTo({
        url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${callerUserId.value}&callType=${callType.value}`
      })
    })
    .catch((err) => {
      console.error('[InvitationNotification] accept failed', err)
      hideNotification()
    })
    .finally(() => {
      processing.value = false
    })
}

function handleReject() {
  if (processing.value || !callId.value) return
  processing.value = true

  const callKit = uni.$callKit
  callKit?.core
    ?.answerCall?.({ callId: callId.value, result: 'refuse' })
    .then(() => {
      hideNotification()
    })
    .catch((err) => {
      console.error('[InvitationNotification] reject failed', err)
      hideNotification()
    })
    .finally(() => {
      processing.value = false
    })
}

onMounted(() => {
  const callKit = uni.$callKit
  if (!callKit?.core?.onEvent) {
    console.warn('[InvitationNotification] uni.$callKit.core.onEvent is not available')
    return
  }

  unsubscribe = callKit.core.onEvent((event) => {
    switch (event.type) {
      case 'incomingCall':
        showNotification(event.payload || {})
        break
      case 'callAccepted':
      case 'callRefused':
      case 'callCanceled':
      case 'callEnded':
      case 'callTimeout':
      case 'callBusy':
        hideNotification()
        break
      default:
        break
    }
  })
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})
</script>

<style scoped>
.invitation-notification {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  padding: 40rpx 32rpx 24rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.25);
  animation: slide-down 0.3s ease-out;
}

@keyframes slide-down {
  from {
    opacity: 0;
    transform: translateY(-40rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.invitation-content {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.invitation-avatar {
  position: relative;
  width: 96rpx;
  height: 96rpx;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.3);
}

.avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 600;
  color: #fff;
  border: 4rpx solid rgba(255, 255, 255, 0.3);
}

.call-type-badge {
  position: absolute;
  bottom: -4rpx;
  right: -4rpx;
  width: 40rpx;
  height: 40rpx;
  background: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.2);
}

.badge-icon {
  width: 24rpx;
  height: 24rpx;
}

.invitation-info {
  flex: 1;
  min-width: 0;
  color: #fff;
}

.caller-name {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 44rpx;
  margin-bottom: 4rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.call-description {
  display: block;
  font-size: 26rpx;
  opacity: 0.9;
  line-height: 36rpx;
}

.invitation-actions {
  display: flex;
  gap: 20rpx;
  flex-shrink: 0;
}

.action-btn {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.15);
}

.action-btn.disabled {
  opacity: 0.6;
}

.action-btn.reject {
  background: #ef4444;
}

.action-btn.accept {
  background: #10b981;
}

.btn-icon {
  width: 40rpx;
  height: 40rpx;
}
</style>
