/**
 * useCallKitCore — Vue3 Composable 封装 @easemob/callkit-core
 *
 * 将 CallKitCore 的纯事件回调映射为 Vue3 响应式状态 (ref / reactive)，
 * 并桥接到旧版 Pinia Store 和 callKitEventBus，保持 UI 层零改动。
 *
 * 设计：模块级单例，所有调用者共享同一个 CallKitCore 实例和响应式状态。
 * 生命周期由 Provider.vue 统一管理（init/destroy），子组件只消费 API。
 */
import { ref, reactive, readonly, shallowRef, type DeepReadonly } from 'vue'
import {
  CallKitCore,
  CALL_STATUS,
  CALL_TYPE,
  HANGUP_REASON as CORE_HANGUP_REASON,
  type CallKitEvent,
  type InviteCallParams,
  type AnswerCallParams,
  type HangupParams,
  type InviteGroupCallParams,
  type RtcReport,
  type SingleCallState,
  type GroupSessionState,
  type GroupParticipant,
} from '@easemob/callkit-core'
import { ChatSDK } from '../core/sdk/imSDK'
import { useRtcChannelStore } from '../store/rtcChannel'
import { useCallTimerStore } from '../store/callTimer'
import { useGlobalCallStore } from '../store/globalCall'
import { useChatClientStore } from '../store/chatClient'
import { createRtcAdapter } from '../services/RtcAdapter'

import { useGroupCallStore } from '../modules/groupCall'
import { callKitEventBus } from '../core/events/CallKitEventBus'
import { buildBaseEventFields, getCurrentUserId } from '../core/events/helpers'
import { HANGUP_REASON } from '../types/callstate.types'
import { logger } from '../utils/logger'

// ═════════════════════════════════════════════════
// 模块级单例状态（所有调用者共享）
// ═════════════════════════════════════════════════

export interface ReactiveCallState {
  status: CALL_STATUS
  callId: string
  channel: string
  token: string
  type: CALL_TYPE
  callerDevId: string
  calleeDevId: string
  callerUserId: string
  calleeUserId: string
  audioEnabled: boolean
  videoEnabled: boolean
  startTime: number | null
}

export interface CallEventLog {
  type: string
  payload: any
  timestamp: number
}

// ─── 共享的响应式状态 ───
const _callState = reactive<ReactiveCallState>({
  status: CALL_STATUS.IDLE,
  callId: '',
  channel: '',
  token: '',
  type: CALL_TYPE.AUDIO_1V1,
  callerDevId: '',
  calleeDevId: '',
  callerUserId: '',
  calleeUserId: '',
  audioEnabled: true,
  videoEnabled: true,
  startTime: null,
})

const _groupSession = shallowRef<GroupSessionState | null>(null)
const _groupParticipants = ref<GroupParticipant[]>([])
const _lastEvent = shallowRef<CallKitEvent | null>(null)
const _eventLog = ref<CallEventLog[]>([])
const _error = ref<string | null>(null)
const _isInitialized = ref(false)

// ─── 外部事件订阅者（供 onCallEvent 使用）───
const _eventHandlers = ref<Set<(event: CallKitEvent) => void>>(new Set())

// ─── 共享的 core 实例 ───
let _coreInstance: CallKitCore | null = null

// ─── HANGUP_REASON 映射 ───
function mapCoreReasonToHangupReason(reason: string): HANGUP_REASON {
  switch (reason) {
    case 'hangup': return HANGUP_REASON.HANGUP
    case 'cancel': return HANGUP_REASON.CANCEL
    case 'refuse': return HANGUP_REASON.REMOTE_REFUSE
    case 'busy': return HANGUP_REASON.BUSY
    case 'timeout': return HANGUP_REASON.NO_RESPONSE
    case 'remoteCancel': return HANGUP_REASON.REMOTE_CANCEL
    case 'remoteHangup': return HANGUP_REASON.HANGUP
    case 'normal': return HANGUP_REASON.HANGUP
    default: return HANGUP_REASON.HANGUP
  }
}

// ─── 判断事件是否由本端触发 ───
// 优先使用 core 事件中的 isRemote 字段（core 知道事件触发源），
// 仅在没有 isRemote 时回退到事件类型推断
function isLocalEvent(event: CallKitEvent): boolean {
  const payload = event.payload as any
  if (typeof payload.isRemote === 'boolean') {
    return !payload.isRemote
  }
  const remoteTypes = new Set(['callRefused', 'callBusy', 'callCanceled', 'callTimeout'])
  return !remoteTypes.has(event.type)
}

// ─── Store 引用（延迟获取）───
function getStores() {
  return {
    rtcChannelStore: useRtcChannelStore(),
    callTimerStore: useCallTimerStore(),
    globalCallStore: useGlobalCallStore(),
    groupCallStore: useGroupCallStore(),
    chatClientStore: useChatClientStore(),

  }
}

// ─── 同步状态 ───
function syncState(state: SingleCallState) {
  _callState.status = state.status
  _callState.callId = state.callId
  _callState.channel = state.channel
  _callState.token = state.token
  _callState.type = state.type
  _callState.callerDevId = state.callerDevId
  _callState.calleeDevId = state.calleeDevId
  _callState.callerUserId = state.callerUserId
  _callState.calleeUserId = state.calleeUserId
  _callState.audioEnabled = state.audioEnabled
  _callState.videoEnabled = state.videoEnabled
  _callState.startTime = state.startTime
}

function syncGroupSession() {
  if (!_coreInstance) return
  _groupSession.value = _coreInstance.getGroupCallSession()
  _groupParticipants.value = _coreInstance.getGroupCallParticipants()
}

function logEvent(event: CallKitEvent) {
  const entry: CallEventLog = {
    type: event.type,
    payload: event.payload,
    timestamp: Date.now(),
  }
  _eventLog.value.push(entry)
  if (_eventLog.value.length > 100) {
    _eventLog.value = _eventLog.value.slice(-100)
  }
  _lastEvent.value = event
}

// ─── 构建旧版事件 payload ───
function buildLegacyPayload(event: CallKitEvent) {
  const payload = event.payload as any
  const isLocal = isLocalEvent(event)
  const base = buildBaseEventFields({
    callId: payload.callId || '',
    channel: payload.channel || '',
    type: payload.callType || CALL_TYPE.AUDIO_1V1,
    callerUserId: payload.callerUserId || '',
    calleeUserId: payload.calleeUserId,
    groupId: payload.groupId,
  }, isLocal)
  return { ...base, ...payload, isLocal }
}

// ─── 资源清理（不触发事件）───
async function cleanupResources() {
  const stores = getStores()
  const rtcService = stores.rtcChannelStore.getRtcService()
  if (rtcService) {
    try {
      const client = rtcService.getClient()
      if (client && client.connectionState === 'CONNECTED') {
        const localTracks = client.localTracks
        if (localTracks && localTracks.length > 0) {
          await client.unpublish(localTracks)
        }
      }
    } catch (e) {
      logger.debug('[useCallKitCore] unpublish 失败:', e)
    }
    try {
      await rtcService.leaveChannel()
    } catch (e) {
      logger.debug('[useCallKitCore] leaveChannel 失败:', e)
    }
  }
  stores.rtcChannelStore.reset()
}

// ─── 重置状态（不触发事件）───
function resetCallState(reason: HANGUP_REASON) {
  const stores = getStores()

  // 计算通话时长
  let duration = 0
  try {
    const callTimerStore = stores.callTimerStore
    if (callTimerStore.callStartTime > 0) {
      duration = Date.now() - callTimerStore.callStartTime
      callTimerStore.reset()
    }
    const groupCallStore = stores.groupCallStore
    if (groupCallStore.session?.startTime && groupCallStore.session.startTime > 0) {
      duration = Date.now() - groupCallStore.session.startTime
      groupCallStore.destroySession()
    }
  } catch (_e) {
    // 忽略
  }

  // 重置小窗状态
  const globalCallStore = stores.globalCallStore
  if (globalCallStore.isMinimized) {
    globalCallStore.isMinimized = false
  }

  return duration
}

// ─── 核心事件处理 ───
async function handleCoreEvent(event: CallKitEvent) {
  logEvent(event)

  // 透传给外部订阅者（事件驱动模式）
  _eventHandlers.value.forEach((handler) => {
    try {
      handler(event)
    } catch (err) {
      logger.error('[useCallKitCore] 事件 handler 执行失败:', err)
    }
  })

  const stores = getStores()
  const { rtcChannelStore, callTimerStore, groupCallStore, chatClientStore } = stores

  // 同步单聊状态到响应式对象（持续态保持响应式）
  if (_coreInstance) {
    syncState(_coreInstance.getSingleCallState())
  }
  syncGroupSession()

  switch (event.type) {
    case 'statusChanged': {
      // 状态已通过 syncState 同步到 _callState，无需额外操作
      callKitEventBus.emit('statusChanged', buildLegacyPayload(event))
      break
    }

    case 'incomingCall': {
      callKitEventBus.emit('incomingCall', buildLegacyPayload(event))
      break
    }

    case 'callConnected': {
      // 被叫方收到 confirmCallee 后进入 IN_CALL，同步状态
      callKitEventBus.emit('callConnected', buildLegacyPayload(event))
      break
    }

    case 'callStarted': {
      callTimerStore.startCallTimer()
      callKitEventBus.emit('callStarted', buildLegacyPayload(event))
      break
    }

    case 'callEnded': {
      const p = event.payload as any
      const reason = mapCoreReasonToHangupReason(p.reason)
      const isRemoteCancel = reason === HANGUP_REASON.REMOTE_CANCEL
      const isRemoteRefuse = reason === HANGUP_REASON.REMOTE_REFUSE
      const currentUserId = chatClientStore.getChatClient?.user || ''
      // 计算 endedBy：远端取消/拒绝时由对方结束，否则由本地用户结束
      const endedBy = (isRemoteCancel || isRemoteRefuse)
        ? (_callState.callerUserId === currentUserId ? _callState.calleeUserId : _callState.callerUserId)
        : currentUserId
      // 先清理 RTC 资源（await），再重置状态
      try {
        await cleanupResources()
      } catch (err) {
        logger.error('[useCallKitCore] 资源清理失败:', err)
      }
      const duration = resetCallState(reason)
      // 重置 _callState 为 IDLE 默认值，避免跨通话污染
      syncState({
        status: CALL_STATUS.IDLE,
        callId: '',
        channel: '',
        token: '',
        type: CALL_TYPE.AUDIO_1V1,
        callerDevId: '',
        calleeDevId: '',
        callerUserId: '',
        calleeUserId: '',
        audioEnabled: true,
        videoEnabled: true,
        startTime: null,
      } as SingleCallState)
      callKitEventBus.emit('callEnded', {
        ...buildLegacyPayload(event),
        reason,
        duration: p.duration || duration || 0,
        endedBy,
      })
      break
    }

    case 'callTimeout': {
      callKitEventBus.emit('callTimeout', buildLegacyPayload(event))
      break
    }

    case 'callRefused': {
      callKitEventBus.emit('callRefused', buildLegacyPayload(event))
      break
    }

    case 'callBusy': {
      callKitEventBus.emit('callBusy', buildLegacyPayload(event))
      break
    }

    case 'callCanceled': {
      callKitEventBus.emit('callCanceled', buildLegacyPayload(event))
      break
    }

    case 'shouldJoinRtc': {
      // RTC 加入由 RtcAdapter.joinChannel 处理，此处仅做日志
      const p = event.payload as any
      logger.info('[useCallKitCore] shouldJoinRtc（RtcAdapter 处理）', { channel: p.channel, role: p.role })
      break
    }

    case 'shouldLeaveRtc': {
      logger.info('[useCallKitCore] shouldLeaveRtc')
      const rtcService = rtcChannelStore.getRtcService()
      if (rtcService) {
        rtcService.leaveChannel().catch(() => {})
      }
      break
    }

    case 'localAudioChanged': {
      const p = event.payload as any
      rtcChannelStore.setAudioEnabled(p.enabled)
      break
    }

    case 'localVideoChanged': {
      const p = event.payload as any
      rtcChannelStore.setVideoEnabled(p.enabled)
      break
    }

    case 'groupCallInit': {
      const p = event.payload as any
      groupCallStore.initSession({
        sessionId: p.channel,
        groupId: p.groupId,
        groupName: p.groupName,
        callType: p.callType,
        isActive: true,
        startTime: Date.now(),
      })
      const currentUserId = chatClientStore.getChatClient?.user || ''
      const globalCallStore = stores.globalCallStore

      // 添加本地用户（被叫方）
      if (currentUserId) {
        const localInfo = globalCallStore.getUserInfo(currentUserId)
        groupCallStore.addParticipant({
          userId: currentUserId,
          nickname: localInfo.nickname || currentUserId,
          avatarUrl: localInfo.avatarURL,
          state: 'invited',
          isLocal: true,
          videoTrack: null,
          audioTrack: null,
          localStream: null,
          isMuted: false,
          isCameraOn: p.callType === 'video',
          isSpeaking: false,
        })
      }

      // 添加主叫方（caller）
      const callerUserId = p.callerUserId as string
      if (callerUserId && callerUserId !== currentUserId) {
        const callerInfo = globalCallStore.getUserInfo(callerUserId)
        groupCallStore.addParticipant({
          userId: callerUserId,
          nickname: callerInfo.nickname || callerUserId,
          avatarUrl: callerInfo.avatarURL,
          state: 'joinedRtc',
          isLocal: false,
          videoTrack: null,
          audioTrack: null,
          localStream: null,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false,
        })
      }

      // 添加其他被邀请成员
      ;(p.invitedMembers || []).forEach((userId: string) => {
        if (userId === currentUserId || userId === callerUserId) return
        const info = globalCallStore.getUserInfo(userId)
        groupCallStore.addParticipant({
          userId,
          nickname: info.nickname || userId,
          avatarUrl: info.avatarURL,
          state: 'invited',
          isLocal: false,
          videoTrack: null,
          audioTrack: null,
          localStream: null,
          isMuted: false,
          isCameraOn: p.callType === 'video',
          isSpeaking: false,
        })
      })
      callKitEventBus.emit('groupCallInit', buildLegacyPayload(event))
      break
    }

    case 'participantStateChanged': {
      const p = event.payload as any
      groupCallStore.setParticipantState(p.userId, p.state)
      callKitEventBus.emit('participantStateChanged', buildLegacyPayload(event))
      break
    }

    case 'participantJoined': {
      const p = event.payload as any
      const globalCallStore = stores.globalCallStore
      const info = globalCallStore.getUserInfo(p.userId)
      if (!groupCallStore.participants.has(p.userId)) {
        // 全新参与者（如追加邀请的成员）：初始状态为 joinedRtc
        groupCallStore.addParticipant({
          userId: p.userId,
          nickname: info.nickname || p.userId,
          avatarUrl: info.avatarURL,
          state: 'joinedRtc',
          isLocal: false,
          videoTrack: null,
          audioTrack: null,
          localStream: null,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false,
        })
      } else {
        // 已有参与者（如刚接受邀请的成员）：保持当前状态，不覆盖为 joinedRtc
        // RtcMediaBridge 会在用户实际加入 Agora 频道后更新状态
        const existing = groupCallStore.participants.get(p.userId)
        if (existing && existing.state !== 'joinedRtc' && existing.state !== 'publishing') {
          // 保持 accepted 状态，不提前设为 joinedRtc
          groupCallStore.markAccepted(p.userId)
        }
      }
      callKitEventBus.emit('participantJoined', buildLegacyPayload(event))
      break
    }

    case 'participantLeft': {
      const p = event.payload as any
      groupCallStore.setParticipantState(p.userId, 'left')
      setTimeout(() => groupCallStore.removeParticipant(p.userId), 2000)
      callKitEventBus.emit('participantLeft', buildLegacyPayload(event))
      break
    }

    case 'rtcReport': {
      callKitEventBus.emit('rtcReport', buildLegacyPayload(event))
      break
    }
  }
}

// ═════════════════════════════════════════════════
// 单例 API
// ═════════════════════════════════════════════════

export function useCallKitCore() {
  // ─── 初始化 ───
  async function init(config: {
    imClient: any
    userProfile?: { userId: string; nickname?: string; avatarURL?: string }
    inviteTimeout?: number
  }) {
    if (_coreInstance) {
      logger.warn('[useCallKitCore] 已初始化，先销毁旧实例')
      await _coreInstance.destroy()
      _coreInstance = null
    }

    const core = new CallKitCore({
      imClient: config.imClient,
      userProfile: config.userProfile,
      inviteTimeout: config.inviteTimeout,
      rtcAdapter: createRtcAdapter({
        getCoreCallState: () => ({
          type: _callState.type,
          callerUserId: _callState.callerUserId,
          calleeUserId: _callState.calleeUserId,
        }),
        getCurrentUserId: () => {
          const stores = getStores()
          return stores.chatClientStore.getChatClient?.user || ''
        },
      }),
      onEvent: handleCoreEvent,
      // 兼容 full 版（静态 ChatSDK.message.create）与 miniCore（实例 client.Message.create）
      createMessage: (options: any) => {
        const sdkAny = ChatSDK as any
        if (sdkAny?.message?.create) {
          return sdkAny.message.create(options)
        }
        const client = config.imClient as any
        if (client?.Message?.create) {
          return client.Message.create(options)
        }
        throw new Error(
          '[useCallKitCore] 无法创建消息：未检测到 message.create API（请确认 easemob-websdk full 版已安装，或 miniCore 已注册消息插件）'
        )
      },
    })

    _coreInstance = core
    _isInitialized.value = true
    _error.value = null

    syncState(core.getSingleCallState())
    logger.info('[useCallKitCore] 初始化完成')
  }

  // ─── API 代理 ───
  async function inviteCall(params: InviteCallParams) {
    if (!_coreInstance) throw new Error('CallKitCore 未初始化')
    try {
      await _coreInstance.inviteCall(params)
      syncState(_coreInstance.getSingleCallState())
    } catch (err: any) {
      _error.value = err.message
      throw err
    }
  }

  async function answerCall(params: AnswerCallParams) {
    if (!_coreInstance) throw new Error('CallKitCore 未初始化')
    try {
      await _coreInstance.answerCall(params)
      syncState(_coreInstance.getSingleCallState())
    } catch (err: any) {
      _error.value = err.message
      throw err
    }
  }

  async function hangup(params?: HangupParams) {
    if (!_coreInstance) throw new Error('CallKitCore 未初始化')
    try {
      await _coreInstance.hangup(params)
      syncState(_coreInstance.getSingleCallState())
    } catch (err: any) {
      _error.value = err.message
      throw err
    }
  }

  async function inviteGroupCall(params: InviteGroupCallParams) {
    if (!_coreInstance) throw new Error('CallKitCore 未初始化')
    try {
      await _coreInstance.inviteGroupCall(params)
      syncState(_coreInstance.getSingleCallState())
      syncGroupSession()
    } catch (err: any) {
      _error.value = err.message
      throw err
    }
  }

  async function inviteMoreParticipants(participantIds: string[]) {
    if (!_coreInstance) throw new Error('CallKitCore 未初始化')
    try {
      await _coreInstance.inviteMoreParticipants(participantIds)
      syncGroupSession()
    } catch (err: any) {
      _error.value = err.message
      throw err
    }
  }

  function toggleAudio() {
    if (!_coreInstance) return
    _coreInstance.toggleAudio()
    syncState(_coreInstance.getSingleCallState())
  }

  function toggleVideo() {
    if (!_coreInstance) return
    _coreInstance.toggleVideo()
    syncState(_coreInstance.getSingleCallState())
  }

  function reportRtcEvent(report: RtcReport) {
    if (!_coreInstance) return
    _coreInstance.reportRtcEvent(report)
    syncGroupSession()
  }

  async function destroy() {
    if (_coreInstance) {
      await _coreInstance.destroy()
      _coreInstance = null
      _isInitialized.value = false
      // 重置响应式状态
      syncState({
        status: CALL_STATUS.IDLE,
        callId: '',
        channel: '',
        token: '',
        type: CALL_TYPE.AUDIO_1V1,
        callerDevId: '',
        calleeDevId: '',
        callerUserId: '',
        calleeUserId: '',
        audioEnabled: true,
        videoEnabled: true,
        startTime: null,
      } as SingleCallState)
      _groupSession.value = null
      _eventLog.value = []
      _lastEvent.value = null
    }
  }

  // ─── 事件订阅 ───
  function onCallEvent(handler: (event: CallKitEvent) => void): () => void {
    _eventHandlers.value.add(handler)
    return () => {
      _eventHandlers.value.delete(handler)
    }
  }

  return {
    // 响应式状态（只读）
    callState: readonly(_callState) as DeepReadonly<ReactiveCallState>,
    groupSession: readonly(_groupSession),
    groupParticipants: readonly(_groupParticipants),
    lastEvent: readonly(_lastEvent),
    eventLog: readonly(_eventLog),
    error: readonly(_error),
    isInitialized: readonly(_isInitialized),

    // API
    init,
    inviteCall,
    answerCall,
    hangup,
    inviteGroupCall,
    inviteMoreParticipants,
    toggleAudio,
    toggleVideo,
    reportRtcEvent,
    destroy,

    // 事件订阅（事件驱动模式）
    onCallEvent,

    // 谓词方法（直接代理到 core，UI 不再直接读 status）
    canAccept: () => _coreInstance?.canAccept() ?? false,
    canReject: () => _coreInstance?.canReject() ?? false,
    canHangup: () => _coreInstance?.canHangup() ?? false,
    isWaitingCalleeAction: () => _coreInstance?.isWaitingCalleeAction() ?? false,
    isInActiveCall: () => _coreInstance?.isInActiveCall() ?? false,
    isInCall: () => _coreInstance?.isInCall() ?? false,
    isCalling: () => _coreInstance?.isCalling() ?? false,
    isIdle: () => _coreInstance?.isIdle() ?? true,

    // 常量
    CALL_STATUS,
    CALL_TYPE,
  }
}
