/**
 * 插件对外入口
 */
export { createUniappMpWeixinCallKit } from './core-adapter'
export type { CallKitInstance } from './core-adapter'
export { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
export type { RtcAdapter, JoinRtcParams, MediaType } from './rtc/RtcAdapter'
export { useCallState } from './store/callState'
export type { CallState } from './store/callState'
