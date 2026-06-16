<template>
  <Transition name="slide-down">
    <div v-if="visible" class="invitation-notification">
      <div class="invitation-content">
        <!-- 头像 -->
        <div class="invitation-avatar">
          <img v-if="callerAvatar" :src="callerAvatar" :alt="callerName" />
          <div v-else class="avatar-placeholder">
            {{ callerName?.[0]?.toUpperCase() || '?' }}
          </div>
          <div class="call-type-badge">
            <svg v-if="callType === 'video'" width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M3.88889 5C2.84568 5 2 5.84568 2 6.88889V17.1111C2 18.1543 2.84568 19 3.88889 19H15.8611C16.9043 19 17.75 18.1543 17.75 17.1111V15.3089L21.0178 17.1244C21.4585 17.3692 22 17.0505 22 16.5464V7.46025C22 6.95616 21.4585 6.63753 21.0178 6.88233L17.75 8.69779V6.88889C17.75 5.84568 16.9043 5 15.8611 5H3.88889ZM5.5 10C6.32843 10 7 9.32843 7 8.5C7 7.67157 6.32843 7 5.5 7C4.67157 7 4 7.67157 4 8.5C4 9.32843 4.67157 10 5.5 10Z" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.8237 15.5557C13.8754 15.5557 14.1849 15.2833 14.2881 15.2288C14.4945 15.1198 14.6493 15.0109 14.8041 14.9564C15.8876 14.466 16.8163 14.7929 18.0547 16.3731C18.8286 17.3538 19.035 18.1712 18.777 18.934C18.5706 19.4789 18.1063 19.9148 17.3839 20.3507C17.3323 20.4052 16.9195 20.6776 16.7647 20.7321C15.0105 21.8764 10.9343 19.2609 7.99333 14.6839C5.05231 10.1614 4.27837 5.31201 6.08425 4.11328L6.34223 3.94982L6.60022 3.78635C7.52896 3.18698 8.09651 2.91454 8.76727 3.02351C9.43803 3.13249 10.0572 3.67737 10.5216 4.65816C11.5535 6.72869 11.3471 7.70948 10.0056 8.63578C9.9024 8.69027 9.54123 8.90822 9.54123 8.96271C9.23164 9.18066 9.74761 10.6518 11.0891 12.6134C12.379 14.6839 13.4626 15.8282 13.8237 15.5557Z" />
            </svg>
          </div>
        </div>

        <!-- 信息 -->
        <div class="invitation-info">
          <div class="caller-name">{{ callerName }}</div>
          <div class="call-description">{{ callDescription }}</div>
        </div>

        <!-- 操作按钮 -->
        <div class="invitation-actions">
          <button class="reject-btn" @click="handleReject" :disabled="processing">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.43445 12.6265C8.40888 12.6658 8.46336 13.037 8.45381 13.1428C8.43469 13.3543 8.44114 13.5264 8.40602 13.6715C8.24328 14.7412 7.53366 15.2879 5.71437 15.4497C4.58252 15.5543 3.85663 15.3068 3.4024 14.7319C3.08891 14.3045 2.98642 13.7342 3.01174 12.967C2.99573 12.9006 2.99239 12.4507 3.02751 12.3056C3.02369 10.4 7.03906 8.58585 11.9887 8.60976C16.8967 8.60665 20.9804 10.4191 21.0002 12.3909L20.9971 12.6688L20.994 12.9466C20.9911 13.9523 20.9178 14.5203 20.5023 14.9781C20.0867 15.4359 19.3642 15.6384 18.3857 15.5067C16.2946 15.2681 15.6485 14.6246 15.6064 13.1421C15.616 13.0363 15.6286 12.6527 15.5871 12.6257C15.5742 12.2815 14.196 11.9462 12.0345 11.9979C9.81551 11.9561 8.40554 12.2159 8.43445 12.6265Z" />
            </svg>
          </button>
          <button class="accept-btn" @click="handleAccept" :disabled="processing">
            <svg v-if="callType === 'video'" width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M3.88889 5C2.84568 5 2 5.84568 2 6.88889V17.1111C2 18.1543 2.84568 19 3.88889 19H15.8611C16.9043 19 17.75 18.1543 17.75 17.1111V15.3089L21.0178 17.1244C21.4585 17.3692 22 17.0505 22 16.5464V7.46025C22 6.95616 21.4585 6.63753 21.0178 6.88233L17.75 8.69779V6.88889C17.75 5.84568 16.9043 5 15.8611 5H3.88889ZM5.5 10C6.32843 10 7 9.32843 7 8.5C7 7.67157 6.32843 7 5.5 7C4.67157 7 4 7.67157 4 8.5C4 9.32843 4.67157 10 5.5 10Z" />
            </svg>
            <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.8237 15.5557C13.8754 15.5557 14.1849 15.2833 14.2881 15.2288C14.4945 15.1198 14.6493 15.0109 14.8041 14.9564C15.8876 14.466 16.8163 14.7929 18.0547 16.3731C18.8286 17.3538 19.035 18.1712 18.777 18.934C18.5706 19.4789 18.1063 19.9148 17.3839 20.3507C17.3323 20.4052 16.9195 20.6776 16.7647 20.7321C15.0105 21.8764 10.9343 19.2609 7.99333 14.6839C5.05231 10.1614 4.27837 5.31201 6.08425 4.11328L6.34223 3.94982L6.60022 3.78635C7.52896 3.18698 8.09651 2.91454 8.76727 3.02351C9.43803 3.13249 10.0572 3.67737 10.5216 4.65816C11.5535 6.72869 11.3471 7.70948 10.0056 8.63578C9.9024 8.69027 9.54123 8.90822 9.54123 8.96271C9.23164 9.18066 9.74761 10.6518 11.0891 12.6134C12.379 14.6839 13.4626 15.8282 13.8237 15.5557Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCallKitCore } from '../composables/useCallKitCore'
import { useChatClientStore } from '../store/chatClient'
import { useCallKit } from '../composables/useCallKit'
import { CALL_TYPE } from '../types/callstate.types'
import { logger } from '../utils/logger'
import { useGroupCallStore } from '../modules/groupCall'
import { useGlobalCallStore } from '../store/globalCall'
import type { CallKitEvent } from '@easemob/callkit-core'

const { callState: coreCallState, onCallEvent, isWaitingCalleeAction } = useCallKitCore()
const chatClientStore = useChatClientStore()
const groupCallStore = useGroupCallStore()
const globalCallStore = useGlobalCallStore()
const { accept, reject } = useCallKit()

const visible = ref(false)
const processing = ref(false)
let unsubscribeEvent: (() => void) | null = null

// 计算属性
const callerName = computed(() => {
  const callerUserId = coreCallState.callerUserId
  if (callerUserId) {
    const userInfo = globalCallStore.getUserInfo(callerUserId)
    return userInfo?.nickname || callerUserId
  }
  return '未知用户'
})

const callerAvatar = computed(() => {
  const callerUserId = coreCallState.callerUserId
  if (callerUserId) {
    const userInfo = globalCallStore.getUserInfo(callerUserId)
    return userInfo?.avatarURL || ''
  }
  return ''
})

const callType = computed(() => {
  const type = coreCallState.type
  if (type === CALL_TYPE.VIDEO_1V1 || type === CALL_TYPE.VIDEO_MULTI) return 'video'
  if (type === CALL_TYPE.AUDIO_1V1 || type === CALL_TYPE.AUDIO_MULTI) return 'audio'
  return 'audio'
})

const isGroupCall = computed(() => {
  const type = coreCallState.type
  return type === CALL_TYPE.VIDEO_MULTI || type === CALL_TYPE.AUDIO_MULTI
})

const callDescription = computed(() => {
  const base = callType.value === 'video' ? '视频通话' : '语音通话'
  if (isGroupCall.value) {
    const groupName = groupCallStore.session?.groupName
    return `邀请您加入${groupName ? `「${groupName}」` : '群组'}${base}`
  }
  return `${base}邀请`
})

// 检查 ChatClient 是否已登录
const isChatClientReady = computed(() => {
  const client = chatClientStore.getChatClient
  // 检查 client 存在且已登录（通过检查 deviceId 是否存在来判断）
  return client && chatClientStore.getClientDeviceId
})

// 显示弹窗（事件驱动：incomingCall）
function showNotification(event?: CallKitEvent) {
  if (!isChatClientReady.value) {
    logger.warn('🔔 [InvitationNotification] ❌ ChatClient 未就绪，无法显示弹窗')
    visible.value = false
    return
  }
  if (!visible.value) {
    visible.value = true
    logger.info('🔔 [InvitationNotification] ✅ 显示通话邀请弹窗 (事件驱动)')
  }
}

// 隐藏弹窗（事件驱动：callAccepted / callRejected / callCanceled / callEnded）
function hideNotification(eventType: string) {
  if (visible.value) {
    visible.value = false
    logger.info(`🔔 [InvitationNotification] 隐藏弹窗 (事件: ${eventType})`)
  }
}

// 事件驱动：订阅 core 事件
function setupEventListeners() {
  unsubscribeEvent = onCallEvent((event) => {
    switch (event.type) {
      case 'incomingCall':
        showNotification(event)
        break
      case 'callAccepted':
      case 'callRefused':
      case 'callCanceled':
      case 'callEnded':
      case 'callTimeout':
      case 'callBusy':
      // 精确单聊/群聊结束事件也关闭弹窗
      case 'singleCallRefused':
      case 'singleCallCanceled':
      case 'singleCallEnded':
      case 'singleCallTimeout':
      case 'singleCallBusy':
      case 'groupCallRefused':
      case 'groupCallCanceled':
      case 'groupCallEnded':
      case 'groupCallTimeout':
      case 'groupCallBusy':
        hideNotification(event.type)
        break
    }
  })
}

// 接听
const handleAccept = async () => {
  logger.info('>>> InvitationNotification.handleAccept 被调用')
  if (processing.value) return

  // 检查 ChatClient 是否已登录
  if (!isChatClientReady.value) {
    logger.error('InvitationNotification: ChatClient未登录或未初始化，无法接听通话')
    logger.error('接听失败: 请先登录环信账号')
    visible.value = false
    return
  }

  processing.value = true
  try {
    logger.info('>>> 开始调用 accept()')
    await accept()
    visible.value = false
  } catch (error) {
    logger.error('InvitationNotification: 接听失败:', error)
    logger.error('接听失败:', error)
    // 兜底：信令发送失败也要关闭弹窗
    visible.value = false
  } finally {
    processing.value = false
  }
}

// 拒绝
const handleReject = async () => {
  logger.info('>>> InvitationNotification.handleReject 被调用')
  if (processing.value) return

  // 检查 ChatClient 是否已登录
  if (!isChatClientReady.value) {
    logger.error('InvitationNotification: ChatClient未登录或未初始化，无法拒绝通话')
    logger.error('拒绝失败: 请先登录环信账号')
    visible.value = false
    return
  }

  processing.value = true
  try {
    logger.info('>>> 开始调用 reject()')
    await reject()
    visible.value = false
  } catch (error) {
    logger.error('InvitationNotification: 拒绝失败:', error)
    logger.error('拒绝失败:', error)
    // 兜底：信令发送失败也要关闭弹窗
    visible.value = false
  } finally {
    processing.value = false
  }
}

// 初始化检查
onMounted(() => {
  // 设置事件监听（事件驱动模式）
  setupEventListeners()

  // 兜底：页面刷新/路由切换场景，通过谓词检查当前状态
  const waiting = isWaitingCalleeAction()
  logger.info(
    `🔔 [InvitationNotification] onMounted | isWaitingCalleeAction=${waiting} | isChatClientReady=${isChatClientReady.value}`
  )
  if (waiting && isChatClientReady.value) {
    visible.value = true
    logger.info('🔔 [InvitationNotification] ✅ 组件挂载时发现待处理的通话邀请，立即显示弹窗')
  } else if (waiting && !isChatClientReady.value) {
    logger.warn('🔔 [InvitationNotification] ❌ 组件挂载时有通话邀请，但用户未登录')
  } else {
    logger.info('🔔 [InvitationNotification] ℹ️ 组件挂载时无待处理邀请')
  }
})

onUnmounted(() => {
  if (unsubscribeEvent) {
    unsubscribeEvent()
    unsubscribeEvent = null
  }
})
</script>

<style scoped>
.invitation-notification {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 16px;
  min-width: 360px;
  max-width: 400px;
  backdrop-filter: blur(10px);
}

.invitation-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.invitation-avatar {
  position: relative;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.invitation-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
  color: white;
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.call-type-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.invitation-info {
  flex: 1;
  min-width: 0;
  color: white;
}

.caller-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.call-description {
  font-size: 14px;
  opacity: 0.9;
  line-height: 20px;
}

.invitation-actions {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.invitation-actions button {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.invitation-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reject-btn {
  background: #ef4444;
}

.reject-btn:hover:not(:disabled) {
  background: #dc2626;
  transform: scale(1.05);
}

.accept-btn {
  background: #10b981;
}

.accept-btn:hover:not(:disabled) {
  background: #059669;
  transform: scale(1.05);
}

/* 动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>
