// ─── 版本号 ───
export const VERSION = '1.1.0'

/**
 * @easemob/callkit-core
 *
 * 框架无关的通话信令核心库。
 * 仅依赖环信 IM SDK 作为信令通道，RTC 层通过抽象接口由上层自行接入。
 */

// ─── 核心入口 ───
export { CallKitCore } from './core/CallKitCore'
export type {
  CallKitCoreConfig,
  InviteCallParams,
  AnswerCallParams,
  HangupParams,
  InviteGroupCallParams,
  RtcReport,
  EasemobConnection,
} from './core/CallKitCore.types'

// ─── 状态机 ───
export { SingleCallStateMachine } from './state/SingleCallStateMachine'
export type { SingleCallState, DomainEvent, TransitionResult } from './state/SingleCallStateMachine'
export { GroupCallSession } from './state/GroupCallSession'
export type { GroupParticipant, GroupSessionState } from './state/GroupCallSession'

// ─── 信令 ───
export { SignalRouter } from './signaling/SignalRouter'
export type { CmdMsgBody, SignalHandler } from './signaling/SignalRouter'
export { SingleCallSignalHandler } from './signaling/SingleCallSignalHandler'
export { GroupCallSignalHandler } from './signaling/GroupCallSignalHandler'
export { MessageBuilder } from './signaling/MessageBuilder'
export type { BuildInviteMessageParams, BuildCmdMessageParams } from './signaling/MessageBuilder'
export { SignalSender } from './signaling/SignalSender'

// ─── IM ───
export type { IMProvider, IMMessage } from './im/IMProvider'
export { IMListener } from './im/IMListener'
export type { IMListenerCallbacks } from './im/IMListener'

// ─── RTC ───
export type { RtcAdapter, JoinRtcParams } from './rtc/RtcAdapter'

// ─── 事件 ───
export type {
  CallKitEvent,
  UIEvent,
  RtcEvent,
  IncomingCallEvent,
  CallStartedEvent,
  CallAcceptedEvent,
  CallConnectedEvent,
  CallEndedEvent,
  CallTimeoutEvent,
  StatusChangedEvent,
  CallRefusedEvent,
  CallBusyEvent,
  CallCanceledEvent,
  SingleCallStartedEvent,
  SingleCallAcceptedEvent,
  SingleCallConnectedEvent,
  SingleCallEndedEvent,
  SingleCallTimeoutEvent,
  SingleCallRefusedEvent,
  SingleCallBusyEvent,
  SingleCallCanceledEvent,
  GroupCallStartedEvent,
  GroupCallAcceptedEvent,
  GroupCallConnectedEvent,
  GroupCallEndedEvent,
  GroupCallTimeoutEvent,
  GroupCallRefusedEvent,
  GroupCallBusyEvent,
  GroupCallCanceledEvent,
  ShouldJoinRtcEvent,
  ShouldLeaveRtcEvent,
  ShouldPublishTracksEvent,
  GroupCallInitEvent,
  ParticipantStateChangedEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  LocalAudioChangedEvent,
  LocalVideoChangedEvent,
} from './events/CallKitEvents'
export { isUIEvent, isRtcEvent } from './events/CallKitEvents'
export { EventBus } from './events/EventBus'

// ─── 类型 ───
export { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from './types/callstate.types'
export type {
  CALLKIT_CMD_MSG_ACTION_TYPE,
  CALLKIT_CMD_MSG_RESULT_TYPE,
} from './types/callstate.types'
export type {
  SignalingExt,
  InviteSignalingExt,
  AlertSignalingExt,
  ConfirmRingSignalingExt,
  AnswerCallSignalingExt,
  ConfirmCalleeSignalingExt,
  CancelCallSignalingExt,
  LeaveCallSignalingExt,
  SignalMessageInviteExt,
} from './types/signal.types'

// ─── 工具 ───
export { generateRandomChannel, formatCallDuration, isMessageExpired, isCmdMessageExpired } from './utils/callUtils'
export { setLogger, getLogger } from './utils/logger'
export type { Logger } from './utils/logger'
