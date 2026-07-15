import { ref, computed, watch, onUnmounted, type ComputedRef, type Ref } from 'vue'
import { useGroupCallStore } from './GroupCallStore'
import { useGlobalCallStore } from '../../../store/globalCall'
import { RtcMediaBridge } from '../media/RtcMediaBridge'
import { GroupCallSignalingAdapter } from '../signaling/GroupCallSignalingAdapter'
import type { RtcService } from '../../../services/RtcService'
import type { Participant } from '../types'
import { logger } from '../../../utils/logger'

export interface UseGroupCallViewModelReturn {
  // 状态
  isActive: ComputedRef<boolean>
  participants: ComputedRef<Participant[]>
  localParticipant: ComputedRef<Participant | undefined>
  callDuration: Ref<number>
  selectedParticipantId: Ref<string | null>

  // 动作
  startSession: (payload: {
    sessionId: string
    groupId: string
    callType: 'video' | 'audio'
    localUserId: string
    localNickname: string
    localAvatarUrl?: string
  }) => void

  addRemoteParticipant: (userId: string, nickname: string, avatarUrl?: string) => void
  markRemoteAccepted: (userId: string) => void
  bindRtcService: (rtcService: RtcService) => void
  unbindRtcService: () => void

  sendInvite: (userIds: string[], groupId: string, message: string) => Promise<void>
  clearInvitationTimer: (userId: string) => void
  hangup: () => Promise<void>

  // 本地媒体控制
  setLocalStream: (stream: MediaStream | null) => void
  setLocalMute: (isMuted: boolean) => void
  setLocalCamera: (isCameraOn: boolean) => void
  setLocalVideoTrack: (track: any) => void

  // 布局控制
  selectParticipant: (userId: string | null) => void
}

/**
 * useGroupCallViewModel
 * 群组通话的顶层 ViewModel，连接 Store、MediaBridge、SignalingAdapter
 */
export function useGroupCallViewModel(): UseGroupCallViewModelReturn {
  const store = useGroupCallStore()
  const signaling = new GroupCallSignalingAdapter()

  let mediaBridge: RtcMediaBridge | null = null
  // 群聊域本地视频流订阅取消函数（阶段 4：替代 useCallKitRtc 全局状态）
  let _unsubscribeLocalStream: (() => void) | null = null

  /* ========== 邀请超时定时器 ========== */
  const _invitationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const INVITE_TIMEOUT_MS = 30000

  function clearInvitationTimer(userId: string) {
    const timer = _invitationTimers.get(userId)
    if (timer) {
      clearTimeout(timer)
      _invitationTimers.delete(userId)
    }
  }

  function clearAllInvitationTimers() {
    _invitationTimers.forEach(timer => clearTimeout(timer))
    _invitationTimers.clear()
  }

  // 监听参与者列表：新 invited 成员自动设超时；加入/移除/拒绝时清理定时器
  watch(
    () => store.participantList.map(p => ({ userId: p.userId, state: p.state })),
    (list, prevList) => {
      const prevMap = new Map((prevList || []).map(p => [p.userId, p.state]))
      const currentIds = new Set(list.map(p => p.userId))

      list.forEach(p => {
        // 新 invited 成员：设置超时定时器
        if (p.state === 'invited' && prevMap.get(p.userId) !== 'invited' && !_invitationTimers.has(p.userId)) {
          const timer = setTimeout(() => {
            logger.info('[useGroupCallViewModel] 邀请超时，移除参与者', p.userId)
            signaling.cancelInvitation(p.userId, store.session?.groupId || '')
            store.removeParticipant(p.userId)
            _invitationTimers.delete(p.userId)
          }, INVITE_TIMEOUT_MS)
          _invitationTimers.set(p.userId, timer)
        }
        // 状态变为非 invited（加入/拒绝/离开）：清理定时器
        if (p.state !== 'invited' && _invitationTimers.has(p.userId)) {
          clearInvitationTimer(p.userId)
        }
      })

      // 成员被完全移除（旧架构直接 removeParticipant）：清理残留定时器
      prevList?.forEach(p => {
        if (!currentIds.has(p.userId) && _invitationTimers.has(p.userId)) {
          clearInvitationTimer(p.userId)
        }
      })
    },
    { deep: true, immediate: true }
  )

  const isActive = computed(() => store.session?.isActive ?? false)
  const participants = computed(() => store.participantList)
  const localParticipant = computed(() => store.localParticipant)
  const callDuration = ref(0)
  let _durationTimer: ReturnType<typeof setInterval> | null = null

  function startDurationTimer() {
    if (_durationTimer) clearInterval(_durationTimer)
    _durationTimer = setInterval(() => {
      if (store.session?.startTime) {
        callDuration.value = Math.floor((Date.now() - store.session.startTime) / 1000)
      }
    }, 1000)
  }

  function stopDurationTimer() {
    if (_durationTimer) {
      clearInterval(_durationTimer)
      _durationTimer = null
    }
    callDuration.value = 0
  }
  const selectedParticipantId = ref<string | null>(null)

  function selectParticipant(userId: string | null) {
    selectedParticipantId.value = userId
  }

  // 组件卸载时清理 timer，防止内存泄漏
  onUnmounted(() => {
    stopDurationTimer()
    clearAllInvitationTimers()
  })

  function startSession(payload: {
    sessionId: string
    groupId: string
    callType: 'video' | 'audio'
    localUserId: string
    localNickname: string
    localAvatarUrl?: string
  }) {
    const existingSession = store.session
    if (!existingSession || existingSession.sessionId !== payload.sessionId) {
      // 全新会话：清空并初始化
      store.initSession({
        sessionId: payload.sessionId,
        groupId: payload.groupId,
        callType: payload.callType,
        isActive: true,
        startTime: Date.now(),
      })
    } else {
      // 被邀请方：store 已在收到 invite 时初始化，保留远程参与者，只更新会话元数据
      store.session = { ...existingSession, isActive: true, startTime: Date.now() }
    }

    // 确保本地用户存在（主叫/被叫都需要）
    if (!store.participants.has(payload.localUserId)) {
      store.addParticipant({
        userId: payload.localUserId,
        nickname: payload.localNickname,
        avatarUrl: payload.localAvatarUrl,
        state: 'joinedRtc',
        isLocal: true,
        videoTrack: null,
        audioTrack: null,
        localStream: null,
        isMuted: false,
        isCameraOn: payload.callType === 'video',
        isSpeaking: false,
      })
    }

    startDurationTimer()
    logger.info('[useGroupCallViewModel] 会话启动', payload.sessionId)
  }

  function addRemoteParticipant(userId: string, nickname: string, avatarUrl?: string) {
    store.addParticipant({
      userId,
      nickname,
      avatarUrl,
      state: 'invited',
      isLocal: false,
      videoTrack: null,
      audioTrack: null,
      localStream: null,
      isMuted: false,
      isCameraOn: false,
      isSpeaking: false,
    })
  }

  function markRemoteAccepted(userId: string) {
    store.markAccepted(userId)
  }

  function bindRtcService(rtcService: RtcService) {
    if (mediaBridge) {
      logger.warn('[useGroupCallViewModel] RtcMediaBridge 已存在，先销毁旧实例')
      mediaBridge.destroy()
    }
    mediaBridge = new RtcMediaBridge(rtcService)
    logger.info('[useGroupCallViewModel] 已绑定 RtcService')

    // 本地用户已通过外部 joinChannel 加入 RTC，补标记状态并同步本地流
    const local = store.localParticipant
    if (local && local.state !== 'joinedRtc') {
      store.setParticipantState(local.userId, 'joinedRtc')
      logger.info('[useGroupCallViewModel] 本地用户已标记为 joinedRtc')
    }

    // 订阅 RtcService 本地视频流变化并同步到群聊域（阶段 4）
    _unsubscribeLocalStream?.()
    _unsubscribeLocalStream = rtcService.subscribeLocalStreamChange((stream) => {
      const localParticipant = store.localParticipant
      if (!localParticipant) return
      store.setLocalStream(localParticipant.userId, stream)
      if (stream) {
        const videoTrack = rtcService.getLocalVideoTrack?.()
        if (videoTrack) {
          store.setVideoTrack(localParticipant.userId, videoTrack)
        }
      } else {
        store.setVideoTrack(localParticipant.userId, null)
      }
    })
  }

  function unbindRtcService() {
    _unsubscribeLocalStream?.()
    _unsubscribeLocalStream = null

    if (mediaBridge) {
      mediaBridge.destroy()
      mediaBridge = null
      logger.info('[useGroupCallViewModel] 已解绑 RtcService')
    }
  }

  async function sendInvite(userIds: string[], groupId: string, message: string) {
    // 1. 信令发送
    await signaling.sendInvite(userIds, groupId, message)
    // 2. 本地状态更新（watch 会自动为新 invited 成员设置超时定时器）
    const globalCallStore = useGlobalCallStore()
    userIds.forEach(id => {
      // 从 GlobalCallStore 获取成员资料，没有则回退到 userId
      const userInfo = globalCallStore.getUserInfo(id)
      addRemoteParticipant(id, userInfo.nickname || id, userInfo.avatarURL)
    })
  }

  async function hangup() {
    clearAllInvitationTimers()
    await signaling.hangup()
    unbindRtcService()
    store.destroySession()
    stopDurationTimer()
  }

  function setLocalStream(stream: MediaStream | null) {
    const local = store.localParticipant
    if (local) {
      store.setLocalStream(local.userId, stream)
    }
  }

  function setLocalMute(isMuted: boolean) {
    const local = store.localParticipant
    if (local) {
      store.setMuteState(local.userId, isMuted)
    }
  }

  function setLocalCamera(isCameraOn: boolean) {
    const local = store.localParticipant
    if (local) {
      store.setCameraState(local.userId, isCameraOn)
    }
  }

  function setLocalVideoTrack(track: any) {
    const local = store.localParticipant
    if (local) {
      store.setVideoTrack(local.userId, track)
    }
  }

  return {
    isActive,
    participants,
    localParticipant,
    callDuration,
    selectedParticipantId,
    startSession,
    addRemoteParticipant,
    markRemoteAccepted,
    bindRtcService,
    unbindRtcService,
    sendInvite,
    clearInvitationTimer,
    hangup,
    setLocalStream,
    setLocalMute,
    setLocalCamera,
    setLocalVideoTrack,
    selectParticipant,
  }
}
