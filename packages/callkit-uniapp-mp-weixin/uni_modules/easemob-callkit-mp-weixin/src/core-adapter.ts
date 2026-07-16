import { CallKitCore } from './vendor/callkit-core.esm.js'
import { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
import { useCallState, resetCallState } from './store/callState'
import type { RtcAdapter } from './rtc/RtcAdapter'
import type { CallKitEvent } from './vendor/callkit-core.esm.js'

export interface CallKitInstance {
  core: CallKitCore
  rtcAdapter: RtcAdapter
}

export interface CreateCallKitOptions {
  /** 环信 IM 连接实例 */
  imClient: any
  /** 可选：自定义 RTC 适配器 */
  rtcAdapter?: RtcAdapter
}

/**
 * 创建 UniApp 微信小程序 CallKit 实例
 */
export function createUniappMpWeixinCallKit(options: CreateCallKitOptions): CallKitInstance {
  const { imClient, rtcAdapter = createMpWeixinRtcAdapter() } = options

  const { state } = useCallState()

  const core = new CallKitCore({
    imClient,
    rtcAdapter,
    createMessage: (payload: any) => {
      // TODO: 使用 easemob-websdk 创建消息对象
      // 示例：return imClient.message.create(payload)
      return payload
    },
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
