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
            src="../static/callkit/icons/video_camera.svg"
          />
          <image
            v-else
            class="badge-icon"
            src="../static/callkit/icons/mic_on.svg"
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
            src="../static/callkit/icons/phone_hang.svg"
          />
        </view>
        <view class="action-btn accept" :class="{ disabled: processing }" @click="handleAccept">
          <image
            class="btn-icon"
            src="../static/callkit/icons/phone_pick.svg"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCallState } from '@/uni_modules/easemob-callkit-mp-weixin'
import { getMpWeixinLogger } from '@/uni_modules/easemob-callkit-mp-weixin/src/utils/logger'

const logger = getMpWeixinLogger()
const { state: callState } = useCallState()

const props = defineProps({
  /**
   * 可选的用户资料映射表，用于查询主叫方昵称/头像。
   * 键为用户 ID，值为 { nickname, avatarURL }。
   * 若未提供或查不到，则回退到 callState.userInfoMap 或主叫用户 ID。
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

const isGroupCall = computed(() => {
  return callTypeValue.value === 2 || callTypeValue.value === 3
})

const callerInfo = computed(() => {
  // 优先使用 callState.userInfoMap（由 callKit.setUserInfoMap 注入）
  // 其次使用组件传入的 userInfoMap（兼容旧用法）
  return callState.userInfoMap[callerUserId.value] || props.userInfoMap[callerUserId.value] || {}
})

const callerName = computed(() => {
  return callerInfo.value.nickname || callerUserId.value || '未知用户'
})

const callerAvatar = computed(() => {
  return callerInfo.value.avatarURL || ''
})

const callDescription = computed(() => {
  if (isGroupCall.value) {
    return callType.value === 'video' ? '群视频通话邀请' : '群语音通话邀请'
  }
  return callType.value === 'video' ? '视频通话邀请' : '语音通话邀请'
})

function showNotification(payload) {
  callId.value = payload.callId || ''
  callerUserId.value = payload.callerUserId || ''
  callTypeValue.value = payload.callType || 0
  visible.value = true

  // 尝试补全主叫方昵称头像（未传入 userInfoMap 时走环信用户属性接口）
  const callKit = uni.$callKit
  if (callerUserId.value && callKit?.resolveUserProfiles) {
    callKit.resolveUserProfiles([callerUserId.value]).catch((err) => {
      logger.warn('[InvitationNotification] resolveUserProfiles 失败', err)
    })
  }
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
      if (isGroupCall.value) {
        // 群聊接听后跳群聊页，携带 callType 保持与 core-adapter 跳转契约一致
        uni.navigateTo({
          url: `/uni_modules/easemob-callkit-mp-weixin/pages/group-call-page/group-call-page?callType=${callType.value}`
        })
        return
      }
      // 如果当前已在通话页，则不再重复跳转
      if (isOnSingleCallPage()) return
      uni.navigateTo({
        url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${callerUserId.value}&callType=${callType.value}`
      })
    })
    .catch((err) => {
      logger.error('[InvitationNotification] accept failed', err)
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
      logger.error('[InvitationNotification] reject failed', err)
      hideNotification()
    })
    .finally(() => {
      processing.value = false
    })
}

let retryTimer = null

function doSubscribe(callKit) {
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
}

function trySubscribe() {
  const callKit = uni.$callKit
  if (callKit?.core?.onEvent) {
    doSubscribe(callKit)
    return
  }

  // CallKit 可能尚未初始化，轮询等待（500ms * 20 = 10s）
  if (retryTimer) return
  let retryCount = 0
  retryTimer = setInterval(() => {
    retryCount += 1
    const ck = uni.$callKit
    if (ck?.core?.onEvent) {
      clearInterval(retryTimer)
      retryTimer = null
      doSubscribe(ck)
    } else if (retryCount >= 20) {
      clearInterval(retryTimer)
      retryTimer = null
      logger.warn('[InvitationNotification] uni.$callKit 超时未就绪')
    }
  }, 500)
}

onMounted(() => {
  trySubscribe()
})

onUnmounted(() => {
  if (retryTimer) {
    clearInterval(retryTimer)
    retryTimer = null
  }
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
