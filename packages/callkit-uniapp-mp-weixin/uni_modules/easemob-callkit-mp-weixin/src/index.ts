/**
 * 插件对外入口
 */
export { createUniappMpWeixinCallKit } from './core-adapter'
export type { CallKitInstance } from './core-adapter'

export { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
export type { RtcAdapter, JoinRtcParams, MediaType } from './rtc/RtcAdapter'

export { useCallState } from './store/callState'
export type { CallState } from './store/callState'

// 从 callkit-core 透传常用枚举/类型
export { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from './vendor/callkit-core.esm.js'
export type {
  CallKitEvent,
  InviteCallParams,
  AnswerCallParams,
  HangupParams
} from './vendor/callkit-core.esm.js'

// IM 连接辅助
export { createIMConnection } from './im/createIMConnection'
export type { IMConnection } from './im/createIMConnection'
export { createIMConnectionAdapter } from './im/IMConnectionAdapter'
export type { IMAdaptedConnection } from './im/IMConnectionAdapter'
export { getIMConfig, IM_DATA_CENTER } from './im/IMConfig'
export type { IMConfig, IMDataCenter, IMDataCenterConfig } from './im/IMConfig'
