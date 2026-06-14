import type { CmdMsgBody, SignalHandler } from './SignalRouter'
import type { SingleCallStateMachine } from '../state/SingleCallStateMachine'
import type { DomainEvent } from '../state/SingleCallStateMachine'
import type { SignalSender } from './SignalSender'
import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'

/**
 * SingleCallSignalHandler
 * 单聊域信令处理器
 *
 * 改造后：
 * - 不读写 Pinia Store → 注入 SingleCallStateMachine
 * - 不直接 join RTC → 通过 StateMachine 返回 SHOULD_JOIN_RTC 事件
 * - 不直接调用 CallService.hangup() → 返回 CALL_ENDED 事件
 * - 不直接 emit callKitEventBus → 返回 DomainEvent[]
 * - 保留直接发送响应信令（confirmRing / confirmCallee）→ 注入 SignalSender
 */
export class SingleCallSignalHandler implements SignalHandler {
  private stateMachine: SingleCallStateMachine
  private sender: SignalSender
  private getDeviceId: () => string
  private logger: Logger

  constructor(
    stateMachine: SingleCallStateMachine,
    sender: SignalSender,
    deviceIdProvider: (() => string) | string,
    logger?: Logger
  ) {
    this.stateMachine = stateMachine
    this.sender = sender
    // 兼容字符串入参（旧测试用例），运行时优先使用 provider 实时读取
    this.getDeviceId = typeof deviceIdProvider === 'function' ? deviceIdProvider : () => deviceIdProvider
    this.logger = logger || getLogger()
    this.logger.warn('📞 [SingleCallSignalHandler] 单聊信令处理器已初始化')
  }

  private get deviceId(): string {
    return this.getDeviceId()
  }

  handle(message: CmdMsgBody): DomainEvent[] {
    const action = message.ext?.action
    switch (action) {
      case 'alert':
        return this.handleAlert(message)
      case 'confirmRing':
        return this.handleConfirmRing(message)
      case 'answerCall':
        return this.handleAnswerCall(message)
      case 'cancelCall':
        return this.handleCancelCall(message)
      case 'leaveCall':
        return this.handleLeaveCall(message)
      case 'confirmCallee':
        return this.handleConfirmCallee(message)
      default:
        this.logger.warn(`[SingleCallSignalHandler] 未知 action: ${action}`)
        return []
    }
  }

  // ───────────────────────────────────────────────
  // alert — 主叫方收到被叫已响铃
  // ───────────────────────────────────────────────

  private handleAlert(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()
    const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI

    this.logger.signal?.('recv', 'alert', {
      from: message.from,
      callId: ext?.callId,
      callerDevId: ext?.callerDevId,
      isGroupCall,
    })

    // 多端校验：callerDevId 必须匹配当前设备
    if (ext.callerDevId !== this.deviceId) {
      this.logger.warn(
        `[SingleCallSignalHandler] 主叫多端: callerDevId(${ext.callerDevId}) ≠ 当前设备(${this.deviceId})`
      )
      return []
    }

    // 状态机流转（群聊也需要 alert → confirmRing 的流转）
    const stateResult = this.stateMachine.receiveAlert(ext.calleeDevId as string)

    // 群聊场景：主叫发 invite 后会立即进入 IN_CALL，导致状态机拒绝 alert 流转。
    // 但为了兼容 iOS/Android 被叫端，仍需回发 confirmRing，否则被叫会判定为"对方已取消"而不弹框。
    const shouldSendConfirmRing = stateResult.ok || isGroupCall

    if (shouldSendConfirmRing) {
      // 构建并发送 confirmRing 响应
      const confirmRingPayload = this.buildConfirmRingPayload(message)
      if (confirmRingPayload) {
        // 与旧版对齐：confirmRing 不设置 deliverOnlineOnly（默认 false）
        this.sender
          .sendCmdMessage(
            message.from as string,
            'singleChat',
            {
              action: 'confirmRing',
              callId: ext.callId as string,
              status: confirmRingPayload.status,
              callerDevId: ext.callerDevId as string,
              calleeDevId: ext.calleeDevId as string,
              ts: Date.now(),
              msgType: 'rtcCallWithAgora',
            } as any
          )
          .catch(() => {})
      }
    }

    if (!stateResult.ok) {
      return []
    }

    return stateResult.events
  }

  private buildConfirmRingPayload(message: CmdMsgBody): { status: boolean } | null {
    const ext = message.ext
    if (!ext) return null

    const currentState = this.stateMachine.getState()
    if (!currentState.callId) {
      this.logger.warn('[SingleCallSignalHandler] 当前无通话，无法构建 confirmRing')
      return null
    }

    let status = true
    if (ext.callId !== currentState.callId) {
      status = false
      this.logger.warn(
        `[SingleCallSignalHandler] callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )
    }

    if (
      currentState.status !== undefined &&
      currentState.status > CALL_STATUS.RECEIVED_CONFIRM_RING &&
      currentState.type !== CALL_TYPE.VIDEO_MULTI
    ) {
      status = false
      this.logger.warn(
        `[SingleCallSignalHandler] 状态已超前: ${currentState.status}，confirmRing status=false`
      )
    }

    return { status }
  }

  // ───────────────────────────────────────────────
  // confirmRing — 被叫方收到主叫确认响铃
  // ───────────────────────────────────────────────

  private handleConfirmRing(message: CmdMsgBody): DomainEvent[] {
    const { ext } = message
    if (!ext) return []

    const currentState = this.stateMachine.getState()
    const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI

    // 多端校验：callerDevId 必须匹配当前设备（confirmRing 是发给主叫的，但被叫也会收到... 等等）
    // 实际上 confirmRing 是主叫发给被叫的。被叫收到时，callerDevId 是主叫的设备ID。
    // 但被叫需要确认这个 confirmRing 是否对应自己当前处理的通话。
    // 原始代码中：ext.callerDevId !== this.chatClientStore.getClientDeviceId → 这是检查主叫设备ID是否与当前设备ID一致
    // 但为什么要一致？confirmRing 是主叫发给被叫的，callerDevId 是主叫的，被叫的设备ID是 calleeDevId。
    // 啊，原始代码这里的逻辑是：主叫有两个设备时，被叫可能收到来自不同主叫设备的 confirmRing。
    // 但被叫怎么知道主叫的 deviceId？从 invite 中获取。
    // 在 StateMachine 中，callerDevId 已经存储了。

    if (ext.callerDevId !== currentState.callerDevId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmRing 主叫设备不匹配: ext(${ext.callerDevId}) ≠ state(${currentState.callerDevId})`
      )
      return []
    }

    if (ext.calleeDevId !== this.deviceId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmRing 被叫设备不匹配: ext(${ext.calleeDevId}) ≠ current(${this.deviceId})`
      )
      return []
    }

    const stateResult = this.stateMachine.receiveConfirmRing(!!ext.status)
    return stateResult.events
  }

  // ───────────────────────────────────────────────
  // answerCall — 主叫方收到被叫应答
  // ───────────────────────────────────────────────

  private handleAnswerCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // callId 校验
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] answerCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )
      return []
    }

    // 已在通话中 → 忽略（单聊场景；群聊不忽略，需发送 confirmCallee）
    if (
      currentState.status === CALL_STATUS.IN_CALL &&
      currentState.type !== CALL_TYPE.VIDEO_MULTI &&
      currentState.type !== CALL_TYPE.AUDIO_MULTI
    ) {
      this.logger.debug('[SingleCallSignalHandler] 单聊已在 IN_CALL，忽略 answerCall')
      return []
    }

    // callerDevId 校验（多端）
    if (ext.callerDevId !== this.deviceId) {
      // 如果消息 from 是当前用户，说明被其他端处理了
      if (message.from === currentState.callerUserId) {
        const reason = ext.result === 'accept' ? '已被其他端接听' : '已被其他端拒绝'
        this.logger.warn(`[SingleCallSignalHandler] answerCall ${reason}`)
        return []
      }
      this.logger.warn(
        `[SingleCallSignalHandler] answerCall callerDevId 不匹配: ext(${ext.callerDevId}) ≠ current(${this.deviceId})`
      )
      return []
    }

    const allEvents: DomainEvent[] = []

    if (ext.result !== 'accept') {
      // ── 拒绝 / 忙线 分支 ──
      this.logger.signal?.('recv', 'answerCall', {
        from: message.from,
        result: ext.result,
        callId: ext.callId,
      })

      const stateResult = this.stateMachine.receiveAnswer(
        ext.result as 'refuse' | 'busy'
      )
      allEvents.push(...stateResult.events)

      // 发送 confirmCallee
      this.sendConfirmCallee(message.from as string, {
        callId: ext.callId as string,
        callerDevId: ext.callerDevId as string,
        calleeDevId: ext.calleeDevId as string,
        result: ext.result as string,
      })
    } else {
      // ── 接受 分支 ──
      this.logger.signal?.('recv', 'answerCall', {
        from: message.from,
        result: 'accept',
        callId: ext.callId,
      })

      // 发送 confirmCallee
      this.sendConfirmCallee(message.from as string, {
        callId: ext.callId as string,
        callerDevId: ext.callerDevId as string,
        calleeDevId: ext.calleeDevId as string,
        result: 'accept',
      })

      // 单聊：状态流转为 IN_CALL 并触发 SHOULD_JOIN_RTC
      // 群聊：仅发送 confirmCallee，不触发单聊状态流转（与旧版对齐）
      if (
        currentState.type !== CALL_TYPE.VIDEO_MULTI &&
        currentState.type !== CALL_TYPE.AUDIO_MULTI
      ) {
        this.logger.info('[SingleCallSignalHandler] 一对一通话接受，进入 IN_CALL')
        const stateResult = this.stateMachine.receiveAnswer('accept')
        allEvents.push(...stateResult.events)
      }
    }

    return allEvents
  }

  // ───────────────────────────────────────────────
  // cancelCall
  // ───────────────────────────────────────────────

  private handleCancelCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // callId 不匹配
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] cancelCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )

      if (currentState.status === CALL_STATUS.IDLE) {
        this.logger.info('[SingleCallSignalHandler] 当前 IDLE，忽略')
        return []
      }

      // 群聊分支已由 GroupCallSignalHandler 处理
      if (
        currentState.type === CALL_TYPE.VIDEO_MULTI ||
        currentState.type === CALL_TYPE.AUDIO_MULTI
      ) {
        this.logger.debug('[SingleCallSignalHandler] 群聊 cancelCall 由 GroupCallSignalHandler 处理')
        return []
      }

      // 单聊容错：ALERTING/INVITING 状态且来自主叫方 → 挂断
      const isFromCaller = message.from === currentState.callerUserId
      if (
        isFromCaller &&
        (currentState.status === CALL_STATUS.ALERTING ||
          currentState.status === CALL_STATUS.INVITING)
      ) {
        this.logger.info('[SingleCallSignalHandler] 单聊收到主叫方取消（callId 不匹配），执行挂断')
        const stateResult = this.stateMachine.receiveCancel()
        return stateResult.events
      }
      return []
    }

    // callId 匹配
    this.logger.signal?.('recv', 'cancelCall', {
      from: message.from,
      callId: ext.callId,
    })
    this.logger.info('[SingleCallSignalHandler] 收到对方取消')

    const stateResult = this.stateMachine.receiveCancel()
    return stateResult.events
  }

  // ───────────────────────────────────────────────
  // leaveCall
  // ───────────────────────────────────────────────

  private handleLeaveCall(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    const currentState = this.stateMachine.getState()

    // callId 不匹配
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] leaveCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )

      if (currentState.status === CALL_STATUS.IDLE) {
        return []
      }

      // 群聊分支
      if (
        currentState.type === CALL_TYPE.VIDEO_MULTI ||
        currentState.type === CALL_TYPE.AUDIO_MULTI
      ) {
        this.logger.debug('[SingleCallSignalHandler] 群聊 leaveCall 由 GroupCallSignalHandler 处理')
        return []
      }

      // 单聊容错
      if (currentState.status === CALL_STATUS.IN_CALL) {
        this.logger.info('[SingleCallSignalHandler] 通话中对方离开，执行挂断')
        const stateResult = this.stateMachine.receiveLeave()
        return stateResult.events
      } else if (
        currentState.status === CALL_STATUS.ALERTING &&
        message.from === currentState.callerUserId
      ) {
        this.logger.info('[SingleCallSignalHandler] ALERTING 状态收到主叫方离开，执行挂断')
        const stateResult = this.stateMachine.receiveLeave()
        return stateResult.events
      }
      return []
    }

    // callId 匹配
    this.logger.signal?.('recv', 'leaveCall', {
      from: message.from,
      callId: ext.callId,
    })

    // 群聊分支
    if (
      currentState.type === CALL_TYPE.VIDEO_MULTI ||
      currentState.type === CALL_TYPE.AUDIO_MULTI
    ) {
      this.logger.debug('[SingleCallSignalHandler] 群聊 leaveCall 由 GroupCallSignalHandler 处理')
      return []
    }

    if (currentState.status === CALL_STATUS.IDLE) {
      return []
    }

    // 与 lib 对齐：ALERTING/INVITING 状态下只有来自主叫方的 leaveCall 才挂断
    if (
      currentState.status === CALL_STATUS.ALERTING ||
      currentState.status === CALL_STATUS.INVITING
    ) {
      if (message.from !== currentState.callerUserId) {
        this.logger.warn('[SingleCallSignalHandler] leaveCall callId 匹配但发送者不是主叫方，忽略')
        return []
      }
    }

    const stateResult = this.stateMachine.receiveLeave()
    return stateResult.events
  }

  // ───────────────────────────────────────────────
  // confirmCallee — 被叫方收到主叫确认 callee 就绪
  // ───────────────────────────────────────────────

  private handleConfirmCallee(message: CmdMsgBody): DomainEvent[] {
    const ext = message.ext
    if (!ext) return []

    this.logger.signal?.('recv', 'confirmCallee', {
      from: message.from,
      callId: ext.callId,
      result: ext.result,
    })
    this.logger.info('[SingleCallSignalHandler] 收到 confirmCallee')

    const currentState = this.stateMachine.getState()

    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmCallee callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      )
      return []
    }

    // confirmCallee 的 result 字段语义：accept 才进入通话，refuse/busy 应忽略
    if (ext.result && ext.result !== 'accept') {
      this.logger.info(`[SingleCallSignalHandler] confirmCallee result=${ext.result}，忽略`)
      return []
    }

    const stateResult = this.stateMachine.receiveConfirmCallee()
    return stateResult.events
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
      .catch(() => {})
  }
}
