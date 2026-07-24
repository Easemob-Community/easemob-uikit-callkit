import type { CmdMsgBody, SignalHandler } from './SignalRouter'
import type { GroupCallSession } from '../state/GroupCallSession'
import type { SingleCallStateMachine } from '../state/SingleCallStateMachine'
import type { DomainEvent } from '../state/SingleCallStateMachine'
import type { SignalSender } from './SignalSender'
import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'
import { CALL_STATUS, CALL_TYPE } from '../types/callstate.types'

/**
 * GroupCallSignalHandler
 * 群聊域信令处理器
 *
 * 改造后：
 * - 不读写 GroupCallStore → 注入 GroupCallSession
 * - 不直接调用 CallService → 返回 DomainEvent[]
 * - 不直接 emit callKitEventBus → 返回 DomainEvent[]
 * - 保留 SingleCallStateMachine 用于 callId / 状态校验（与原架构一致）
 */
export class GroupCallSignalHandler implements SignalHandler {
  private session: GroupCallSession
  private stateMachine: SingleCallStateMachine
  private sender: SignalSender
  private getUserId: () => string
  private logger: Logger

  constructor(
    session: GroupCallSession,
    stateMachine: SingleCallStateMachine,
    sender: SignalSender,
    userIdProvider: (() => string) | string,
    logger?: Logger
  ) {
    this.session = session
    this.stateMachine = stateMachine
    this.sender = sender
    // 兼容字符串入参（旧测试用例），运行时优先使用 provider 实时读取
    this.getUserId = typeof userIdProvider === 'function' ? userIdProvider : () => userIdProvider
    this.logger = logger || getLogger()
    this.logger.warn('👥 [GroupCallSignalHandler] 群聊信令处理器已初始化')
  }

  private get userId(): string {
    return this.getUserId()
  }

  /**
   * 处理 invite 文本消息中的群聊初始化
   * 由 IMListener 在收到 invite 文本消息时直接调用（不走 SignalRouter）
   */
  handleInviteTextMessage(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext as any
    const callerUserId = ext?.callerIMName || message.from || ''
    const groupId = ext?.callkitGroupInfo?.groupId || ''
    const groupName = ext?.callkitGroupInfo?.groupName || ''
    const channel = ext?.channelName || ''
    const callType = ext?.type === CALL_TYPE.VIDEO_MULTI ? 'video' : 'audio'
    const invitedMembers: string[] = ext?.invitedMembers || []
    const callId = ext?.callId || ''

    // 解析 caller 资料
    const callerUserInfo = ext?.ease_chat_uikit_user_info
    const callerNickname = callerUserInfo?.nickname || callerUserId
    const callerAvatar = callerUserInfo?.avatarURL || ''

    // 初始化群聊会话
    this.session.init({
      sessionId: channel,
      groupId,
      groupName,
      callType,
      callerUserId,
    })

    // 本地用户
    this.session.addParticipant({
      userId: this.userId,
      nickname: this.userId,
      avatarUrl: '',
      state: 'invited',
      isLocal: true,
      isMuted: false,
      isCameraOn: callType === 'video',
      isSpeaking: false,
    })

    // 主叫方
    if (callerUserId && callerUserId !== this.userId) {
      this.session.addParticipant({
        userId: callerUserId,
        nickname: callerNickname,
        avatarUrl: callerAvatar,
        state: 'joinedRtc',
        isLocal: false,
        isMuted: false,
        isCameraOn: false,
        isSpeaking: false,
      })
    }

    // 其他被邀请成员
    invitedMembers.forEach((m: string) => {
      if (m !== this.userId && m !== callerUserId) {
        this.session.addParticipant({
          userId: m,
          nickname: m,
          avatarUrl: '',
          state: 'invited',
          isLocal: false,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false,
        })
      }
    })

    this.logger.event?.('groupCallInit', {
      groupId,
      groupName,
      channel,
      callType,
      participants: this.session.getAllParticipants().map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        state: p.state,
      })),
    })

    return [
      {
        type: 'GROUP_CALL_INIT',
        callId,
        groupId,
        groupName,
        channel,
        callType,
        callerUserId,
        invitedMembers,
      },
    ]
  }

  handle(message: CmdMsgBody): DomainEvent[] {
    const action = message.ext?.action
    switch (action) {
      case 'answerCall':
        return this.handleAnswerCall(message)
      case 'cancelCall':
        return this.handleCancelCall(message)
      case 'leaveCall':
        return this.handleLeaveCall(message)
      default:
        this.logger.warn(`[GroupCallSignalHandler] 未知 action: ${action}`)
        return []
    }
  }

  // ───────────────────────────────────────────────
  // answerCall — 群聊成员应答
  // ───────────────────────────────────────────────

  private handleAnswerCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // 只处理群聊类型
    if (
      currentState.type !== CALL_TYPE.VIDEO_MULTI &&
      currentState.type !== CALL_TYPE.AUDIO_MULTI
    ) {
      return []
    }

    // callId 校验
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[GroupCallSignalHandler] answerCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )
      return []
    }

    const fromUserId = message.from as string
    const callId = currentState.callId
    const channel = currentState.channel
    const groupSnapshot = this.session.getSnapshot()
    const groupId = groupSnapshot?.groupId

    if (ext.result !== 'accept') {
      // ── 拒绝 ──
      this.logger.signal?.('recv', 'answerCall', {
        from: fromUserId,
        result: ext.result,
        callId,
        type: 'group',
      })
      this.logger.info(`[GroupCallSignalHandler] 群聊成员拒绝: ${fromUserId}`)

      this.session.removeParticipant(fromUserId)

      return [
        {
          type: 'PARTICIPANT_LEFT',
          callId,
          userId: fromUserId,
          channel,
          callType: currentState.type,
          reason: ext.result === 'busy' ? 'busy' : 'refused',
          groupId,
        },
      ]
    }

    // ── 接受 ──
    this.logger.signal?.('recv', 'answerCall', {
      from: fromUserId,
      result: 'accept',
      callId,
      type: 'group',
    })
    this.logger.info(`[GroupCallSignalHandler] 群聊成员接受: ${fromUserId}`)

    this.session.markAccepted(fromUserId)

    // 与旧版对齐：群聊成员接受后，主叫方也发送 confirmCallee 给被叫方
    this.sendConfirmCallee(fromUserId, {
      callId,
      callerDevId: currentState.callerDevId || '',
      calleeDevId: ext.calleeDevId as string,
      result: 'accept',
    })

    return [
      {
        type: 'PARTICIPANT_STATE_CHANGED',
        callId,
        userId: fromUserId,
        state: 'accepted',
        groupId,
      },
      {
        type: 'PARTICIPANT_JOINED',
        callId,
        userId: fromUserId,
        channel,
        callType: currentState.type,
        groupId,
      },
    ]
  }

  // ─── 私有辅助 ───

  private sendConfirmCallee(
    to: string,
    payload: {
      callId: string
      callerDevId: string
      calleeDevId: string
      result: string
    }
  ): void {
    // 与旧版对齐：confirmCallee 不设置 deliverOnlineOnly（默认 false）
    this.sender
      .sendCmdMessage(
        to,
        'singleChat',
        {
          action: 'confirmCallee',
          callId: payload.callId,
          callerDevId: payload.callerDevId,
          calleeDevId: payload.calleeDevId,
          result: payload.result,
          ts: Date.now(),
          msgType: 'rtcCallWithAgora',
        } as any
      )
      .catch((e) => {
        // confirmCallee 发送失败时被叫侧只能等 confirmCalleeTimer 超时回收，必须留痕便于排查
        this.logger.warn('[GroupCallSignalHandler] confirmCallee 发送失败:', { to, callId: payload.callId, err: e })
      })
  }

  // ───────────────────────────────────────────────
  // cancelCall — 群聊容错
  // ───────────────────────────────────────────────

  private handleCancelCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // 只处理群聊类型
    if (
      currentState.type !== CALL_TYPE.VIDEO_MULTI &&
      currentState.type !== CALL_TYPE.AUDIO_MULTI
    ) {
      return []
    }

    const currentStatus = currentState.status
    const isFromCaller = message.from === currentState.callerUserId

    // callId 不匹配时的容错
    if (ext.callId !== currentState.callId) {
      if (
        isFromCaller &&
        (currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING)
      ) {
        this.logger.info('[GroupCallSignalHandler] 群聊收到主叫方取消（callId 不匹配），执行挂断')
        const stateResult = this.stateMachine.receiveCancel()
        return stateResult.events
      }
      return []
    }

    // callId 匹配
    this.logger.signal?.('recv', 'cancelCall', {
      from: message.from,
      callId: ext.callId,
      type: 'group',
    })

    if (
      isFromCaller &&
      (currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING)
    ) {
      this.logger.info('[GroupCallSignalHandler] 群聊收到主叫方 cancelCall，执行远程挂断')
      const stateResult = this.stateMachine.receiveCancel()
      return stateResult.events
    }

    this.logger.debug('[GroupCallSignalHandler] 群聊 cancelCall 状态不符，忽略')
    return []
  }

  // ───────────────────────────────────────────────
  // leaveCall — 群聊成员离开
  // ───────────────────────────────────────────────

  private handleLeaveCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // 只处理群聊类型
    if (
      currentState.type !== CALL_TYPE.VIDEO_MULTI &&
      currentState.type !== CALL_TYPE.AUDIO_MULTI
    ) {
      return []
    }

    const currentStatus = currentState.status
    const isFromCaller = message.from === currentState.callerUserId
    const fromUserId = message.from as string

    // callId 不匹配时的容错
    if (ext.callId !== currentState.callId) {
      // 迟到的旧 callId leaveCall（离线补投）不得影响当前通话：
      // IN_CALL 时会误踢成员，ALERTING 时会误挂整场，统一只记日志忽略
      this.logger.warn('[GroupCallSignalHandler] leaveCall callId 不匹配，忽略（不触碰当前会话）', {
        extCallId: ext.callId,
        currentCallId: currentState.callId,
        from: fromUserId,
      })
      return []
    }

    // 被叫方在 ALERTING/INVITING 状态收到主叫方 leaveCall → 挂断整个通话
    if (
      (currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING) &&
      isFromCaller
    ) {
      this.logger.info(`[GroupCallSignalHandler] 被叫方收到主叫方(${fromUserId})离开，挂断通话`)
      const stateResult = this.stateMachine.receiveCancel()
      return stateResult.events
    }

    // 通话中状态：只移除离开的成员
    this.logger.signal?.('recv', 'leaveCall', {
      from: fromUserId,
      callId: ext.callId,
      type: 'group',
    })
    this.logger.info(`[GroupCallSignalHandler] 群聊成员离开: ${fromUserId}`)

    const groupSnapshot = this.session.getSnapshot()
    const groupId = groupSnapshot?.groupId

    this.session.setParticipantState(fromUserId, 'left')
    // 延迟移除（与原行为一致），timer 由 session 托管：remove 前校验 state、destroy 统一清理
    this.session.scheduleRemoveParticipant(fromUserId)

    return [
      {
        type: 'PARTICIPANT_LEFT',
        callId: currentState.callId,
        userId: fromUserId,
        channel: currentState.channel,
        callType: currentState.type,
        reason: 'left',
        groupId,
      },
    ]
  }
}
