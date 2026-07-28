/**
 * useCallKitCore — Vue3 Composable 封装 @easemob-community/callkit-core
 *
 * 将 CallKitCore 的纯事件回调映射为 Vue3 响应式状态 (ref / reactive)，
 * 并桥接到旧版 Pinia Store 和 callKitEventBus，保持 UI 层零改动。
 *
 * 设计：模块级单例，所有调用者共享同一个 CallKitCore 实例和响应式状态。
 * 生命周期由 Provider.vue 统一管理（init/destroy），子组件只消费 API。
 *
 * 注意：当前设计假设单 IM 连接场景（一个页面一个 CallKitCore 实例）。
 * 若未来需要多实例（多标签页、微前端），可提供 createCallKitCore() 工厂函数
 * 或改用 provide/inject 模式隔离实例状态。
 */
import { ref, reactive, readonly, shallowRef, computed, type DeepReadonly } from 'vue'
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
} from '@easemob-community/callkit-core'
import { ChatSDK } from '../core/sdk/imSDK'
import { useCallKitRtc } from '../composables/useCallKitRtc'
import { useCallTimerStore } from '../store/callTimer'
import { useGlobalCallStore } from '../store/globalCall'
import { useChatClientStore } from '../store/chatClient'
import { createRtcAdapter } from '../services/RtcAdapter'
import type { MediaInputStatus } from '../services/RtcService'

import { useGroupCallStore } from '../modules/groupCall'
import { callKitEventBus } from '../core/events/CallKitEventBus'
import { buildBaseEventFields, getCurrentUserId } from '../core/events/helpers'
import { HANGUP_REASON } from '../types/callstate.types'
import { logger } from '../utils/logger'
import { resolveUserProfiles } from '../services/UserProfileService'

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

// ─── 单聊域本地视频流（阶段 4：从 useCallKitRtc 全局状态拆出）───
const _localStream = ref<MediaStream | null>(null)

// ─── 本地媒体输入状态（RtcService 媒体输入监控上报：设备缺失/无输入提示）───
const _mediaInputStatus = ref<MediaInputStatus>({
  hasCamera: null,
  hasMicrophone: null,
  audioInputActive: null,
  videoInputActive: null,
})

// ─── RtcService 媒体状态订阅取消函数（单聊域）───
let _unsubscribeRtcAudio: (() => void) | null = null
let _unsubscribeRtcVideo: (() => void) | null = null
let _unsubscribeRtcLocalStream: (() => void) | null = null
let _unsubscribeRtcMediaInput: (() => void) | null = null

// ─── 对端用户ID（模块级单例 computed）───
const _peerUserId = computed<string>(() => {
  try {
    const stores = getStores()
    const currentUserId = stores.chatClientStore.getChatClient?.user || ''
    if (!currentUserId) return ''
    if (_callState.callerUserId === currentUserId) {
      return _callState.calleeUserId || ''
    }
    return _callState.callerUserId
  } catch {
    return ''
  }
})

// ─── 外部事件订阅者（供 onCallEvent 使用）───
const _eventHandlers = ref<Set<(event: CallKitEvent) => void>>(new Set())

// ─── 共享的 core 实例 ───
let _coreInstance: CallKitCore | null = null

// ─── 判断通话类型是否为群聊 ───
function isGroupCallType(callType?: CALL_TYPE): boolean {
  return callType === CALL_TYPE.VIDEO_MULTI || callType === CALL_TYPE.AUDIO_MULTI
}

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
  const remoteTypes = new Set([
    'callRefused', 'callBusy', 'callCanceled', 'callTimeout',
    'singleCallRefused', 'singleCallBusy', 'singleCallCanceled', 'singleCallTimeout',
    'groupCallRefused', 'groupCallBusy', 'groupCallCanceled', 'groupCallTimeout',
  ])
  return !remoteTypes.has(event.type)
}

// ─── Store 引用（延迟获取）───
function getStores() {
  return {
    rtc: useCallKitRtc(),
    callTimerStore: useCallTimerStore(),
    globalCallStore: useGlobalCallStore(),
    groupCallStore: useGroupCallStore(),
    chatClientStore: useChatClientStore(),

  }
}

// ─── 单聊域 RTC 媒体状态订阅（阶段 4：从 useCallKitRtc 全局状态拆出）───
function subscribeSingleCallMediaState() {
  unsubscribeSingleCallMediaState()

  const stores = getStores()
  const rtcService = stores.rtc.getRtcService()
  if (!rtcService) {
    logger.warn('[useCallKitCore] 订阅单聊媒体状态时 RtcService 尚未初始化')
    return
  }

  _unsubscribeRtcAudio = rtcService.subscribeAudioEnabledChange((enabled) => {
    // 群聊通话期间媒体状态归 GroupCallStore.localParticipant 管理，不写单聊域
    if (_coreInstance && isGroupCallType(_coreInstance.getSingleCallState().type)) return
    _callState.audioEnabled = enabled
  })
  _unsubscribeRtcVideo = rtcService.subscribeVideoEnabledChange((enabled) => {
    if (_coreInstance && isGroupCallType(_coreInstance.getSingleCallState().type)) return
    _callState.videoEnabled = enabled
  })
  _unsubscribeRtcLocalStream = rtcService.subscribeLocalStreamChange((stream) => {
    _localStream.value = stream
  })
  _unsubscribeRtcMediaInput = rtcService.subscribeMediaInputStatus((status) => {
    _mediaInputStatus.value = status
  })

  logger.info('[useCallKitCore] 单聊域 RTC 媒体状态订阅完成')
}

function unsubscribeSingleCallMediaState() {
  _unsubscribeRtcAudio?.()
  _unsubscribeRtcAudio = null
  _unsubscribeRtcVideo?.()
  _unsubscribeRtcVideo = null
  _unsubscribeRtcLocalStream?.()
  _unsubscribeRtcLocalStream = null
  _unsubscribeRtcMediaInput?.()
  _unsubscribeRtcMediaInput = null
  _localStream.value = null
  _mediaInputStatus.value = {
    hasCamera: null,
    hasMicrophone: null,
    audioInputActive: null,
    videoInputActive: null,
  }
}

// ─── 同步状态 ────
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
  // 媒体字段仅单聊同步：群聊通话期间 core 状态机的 audioEnabled/videoEnabled
  // 无人维护（恒为初始 true），用失真值覆盖会与 RtcService 订阅回调形成双写入者抖动
  const isGroup = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI
  if (!isGroup) {
    _callState.audioEnabled = state.audioEnabled
    _callState.videoEnabled = state.videoEnabled
  }
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
  const rtcService = stores.rtc.getRtcService()
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
}

// ─── participantLeft 延迟移除 timer（可取消）───
// 成员 left 后 2s 才从 Map 移除（与原行为一致），但：
// 1) 同 userId 反复 left/rejoin 时只保留最后一次 timer；
// 2) remove 前校验参与者当前 state 仍为 left——2s 内重新加入的成员不得被旧 timer 误删
const _participantRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleParticipantRemove(
  groupCallStore: ReturnType<typeof useGroupCallStore>,
  userId: string
) {
  const existing = _participantRemoveTimers.get(userId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    _participantRemoveTimers.delete(userId)
    const participant = groupCallStore.participants.get(userId)
    if (participant && participant.state === 'left') {
      groupCallStore.removeParticipant(userId)
    }
  }, 2000)
  _participantRemoveTimers.set(userId, timer)
}

function clearParticipantRemoveTimers() {
  _participantRemoveTimers.forEach((t) => clearTimeout(t))
  _participantRemoveTimers.clear()
}

// ─── 重置状态（不触发事件）───
function resetCallState(reason: HANGUP_REASON) {
  const stores = getStores()

  // 计算通话时长
  let duration = 0
  try {
    // 清理所有 participantLeft 延迟移除 timer（会话结束，不再移除任何人）
    clearParticipantRemoveTimers()
    const callTimerStore = stores.callTimerStore
    if (callTimerStore.callStartTime > 0) {
      duration = Date.now() - callTimerStore.callStartTime
    }
    // 无条件清零：callDuration 由 core 的 callDurationUpdated 事件镜像，
    // 通话结束不重置会让下一场通话 UI 先显示上一场的终值约 1 秒
    callTimerStore.reset()
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
  const { rtc, callTimerStore, groupCallStore, chatClientStore } = stores

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
      // 被叫方收到来电：将主叫方传入的 callerInfo 写入全局缓存，
      // 这样即使 Provider 拉取失败，弹窗也能显示主叫方主动传入的昵称/头像
      const p = event.payload as any
      const callerUserId = p.callerUserId as string
      const callerInfo = p.callerInfo as { nickname?: string; avatarURL?: string } | undefined
      if (callerUserId && callerInfo) {
        const stores = getStores()
        stores.globalCallStore.setUserInfo(callerUserId, callerInfo)
        logger.info('[useCallKitCore] incomingCall 已缓存主叫方资料', { callerUserId, ...callerInfo })
      }
      callKitEventBus.emit('incomingCall', buildLegacyPayload(event))
      break
    }

    case 'callInvited': {
      // 邀请已发出/收到：通知 UI 显示通话窗口
      const invitedPayload = buildLegacyPayload(event)
      callKitEventBus.emit('callInvited', invitedPayload)
      callKitEventBus.emit(
        isGroupCallType(event.payload.callType) ? 'groupCallInvited' : 'singleCallInvited',
        invitedPayload
      )
      break
    }

    case 'callConnected': {
      // 被叫方收到 confirmCallee 后进入 IN_CALL，同步状态
      callKitEventBus.emit('callConnected', buildLegacyPayload(event))
      break
    }

    case 'callStarted': {
      // 计时器由 CallKitCore 的 durationTimer 驱动，通过 callDurationUpdated 事件更新
      // 不需要在这里启动额外的计时器，避免双重触发
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
      _localStream.value = null
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

    // 精确单聊/群聊生命周期事件：副作用已在对应通用事件中处理，这里只负责透传给 EventBus
    case 'callAccepted': {
      // 主叫方收到被叫 accept：被叫随 answerCall 回传的资料写入全局缓存，
      // 使主叫侧的通话中界面/对方关摄像头占位能展示被叫昵称头像
      // （与 incomingCall 缓存 callerInfo 对称）
      const p = event.payload as any
      const calleeUserId = p.calleeUserId as string | undefined
      const calleeInfo = p.calleeInfo as { nickname?: string; avatarURL?: string } | undefined
      if (calleeUserId && calleeInfo && (calleeInfo.nickname || calleeInfo.avatarURL)) {
        stores.globalCallStore.setUserInfo(calleeUserId, calleeInfo)
        logger.info('[useCallKitCore] callAccepted 已缓存被叫方资料', { calleeUserId, ...calleeInfo })
      }
      callKitEventBus.emit('callAccepted', buildLegacyPayload(event))
      break
    }

    case 'singleCallAccepted':
    case 'groupCallAccepted':
    case 'singleCallInvited':
    case 'singleCallStarted':
    case 'singleCallConnected':
    case 'singleCallEnded':
    case 'singleCallTimeout':
    case 'singleCallRefused':
    case 'singleCallBusy':
    case 'singleCallCanceled':
    case 'groupCallInvited':
    case 'groupCallStarted':
    case 'groupCallConnected':
    case 'groupCallEnded':
    case 'groupCallTimeout':
    case 'groupCallRefused':
    case 'groupCallBusy':
    case 'groupCallCanceled': {
      callKitEventBus.emit(event.type, buildLegacyPayload(event))
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
      const rtcService = rtc.getRtcService()
      if (rtcService) {
        rtcService.leaveChannel().catch(() => {})
      }
      break
    }

    case 'localAudioChanged': {
      // 单聊域音频状态由 RtcService 订阅回调直接同步到 _callState，
      // 此处无需额外操作（syncState 已在事件开始时执行）
      logger.debug('[useCallKitCore] localAudioChanged（已由 RtcService 订阅同步）')
      break
    }

    case 'localVideoChanged': {
      // 单聊域视频状态由 RtcService 订阅回调直接同步到 _callState，
      // 此处无需额外操作（syncState 已在事件开始时执行）
      logger.debug('[useCallKitCore] localVideoChanged（已由 RtcService 订阅同步）')
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

      // 构建被邀请成员集合（event payload 可能缺失 invitedMembers）
      const invitedMemberSet = new Set<string>(
        (Array.isArray(p.invitedMembers) ? p.invitedMembers : [])
          .filter((id: string) => id !== currentUserId && id !== p.callerUserId)
      )

      // 补充：从 core 侧 GroupCallSession 同步参与者（更权威、更完整）
      // 修复：event payload 的 invitedMembers 在运行时可能不完整，
      // 而 GroupCallSession 由 GroupCallSignalHandler 直接根据信令消息初始化，
      // 始终包含完整的参与者列表。
      if (_coreInstance) {
        try {
          const coreParticipants = _coreInstance.getGroupCallParticipants()
          coreParticipants.forEach((cp) => {
            if (cp.userId && cp.userId !== currentUserId && cp.userId !== p.callerUserId) {
              invitedMemberSet.add(cp.userId)
            }
          })
        } catch (e) {
          // core 实例不可用时回退到仅使用 event payload
        }
      }

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

      // 添加其他被邀请成员（使用合并后的集合，包含 event payload + core 侧参与者）
      invitedMemberSet.forEach((userId: string) => {
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

      // enrich 所有参与者资料（先查缓存 → 未命中调 Provider → 回写缓存并更新参与者）
      try {
        const allParticipantIds = Array.from(groupCallStore.participants.keys())
        await resolveUserProfiles(allParticipantIds)
        allParticipantIds.forEach((userId) => {
          const refreshed = globalCallStore.getUserInfo(userId)
          if (refreshed.nickname || refreshed.avatarURL) {
            groupCallStore.updateParticipantProfile(userId, {
              nickname: refreshed.nickname,
              avatarUrl: refreshed.avatarURL,
            })
          }
        })
        logger.info('[useCallKitCore] groupCallInit 已 enrich 参与者资料', { count: allParticipantIds.length })
      } catch (err) {
        logger.warn('[useCallKitCore] groupCallInit 获取参与者资料失败', err)
      }

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

      // enrich 新加入/接受的参与者资料（先查缓存 → 未命中调 Provider → 回写缓存）
      try {
        await resolveUserProfiles([p.userId])
        const refreshed = globalCallStore.getUserInfo(p.userId)
        if (refreshed.nickname || refreshed.avatarURL) {
          groupCallStore.updateParticipantProfile(p.userId, {
            nickname: refreshed.nickname,
            avatarUrl: refreshed.avatarURL,
          })
        }
      } catch (err) {
        logger.warn('[useCallKitCore] 获取参与者资料失败，回退到 userId', { userId: p.userId, err })
      }

      callKitEventBus.emit('participantJoined', buildLegacyPayload(event))
      break
    }

    case 'participantLeft': {
      const p = event.payload as any
      groupCallStore.setParticipantState(p.userId, 'left')
      scheduleParticipantRemove(groupCallStore, p.userId)
      callKitEventBus.emit('participantLeft', buildLegacyPayload(event))
      break
    }

    case 'rtcReport': {
      callKitEventBus.emit('rtcReport', buildLegacyPayload(event))
      break
    }

    case 'callDurationUpdated': {
      const p = event.payload as any
      callTimerStore.callDuration = Math.floor(p.duration / 1000)
      callKitEventBus.emit('callDurationUpdated', buildLegacyPayload(event))
      break
    }

    case 'callError': {
      logger.error('[useCallKitCore] callError:', event.payload)
      callKitEventBus.emit('callError', buildLegacyPayload(event))
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
      logger.info('[useCallKitCore] 已初始化，先销毁旧实例')
      await _coreInstance.destroy()
      _coreInstance = null
    }

    const core = new CallKitCore({
      imClient: config.imClient,
      userProfile: config.userProfile,
      inviteTimeout: config.inviteTimeout,
      // 传入 Vue3 层 logger，使 callkit-core 日志与 UI 层共享同一日志级别
      logger,
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

    // 订阅 RtcService 媒体状态变化到单聊域（阶段 4：替代 useCallKitRtc 全局状态）
    subscribeSingleCallMediaState()

    // 注册 RTC user-left 兜底回调：1v1 通话中对方离开 RTC 频道时触发 callEnded
    // 作为 IM 信令（leaveCall）可能丢失的兜底保护
    const stores = getStores()
    stores.rtc.setOnUserLeftHandler((userId: string) => {
      if (!_coreInstance) return
      const state = _coreInstance.getSingleCallState()
      // 只在单聊 + 通话中 + 离开的是对端用户时触发
      const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI
      if (isGroupCall) return
      if (state.status !== CALL_STATUS.IN_CALL) return
      const currentUserId = stores.chatClientStore.getChatClient?.user || ''
      const peerId = state.callerUserId === currentUserId ? state.calleeUserId : state.callerUserId
      if (userId !== peerId) return
      logger.warn('[useCallKitCore] RTC 兜底：检测到对端离开 RTC 频道，触发挂断', { userId, callId: state.callId })
      _coreInstance.hangup({ reason: 'normal' }).catch(() => {})
    })

    logger.info('[useCallKitCore] 初始化完成')
  }

  // ─── 更新 IM 客户端实例（账号切换等场景）───
  async function updateImClient(client: any) {
    if (!client) {
      logger.warn('[useCallKitCore] updateImClient 收到空 client，忽略')
      return
    }

    const stores = getStores()
    const { chatClientStore } = stores

    // 更新 store 中的 client，会触发连接状态监听重新绑定
    chatClientStore.setClient(client)

    // 同步更新 callkit-core 中的 imClient，保持信令链路正确
    if (_coreInstance) {
      _coreInstance.updateImClient(client)
      logger.info('[useCallKitCore] IM 客户端实例已更新并同步到 callkit-core')
    } else {
      logger.info('[useCallKitCore] CallKitCore 尚未初始化，仅更新了 store 中的 client')
    }
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

      // enrich 新邀请的成员资料
      try {
        await resolveUserProfiles(participantIds)
        const stores = getStores()
        participantIds.forEach((userId) => {
          const refreshed = stores.globalCallStore.getUserInfo(userId)
          if (refreshed.nickname || refreshed.avatarURL) {
            stores.groupCallStore.updateParticipantProfile(userId, {
              nickname: refreshed.nickname,
              avatarUrl: refreshed.avatarURL,
            })
          }
        })
        logger.info('[useCallKitCore] 已 enrich 新邀请成员资料', { participantIds })
      } catch (err) {
        logger.warn('[useCallKitCore] 获取新邀请成员资料失败', err)
      }
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

  /**
   * 设置单个用户资料（主动注入，优先级高于 Provider 拉取）
   * 用于业务方在通话前/通话中动态设置 nickname / avatarURL
   */
  function setUserInfo(
    userId: string,
    userInfo: { nickname?: string; avatarURL?: string }
  ) {
    const stores = getStores()
    stores.globalCallStore.setUserInfo(userId, userInfo)
    // 如果当前正在群聊通话中，同步更新对应参与者的资料
    try {
      stores.groupCallStore.updateParticipantProfile(userId, {
        nickname: userInfo.nickname,
        avatarUrl: userInfo.avatarURL,
      })
    } catch (_e) {
      // 忽略：群聊 store 可能未初始化
    }
    logger.info('[useCallKitCore] 已设置用户资料', { userId, ...userInfo })
  }

  /**
   * 批量设置用户资料
   */
  function setUsersInfo(
    entries: Array<{ userId: string; nickname?: string; avatarURL?: string }>
  ) {
    const stores = getStores()
    stores.globalCallStore.batchSetUserInfo(
      entries.map(({ userId, nickname, avatarURL }) => ({
        userId,
        userInfo: { nickname, avatarURL },
      }))
    )
    // 如果当前正在群聊通话中，同步更新对应参与者的资料
    try {
      entries.forEach(({ userId, nickname, avatarURL }) => {
        stores.groupCallStore.updateParticipantProfile(userId, {
          nickname,
          avatarUrl: avatarURL,
        })
      })
    } catch (_e) {
      // 忽略：群聊 store 可能未初始化
    }
    logger.info('[useCallKitCore] 已批量设置用户资料', { count: entries.length })
  }

  async function destroy() {
    if (_coreInstance) {
      // 清理 RTC 兜底回调
      try {
        const stores = getStores()
        stores.rtc.setOnUserLeftHandler(null)
      } catch (_e) { /* ignore */ }

      // 取消单聊域 RTC 媒体状态订阅（阶段 4）
      unsubscribeSingleCallMediaState()

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
    localStream: readonly(_localStream),
    mediaInputStatus: readonly(_mediaInputStatus),
    peerUserId: readonly(_peerUserId),
    groupSession: readonly(_groupSession),
    groupParticipants: readonly(_groupParticipants),
    lastEvent: readonly(_lastEvent),
    eventLog: readonly(_eventLog),
    error: readonly(_error),
    isInitialized: readonly(_isInitialized),

    // API
    init,
    updateImClient,
    inviteCall,
    answerCall,
    hangup,
    inviteGroupCall,
    inviteMoreParticipants,
    toggleAudio,
    toggleVideo,
    reportRtcEvent,
    setUserInfo,
    setUsersInfo,
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

export type UseCallKitCoreReturn = ReturnType<typeof useCallKitCore>
