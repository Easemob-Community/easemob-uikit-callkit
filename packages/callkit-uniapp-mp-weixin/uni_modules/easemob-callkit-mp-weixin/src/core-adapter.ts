import { CallKitCore, setLogger, CALL_TYPE } from './vendor/callkit-core.esm.js'
import { createMpWeixinLogger } from './utils/logger'
import { createMpWeixinRtcAdapter } from './rtc/MpWeixinRtcAdapter'
import { useCallState, resetCallState, type UserInfo } from './store/callState'
import { useGroupCallState, resetGroupCallState, type GroupParticipant } from './store/groupCallState'
import type { RtcAdapter } from './rtc/RtcAdapter'
import type { CallKitEvent } from './vendor/callkit-core.esm.js'
import type { IMAdaptedConnection } from './im/IMConnectionAdapter'

export interface CallKitInstance {
  core: CallKitCore
  rtcAdapter: RtcAdapter
  /** 设置单个用户资料，供通话页/通知条显示昵称头像 */
  setUserInfo(userId: string, info: UserInfo): void
  /** 批量设置用户资料 */
  setUserInfoMap(map: Record<string, UserInfo>): void
  /** 订阅通话事件，返回取消订阅函数 */
  onEvent(handler: (event: CallKitEvent) => void): () => void
  /** 发起群聊通话 */
  inviteGroupCall(params: {
    groupId: string
    participantIds: string[]
    callType: CALL_TYPE
    ext?: { groupName?: string; groupAvatar?: string; message?: string }
    callerInfo?: UserInfo
  }): Promise<void>
  /** 通话中追加邀请参与者 */
  inviteMoreParticipants(participantIds: string[]): Promise<void>
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
  /**
   * 是否显示插件内置的通话结束状态 Toast。
   * 默认为 true；若宿主项目已通过 onEvent 自行处理，可设为 false 避免重复提示。
   */
  showDefaultToast?: boolean
}

function getCallTypeName(callType: number): 'audio' | 'video' {
  return callType === 1 || callType === 2 ? 'video' : 'audio'
}

/**
 * 创建 UniApp 微信小程序 CallKit 实例
 */
export function createUniappMpWeixinCallKit(options: CreateCallKitOptions): CallKitInstance {
  const { imClient, userProfile, rtcAdapter: customRtcAdapter, onIncomingCall, showDefaultToast = true } = options

  const { state, startDurationTimer } = useCallState()

  // 记录当前登录用户身份，并把本人资料写入 userInfoMap，供通话页展示
  if (userProfile?.userId) {
    state.localUserId = userProfile.userId
    state.userInfoMap[userProfile.userId] = {
      nickname: userProfile.nickname || userProfile.userId,
      avatarURL: userProfile.avatarURL || ''
    }
  }
  const {
    state: groupState,
    startInviteTimeout: startGroupInviteTimeout,
    stopInviteTimeout: stopGroupInviteTimeout,
    upsertParticipant,
    removeParticipant,
    updateParticipantState
  } = useGroupCallState()

  // 监听 IM 连接状态，便于宿主感知断线/重连
  imClient.onConnected = () => {
    logger.info('[CallKit] IM 已重新连接')
    uni.showToast({ title: 'IM 已重新连接', icon: 'none', duration: 1500 })
  }
  imClient.onDisconnected = () => {
    logger.warn('[CallKit] IM 已断开连接')
    uni.showToast({ title: 'IM 连接已断开，等待重连', icon: 'none', duration: 2000 })
  }

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
      getUserIdByRTCUIds: (uids) => imClient.getUserIdByRTCUIds(uids),
      onLocalStreamUrl: (url) => {
        // 本地流发布只更新 UI 状态，不再上报 core 的 userPublished
        // userPublished 应由远端用户流发布事件触发
      },
      onRemoteStreamUrl: (url, uid) => {
        // 主叫方在发起呼叫时已知道对端 userId，直接用 targetUserId 纠正 RTC uid 解析结果
        if (state.isCaller && state.targetUserId) {
          state.remoteUserId = state.targetUserId
          state.remoteUid = String(uid)
        }
        core.reportRtcEvent({
          type: 'userPublished',
          payload: {
            userId: state.remoteUserId || state.targetUserId,
            uid
          }
        })
      },
      onRemoteUserState: (uid, joined) => {
        // 主叫方在发起呼叫时已知道对端 userId，直接用 targetUserId 纠正 RTC uid 解析结果
        if (joined && state.isCaller && state.targetUserId) {
          state.remoteUserId = state.targetUserId
          state.remoteUid = String(uid)
        }
        core.reportRtcEvent({
          type: joined ? 'userJoined' : 'userLeft',
          payload: { uid }
        })
      },
      onRemoteStreamAdded: (uid, url, userId) => {
        // 群聊：把远端流写入群聊参与者
        if (groupState.session) {
          upsertParticipant({
            userId,
            uid: String(uid),
            streamUrl: url,
            state: 'joinedRtc'
          })
        }
      },
      onRemoteStreamRemoved: (uid, userId) => {
        // 群聊：移除远端流
        if (groupState.session) {
          updateParticipantState(userId, { streamUrl: '', state: 'left' })
        }
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
          const callType = payload.callType

          // 群聊来电
          if (callType === 2 || callType === 3) {
            groupState.callStatus = 'ringing'
            groupState.session = {
              groupId: payload.groupId || payload.calleeUserId || '',
              groupName: payload.groupName || '群聊',
              callType: callType === 2 ? 'video' : 'audio',
              startTime: null,
              callerUserId: payload.callerUserId || ''
            }

            // 把主叫方资料写入 userInfoMap，供响铃页展示
            if (payload.callerUserId) {
              state.userInfoMap[payload.callerUserId] = {
                nickname: payload.callerInfo?.nickname || payload.callerUserId,
                avatarURL: payload.callerInfo?.avatarURL || ''
              }
            }

            // 同步单聊状态，便于接听/拒绝调用
            state.callId = payload.callId || ''
            state.callType = callType === 2 ? 'video' : 'audio'
            state.isCaller = false
            state.audioEnabled = true
            state.videoEnabled = callType === 2

            // 初始化被邀请参与者
            const invitedMembers = payload.invitedMembers || []
            groupState.invitedParticipants = invitedMembers.map((userId: string) => ({
              userId,
              uid: '',
              streamUrl: '',
              state: 'invited',
              isMuted: false,
              isCameraOn: false,
              nickname: state.userInfoMap[userId]?.nickname || userId,
              avatarURL: state.userInfoMap[userId]?.avatarURL || '',
              isLocal: userId === state.localUserId,
              isSpeaking: false
            }))

            const handled = onIncomingCall?.({
              callerUserId: payload.callerUserId || '',
              callType: callType === 2 ? 'video' : 'audio',
              callId: payload.callId || ''
            })
            if (handled === true) {
              break
            }

            uni.navigateTo({
              url: `/uni_modules/easemob-callkit-mp-weixin/pages/group-call-page/group-call-page?groupId=${groupState.session.groupId}&callType=${groupState.session.callType}`
            })
            break
          }

          // 单聊来电
          state.status = 'ringing'
          state.targetUserId = payload.callerUserId || ''
          state.callType = getCallTypeName(callType)
          state.callId = payload.callId || ''
          state.isCaller = false
          state.audioEnabled = true
          state.videoEnabled = callType === CALL_TYPE.VIDEO_1V1

          // 把主叫方资料写入全局 userInfoMap，供通话页显示昵称/头像
          if (payload.callerInfo && payload.callerUserId) {
            state.userInfoMap[payload.callerUserId] = {
              nickname: payload.callerInfo.nickname || payload.callerUserId,
              avatarURL: payload.callerInfo.avatarURL || ''
            }
          }

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
        case 'groupCallInit': {
          const payload = event.payload || {}
          // 主叫方：群聊初始化，跳群聊页
          groupState.callStatus = 'in_call'
          groupState.session = {
            groupId: payload.groupId || '',
            groupName: payload.groupName || '群聊',
            callType: payload.callType || 'audio',
            startTime: null
          }

          // 初始化参与者
          const invitedMembers = payload.invitedMembers || []
          groupState.participants = invitedMembers.map((userId: string) => ({
            userId,
            uid: '',
            streamUrl: '',
            state: 'invited',
            isMuted: false,
            isCameraOn: false,
            nickname: state.userInfoMap[userId]?.nickname || userId,
            avatarURL: state.userInfoMap[userId]?.avatarURL || '',
            isLocal: userId === userProfile?.userId,
            isSpeaking: false
          }))

          uni.navigateTo({
            url: `/uni_modules/easemob-callkit-mp-weixin/pages/group-call-page/group-call-page?groupId=${groupState.session.groupId}&callType=${groupState.session.callType}`
          })
          break
        }
        case 'participantJoined': {
          const payload = event.payload || {}
          if (groupState.session && payload.userId) {
            upsertParticipant({
              userId: payload.userId,
              state: 'accepted',
              nickname: state.userInfoMap[payload.userId]?.nickname || payload.userId,
              avatarURL: state.userInfoMap[payload.userId]?.avatarURL || ''
            })
          }
          break
        }
        case 'participantLeft': {
          const payload = event.payload || {}
          if (groupState.session && payload.userId) {
            updateParticipantState(payload.userId, { state: 'left', streamUrl: '' })
          }
          break
        }
        case 'participantStateChanged': {
          const payload = event.payload || {}
          if (groupState.session && payload.userId) {
            updateParticipantState(payload.userId, {
              state: payload.state
            })
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
          // 根据事件类型给用户明确的状态反馈
          const toastMap: Record<string, string> = {
            callEnded: '通话结束',
            callTimeout: '无人接听',
            callRefused: '对方已拒绝',
            callBusy: '对方正在通话中',
            callCanceled: '对方已取消'
          }
          const message = toastMap[event.type]
          if (message && showDefaultToast) {
            uni.showToast({ title: message, icon: 'none', duration: 2000 })
          }
          resetCallState()
          resetGroupCallState()
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
            callType: getCallTypeName(payload.callType),
            knownParticipants: groupState.session
              ? groupState.participants
                  .filter((p) => !p.isLocal)
                  .map((p) => ({ uid: p.uid || 0, userId: p.userId }))
              : undefined
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
    rtcAdapter,
    setUserInfo: (userId: string, info: UserInfo) => {
      state.userInfoMap[userId] = { ...state.userInfoMap[userId], ...info }
    },
    setUserInfoMap: (map: Record<string, UserInfo>) => {
      Object.entries(map).forEach(([userId, info]) => {
        state.userInfoMap[userId] = { ...state.userInfoMap[userId], ...info }
      })
    },
    onEvent: (handler) => core.onEvent(handler),
    inviteGroupCall: (params) => core.inviteGroupCall(params),
    inviteMoreParticipants: (participantIds) => core.inviteMoreParticipants(participantIds)
  }
}
