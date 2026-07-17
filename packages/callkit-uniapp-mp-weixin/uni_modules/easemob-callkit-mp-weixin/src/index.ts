/**
 * 插件对外入口
 */
export { createUniappMpWeixinCallKit } from './core-adapter'
export type { CallKitInstance, IncomingCallPayload, CreateCallKitOptions, GroupMemberInfo } from './core-adapter'

export { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
export type { RtcAdapter, JoinRtcParams, MediaType } from './rtc/RtcAdapter'

export { useCallState, resetCallState } from './store/callState'
export type { CallState, UserInfo } from './store/callState'

export { useGroupCallState, resetGroupCallState } from './store/groupCallState'
export type { GroupCallState, GroupParticipant, GroupCallSession } from './store/groupCallState'

// 日志工具
export { createMpWeixinLogger, getMpWeixinLogger } from './utils/logger'
export type { LogLevel, CreateLoggerOptions } from './utils/logger'

// 从 callkit-core 透传常用枚举/类型
export { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from './vendor/callkit-core.esm.js'
export type {
  CallKitEvent,
  InviteCallParams,
  AnswerCallParams,
  HangupParams
} from './vendor/callkit-core.esm.js'

// IM 连接辅助
export { createIMConnectionAdapter } from './im/IMConnectionAdapter'
export type { IMAdaptedConnection, IMConnection } from './im/IMConnectionAdapter'
