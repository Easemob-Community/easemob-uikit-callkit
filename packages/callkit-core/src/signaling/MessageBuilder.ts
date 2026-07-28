import type {
  InviteSignalingExt,
  SignalingExt,
  AlertSignalingExt,
  ConfirmRingSignalingExt,
  AnswerCallSignalingExt,
  ConfirmCalleeSignalingExt,
  CancelCallSignalingExt,
  LeaveCallSignalingExt,
} from '../types/signal.types'
import { CALL_TYPE } from '../types/callstate.types'
import type { CALLKIT_CMD_MSG_ACTION_TYPE, CALLKIT_CMD_MSG_RESULT_TYPE } from '../types/callstate.types'

/**
 * MessageBuilder
 * 由 ChatService 改造而来的纯函数集合。
 *
 * 关键变化：
 * - 不再读取 callStateStore，所有数据由调用方显式传入
 * - 不再查询用户/群组资料，由调用方传入
 */

export interface BuildInviteMessageParams {
  callId: string
  callerUserId: string
  calleeUserId: string
  callerDevId: string
  channel: string
  callType: CALL_TYPE
  ts?: number
  invitedMembers?: string[]
  callerInfo?: { nickname?: string; avatarURL?: string }
  groupInfo?: { groupId: string; groupName?: string; groupAvatar?: string }
}

export interface BuildCmdMessageParams {
  action: CALLKIT_CMD_MSG_ACTION_TYPE
  callId: string
  callerDevId?: string
  calleeDevId?: string
  result?: CALLKIT_CMD_MSG_RESULT_TYPE
  status?: boolean
  ts?: number
  /** 被叫方用户资料（仅 answerCall 使用，回传给主叫展示） */
  userInfo?: { nickname?: string; avatarURL?: string }
}

export class MessageBuilder {
  /**
   * 构建 invite 文本消息的 ext
   */
  static buildInviteExt(params: BuildInviteMessageParams): InviteSignalingExt {
    const ts = params.ts ?? Date.now()
    // 与旧版 ChatService 对齐：空数组时不携带 invitedMembers 字段
    const invitedMembers =
      params.invitedMembers && params.invitedMembers.length > 0
        ? params.invitedMembers
        : undefined
    return {
      action: 'invite',
      callId: params.callId || '',
      callerIMName: params.callerUserId || '',
      calleeIMName: params.calleeUserId || '',
      callerDevId: params.callerDevId || '',
      channelName: params.channel || '',
      chatType: params.callType || CALL_TYPE.AUDIO_1V1,
      type: params.callType || CALL_TYPE.AUDIO_1V1,
      ts,
      msgType: 'rtcCallWithAgora',
      invitedMembers,
      em_push_ext: {
        type: 'call',
        custom: {
          action: 'invite',
          channelName: params.channel || '',
          type: params.callType || CALL_TYPE.AUDIO_1V1,
          callerDevId: params.callerDevId || '',
          callId: params.callId || '',
          ts,
          msgType: 'rtcCallWithAgora',
          callerIMName: params.callerUserId || '',
          calleeIMName: params.calleeUserId || '',
          // 与旧版 ChatService 对齐：无昵称时 fallback 到 callerUserId，避免 iOS/APNS 解析异常
          callerNickname: params.callerInfo?.nickname || params.callerUserId || '',
          chatType: params.callType || CALL_TYPE.AUDIO_1V1,
        },
      },
      em_apns_ext: {
        em_push_type: 'voip',
      },
      ease_chat_uikit_user_info: params.callerInfo
        ? {
            nickname: params.callerInfo.nickname || params.callerUserId || '',
            avatarURL: params.callerInfo.avatarURL || '',
          }
        : undefined,
      callkitGroupInfo: params.groupInfo,
      // 兼容新版 iOS EaseCallUIKit：ext 最外层携带 groupId / receiverList
      groupId: params.groupInfo?.groupId,
      receiverList: invitedMembers,
    }
  }

  /**
   * 构建 CMD 信令消息的 ext
   */
  static buildCmdExt(params: BuildCmdMessageParams): SignalingExt {
    const ts = params.ts ?? Date.now()
    const base = { callId: params.callId || '', ts, msgType: 'rtcCallWithAgora' }

    switch (params.action) {
      case 'alert':
        return {
          ...base,
          action: 'alert',
          calleeDevId: params.calleeDevId || '',
          callerDevId: params.callerDevId || '',
        } as AlertSignalingExt

      case 'confirmRing':
        return {
          ...base,
          action: 'confirmRing',
          status: params.status ?? false,
          callerDevId: params.callerDevId || '',
          calleeDevId: params.calleeDevId || '',
        } as ConfirmRingSignalingExt

      case 'answerCall':
        return {
          ...base,
          action: 'answerCall',
          result: (params.result as any) || 'busy',
          callerDevId: params.callerDevId || '',
          calleeDevId: params.calleeDevId || '',
          // 被叫方资料回传（与 invite 的 ease_chat_uikit_user_info 对称），旧端忽略
          ease_chat_uikit_user_info: params.userInfo
            ? {
                nickname: params.userInfo.nickname || '',
                avatarURL: params.userInfo.avatarURL || '',
              }
            : undefined,
        } as AnswerCallSignalingExt

      case 'confirmCallee':
        return {
          ...base,
          action: 'confirmCallee',
          result: (params.result as any) || 'accept',
          callerDevId: params.callerDevId || '',
          calleeDevId: params.calleeDevId || '',
        } as ConfirmCalleeSignalingExt

      case 'cancelCall':
        return {
          ...base,
          action: 'cancelCall',
          callerDevId: params.callerDevId || '',
        } as CancelCallSignalingExt

      case 'leaveCall':
        return {
          ...base,
          action: 'leaveCall',
        } as LeaveCallSignalingExt

      default:
        throw new Error(`[MessageBuilder] 未知的信令动作: ${params.action}`)
    }
  }
}
