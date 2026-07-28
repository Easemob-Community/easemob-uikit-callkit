import type { CALL_TYPE } from '../types/callstate.types'
import type { CallKitEvent, UIEvent, RtcEvent } from '../events/CallKitEvents'
import type { RtcAdapter } from '../rtc/RtcAdapter'
import type { Logger } from '../utils/logger'

// ────────────────────────────────────────────────
// 环信 IM SDK 类型（核心库内部使用，不暴露具体 SDK）
// ────────────────────────────────────────────────

export interface EasemobConnection {
  user: string
  context: {
    userId: string
    jid: { clientResource: string }
  }
  token: string
  send: (msg: any) => Promise<any>
  addEventHandler: (id: string, handlers: Record<string, (...args: any[]) => void>) => void
  removeEventHandler: (id: string) => void
  /**
   * 获取 Agora RTC Token。
   * 环信真实 SDK 返回结构为 `{ data: { RTCToken, appId, RTCUId, expireIn } }`，
   * 为了兼容早期代码与精简 mock，额外允许顶层 `accessToken`/`appId` 字段。
   */
  getRTCToken: (channel: string) => Promise<{
    data?: { RTCToken?: string; appId?: string; RTCUId?: number; expireIn?: number }
    accessToken?: string
    appId?: string
  }>
  getUserIdByRTCUIds: (uids: (number | string)[]) => Promise<{ data: Record<string, string> }>
}

// ────────────────────────────────────────────────
// 核心库配置
// ────────────────────────────────────────────────

export interface CallKitCoreConfig {
  /** 环信 IM 客户端实例 */
  imClient: EasemobConnection
  /** 当前用户资料 */
  userProfile?: {
    userId: string
    nickname?: string
    avatarURL?: string
  }
  /** RTC 适配器（可选）。配置后 Core 会自动处理 RTC 指令事件 */
  rtcAdapter?: RtcAdapter
  /** 全局事件回调（兼容旧接口，与 onUIEvent/onRtcEvent 可共存） */
  onEvent?: (event: CallKitEvent) => void
  /** UI 层事件回调：显示弹窗、更新界面、处理通话生命周期 */
  onUIEvent?: (event: UIEvent) => void
  /** RTC 指令事件回调：加入/离开频道、发布轨道、切换音视频。若已配置 rtcAdapter 可省略 */
  onRtcEvent?: (event: RtcEvent) => void
  /** 邀请超时时间（毫秒），默认 30000 */
  inviteTimeout?: number
  /** 自定义日志器（可选） */
  logger?: Logger
  /** 消息创建工厂（可选）。用于兼容不同版本的 easemob-websdk 消息创建方式 */
  createMessage?: (options: any) => any
}

// ────────────────────────────────────────────────
// API 参数
// ────────────────────────────────────────────────

export interface InviteCallParams {
  calleeUserId: string
  callType: CALL_TYPE
  ext?: Record<string, any>
  /**
   * 当前用户（主叫方）资料。
   * 优先级高于 CallKitCoreConfig.userProfile，用于让每次邀请都携带最新的昵称/头像。
   */
  callerInfo?: {
    nickname?: string
    avatarURL?: string
  }
}

export interface AnswerCallParams {
  callId: string
  /** @deprecated 使用 result 替代 */
  accept?: boolean
  result?: 'accept' | 'refuse' | 'busy'
  /**
   * 当前用户（被叫方）资料，随 answerCall 信令回传给主叫方展示。
   * 优先级高于 CallKitCoreConfig.userProfile。
   */
  calleeInfo?: {
    nickname?: string
    avatarURL?: string
  }
}

export interface HangupParams {
  callId?: string
  reason?: 'normal' | 'cancel' | 'timeout'
}

export interface InviteGroupCallParams {
  groupId: string
  participantIds: string[]
  callType: CALL_TYPE
  ext?: Record<string, any>
  /**
   * 当前用户（主叫方）资料。
   * 优先级高于 CallKitCoreConfig.userProfile，用于让每次邀请都携带最新的昵称/头像。
   */
  callerInfo?: {
    nickname?: string
    avatarURL?: string
  }
}

// ────────────────────────────────────────────────
// RTC 上报
// ────────────────────────────────────────────────

export interface RtcReport {
  type:
    | 'rtcJoined'
    | 'rtcLeft'
    | 'userJoined'
    | 'userLeft'
    | 'userPublished'
    | 'userUnpublished'
    | 'userAudioMuted'
    | 'userAudioUnmuted'
    | 'userVideoMuted'
    | 'userVideoUnmuted'
    | 'networkQuality'
    | 'speaking'
    | 'stoppedSpeaking'
    | 'error'
  payload: {
    userId?: string
    uid?: string | number
    mediaType?: 'audio' | 'video'
    track?: any
    /** 网络质量：0=未知, 1=优, 2=良, 3=一般, 4=差, 5=极差, 6=断开 */
    quality?: number
    /** 说话音量 0-100 */
    volume?: number
    /** 错误信息 */
    error?: string
    /** 错误码 */
    errorCode?: number
  }
}
