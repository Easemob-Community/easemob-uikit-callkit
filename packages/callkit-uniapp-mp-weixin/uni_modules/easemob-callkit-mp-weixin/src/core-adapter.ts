import { CallKitCore, setLogger } from './vendor/callkit-core.esm.js'
import { createMpWeixinLogger } from './utils/logger'
import { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
import { useCallState, resetCallState } from './store/callState'
import type { RtcAdapter } from './rtc/RtcAdapter'
import type { CallKitEvent } from './vendor/callkit-core.esm.js'
import type { IMAdaptedConnection } from './im/IMConnectionAdapter'

export interface CallKitInstance {
  core: CallKitCore
  rtcAdapter: RtcAdapter
}

export interface IncomingCallPayload {
  callerUserId: string
  callType: 'audio' | 'video'
  callId: string
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
  /**
   * 收到来电时的回调。
   *
   * 返回 true 表示宿主项目已自行处理（如展示自定义弹窗），
   * 插件将**不再**自动跳转到全屏通话页；
   * 返回 false 或不返回，则插件默认自动跳转。
   */
  onIncomingCall?: (payload: IncomingCallPayload) => boolean | void
}

function getCallTypeName(callType: number): 'audio' | 'video' {
  return callType === 1 || callType === 2 ? 'video' : 'audio'
}

/**
 * 创建 UniApp 微信小程序 CallKit 实例
 */
export function createUniappMpWeixinCallKit(options: CreateCallKitOptions): CallKitInstance {
  const { imClient, userProfile, rtcAdapter: customRtcAdapter, onIncomingCall } = options

  const { state, startDurationTimer } = useCallState()

  // 延迟赋值：adapter 的回调需要引用 core，core 又需要 adapter
  let core: CallKitCore

  const logger = createMpWeixinLogger()
  // 设置 callkit-core 全局 logger，确保核心层也走统一前缀和级别控制
  setLogger(logger)

  const rtcAdapter =
    customRtcAdapter ||
    createMpWeixinRtcAdapter({
      logger,
      logLevel: logger.level,
      onLocalStreamUrl: (url) => {
        core.reportRtcEvent({
          type: 'userPublished',
          payload: {
            userId: state.targetUserId,
            uid: state.targetUserId
          }
        })
      },
      onRemoteStreamUrl: (url, uid) => {
        core.reportRtcEvent({
          type: 'userPublished',
          payload: {
            userId: state.targetUserId,
            uid
          }
        })
      },
      onRemoteUserState: (uid, joined) => {
        core.reportRtcEvent({
          type: joined ? 'userJoined' : 'userLeft',
          payload: { uid }
        })
      },
      onLocalMediaState: (type, enabled) => {
        core.reportRtcEvent({
          type: enabled
            ? type === 'audio'
              ? 'userAudioUnmuted'
              : 'userVideoUnmuted'
            : type === 'audio'
              ? 'userAudioMuted'
              : 'userVideoMuted',
          payload: { userId: state.targetUserId }
        })
      },
      onEvent: (type, payload) => {
        if (type === 'error') {
          core.reportRtcEvent({
            type: 'error',
            payload: { error: payload?.reason || String(payload) }
          })
        }
      }
    })

  core = new CallKitCore({
    imClient,
    userProfile,
    rtcAdapter,
    logger,
    createMessage: (payload: any) => imClient.createMessage(payload),
    onEvent: (event: CallKitEvent) => {
      logger.debug('[callkit event]', event)

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

          const incomingPayload: IncomingCallPayload = {
            callerUserId: state.targetUserId,
            callType: state.callType,
            callId: state.callId
          }

          // 优先让宿主项目处理来电展示
          const handled = onIncomingCall?.(incomingPayload)
          if (handled === true) {
            break
          }

          // 默认自动跳转到插件内置单聊通话页面（被叫）
          uni.navigateTo({
            url: `/uni_modules/easemob-callkit-mp-weixin/pages/single-call-page/single-call-page?targetUserId=${state.targetUserId}&callType=${state.callType}`
          })
          break
        }
        case 'callInvited': {
          const payload = event.payload || {}
          // 主叫方： inviteCall 发出后同步 callId / channel / 对端用户
          if (payload.isCaller) {
            state.callId = payload.callId || state.callId
            state.channel = payload.channel || state.channel
            state.targetUserId = payload.calleeUserId || state.targetUserId
          }
          break
        }
        case 'callConnected':
        case 'callStarted': {
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
          // 通话结束由 single-call-page 的状态监听器负责返回，这里只重置全局状态
          break
        }
        case 'shouldJoinRtc': {
          const payload = event.payload || {}
          rtcAdapter.joinChannel({
            channel: payload.channel,
            token: payload.token,
            uid: payload.uid,
            appId: payload.appId,
            callType: getCallTypeName(payload.callType)
          })
          break
        }
        case 'shouldPublishTracks': {
          const payload = event.payload || {}
          rtcAdapter.publishLocalTracks(payload.trackTypes || [])
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
