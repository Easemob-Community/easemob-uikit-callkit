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

function getCallTypeName(callType: number): 'audio' | 'video' {
  return callType === 1 || callType === 2 ? 'video' : 'audio'
}

function isSingleCall(callType: number): boolean {
  return callType === 0 || callType === 1
}

/**
 * 创建 UniApp 微信小程序 CallKit 实例
 */
export function createUniappMpWeixinCallKit(options: CreateCallKitOptions): CallKitInstance {
  const { imClient, userProfile, rtcAdapter = createMpWeixinRtcAdapter() } = options

  const { state, startDurationTimer } = useCallState()

  const core = new CallKitCore({
    imClient,
    userProfile,
    rtcAdapter,
    createMessage: (payload: any) => imClient.createMessage(payload),
    onEvent: (event: CallKitEvent) => {
      console.log('[callkit event]', event)

      switch (event.type) {
        case 'incomingCall': {
          const payload = event.payload || {}
          state.status = 'ringing'
          state.targetUserId = payload.callerUserId || ''
          state.callType = getCallTypeName(payload.callType)
          state.callId = payload.callId || ''
          state.isCaller = false
          state.audioEnabled = true
          state.videoEnabled = payload.callType === 1 || payload.callType === 2

          // 跳转到通话页面（被叫）
          uni.navigateTo({
            url: `/pages/meeting/meeting?targetUserId=${state.targetUserId}&callType=${state.callType}`
          })
          break
        }
        case 'callConnected': {
          state.status = 'in_call'
          startDurationTimer()
          break
        }
        case 'callEnded':
        case 'callTimeout':
        case 'callRefused':
        case 'callBusy':
        case 'callCanceled': {
          resetCallState()
          // 如果当前在通话页面，返回首页
          const pages = getCurrentPages()
          const current = pages[pages.length - 1]
          if (current && current.route?.includes('meeting')) {
            uni.navigateBack({ delta: 1 })
          }
          break
        }
        case 'statusChanged':
          // TODO: 同步 core 内部状态到 UI
          break
        case 'shouldJoinRtc': {
          const payload = event.payload || {}
          rtcAdapter.joinChannel({
            channel: payload.channel,
            token: payload.token,
            uid: payload.rtcUid,
            appId: payload.appId
          })
          break
        }
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
