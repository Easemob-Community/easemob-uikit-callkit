import type { CALL_TYPE } from '../types/callstate.types'

// ────────────────────────────────────────────────
// 基础事件结构
// ────────────────────────────────────────────────

export interface BaseEvent {
  callId: string
  channel: string
  callType: CALL_TYPE
  callerUserId: string
  calleeUserId?: string
  groupId?: string
}

// ────────────────────────────────────────────────
// 通用通话生命周期事件（向后兼容）
// ────────────────────────────────────────────────

export interface IncomingCallEvent {
  type: 'incomingCall'
  payload: {
    callId: string
    callType: CALL_TYPE
    callerUserId: string
    callerDevId: string
    channel: string
    calleeUserId: string
    token?: string
    groupId?: string
    groupName?: string
    invitedMembers?: string[]
    callerInfo?: { nickname?: string; avatarURL?: string }
  }
}

export interface CallInvitedEvent {
  type: 'callInvited'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface SingleCallInvitedEvent {
  type: 'singleCallInvited'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface GroupCallInvitedEvent {
  type: 'groupCallInvited'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface CallStartedEvent {
  type: 'callStarted'
  payload: BaseEvent & {
    isCaller: boolean
    startTime: number
  }
}

export interface CallAcceptedEvent {
  type: 'callAccepted'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface CallConnectedEvent {
  type: 'callConnected'
  payload: BaseEvent
}

export interface CallEndedEvent {
  type: 'callEnded'
  payload: BaseEvent & {
    reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel'
    duration?: number
  }
}

export interface CallTimeoutEvent {
  type: 'callTimeout'
  payload: BaseEvent
}

// ────────────────────────────────────────────────
// 单聊特定事件（UI 层精确订阅）
// ────────────────────────────────────────────────

export interface SingleCallStartedEvent {
  type: 'singleCallStarted'
  payload: BaseEvent & {
    isCaller: boolean
    startTime: number
  }
}

export interface SingleCallAcceptedEvent {
  type: 'singleCallAccepted'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface SingleCallConnectedEvent {
  type: 'singleCallConnected'
  payload: BaseEvent
}

export interface SingleCallEndedEvent {
  type: 'singleCallEnded'
  payload: BaseEvent & {
    reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel'
    duration?: number
  }
}

export interface SingleCallTimeoutEvent {
  type: 'singleCallTimeout'
  payload: BaseEvent
}

export interface SingleCallRefusedEvent {
  type: 'singleCallRefused'
  payload: BaseEvent & { isRemote: boolean }
}

export interface SingleCallBusyEvent {
  type: 'singleCallBusy'
  payload: BaseEvent
}

export interface SingleCallCanceledEvent {
  type: 'singleCallCanceled'
  payload: BaseEvent & { isRemote: boolean }
}

// ────────────────────────────────────────────────
// 群聊特定事件（UI 层精确订阅）
// ────────────────────────────────────────────────

export interface GroupCallStartedEvent {
  type: 'groupCallStarted'
  payload: BaseEvent & {
    isCaller: boolean
    startTime: number
  }
}

export interface GroupCallAcceptedEvent {
  type: 'groupCallAccepted'
  payload: BaseEvent & {
    isCaller: boolean
  }
}

export interface GroupCallConnectedEvent {
  type: 'groupCallConnected'
  payload: BaseEvent
}

export interface GroupCallEndedEvent {
  type: 'groupCallEnded'
  payload: BaseEvent & {
    reason: 'hangup' | 'cancel' | 'refuse' | 'busy' | 'timeout' | 'remoteHangup' | 'remoteCancel'
    duration?: number
  }
}

export interface GroupCallTimeoutEvent {
  type: 'groupCallTimeout'
  payload: BaseEvent
}

export interface GroupCallRefusedEvent {
  type: 'groupCallRefused'
  payload: BaseEvent & { isRemote: boolean }
}

export interface GroupCallBusyEvent {
  type: 'groupCallBusy'
  payload: BaseEvent
}

export interface GroupCallCanceledEvent {
  type: 'groupCallCanceled'
  payload: BaseEvent & { isRemote: boolean }
}

// ────────────────────────────────────────────────
// 状态/业务事件
// ────────────────────────────────────────────────

export interface StatusChangedEvent {
  type: 'statusChanged'
  payload: BaseEvent & {
    from: string
    to: string
  }
}

export interface CallRefusedEvent {
  type: 'callRefused'
  payload: BaseEvent & { isRemote: boolean }
}

export interface CallBusyEvent {
  type: 'callBusy'
  payload: BaseEvent
}

export interface CallCanceledEvent {
  type: 'callCanceled'
  payload: BaseEvent & { isRemote: boolean }
}

// ────────────────────────────────────────────────
// RTC 指令事件
// ────────────────────────────────────────────────

export interface ShouldJoinRtcEvent {
  type: 'shouldJoinRtc'
  payload: BaseEvent & {
    token: string
    uid: number | string
    /** Agora App ID（来自 IM 服务端 getRTCToken 返回），为空时上层使用初始化时传入的 appId */
    appId?: string
    role: 'caller' | 'callee'
  }
}

export interface ShouldLeaveRtcEvent {
  type: 'shouldLeaveRtc'
  payload: BaseEvent & {
    reason: string
  }
}

export interface ShouldPublishTracksEvent {
  type: 'shouldPublishTracks'
  payload: BaseEvent & {
    trackTypes: ('audio' | 'video')[]
  }
}

// ────────────────────────────────────────────────
// 群聊特定事件
// ────────────────────────────────────────────────

export interface GroupCallInitEvent {
  type: 'groupCallInit'
  payload: {
    callId: string
    groupId: string
    groupName: string
    channel: string
    callType: 'audio' | 'video'
    callerUserId: string
    invitedMembers: string[]
  }
}

export interface ParticipantStateChangedEvent {
  type: 'participantStateChanged'
  payload: {
    callId: string
    userId: string
    state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
    groupId?: string
  }
}

export interface ParticipantJoinedEvent {
  type: 'participantJoined'
  payload: BaseEvent & {
    userId: string
    groupId?: string
  }
}

export interface ParticipantLeftEvent {
  type: 'participantLeft'
  payload: BaseEvent & {
    userId: string
    reason: string
    groupId?: string
  }
}

// ────────────────────────────────────────────────
// 媒体状态事件
// ────────────────────────────────────────────────

export interface LocalAudioChangedEvent {
  type: 'localAudioChanged'
  payload: { enabled: boolean }
}

export interface LocalVideoChangedEvent {
  type: 'localVideoChanged'
  payload: { enabled: boolean }
}

// ────────────────────────────────────────────────
// RTC 上报事件（由 reportRtcEvent 触发）
// ────────────────────────────────────────────────

export interface RtcReportEvent {
  type: 'rtcReport'
  payload: {
    type: string
    payload: Record<string, any>
  }
}

// ────────────────────────────────────────────────
// 时长与错误事件
// ────────────────────────────────────────────────

export interface CallDurationUpdatedEvent {
  type: 'callDurationUpdated'
  payload: BaseEvent & {
    duration: number
  }
}

export interface CallErrorEvent {
  type: 'callError'
  payload: {
    /** 错误类型 */
    type: string
    /** 错误信息 */
    error: string
    /** 关联通话 ID */
    callId?: string
    /** 额外上下文 */
    context?: Record<string, any>
  }
}

// ────────────────────────────────────────────────
// 联合类型
// ────────────────────────────────────────────────

export type UIEvent =
  | IncomingCallEvent
  | CallInvitedEvent
  | CallStartedEvent
  | CallAcceptedEvent
  | CallConnectedEvent
  | CallEndedEvent
  | CallTimeoutEvent
  | StatusChangedEvent
  | CallRefusedEvent
  | CallBusyEvent
  | CallCanceledEvent
  | GroupCallInitEvent
  | ParticipantStateChangedEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | RtcReportEvent
  | CallDurationUpdatedEvent
  | CallErrorEvent
  // 精确单聊/群聊事件
  | SingleCallInvitedEvent
  | SingleCallStartedEvent
  | SingleCallAcceptedEvent
  | SingleCallConnectedEvent
  | SingleCallEndedEvent
  | SingleCallTimeoutEvent
  | SingleCallRefusedEvent
  | SingleCallBusyEvent
  | SingleCallCanceledEvent
  | GroupCallInvitedEvent
  | GroupCallStartedEvent
  | GroupCallAcceptedEvent
  | GroupCallConnectedEvent
  | GroupCallEndedEvent
  | GroupCallTimeoutEvent
  | GroupCallRefusedEvent
  | GroupCallBusyEvent
  | GroupCallCanceledEvent

export type RtcEvent =
  | ShouldJoinRtcEvent
  | ShouldLeaveRtcEvent
  | ShouldPublishTracksEvent
  | LocalAudioChangedEvent
  | LocalVideoChangedEvent

export type CallKitEvent = UIEvent | RtcEvent

// ────────────────────────────────────────────────
// 类型守卫（帮助按来源分发事件）
// ────────────────────────────────────────────────

const rtcEventTypes: Set<CallKitEvent['type']> = new Set([
  'shouldJoinRtc',
  'shouldLeaveRtc',
  'shouldPublishTracks',
  'localAudioChanged',
  'localVideoChanged',
])

const uiEventTypes: Set<CallKitEvent['type']> = new Set([
  'incomingCall',
  'callInvited',
  'callStarted',
  'callAccepted',
  'callConnected',
  'callEnded',
  'callTimeout',
  'statusChanged',
  'callRefused',
  'callBusy',
  'callCanceled',
  'groupCallInit',
  'participantStateChanged',
  'participantJoined',
  'participantLeft',
  'rtcReport',
  'callDurationUpdated',
  'callError',
  // 精确单聊/群聊事件
  'singleCallInvited',
  'singleCallStarted',
  'singleCallAccepted',
  'singleCallConnected',
  'singleCallEnded',
  'singleCallTimeout',
  'singleCallRefused',
  'singleCallBusy',
  'singleCallCanceled',
  'groupCallInvited',
  'groupCallStarted',
  'groupCallAccepted',
  'groupCallConnected',
  'groupCallEnded',
  'groupCallTimeout',
  'groupCallRefused',
  'groupCallBusy',
  'groupCallCanceled',
])

export function isUIEvent(event: CallKitEvent): event is UIEvent {
  return !rtcEventTypes.has(event.type)
}

export function isRtcEvent(event: CallKitEvent): event is RtcEvent {
  return rtcEventTypes.has(event.type)
}
