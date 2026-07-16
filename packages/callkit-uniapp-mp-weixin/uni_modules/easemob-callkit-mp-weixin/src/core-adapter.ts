import { CallKitCore } from './vendor/callkit-core.esm.js'
import { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
import { useCallState, resetCallState } from './store/callState'
import type { RtcAdapter } from './rtc/RtcAdapter'
import type { CallKitEvent } from './vendor/callkit-core.esm.js'
import type { IMAdaptedConnection } from './im/IMConnectionAdapter'

export interface CallKitInstance {
  core: CallKitCore
  rtcAdapter: RtcAdapter
}

export interface CreateCallKitOptions {
  /** 经 IMConnectionAdapter 包装后的环信 IM 连接实例 */
  imClient: IMAdaptedConnection
  /** 当前用户资料 */
  userProfile?: {
    userId: string
    nickname?: string
    avatarURL?: string
  }
  /** 可选：自定义 RTC 适配器 */
  rtcAdapter?: RtcAdapter
}

/**
 * 创建 UniApp 微信小程序 CallKit 实例
 */
export function createUniappMpWeixinCallKit(options: CreateCallKitOptions): CallKitInstance {
  const { imClient, userProfile, rtcAdapter = createMpWeixinRtcAdapter() } = options

  const { state } = useCallState()

  const core = new CallKitCore({
    imClient,
    userProfile,
    rtcAdapter,
    createMessage: (payload: any) => imClient.createMessage(payload),
    onEvent: (event: CallKitEvent) => {
      console.log('[callkit event]', event)

      switch (event.type) {
        case 'incomingCall':
          state.status = 'ringing'
          state.targetUserId = event.payload?.callerUserId || ''
          state.callType = event.payload?.callType === 1 ? 'video' : 'audio'
          break
        case 'callConnected':
          state.status = 'in_call'
          break
        case 'callEnded':
        case 'callTimeout':
        case 'callRefused':
        case 'callBusy':
        case 'callCanceled':
          resetCallState()
          break
        case 'statusChanged':
          // TODO: 同步 core 内部状态到 UI
          break
        case 'shouldJoinRtc':
          // TODO: 从 event.payload 获取 channel/token/uid 后调用 rtcAdapter.joinChannel
          break
        case 'shouldLeaveRtc':
          rtcAdapter.leaveChannel()
          break
        default:
          break
      }
    }
  })

  return {
    core,
    rtcAdapter
  }
}
