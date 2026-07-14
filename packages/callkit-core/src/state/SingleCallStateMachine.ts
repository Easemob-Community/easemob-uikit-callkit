import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'
import type { Logger } from '../utils/logger'
import { getLogger } from '../utils/logger'

// ────────────────────────────────────────────────
// 状态与事件类型
// ────────────────────────────────────────────────

export interface SingleCallState {
  status: CALL_STATUS
  callId: string
  channel: string
  token: string
  type: CALL_TYPE
  callerDevId: string
  calleeDevId: string
  callerUserId: string
  calleeUserId: string
  inviteTimeout: number
  inviteTimeoutTimer: ReturnType<typeof setTimeout> | null
  startTime: number | null
  audioEnabled: boolean
  videoEnabled: boolean
}

export type DomainEvent =
  // ─── 单聊状态事件 ───
  | { type: 'STATUS_CHANGED'; from: CALL_STATUS; to: CALL_STATUS; callId: string }
  | { type: 'CALL_INVITED'; callId: string; isCaller: boolean; channel: string; callType: CALL_TYPE }
  | { type: 'CALL_STARTED'; callId: string; isCaller: boolean; channel: string; callType: CALL_TYPE }
  | { type: 'CALL_ACCEPTED'; callId: string; isCaller: boolean; channel: string; callType: CALL_TYPE }
  | { type: 'CALL_CONNECTED'; callId: string; channel: string; callType: CALL_TYPE }
  | { type: 'CALL_ENDED'; callId: string; reason: string; duration: number }
  | { type: 'CALL_TIMEOUT'; callId: string }
  | { type: 'CALL_REFUSED'; callId: string; isRemote: boolean }
  | { type: 'CALL_BUSY'; callId: string }
  | { type: 'CALL_CANCELED'; callId: string; isRemote: boolean }
  | {
      type: 'SHOULD_JOIN_RTC'
      callId: string
      channel: string
      token: string
      role: 'caller' | 'callee'
      callType: CALL_TYPE
    }
  // ─── 群聊事件 ───
  | {
      type: 'GROUP_CALL_INIT'
      callId: string
      groupId: string
      groupName: string
      channel: string
      callType: 'audio' | 'video'
      callerUserId: string
      invitedMembers: string[]
    }
  | {
      type: 'PARTICIPANT_STATE_CHANGED'
      callId: string
      userId: string
      state: 'invited' | 'accepted' | 'joinedRtc' | 'left'
      groupId?: string
    }
  | {
      type: 'PARTICIPANT_JOINED'
      callId: string
      userId: string
      channel: string
      callType: CALL_TYPE
      groupId?: string
    }
  | {
      type: 'PARTICIPANT_LEFT'
      callId: string
      userId: string
      channel: string
      callType: CALL_TYPE
      reason: string
      groupId?: string
    }
  // ─── 媒体状态事件 ───
  | { type: 'LOCAL_AUDIO_CHANGED'; callId: string; enabled: boolean }
  | { type: 'LOCAL_VIDEO_CHANGED'; callId: string; enabled: boolean }

export interface TransitionResult {
  ok: boolean
  events: DomainEvent[]
}

// ────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30000

function createIdleState(): SingleCallState {
  return {
    status: CALL_STATUS.IDLE,
    callId: '',
    channel: '',
    token: '',
    type: CALL_TYPE.AUDIO_1V1,
    callerDevId: '',
    calleeDevId: '',
    callerUserId: '',
    calleeUserId: '',
    inviteTimeout: DEFAULT_TIMEOUT,
    inviteTimeoutTimer: null,
    startTime: null,
    audioEnabled: true,
    videoEnabled: true,
  }
}

/**
 * 单聊通话状态机
 *
 * 职责：
 * 1. 管理 IDLE → INVITING → ALERTING → RECEIVED_CONFIRM_RING → IN_CALL 的状态流转
 * 2. 校验 callId、deviceId、多端冲突（由 Handler 调用前预校验，状态机二次兜底）
 * 3. 管理邀请超时定时器
 * 4. 计算通话时长
 *
 * 不执行任何副作用（不发消息、不 join RTC），只返回领域事件。
 *
 * 状态流转规则从现有 lib/store/callState.ts + lib/signaling/SingleCallSignalHandler.ts 提取。
 */
export class SingleCallStateMachine {
  private state: SingleCallState = createIdleState()
  private logger: Logger

  constructor(logger?: Logger) {
    this.logger = logger || getLogger()
  }

  // ─── 查询 ───

  getState(): Readonly<SingleCallState> {
    return Object.freeze({ ...this.state })
  }

  isIdle(): boolean {
    return this.state.status === CALL_STATUS.IDLE
  }

  isInCall(): boolean {
    return this.state.status === CALL_STATUS.IN_CALL
  }

  /**
   * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
   */
  isWaitingCalleeAction(): boolean {
    return (
      this.state.status === CALL_STATUS.ALERTING ||
      this.state.status === CALL_STATUS.CONFIRM_RING ||
      this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING
    )
  }

  /**
   * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
   */
  isInActiveCall(): boolean {
    return (
      this.state.status === CALL_STATUS.ANSWER_CALL ||
      this.state.status === CALL_STATUS.CONFIRM_CALLEE ||
      this.state.status === CALL_STATUS.IN_CALL
    )
  }

  /**
   * 当前是否可以接听（被叫端按钮可点击）
   */
  canAccept(): boolean {
    return (
      this.state.status === CALL_STATUS.ALERTING ||
      this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING
    )
  }

  /**
   * 当前是否可以拒绝（被叫端按钮可点击）
   */
  canReject(): boolean {
    return (
      this.state.status === CALL_STATUS.ALERTING ||
      this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING
    )
  }

  /**
   * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
   */
  canHangup(): boolean {
    return this.state.status !== CALL_STATUS.IDLE
  }

  /**
   * 当前是否处于呼叫/响铃中（主叫等待对方接听）
   */
  isCalling(): boolean {
    return (
      this.state.status === CALL_STATUS.INVITING ||
      this.state.status === CALL_STATUS.CONFIRM_RING
    )
  }

  isCallIdMatch(incomingCallId: string): boolean {
    return this.state.callId === incomingCallId
  }

  getDuration(): number {
    if (!this.state.startTime) return 0
    return Date.now() - this.state.startTime
  }

  // ─── 初始化 ───

  /**
   * 主叫方发起邀请
   */
  initInvite(params: {
    calleeUserId: string
    callType: CALL_TYPE
    callerDevId: string
    callerUserId: string
    callId: string
    channel: string
    token: string
    timeout?: number
  }): TransitionResult {
    this.clearTimeout()
    const oldStatus = this.state.status

    this.state = {
      ...createIdleState(),
      status: CALL_STATUS.INVITING,
      calleeUserId: params.calleeUserId,
      callerUserId: params.callerUserId,
      callerDevId: params.callerDevId,
      type: params.callType,
      callId: params.callId,
      channel: params.channel,
      token: params.token,
      inviteTimeout: params.timeout ?? DEFAULT_TIMEOUT,
    }

    // 超时定时器由 CallKitCore 层管理，不在状态机内启动
    this.logger.stateChange?.(oldStatus, CALL_STATUS.INVITING, { callId: params.callId })

    return {
      ok: true,
      events: [
        {
          type: 'STATUS_CHANGED',
          from: oldStatus,
          to: CALL_STATUS.INVITING,
          callId: params.callId,
        },
        {
          type: 'CALL_INVITED',
          callId: params.callId,
          isCaller: true,
          channel: params.channel,
          callType: params.callType,
        },
      ],
    }
  }

  /**
   * 被叫方收到 invite，初始化响铃状态
   */
  initIncoming(params: {
    callId: string
    channel: string
    token: string
    callType: CALL_TYPE
    callerDevId: string
    callerUserId: string
    calleeDevId: string
    calleeUserId: string
  }): TransitionResult {
    this.clearTimeout()
    const oldStatus = this.state.status

    this.state = {
      ...createIdleState(),
      status: CALL_STATUS.ALERTING,
      callId: params.callId,
      channel: params.channel,
      token: params.token,
      type: params.callType,
      callerDevId: params.callerDevId,
      callerUserId: params.callerUserId,
      calleeDevId: params.calleeDevId,
      calleeUserId: params.calleeUserId,
    }

    // 超时定时器由 CallKitCore 层管理，不在状态机内启动
    this.logger.stateChange?.(oldStatus, CALL_STATUS.ALERTING, { callId: params.callId })

    return {
      ok: true,
      events: [
        {
          type: 'STATUS_CHANGED',
          from: oldStatus,
          to: CALL_STATUS.ALERTING,
          callId: params.callId,
        },
        {
          type: 'CALL_INVITED',
          callId: params.callId,
          isCaller: false,
          channel: params.channel,
          callType: params.callType,
        },
      ],
    }
  }

  // ─── 信令响应 ───

  /**
   * 主叫方收到 alert（被叫已响铃）
   *
   * 与 lib 对齐：收到 alert 后保持 INVITING 状态不变（lib 的 handleAlertSignalMessage
   * 不修改 callState.status），只记录 calleeDevId 和发送 confirmRing。
   * 状态直到收到 confirmRing 后才变为 RECEIVED_CONFIRM_RING。
   */
  receiveAlert(calleeDevId: string): TransitionResult {
    if (this.state.status !== CALL_STATUS.INVITING) {
      this.logger.warn('[SingleCallStateMachine] receiveAlert: 当前状态不是 INVITING，忽略', {
        status: this.state.status,
      })
      return { ok: false, events: [] }
    }

    // 不改变状态，只记录被叫设备 ID（与 lib 对齐）
    this.state.calleeDevId = calleeDevId
    this.logger.info('[SingleCallStateMachine] receiveAlert: 保持 INVITING，记录 calleeDevId', {
      callId: this.state.callId,
      calleeDevId,
    })

    return { ok: true, events: [] }
  }

  /**
   * 被叫方收到 confirmRing
   */
  receiveConfirmRing(status: boolean): TransitionResult {
    if (this.state.status < CALL_STATUS.ALERTING) {
      this.logger.warn('[SingleCallStateMachine] receiveConfirmRing: 当前状态 < ALERTING，忽略')
      return { ok: false, events: [] }
    }
    if (this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING) {
      this.logger.info('[SingleCallStateMachine] receiveConfirmRing: 已是 RECEIVED_CONFIRM_RING，忽略')
      return { ok: false, events: [] }
    }
    if (!status) {
      this.logger.warn('[SingleCallStateMachine] receiveConfirmRing: status=false，忽略')
      return { ok: false, events: [] }
    }

    this.clearTimeout()
    const oldStatus = this.state.status
    this.state.status = CALL_STATUS.RECEIVED_CONFIRM_RING
    this.logger.stateChange?.(oldStatus, CALL_STATUS.RECEIVED_CONFIRM_RING, { callId: this.state.callId })

    return {
      ok: true,
      events: [
        {
          type: 'STATUS_CHANGED',
          from: oldStatus,
          to: CALL_STATUS.RECEIVED_CONFIRM_RING,
          callId: this.state.callId,
        },
      ],
    }
  }

  /**
   * 收到 answerCall 信令
   */
  receiveAnswer(result: 'accept' | 'refuse' | 'busy', fromCaller?: boolean): TransitionResult {
    this.clearTimeout()

    // 已在通话中，忽略（防止重复 accept）
    if (this.state.status === CALL_STATUS.IN_CALL) {
      this.logger.info('[SingleCallStateMachine] receiveAnswer: 已在 IN_CALL，忽略')
      return { ok: false, events: [] }
    }

    if (result === 'accept') {
      const oldStatus = this.state.status
      this.state.status = CALL_STATUS.IN_CALL
      this.state.startTime = Date.now()
      this.logger.stateChange?.(oldStatus, CALL_STATUS.IN_CALL, { callId: this.state.callId })

      const isCaller = !fromCaller // 如果是主叫收到 accept，则 isCaller=true
      const events: DomainEvent[] = [
        {
          type: 'STATUS_CHANGED',
          from: oldStatus,
          to: CALL_STATUS.IN_CALL,
          callId: this.state.callId,
        },
        {
          type: 'CALL_ACCEPTED',
          callId: this.state.callId,
          isCaller,
          channel: this.state.channel,
          callType: this.state.type,
        },
        {
          type: 'CALL_STARTED',
          callId: this.state.callId,
          isCaller,
          channel: this.state.channel,
          callType: this.state.type,
        },
        {
          type: 'SHOULD_JOIN_RTC',
          callId: this.state.callId,
          channel: this.state.channel,
          token: this.state.token,
          role: fromCaller ? 'callee' : 'caller',
          callType: this.state.type,
        },
      ]
      return { ok: true, events }
    }

    // refuse / busy
    const oldStatus = this.state.status
    const duration = 0
    const reason = result === 'busy' ? HANGUP_REASON.BUSY : HANGUP_REASON.REMOTE_REFUSE
    const callId = this.state.callId
    this.resetCore()
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IDLE, { callId, trigger: `answer:${result}` })

    const events: DomainEvent[] = [
      {
        type: 'CALL_ENDED',
        callId,
        reason,
        duration,
      },
    ]
    if (result === 'busy') {
      events.unshift({ type: 'CALL_BUSY', callId })
    } else {
      events.unshift({ type: 'CALL_REFUSED', callId, isRemote: true })
    }
    return { ok: true, events }
  }

  /**
   * 收到 cancelCall 信令
   * 
   * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
   */
  receiveCancel(): TransitionResult {
    const currentStatus = this.state.status
    const callId = this.state.callId

    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn('[SingleCallStateMachine] receiveCancel: 当前状态 IDLE，忽略')
      return { ok: false, events: [] }
    }

    this.clearTimeout()
    this.resetCore()
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: 'cancel' })

    return {
      ok: true,
      events: [
        { type: 'CALL_CANCELED', callId, isRemote: true },
        { type: 'CALL_ENDED', callId, reason: HANGUP_REASON.REMOTE_CANCEL, duration: 0 },
      ],
    }
  }

  /**
   * 收到 leaveCall 信令
   * 
   * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
   */
  receiveLeave(): TransitionResult {
    const currentStatus = this.state.status
    const callId = this.state.callId

    if (currentStatus === CALL_STATUS.IDLE) {
      return { ok: false, events: [] }
    }
    if (currentStatus === CALL_STATUS.IN_CALL) {
      const duration = this.getDuration()
      this.resetCore()
      this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: 'leave' })
      return {
        ok: true,
        events: [{ type: 'CALL_ENDED', callId, reason: HANGUP_REASON.HANGUP, duration }],
      }
    }
    // ALERTING/INVITING 状态下收到 leave → 也挂断（兼容 caller 在响铃阶段离开）
    this.resetCore()
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: 'leave:alerting' })
    return {
      ok: true,
      events: [{ type: 'CALL_ENDED', callId, reason: HANGUP_REASON.HANGUP, duration: 0 }],
    }
  }

  /**
   * 收到 confirmCallee 信令（被叫方）
   */
  receiveConfirmCallee(): TransitionResult {
    // IDLE 状态下收到 confirmCallee → 忽略（可能已主动拒绝/挂断）
    if (this.state.status === CALL_STATUS.IDLE) {
      this.logger.warn('[SingleCallStateMachine] receiveConfirmCallee: 当前 IDLE，忽略')
      return { ok: false, events: [] }
    }

    // 已在 IN_CALL 状态 → 不重复派发事件（防止群聊被叫二次 join）
    if (this.state.status === CALL_STATUS.IN_CALL) {
      this.logger.info('[SingleCallStateMachine] receiveConfirmCallee: 已是 IN_CALL，跳过')
      return { ok: false, events: [] }
    }

    // 保存旧状态后再修改（修复 #7：from 字段永远是 IN_CALL 的 bug）
    const oldStatus = this.state.status
    this.state.status = CALL_STATUS.IN_CALL
    this.state.startTime = Date.now()
    this.clearTimeout()
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IN_CALL, { callId: this.state.callId })

    const events: DomainEvent[] = [
      {
        type: 'STATUS_CHANGED',
        from: oldStatus,
        to: CALL_STATUS.IN_CALL,
        callId: this.state.callId,
      },
      {
        type: 'CALL_CONNECTED',
        callId: this.state.callId,
        channel: this.state.channel,
        callType: this.state.type,
      },
      {
        type: 'CALL_STARTED',
        callId: this.state.callId,
        isCaller: false,
        channel: this.state.channel,
        callType: this.state.type,
      },
      {
        type: 'SHOULD_JOIN_RTC',
        callId: this.state.callId,
        channel: this.state.channel,
        token: this.state.token,
        role: 'callee',
        callType: this.state.type,
      },
    ]
    return { ok: true, events }
  }

  // ─── 本地动作 ───

  /**
   * 本地挂断/取消
   */
  hangup(reason: string = HANGUP_REASON.HANGUP): TransitionResult {
    const currentStatus = this.state.status
    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn('[SingleCallStateMachine] hangup: 当前状态 IDLE，忽略')
      return { ok: false, events: [] }
    }

    const duration = currentStatus === CALL_STATUS.IN_CALL ? this.getDuration() : 0
    const callId = this.state.callId
    this.clearTimeout()
    this.resetCore()
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: 'hangup' })

    return {
      ok: true,
      events: [{ type: 'CALL_ENDED', callId, reason, duration }],
    }
  }

  /**
   * 邀请超时
   */
  timeout(): TransitionResult {
    const currentStatus = this.state.status
    if (currentStatus === CALL_STATUS.IDLE || currentStatus === CALL_STATUS.IN_CALL) {
      return { ok: false, events: [] }
    }

    const callId = this.state.callId
    this.resetCore()
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: 'timeout' })

    return {
      ok: true,
      events: [
        { type: 'CALL_TIMEOUT', callId },
        { type: 'CALL_ENDED', callId, reason: HANGUP_REASON.NO_RESPONSE, duration: 0 },
      ],
    }
  }

  /**
   * 强制重置状态机
   */
  reset(): void {
    this.clearTimeout()
    const oldStatus = this.state.status
    this.state = createIdleState()
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IDLE, { trigger: 'forceReset' })
  }

  // ─── 超时管理（由外部调用） ───

  /**
   * 启动超时定时器。
   * 超时后自动调用 onTimeout 回调（由 CallKitCore 注册），确保事件不会被丢弃。
   */
  startTimeout(onTimeout?: (result: TransitionResult) => void): void {
    this.clearTimeout()
    this.state.inviteTimeoutTimer = setTimeout(() => {
      const result = this.timeout()
      if (onTimeout && result.ok) {
        onTimeout(result)
      }
    }, this.state.inviteTimeout)
  }

  private clearTimeout(): void {
    if (this.state.inviteTimeoutTimer) {
      clearTimeout(this.state.inviteTimeoutTimer)
      this.state.inviteTimeoutTimer = null
    }
  }

  private resetCore(): void {
    this.state = createIdleState()
  }

  // ─── 媒体状态 ───

  /**
   * 切换本地音频状态
   */
  toggleAudio(): TransitionResult {
    this.state.audioEnabled = !this.state.audioEnabled
    return {
      ok: true,
      events: [
        {
          type: 'LOCAL_AUDIO_CHANGED',
          callId: this.state.callId,
          enabled: this.state.audioEnabled,
        },
      ],
    }
  }

  /**
   * 切换本地视频状态
   */
  toggleVideo(): TransitionResult {
    this.state.videoEnabled = !this.state.videoEnabled
    return {
      ok: true,
      events: [
        {
          type: 'LOCAL_VIDEO_CHANGED',
          callId: this.state.callId,
          enabled: this.state.videoEnabled,
        },
      ],
    }
  }
}
