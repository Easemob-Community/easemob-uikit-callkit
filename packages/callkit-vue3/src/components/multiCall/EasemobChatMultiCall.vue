<template>
  <GroupCallShell
    v-if="isVisible"
    ref="groupCallShellRef"
    :group-id="effectiveGroupId"
    :group-name="effectiveGroupName"
    :group-avatar="effectiveGroupAvatar"
    :group-members="props.groupMembers"
    :current-user-id="props.currentUserId || chatClientStore.getChatClient?.user || ''"
    :current-nickname="globalCallStore.getUserInfo(chatClientStore.getChatClient?.user)?.nickname"
    :current-avatar-url="globalCallStore.getUserInfo(chatClientStore.getChatClient?.user)?.avatarURL"
    :rtc-service="rtcChannelStore.getRtcService()"
    @hangup="handleHangup"
    @add-participant="handleAddParticipant"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRtcChannelStore } from '../../store/rtcChannel'
import { useChatClientStore } from '../../store/chatClient'
import { useGlobalCallStore } from '../../store/globalCall'
import { useCallKitCore } from '../../composables/useCallKitCore'
import { CALL_STATUS, CALL_TYPE } from '../../types/callstate.types'
import { GroupCallShell, useGroupCallStore } from '../../modules/groupCall'
import { logger } from '../../utils/logger'

const props = withDefaults(defineProps<{
  groupId?: string
  groupName?: string
  groupAvatar?: string
  type?: 'audio' | 'video'
  currentUserId?: string
  autoShow?: boolean
  groupMembers?: Array<{ userId: string; userName: string; avatar?: string }>
}>(), {
  autoShow: true,
})

const emit = defineEmits<{
  /** 通话开始（可选监听） */
  callStarted: []
  /** 通话结束（可选监听） */
  callEnded: []
  /** 添加参与者按钮点击（可选监听） */
  addParticipant: []
  /** 邀请超时（可选监听） */
  participantTimeout: [userId: string]
  /** 发生错误（可选监听） */
  error: [error: Error]
}>()

const { callState: coreCallState, onCallEvent } = useCallKitCore()
const rtcChannelStore = useRtcChannelStore()
const chatClientStore = useChatClientStore()
const globalCallStore = useGlobalCallStore()
const groupCallStore = useGroupCallStore()

const groupCallShellRef = ref<InstanceType<typeof GroupCallShell> | null>(null)
let unsubscribeEvent: (() => void) | null = null

// groupId/groupName/groupAvatar 优先使用外部 prop，无则从 store 兜底
// 被叫方场景：calleeUserId / groupCallStore.session.groupId 就是 groupId
const effectiveGroupId = computed(() =>
  props.groupId || coreCallState.calleeUserId || groupCallStore.session?.groupId || ''
)
const effectiveGroupName = computed(() => {
  if (props.groupName) return props.groupName
  return groupCallStore.session?.groupName || ''
})
const effectiveGroupAvatar = computed(() => props.groupAvatar || '')

// 群聊通话页面可见性（事件驱动）
// - incomingCall: 不显示（由 InvitationNotification 处理响铃）
// - callAccepted / callConnected / callStarted: 显示（被叫接受或通话连接）
// - callEnded / callCanceled / callRefused / callTimeout / callBusy: 隐藏
const isVisible = ref(props.autoShow === false)

function showCallWindow() {
  if (props.autoShow === false) return // autoShow=false 时外部控制，不响应事件
  if (!isVisible.value) {
    isVisible.value = true
    logger.info('[EasemobChatMultiCall] 显示群聊通话页面')
  }
}

function hideCallWindow() {
  if (props.autoShow === false) return // autoShow=false 时外部控制，不响应事件
  if (isVisible.value) {
    isVisible.value = false
    logger.info('[EasemobChatMultiCall] 隐藏群聊通话页面')
  }
}

const handleHangup = () => {
  emit('callEnded')
}

const handleAddParticipant = () => {
  emit('addParticipant')
}

// 主叫方 / 被邀请方：GroupCallShell 可能因 v-if 延迟渲染，
// 监听 ref 变化自动补调 startSession（幂等，重复调用安全）
watch(
  groupCallShellRef,
  (shell, prevShell) => {
    if (shell && !prevShell) {
      const type = coreCallState.type
      const isGroupCall = type === CALL_TYPE.VIDEO_MULTI || type === CALL_TYPE.AUDIO_MULTI
      if (!isGroupCall) {
        logger.info('[EasemobChatMultiCall] shell 渲染但不在群通话状态，跳过 startSession')
        return
      }
      const callType = type === CALL_TYPE.AUDIO_MULTI ? 'audio' : 'video'
      shell.startSession({
        sessionId: coreCallState.channel || '',
        callType,
      })
      emit('callStarted')
    }
  },
  { immediate: false }
)

// 事件驱动：订阅精确群聊事件控制显示/隐藏
function setupEventListeners() {
  unsubscribeEvent = onCallEvent((event) => {
    switch (event.type) {
      case 'groupCallInvited':
      case 'groupCallAccepted':
      case 'groupCallConnected':
      case 'groupCallStarted':
        // 邀请发出 / 被叫接受 / 通话连接 / 通话开始 → 显示通话页面
        showCallWindow()
        break
      case 'groupCallEnded':
      case 'groupCallCanceled':
      case 'groupCallRefused':
      case 'groupCallTimeout':
      case 'groupCallBusy':
        // 通话结束 → 隐藏通话页面
        hideCallWindow()
        emit('callEnded')
        break
    }
  })
}

onMounted(() => {
  setupEventListeners()

  // 兜底：组件挂载时如果已在活跃通话中，立即显示
  // 这处理页面刷新/路由切换后重新挂载的场景
  const status = coreCallState.status
  const isGroupCall = coreCallState.type === CALL_TYPE.VIDEO_MULTI || coreCallState.type === CALL_TYPE.AUDIO_MULTI
  const isActiveStatus = status === CALL_STATUS.ANSWER_CALL || status === CALL_STATUS.CONFIRM_CALLEE || status === CALL_STATUS.IN_CALL
  if (props.autoShow !== false && isGroupCall && isActiveStatus) {
    logger.info('[EasemobChatMultiCall] 组件挂载时发现活跃群聊通话，立即显示')
    isVisible.value = true
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
/* 薄 wrapper，无额外样式 */
</style>
