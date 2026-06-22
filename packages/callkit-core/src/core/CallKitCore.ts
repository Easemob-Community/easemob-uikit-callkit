import type {
  CallKitCoreConfig,
  InviteCallParams,
  AnswerCallParams,
  HangupParams,
  InviteGroupCallParams,
  RtcReport,
  EasemobConnection,
} from './CallKitCore.types'
import type { CallKitEvent } from '../events/CallKitEvents'
import { isUIEvent, isRtcEvent } from '../events/CallKitEvents'
import type { DomainEvent, SingleCallState } from '../state/SingleCallStateMachine'
import { getLogger } from '../utils/logger'
import type { Logger } from '../utils/logger'
import { EventBus } from '../events/EventBus'
import { SingleCallStateMachine } from '../state/SingleCallStateMachine'
import { GroupCallSession } from '../state/GroupCallSession'
import { SignalRouter } from '../signaling/SignalRouter'
import { SignalSender } from '../signaling/SignalSender'
import { SingleCallSignalHandler } from '../signaling/SingleCallSignalHandler'
import { GroupCallSignalHandler } from '../signaling/GroupCallSignalHandler'
import { IMListener } from '../im/IMListener'
import { MessageBuilder } from '../signaling/MessageBuilder'
import { generateRandomChannel, isMessageExpired, isCmdMessageExpired } from '../utils/callUtils'
import { CALL_STATUS, CALL_TYPE, HANGUP_REASON } from '../types/callstate.types'

/**
 * CallKitCore
 * 框架无关的通话信令核心。
 *
 * 职责：
 * 1. 管理单聊/群聊通话生命周期
 * 2. 通过事件回调通知上层所有决策点
 * 3. 不直接操作任何 RTC SDK，RTC 由上层通过适配器或事件自行处理
 */
export class CallKitCore {
  private config: CallKitCoreConfig
  private logger: Logger
  private singleCallState: SingleCallStateMachine
  private groupCallSession: GroupCallSession
  private signalRouter: SignalRouter
  private signalSender: SignalSender
  private singleCallHandler: SingleCallSignalHandler
  private groupCallHandler: GroupCallSignalHandler
  private imListener: IMListener
  private destroyed = false
  private inviteTimer: ReturnType<typeof setTimeout> | null = null

  // 群聊被叫方在 fetchRtcToken 期间可能收到主叫的取消/离开信令，
  // 但此时 singleCallState 仍为 IDLE，SignalRouter 会忽略这些信令。
  // 用 Map 记录“待处理的 incoming invite”，在 token 返回后检查是否已被 abort。
  private pendingIncomingInvites = new Map<string, { aborted: boolean }>()

  // RTC token 元数据（来自 IM 服务端 getRTCToken）
  // 注意：Agora 加入频道时使用的 uid 必须是服务端返回的 RTCUId（数值型），而不是 IM 的字符串 userId
  private rtcAppId: string = ''
  private rtcUid: number = 0

  // 当前用户信息（实时读取：因 Provider 在登录前就 init，必须每次发送时从 imClient 取最新值，与旧版 lib/services/ChatService.ts 行为对齐）
  private inviteTimeoutMs: number

  // 通话时长计时器
  private durationTimer: ReturnType<typeof setInterval> | null = null
  private durationStartTime: number = 0
  private durationCallInfo: { callId: string; channel: string; callType: CALL_TYPE; callerUserId: string } | null = null

  private get userId(): string {
    return this.config.imClient.context?.userId || (this.config.imClient as any).user || ''
  }

  private get deviceId(): string {
    return this.config.imClient.context?.jid?.clientResource || ''
  }

  // 事件总线（供上层精细订阅）
  private eventBus: EventBus<{ callKitEvent: CallKitEvent }>

  constructor(config: CallKitCoreConfig) {
    this.config = config
    this.logger = config.logger || getLogger()
    this.eventBus = new EventBus<{ callKitEvent: CallKitEvent }>(this.logger)

    // userId / deviceId 通过 getter 实时读取，避免登录前快照导致 ext 字段为空
    this.inviteTimeoutMs = config.inviteTimeout || 30000

    // 初始化状态层
    this.singleCallState = new SingleCallStateMachine(this.logger)
    this.groupCallSession = new GroupCallSession(this.logger)

    // 初始化信令层
    this.signalRouter = new SignalRouter(this.logger)
    this.signalSender = new SignalSender(config.imClient, this.logger, config.createMessage)

    // 初始化 Handler（传入 provider 函数，确保每次校验/读取时都拿最新登录态）
    this.singleCallHandler = new SingleCallSignalHandler(
      this.singleCallState,
      this.signalSender,
      () => this.deviceId,
      this.logger
    )
    this.groupCallHandler = new GroupCallSignalHandler(
      this.groupCallSession,
      this.singleCallState,
      this.signalSender,
      () => this.userId,
      this.logger
    )

    // 注册到 Router
    this.signalRouter.register('alert', this.singleCallHandler)
    this.signalRouter.register('confirmRing', this.singleCallHandler)
    this.signalRouter.register('answerCall', this.singleCallHandler)
    this.signalRouter.register('cancelCall', this.singleCallHandler)
    this.signalRouter.register('leaveCall', this.singleCallHandler)
    this.signalRouter.register('confirmCallee', this.singleCallHandler)

    this.signalRouter.register('answerCall', this.groupCallHandler)
    this.signalRouter.register('cancelCall', this.groupCallHandler)
    this.signalRouter.register('leaveCall', this.groupCallHandler)

    // 初始化 IM 监听
    this.imListener = new IMListener(
      config.imClient,
      {
        onTextMessage: (msg) => this.handleTextMessage(msg),
        onCmdMessage: (msg) => this.handleCmdMessage(msg),
        onConnected: () => this.handleIMConnected(),
        onDisconnected: () => this.handleIMDisconnected(),
      },
      this.logger
    )
    this.imListener.mount()

    this.logger.info('[CallKitCore] 初始化完成（userId/deviceId 将在登录后实时读取）')
    this.logger.warn('🚀 ========== CallKitCore 链路已激活 ========== 🚀')
    this.logger.warn('   版本: callkit-core | 当前用户:', this.userId || '(尚未登录)', '| 设备:', this.deviceId || '(尚未登录)')
  }

  /**
   * 更新底层 IM 客户端实例（用于账号切换等场景）。
   * 会同步更新 SignalSender、IMListener 以及内部 config，不丢失当前通话状态。
   */
  updateImClient(imClient: EasemobConnection): void {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')
    if (!imClient) throw new Error('updateImClient 需要有效的 IM 客户端实例')

    this.config.imClient = imClient
    this.signalSender.updateImClient(imClient)
    this.imListener.updateImClient(imClient)

    this.logger.info('[CallKitCore] IM 客户端实例已更新')
    this.logger.warn('🚀 ========== CallKitCore 链路已更新 ========== 🚀')
    this.logger.warn('   版本: callkit-core | 当前用户:', this.userId || '(尚未登录)', '| 设备:', this.deviceId || '(尚未登录)')
  }

  // ───────────────────────────────────────────────
  // 单聊 API
  // ───────────────────────────────────────────────

  /**
   * 发起单聊通话
   */
  async inviteCall(params: InviteCallParams): Promise<void> {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')

    const callId = generateRandomChannel(16)
    const channel = generateRandomChannel(12)

    // 获取 RTC token（兼容真实 SDK 返回 { data: { RTCToken, appId, RTCUId } } 与精简 mock）
    const token = await this.fetchRtcToken(channel)

    // 状态机流转
    const stateResult = this.singleCallState.initInvite({
      calleeUserId: params.calleeUserId,
      callType: params.callType,
      callerDevId: this.deviceId,
      callerUserId: this.userId,
      callId,
      channel,
      token,
      timeout: this.inviteTimeoutMs,
    })

    // 启动超时定时器（Critical #1：超时事件由 CallKitCore 消费）
    this.startInviteTimeout()

    // 发送 invite 文本消息
    // 优先使用本次邀请传入的 callerInfo，回退到初始化时的 userProfile
    const callerInfo = {
      ...this.config.userProfile,
      ...params.callerInfo,
    }
    const ext = MessageBuilder.buildInviteExt({
      callId,
      callerUserId: this.userId,
      calleeUserId: params.calleeUserId,
      callerDevId: this.deviceId,
      channel,
      callType: params.callType,
      callerInfo,
    })

    await this.signalSender.sendInviteMessage(
      params.calleeUserId,
      'singleChat',
      '[通话邀请]',
      ext
    )

    // 处理并发出事件
    this.processEvents(stateResult.events, this.singleCallState.getState())
  }

  /**
   * 响应来电（接受/拒绝）
   */
  async answerCall(params: AnswerCallParams): Promise<void> {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')

    const state = this.singleCallState.getState()

    // 兼容旧版 accept: boolean 参数
    const result = params.result ?? (params.accept ? 'accept' : 'refuse')
    const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI

    // 构建并发送 answerCall 信令（群聊也是点对点发给主叫方）
    const ext = MessageBuilder.buildCmdExt({
      action: 'answerCall',
      callId: state.callId,
      callerDevId: state.callerDevId,
      calleeDevId: this.deviceId,
      result,
    })

    await this.signalSender.sendCmdMessage(
      state.callerUserId,
      'singleChat',
      ext,
      { deliverOnlineOnly: true }
    )

    if (result === 'accept') {
      if (isGroupCall) {
        // 群聊：被叫接受后不直接进入 IN_CALL，等待主叫方发送 confirmCallee
        // （修复 Critical #4：避免二次 SHOULD_JOIN_RTC）
        this.logger.info('[CallKitCore] 群聊接受，等待 confirmCallee 后再进入 IN_CALL')
        this.clearInviteTimeout()
      } else {
        // 单聊：保持 ALERTING，等待 confirmCallee 后再进入 IN_CALL
        this.logger.info('[CallKitCore] 单聊接受，等待 confirmCallee')
      }
    } else {
      // ── 拒绝/忙线分支 ──
      // 清理本地状态
      const hangupReason = result === 'busy' ? HANGUP_REASON.BUSY : HANGUP_REASON.REFUSE
      const hangupResult = this.singleCallState.hangup(hangupReason)
      this.processEvents(hangupResult.events, state)
    }
  }

  /**
   * 挂断/取消通话
   */
  async hangup(params?: HangupParams): Promise<void> {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')

    const state = this.singleCallState.getState()
    const currentStatus = state.status

    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn('[CallKitCore] hangup: 当前 IDLE，忽略')
      return
    }

    // 根据状态决定发送 cancelCall 还是 leaveCall
    const isGroupCall =
      state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI

    if (currentStatus === CALL_STATUS.INVITING || currentStatus === CALL_STATUS.ALERTING) {
      this.clearInviteTimeout()
      // 发送 cancelCall
      const ext = MessageBuilder.buildCmdExt({
        action: 'cancelCall',
        callId: state.callId,
        callerDevId: state.callerDevId,
      })

      if (isGroupCall) {
        // 群聊：发送到群 groupId，携带 receiverList 定向给被邀请成员（与旧版 CallService 对齐）
        const groupSnapshot = this.groupCallSession.getSnapshot()
        const groupId = groupSnapshot?.groupId || state.calleeUserId
        const allParticipants = this.groupCallSession.getAllParticipants()
        const receiverList = allParticipants
          .filter((p) => p.userId !== this.userId && p.state === 'invited')
          .map((p) => p.userId)
        this.logger.warn(
          '[CallKitCore] 群聊取消: participants=',
          allParticipants.map((p) => ({ userId: p.userId, state: p.state })),
          '| receiverList=',
          receiverList
        )
        if (groupId && receiverList.length > 0) {
          this.logger.warn('[CallKitCore] 群聊取消: 发送 cancelCall 到', groupId, 'receiverList:', receiverList)
          await this.signalSender
            .sendCmdMessage(groupId, 'groupChat', ext, { receiverList })
            .catch((err) => {
              this.logger.error('[CallKitCore] 群聊取消: 发送 cancelCall 失败', err)
            })
        } else {
          this.logger.warn('[CallKitCore] 群聊取消: 无接收者，跳过发送 cancelCall')
        }
      } else {
        // 单聊
        const targetId = state.callerUserId === this.userId ? state.calleeUserId : state.callerUserId
        await this.signalSender.sendCmdMessage(targetId, 'singleChat', ext).catch(() => {})
      }
    } else if (currentStatus === CALL_STATUS.IN_CALL) {
      this.clearInviteTimeout()
      // 发送 leaveCall
      const ext = MessageBuilder.buildCmdExt({
        action: 'leaveCall',
        callId: state.callId,
      })

      if (isGroupCall) {
        // 群聊：发送到群 groupId，携带 receiverList 定向给通话中成员（与旧版 CallService 对齐）
        const groupSnapshot = this.groupCallSession.getSnapshot()
        const groupId = groupSnapshot?.groupId || state.calleeUserId
        const receiverList = this.groupCallSession
          .getAllParticipants()
          .filter((p) => p.userId !== this.userId && p.state !== 'left')
          .map((p) => p.userId)
        if (groupId && receiverList.length > 0) {
          await this.signalSender
            .sendCmdMessage(groupId, 'groupChat', ext, { receiverList })
            .catch(() => {})
        }
      } else {
        // 单聊
        const targetId = state.callerUserId === this.userId ? state.calleeUserId : state.callerUserId
        await this.signalSender.sendCmdMessage(targetId, 'singleChat', ext).catch(() => {})
      }
    }

    const reason = params?.reason === 'cancel'
      ? HANGUP_REASON.CANCEL
      : params?.reason === 'timeout'
      ? HANGUP_REASON.NO_RESPONSE
      : HANGUP_REASON.HANGUP

    const hangupResult = this.singleCallState.hangup(reason)
    this.clearInviteTimeout()
    this.processEvents(hangupResult.events, state)
  }

  // ───────────────────────────────────────────────
  // 群聊 API
  // ───────────────────────────────────────────────

  /**
   * 通话中邀请更多成员加入群聊通话
   */
  async inviteMoreParticipants(participantIds: string[]): Promise<void> {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')

    const state = this.singleCallState.getState()
    if (state.status !== CALL_STATUS.IN_CALL && state.status !== CALL_STATUS.INVITING) {
      this.logger.warn('[CallKitCore] inviteMoreParticipants: 当前不在通话中，忽略')
      return
    }

    const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI
    if (!isGroupCall) {
      this.logger.warn('[CallKitCore] inviteMoreParticipants: 当前不是群聊通话，忽略')
      return
    }

    const groupSnapshot = this.groupCallSession.getSnapshot()
    const groupId = groupSnapshot?.groupId
    if (!groupId) {
      this.logger.warn('[CallKitCore] inviteMoreParticipants: 群聊会话未初始化')
      return
    }

    // 构建 invite 文本消息
    // 追加邀请时复用当前会话的群名称，避免退化成 groupId
    const ext = MessageBuilder.buildInviteExt({
      callId: state.callId,
      callerUserId: this.userId,
      calleeUserId: groupId,
      callerDevId: this.deviceId,
      channel: state.channel,
      callType: state.type,
      invitedMembers: participantIds,
      groupInfo: { groupId, groupName: groupSnapshot?.groupName || groupId },
      callerInfo: this.config.userProfile,
    })

    // 先发送邀请消息，成功后再添加参与者到会话
    try {
      await this.signalSender.sendInviteMessage(
        participantIds,
        'groupChat',
        '[群通话邀请]',
        ext,
        groupId
      )
    } catch (err) {
      this.emitError('inviteMoreParticipantsFailed', err, { callId: state.callId, participantIds })
      this.logger.error('[CallKitCore] 发送追加邀请失败', err)
      throw err
    }

    // 发送成功后再添加参与者到会话
    participantIds.forEach((userId: string) => {
      if (!this.groupCallSession.getParticipant(userId)) {
        this.groupCallSession.addParticipant({
          userId,
          nickname: userId,
          avatarUrl: '',
          state: 'invited',
          isLocal: false,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false,
        })
      }
    })

    this.logger.info('[CallKitCore] 已发送追加邀请', { groupId, participantIds })
  }

  /**
   * 发起群聊通话
   */
  async inviteGroupCall(params: InviteGroupCallParams): Promise<void> {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')

    const callId = generateRandomChannel(16)
    const channel = generateRandomChannel(12)
    const callTypeStr = params.callType === CALL_TYPE.VIDEO_MULTI ? 'video' : 'audio'

    // 获取 RTC token（兼容真实 SDK 返回 { data: { RTCToken, appId, RTCUId } } 与精简 mock）
    const token = await this.fetchRtcToken(channel)

    // 优先使用传入的群名称，回退到 groupId
    const groupName = params.ext?.groupName || params.groupId
    const groupAvatar = params.ext?.groupAvatar

    // 初始化群聊会话
    this.groupCallSession.init({
      sessionId: channel,
      groupId: params.groupId,
      groupName,
      callType: callTypeStr,
      callerUserId: this.userId,
    })

    // 添加主叫方自己
    this.groupCallSession.addParticipant({
      userId: this.userId,
      nickname: this.userId,
      avatarUrl: '',
      state: 'joinedRtc',
      isLocal: true,
      isMuted: false,
      isCameraOn: callTypeStr === 'video',
      isSpeaking: false,
    })

    // 添加被邀请成员
    params.participantIds.forEach((userId: string) => {
      this.groupCallSession.addParticipant({
        userId,
        nickname: userId,
        avatarUrl: '',
        state: 'invited',
        isLocal: false,
        isMuted: false,
        isCameraOn: false,
        isSpeaking: false,
      })
    })

    // 发出 GROUP_CALL_INIT 事件（主叫方也需要此事件来驱动 UI 显示）
    this.processEvents(
      [
        {
          type: 'GROUP_CALL_INIT',
          callId,
          groupId: params.groupId,
          groupName,
          channel,
          callType: callTypeStr,
          callerUserId: this.userId,
          invitedMembers: params.participantIds,
        },
      ],
      this.singleCallState.getState()
    )

    // 初始化单聊状态机（群聊也用它存储 callId/channel/token）
    // 群聊时 calleeUserId 使用 groupId，与旧版 lib/ 保持一致
    const stateResult = this.singleCallState.initInvite({
      calleeUserId: params.groupId,
      callType: params.callType,
      callerDevId: this.deviceId,
      callerUserId: this.userId,
      callId,
      channel,
      token,
      timeout: this.inviteTimeoutMs,
    })

    // 发送 invite 文本消息（groupChat）
    // calleeUserId 在群聊时使用 groupId，与旧版 lib/ 的 callStateStore.calleeUserId = groupId 对齐
    // 优先使用本次邀请传入的 callerInfo，回退到初始化时的 userProfile
    const callerInfo = {
      ...this.config.userProfile,
      ...params.callerInfo,
    }
    const ext = MessageBuilder.buildInviteExt({
      callId,
      callerUserId: this.userId,
      calleeUserId: params.groupId,
      callerDevId: this.deviceId,
      channel,
      callType: params.callType,
      invitedMembers: params.participantIds,
      groupInfo: { groupId: params.groupId, groupName, groupAvatar },
      callerInfo,
    })

    // 使用用户传入的 message 作为 txt 消息内容，与 v1.0.6 ChatService 行为对齐
    const inviteMessage = params.ext?.message || '[群通话邀请]'

    await this.signalSender.sendInviteMessage(
      params.participantIds,
      'groupChat',
      inviteMessage,
      ext,
      params.groupId
    )

    this.processEvents(stateResult.events, this.singleCallState.getState())

    // 群聊主叫方：发送 invite 后立即进入 IN_CALL 并加入 RTC（与旧版行为对齐）
    this.logger.info('[CallKitCore] 群聊主叫方：进入 IN_CALL 并触发 RTC 加入')
    // fromCaller=false 表示“主叫方收到 accept”，使 isCaller=true / role='caller'
    const answerResult = this.singleCallState.receiveAnswer('accept', false)
    if (answerResult.ok) {
      this.processEvents(answerResult.events, this.singleCallState.getState())
    }
  }

  // ───────────────────────────────────────────────
  // 媒体控制
  // ───────────────────────────────────────────────

  /**
   * 切换本地音频（静音/取消静音）
   */
  toggleAudio(): void {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')
    const stateResult = this.singleCallState.toggleAudio()
    this.processEvents(stateResult.events, this.singleCallState.getState())
  }

  /**
   * 切换本地视频（开启/关闭摄像头）
   */
  toggleVideo(): void {
    if (this.destroyed) throw new Error('CallKitCore 已销毁')
    const stateResult = this.singleCallState.toggleVideo()
    this.processEvents(stateResult.events, this.singleCallState.getState())
  }

  // ───────────────────────────────────────────────
  // RTC 反馈
  // ───────────────────────────────────────────────

  /**
   * 获取 RTC token（并缓存 appId / RTCUId）
   * - 环信真实 SDK：`{ data: { RTCToken, appId, RTCUId, expireIn } }`
   * - 早期 / 精简 mock：`{ accessToken, appId }`
   * 为了与旧版 lib/composables/useJoinChannel.ts 行为对齐，同步保存 rtcAppId、rtcUid供
   * shouldJoinRtc 事件透传给上层 RtcAdapter（Agora 的 join 必须使用服务端返回的数值型 uid）。
   */
  private async fetchRtcToken(channel: string): Promise<string> {
    try {
      const tokenRes: any = await this.config.imClient.getRTCToken(channel)
      const data: any = tokenRes?.data ?? tokenRes ?? {}
      const token: string = data.RTCToken ?? data.accessToken ?? tokenRes?.accessToken ?? ''
      const appId: string = data.appId ?? tokenRes?.appId ?? ''
      const rtcUid: number = Number(data.RTCUId ?? data.rtcUid ?? 0) || 0

      if (appId) this.rtcAppId = appId
      if (rtcUid) this.rtcUid = rtcUid

      if (!token) {
        this.logger.warn('[CallKitCore] getRTCToken 返回 token 为空', { tokenRes })
      } else {
        this.logger.info('[CallKitCore] 获取 RTC token 成功', {
          channel,
          appId: this.rtcAppId,
          rtcUid: this.rtcUid,
          hasToken: !!token,
        })
      }
      return token
    } catch (err) {
      this.emitError('rtcTokenFetchFailed', err, { channel })
      this.logger.warn('[CallKitCore] 获取 RTC token 失败，使用空 token', err)
      return ''
    }
  }

  /**
   * 上层调用 RTC SDK 后，通过此方法反馈 RTC 事件给核心库
   */
  reportRtcEvent(report: RtcReport): void {
    this.logger.info('[CallKitCore] reportRtcEvent', report)

    const { type, payload } = report

    // 群聊参与者 RTC 状态同步
    if (payload.userId) {
      switch (type) {
        case 'userJoined':
        case 'userPublished':
          this.groupCallSession.markJoinedRtc(payload.userId)
          break
        case 'userLeft':
        case 'userUnpublished':
          this.groupCallSession.markLeftRtc(payload.userId)
          break
        case 'userAudioMuted':
          this.groupCallSession.markAudioMuted(payload.userId, true)
          break
        case 'userAudioUnmuted':
          this.groupCallSession.markAudioMuted(payload.userId, false)
          break
        case 'userVideoMuted':
          this.groupCallSession.markVideoOn(payload.userId, false)
          break
        case 'userVideoUnmuted':
          this.groupCallSession.markVideoOn(payload.userId, true)
          break
      }
    }

    // 网络质量/说话状态/错误等事件直接透传给上层
    if (
      type === 'networkQuality' ||
      type === 'speaking' ||
      type === 'stoppedSpeaking' ||
      type === 'error'
    ) {
      const rtcEvent: CallKitEvent = {
        type: 'rtcReport',
        payload: { type: report.type, payload: report.payload },
      }
      this.emitEvent(rtcEvent)
    }
  }

  // ───────────────────────────────────────────────
  // 状态查询
  // ───────────────────────────────────────────────

  getSingleCallState() {
    return this.singleCallState.getState()
  }

  getGroupCallSession() {
    return this.groupCallSession.getSnapshot()
  }

  /**
   * 获取群聊通话的所有参与者（包含状态信息）
   */
  getGroupCallParticipants() {
    return this.groupCallSession.getAllParticipants()
  }

  /**
   * 当前是否在通话中（IN_CALL 状态）
   */
  isInCall(): boolean {
    return this.singleCallState.isInCall()
  }

  /**
   * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
   */
  isWaitingCalleeAction(): boolean {
    return this.singleCallState.isWaitingCalleeAction()
  }

  /**
   * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
   */
  isInActiveCall(): boolean {
    return this.singleCallState.isInActiveCall()
  }

  /**
   * 当前是否可以接听（被叫端按钮可点击）
   */
  canAccept(): boolean {
    return this.singleCallState.canAccept()
  }

  /**
   * 当前是否可以拒绝（被叫端按钮可点击）
   */
  canReject(): boolean {
    return this.singleCallState.canReject()
  }

  /**
   * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
   */
  canHangup(): boolean {
    return this.singleCallState.canHangup()
  }

  /**
   * 当前是否在呼叫/响铃中（INVITING 或 ALERTING 状态）
   */
  isCalling(): boolean {
    return this.singleCallState.isCalling()
  }

  /**
   * 获取当前通话类型，无通话时返回 null
   */
  getCurrentCallType(): CALL_TYPE | null {
    const state = this.singleCallState.getState()
    return state.status === CALL_STATUS.IDLE ? null : state.type
  }

  /**
   * 获取当前通话 ID，无通话时返回空字符串
   */
  getCurrentCallId(): string {
    return this.singleCallState.getState().callId || ''
  }

  /**
   * 当前是否空闲
   */
  isIdle(): boolean {
    return this.singleCallState.isIdle()
  }

  // ───────────────────────────────────────────────
  // 事件订阅（供上层精细控制）
  // ───────────────────────────────────────────────

  /**
   * 订阅通话事件
   * @returns 取消订阅函数
   */
  onEvent(handler: (event: CallKitEvent) => void): () => void {
    return this.eventBus.on('callKitEvent', handler)
  }

  /**
   * 订阅单次通话事件
   */
  onceEvent(handler: (event: CallKitEvent) => void): () => void {
    return this.eventBus.once('callKitEvent', handler)
  }

  // ───────────────────────────────────────────────
  // 生命周期
  // ───────────────────────────────────────────────

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true

    this.clearInviteTimeout()
    this.stopDurationTimer()
    this.imListener.unmount()
    this.eventBus.clear()
    this.singleCallState.reset()
    this.groupCallSession.destroy()

    this.logger.info('[CallKitCore] 已销毁')
  }

  // ───────────────────────────────────────────────
  // 内部：消息处理
  // ───────────────────────────────────────────────

  private isSelfMessage(msg: any): boolean {
    return msg.from === this.userId
  }

  private async handleTextMessage(msg: any): Promise<void> {
    // 无条件日志：所有文本消息都记录，方便排查消息是否到达 core
    const rawExt = msg.ext as any
    const bodyExt = msg.body?.ext as any
    const ext = rawExt || bodyExt
    this.logger.warn('✉️ [CallKitCore] handleTextMessage 被调用', {
      from: msg.from,
      to: msg.to,
      msgType: msg.type,
      chatType: msg.chatType,
      hasRawExt: !!rawExt,
      hasBodyExt: !!bodyExt,
      extAction: ext?.action,
      extCallId: ext?.callId,
      self: this.isSelfMessage(msg),
    })

    if (this.isSelfMessage(msg)) {
      this.logger.warn('[CallKitCore] ❌ 忽略自己发送的文本消息')
      return
    }

    if (!ext || ext.action !== 'invite') {
      this.logger.warn('[CallKitCore] ❌ 忽略非 invite 文本消息 | ext.action=', ext?.action)
      return
    }

    const isGroupCall =
      ext.chatType === CALL_TYPE.VIDEO_MULTI ||
      ext.chatType === CALL_TYPE.AUDIO_MULTI ||
      ext.callkitGroupInfo?.groupId

    // ========= Critical #2: 忙线自动拒绝 =========
    const currentStatus = this.singleCallState.getState().status
    if (currentStatus > CALL_STATUS.IDLE) {
      this.logger.warn('[CallKitCore] ❌ 当前已在通话中，发送忙线拒绝 | currentStatus=', currentStatus)
      const busyExt = MessageBuilder.buildCmdExt({
        action: 'answerCall',
        callId: ext.callId as string,
        callerDevId: ext.callerDevId as string,
        calleeDevId: this.deviceId,
        result: 'busy',
      })
      this.signalSender
        .sendCmdMessage(msg.from as string, 'singleChat', busyExt as any, {
          deliverOnlineOnly: true,
        })
        .catch(() => {})
      return
    }

    // ========= Critical #3: 接收者校验 =========
    if (!isGroupCall) {
      // 单聊：检查消息是否发给当前用户
      if (msg.to && msg.to !== this.userId) {
        this.logger.warn('[CallKitCore] ❌ 单聊 invite 接收者不是当前用户 | msg.to=', msg.to)
        return
      }
      // 单聊：设备 ID 校验
      if (ext.calleeDevId && ext.calleeDevId !== this.deviceId) {
        this.logger.warn('[CallKitCore] ❌ 单聊 invite calleeDevId 不匹配 | ext=', ext.calleeDevId, '| my=', this.deviceId)
        return
      }
    } else {
      // 群聊：检查当前用户是否在被邀请列表中
      const invitedMembers: string[] = ext.invitedMembers || []
      if (invitedMembers.length > 0 && !invitedMembers.includes(this.userId)) {
        this.logger.warn('[CallKitCore] ❌ 群聊 invite 当前用户不在被邀请列表中')
        return
      }
    }

    // ========= Critical #3: 过期检查 =========
    const msgTime = msg.time || ext.ts
    if (msgTime && isMessageExpired(msgTime, this.inviteTimeoutMs + 10000)) {
      this.logger.warn('[CallKitCore] ❌ invite 消息已过期 | msgTime=', msgTime)
      return
    }

    this.logger.warn(
      isGroupCall
        ? '✉️ [CallKitCore] ✅ 【群聊】确认收到 invite 文本消息 → 进入群聊处理分支'
        : '✉️ [CallKitCore] ✅ 【单聊】确认收到 invite 文本消息 → 进入单聊处理分支',
      { from: msg.from, callId: ext.callId, channel: ext.channelName, type: ext.type }
    )

    if (isGroupCall) {
      // 群聊 invite：异步获取 token 并初始化
      await this.handleGroupCallInvite(msg, ext).catch((err) => {
        this.emitError('groupCallInviteHandlingFailed', err, { messageId: msg.id })
        this.logger.error('[CallKitCore] 群聊 invite 处理失败', err)
      })
    } else {
      // 单聊 invite
      await this.handleSingleCallInvite(msg, ext)
    }
  }

  private async handleGroupCallInvite(msg: any, ext: any): Promise<void> {
    // 群聊 invite：同时初始化 singleCallState（被叫方需要它来处理 confirmCallee / cancelCall / leaveCall）
    const callId = ext.callId as string
    const channel = ext.channelName as string
    const callType = ext.type as CALL_TYPE
    const callerDevId = ext.callerDevId as string
    const callerUserId = (ext.callerIMName as string) || (msg.from as string) || ''

    // 记录待处理 invite，用于在 fetchRtcToken 异步期间接收到取消/离开信令时能够 abort
    this.pendingIncomingInvites.set(callId, { aborted: false })

    // 获取 RTC token（群聊被叫方同样需要 token 加入 Agora 频道）
    const token = await this.fetchRtcToken(channel)

    // 检查是否在 fetch token 期间被主叫取消或离开
    const pending = this.pendingIncomingInvites.get(callId)
    this.pendingIncomingInvites.delete(callId)
    if (pending?.aborted) {
      this.logger.warn('[CallKitCore] 群聊 invite 在获取 token 期间已被取消/离开，跳过初始化')
      return
    }

    if (this.singleCallState.getState().status === CALL_STATUS.IDLE) {
      this.logger.warn('🔄 [CallKitCore] 群聊被叫方：singleCallState 从 IDLE → ALERTING')
      const groupId = ext?.callkitGroupInfo?.groupId || ext?.groupId || ''
      const stateResult = this.singleCallState.initIncoming({
        callId,
        channel,
        token,
        callType,
        callerDevId,
        callerUserId,
        calleeDevId: this.deviceId,
        calleeUserId: groupId, // 群聊时 calleeUserId 使用 groupId，与旧版对齐
      })
      this.logger.warn('[CallKitCore] initIncoming 返回事件数:', stateResult.events.length)
      // 处理状态机返回的 STATUS_CHANGED 事件，确保 callStateStore 同步到 ALERTING
      this.processEvents(stateResult.events, this.singleCallState.getState())
      // 启动超时定时器
      this.startInviteTimeout()
    } else {
      this.logger.warn(
        '[CallKitCore] ⚠️ 群聊被叫方：singleCallState 不是 IDLE，跳过 initIncoming | 当前状态=',
        this.singleCallState.getState().status
      )
    }

    const events = this.groupCallHandler.handleInviteTextMessage(msg)
    this.logger.warn('[CallKitCore] 群聊 invite 处理后事件:', events.map((e: any) => e.type))
    this.processEvents(events, this.singleCallState.getState())

    // 发出 incomingCall 事件（与单聊行为保持一致，确保 UI 层能弹出待接听状态栏）
    const incomingEvent: CallKitEvent = {
      type: 'incomingCall',
      payload: {
        callId,
        callType,
        callerUserId,
        callerDevId,
        channel,
        calleeUserId: ext?.callkitGroupInfo?.groupId || ext?.groupId || '',
        token: '',
        callerInfo: ext.ease_chat_uikit_user_info,
        groupId: ext?.callkitGroupInfo?.groupId || ext?.groupId,
        groupName: ext?.callkitGroupInfo?.groupName,
      },
    }
    this.logger.warn('[CallKitCore] 即将发出 incomingCall 事件:', { callId, callerUserId, callType })
    this.emitEvent(incomingEvent)
    this.logger.warn('[CallKitCore] incomingCall 事件已发出')

    // 被叫方收到 invite 后回发 alert CMD（与旧版 useListenerManager 对齐）
    this.sendAlertSignal(msg.from as string, ext.callId as string, ext.callerDevId as string)
  }

  private async handleSingleCallInvite(msg: any, ext: any): Promise<void> {
    const callId = ext.callId as string
    const channel = ext.channelName as string
    const callType = ext.type as CALL_TYPE
    const callerDevId = ext.callerDevId as string
    const callerUserId = (ext.callerIMName as string) || (msg.from as string) || ''
    const calleeUserId = (ext.calleeIMName as string) || (msg.to as string) || ''

    this.logger.debug('[CallKitCore] handleSingleCallInvite', {
      from: msg.from,
      callerIMName: ext.callerIMName,
      calleeIMName: ext.calleeIMName,
      resolvedCallerId: callerUserId,
      resolvedCalleeId: calleeUserId,
    })

    // 获取 RTC token（Warning #6：使用 await 确保 token 可用）
    const token = await this.fetchRtcToken(channel)

    // 状态机初始化
    const stateResult = this.singleCallState.initIncoming({
      callId,
      channel,
      token,
      callType,
      callerDevId,
      callerUserId,
      calleeDevId: this.deviceId,
      calleeUserId,
    })

    // 启动超时定时器
    this.startInviteTimeout()

    // 发出 incomingCall 事件
    const incomingEvent: CallKitEvent = {
      type: 'incomingCall',
      payload: {
        callId,
        callType,
        callerUserId,
        callerDevId,
        channel,
        calleeUserId,
        token,
        callerInfo: ext.ease_chat_uikit_user_info,
      },
    }
    this.emitEvent(incomingEvent)

    // 处理状态机返回的事件（STATUS_CHANGED）
    this.processEvents(stateResult.events, this.singleCallState.getState())

    // 被叫方收到 invite 后回发 alert CMD（与旧版 useListenerManager 对齐）
    this.sendAlertSignal(msg.from as string, callId, callerDevId)
  }

  /**
   * 发送 alert CMD 信令给主叫方
   */
  private sendAlertSignal(to: string, callId: string, callerDevId: string): void {
    const alertExt = MessageBuilder.buildCmdExt({
      action: 'alert',
      callId,
      callerDevId,
      calleeDevId: this.deviceId,
    })
    this.signalSender
      .sendCmdMessage(to, 'singleChat', alertExt as any, { deliverOnlineOnly: true })
      .catch(() => {})
  }

  private handleCmdMessage(msg: any): void {
    // 无条件日志：所有 CMD 消息都记录
    this.logger.warn('📨 [CallKitCore] handleCmdMessage 被调用', {
      from: msg.from,
      to: msg.to,
      action: msg.action,
      extAction: msg.ext?.action,
      callId: msg.ext?.callId,
      self: this.isSelfMessage(msg),
    })

    if (this.isSelfMessage(msg)) {
      this.logger.warn('[CallKitCore] ❌ 忽略自己发送的 CMD 消息')
      return
    }

    // ========= Critical #3: CMD 过滤 — 只处理 rtcCall 类型 =========
    if (msg.action !== 'rtcCall') {
      this.logger.warn('[CallKitCore] ❌ 忽略非 rtcCall CMD 消息 | action=', msg.action)
      return
    }

    // ========= Critical #3: CMD 过期检查 =========
    const cmdTime = msg.time || msg.ext?.ts
    if (cmdTime && isCmdMessageExpired(cmdTime)) {
      this.logger.warn('[CallKitCore] ❌ CMD 消息已过期 | cmdTime=', cmdTime)
      return
    }

    // ========= 待处理 invite 的取消/离开拦截 =========
    // 群聊被叫方在 fetchRtcToken 期间 singleCallState 仍为 IDLE，SignalRouter 会忽略 cancelCall/leaveCall。
    // 此处提前拦截并标记为 aborted，避免 token 返回后仍弹出已取消的邀请。
    const extAction = msg.ext?.action
    const extCallId = msg.ext?.callId
    if (
      extCallId &&
      (extAction === 'cancelCall' || extAction === 'leaveCall') &&
      this.pendingIncomingInvites.has(extCallId)
    ) {
      this.logger.warn('[CallKitCore] 待处理 invite 收到取消/离开信令，标记为 aborted', {
        callId: extCallId,
        action: extAction,
      })
      this.pendingIncomingInvites.get(extCallId)!.aborted = true
      return
    }

    const events = this.signalRouter.dispatch(msg)
    if (events.length > 0) {
      this.logger.warn('📨 [CallKitCore] ✅ CMD 消息处理后产生事件:', events.map((e) => e.type))
      this.processEvents(events, this.singleCallState.getState())
    } else {
      this.logger.warn('📨 [CallKitCore] ⚠️ CMD 消息未产生任何事件（可能被忽略或 handler 返回空）')
    }
  }

  // ───────────────────────────────────────────────
  // 内部：事件处理与映射
  // ───────────────────────────────────────────────

  private processEvents(events: DomainEvent[], snapshot: SingleCallState): void {
    events.forEach((event) => {
      const callKitEvents = this.mapDomainEvents(event, snapshot)
      callKitEvents.forEach((callKitEvent) => {
        this.emitEvent(callKitEvent)
        this.handleRtcEvent(callKitEvent)

        // 通话开始/连接时启动时长计时器；通话结束时停止
        if (callKitEvent.type === 'callStarted' || callKitEvent.type === 'callConnected') {
          this.startDurationTimer(
            callKitEvent.payload.callId,
            callKitEvent.payload.channel,
            callKitEvent.payload.callType,
            callKitEvent.payload.callerUserId
          )
        }
        if (callKitEvent.type === 'callEnded') {
          this.stopDurationTimer()
        }
      })
    })
  }

  /**
   * 当配置了 rtcAdapter 时，自动处理 RTC 相关事件
   */
  private handleRtcEvent(event: CallKitEvent): void {
    const adapter = this.config.rtcAdapter
    if (!adapter) return

    switch (event.type) {
      case 'shouldJoinRtc': {
        const p = event.payload
        adapter
          .joinChannel({
            channel: p.channel,
            token: p.token,
            uid: p.uid,
            appId: p.appId,
          })
          .catch((e) => {
            this.emitError('rtcJoinChannelFailed', e, { channel: p.channel, uid: p.uid })
            this.logger.error('[CallKitCore] rtcAdapter.joinChannel 失败:', e)
          })
        break
      }

      case 'shouldLeaveRtc': {
        adapter.leaveChannel().catch((e) => {
          this.emitError('rtcLeaveChannelFailed', e, { channel: event.payload.channel })
        })
        break
      }

      case 'shouldPublishTracks': {
        const p = event.payload
        adapter
          .publishLocalTracks(p.trackTypes)
          .catch((e) => {
            this.emitError('rtcPublishTracksFailed', e, { channel: p.channel, trackTypes: p.trackTypes })
            this.logger.error('[CallKitCore] rtcAdapter.publishLocalTracks 失败:', e)
          })
        break
      }

      case 'localAudioChanged': {
        adapter
          .setAudioEnabled(event.payload.enabled)
          .catch((e) => {
            this.emitError('rtcSetAudioEnabledFailed', e, { enabled: event.payload.enabled })
            this.logger.error('[CallKitCore] rtcAdapter.setAudioEnabled 失败:', e)
          })
        break
      }

      case 'localVideoChanged': {
        adapter
          .setVideoEnabled(event.payload.enabled)
          .catch((e) => {
            this.emitError('rtcSetVideoEnabledFailed', e, { enabled: event.payload.enabled })
            this.logger.error('[CallKitCore] rtcAdapter.setVideoEnabled 失败:', e)
          })
        break
      }
    }
  }

  private mapDomainEvents(event: DomainEvent, snapshot: SingleCallState): CallKitEvent[] {
    const base = {
      callId: event.callId,
      channel: snapshot.channel,
      callType: snapshot.type,
      callerUserId: snapshot.callerUserId,
      calleeUserId: snapshot.calleeUserId,
    }

    const isGroupCall = snapshot.type === CALL_TYPE.VIDEO_MULTI || snapshot.type === CALL_TYPE.AUDIO_MULTI

    switch (event.type) {
      case 'STATUS_CHANGED': {
        return [
          {
            type: 'statusChanged',
            payload: {
              ...base,
              from: String(event.from),
              to: String(event.to),
            },
          },
        ]
      }

      case 'CALL_INVITED': {
        const common = { ...base, isCaller: event.isCaller }
        return [
          { type: 'callInvited', payload: common },
          { type: isGroupCall ? 'groupCallInvited' : 'singleCallInvited', payload: common },
        ]
      }

      case 'CALL_STARTED': {
        const common = {
          ...base,
          isCaller: event.isCaller,
          startTime: Date.now(),
        }
        return [
          { type: 'callStarted', payload: common },
          { type: isGroupCall ? 'groupCallStarted' : 'singleCallStarted', payload: common },
        ]
      }

      case 'CALL_ACCEPTED': {
        const common = { ...base, isCaller: event.isCaller }
        return [
          { type: 'callAccepted', payload: common },
          { type: isGroupCall ? 'groupCallAccepted' : 'singleCallAccepted', payload: common },
        ]
      }

      case 'CALL_CONNECTED': {
        return [
          { type: 'callConnected', payload: base },
          { type: isGroupCall ? 'groupCallConnected' : 'singleCallConnected', payload: base },
        ]
      }

      case 'CALL_ENDED': {
        const common = {
          ...base,
          reason: event.reason as any,
          duration: event.duration,
        }
        return [
          { type: 'callEnded', payload: common },
          { type: isGroupCall ? 'groupCallEnded' : 'singleCallEnded', payload: common },
        ]
      }

      case 'CALL_TIMEOUT': {
        return [
          { type: 'callTimeout', payload: base },
          { type: isGroupCall ? 'groupCallTimeout' : 'singleCallTimeout', payload: base },
        ]
      }

      case 'CALL_REFUSED': {
        const common = { ...base, isRemote: event.isRemote }
        return [
          { type: 'callRefused', payload: common },
          { type: isGroupCall ? 'groupCallRefused' : 'singleCallRefused', payload: common },
        ]
      }

      case 'CALL_BUSY': {
        return [
          { type: 'callBusy', payload: base },
          { type: isGroupCall ? 'groupCallBusy' : 'singleCallBusy', payload: base },
        ]
      }

      case 'CALL_CANCELED': {
        const common = { ...base, isRemote: event.isRemote }
        return [
          { type: 'callCanceled', payload: common },
          { type: isGroupCall ? 'groupCallCanceled' : 'singleCallCanceled', payload: common },
        ]
      }

      case 'SHOULD_JOIN_RTC': {
        return [
          {
            type: 'shouldJoinRtc',
            payload: {
              ...base,
              token: event.token,
              // Agora 加入频道必须使用服务端返回的 RTCUId（数值型），
              // 无法获取时兑底为 IM userId（与旧版付费智能兑底逻辑一致）
              uid: this.rtcUid || this.userId,
              appId: this.rtcAppId || undefined,
              role: event.role,
            },
          },
        ]
      }

      case 'GROUP_CALL_INIT': {
        return [
          {
            type: 'groupCallInit',
            payload: {
              callId: event.callId,
              groupId: event.groupId,
              groupName: event.groupName,
              channel: event.channel,
              callType: event.callType,
              callerUserId: event.callerUserId,
              invitedMembers: event.invitedMembers,
            },
          },
        ]
      }

      case 'PARTICIPANT_STATE_CHANGED': {
        return [
          {
            type: 'participantStateChanged',
            payload: {
              callId: event.callId,
              userId: event.userId,
              state: event.state,
              groupId: event.groupId,
            },
          },
        ]
      }

      case 'PARTICIPANT_JOINED': {
        return [
          {
            type: 'participantJoined',
            payload: {
              ...base,
              userId: event.userId,
              groupId: event.groupId,
            },
          },
        ]
      }

      case 'PARTICIPANT_LEFT': {
        return [
          {
            type: 'participantLeft',
            payload: {
              ...base,
              userId: event.userId,
              reason: event.reason,
              groupId: event.groupId,
            },
          },
        ]
      }

      case 'LOCAL_AUDIO_CHANGED': {
        return [{ type: 'localAudioChanged', payload: { enabled: event.enabled } }]
      }

      case 'LOCAL_VIDEO_CHANGED': {
        return [{ type: 'localVideoChanged', payload: { enabled: event.enabled } }]
      }

      default:
        return []
    }
  }

  private emitEvent(event: CallKitEvent): void {
    this.logger.debug('[CallKitCore] emitEvent:', event.type, '| onEvent存在=', !!this.config.onEvent, '| onUIEvent存在=', !!this.config.onUIEvent)

    // 重复订阅检测：如果同时使用了 config.onEvent 和 core.onEvent()，发出警告
    const hasEventBusListeners = this.eventBus.listenerCount('callKitEvent') > 0
    const hasLegacyOnEvent = !!this.config.onEvent
    if (hasEventBusListeners && hasLegacyOnEvent) {
      this.logger.warn(
        '[CallKitCore] 同时使用了 config.onEvent 和 core.onEvent() 订阅，事件可能重复触发。' +
          '建议只使用其中一种订阅方式。'
      )
    }

    // 1. 通过 EventBus 分发（供上层 onEvent/offEvent 使用）
    this.eventBus.emit('callKitEvent', event)

    // 2. 兼容旧接口：onEvent 接收所有事件
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event)
        this.logger.debug('[CallKitCore] onEvent 回调执行成功:', event.type)
      } catch (err) {
        this.logger.error('[CallKitCore] onEvent 回调执行失败:', err)
      }
    }

    // 3. 按来源分发到新接口
    if (isUIEvent(event) && this.config.onUIEvent) {
      try {
        this.config.onUIEvent(event)
        this.logger.debug('[CallKitCore] onUIEvent 回调执行成功:', event.type)
      } catch (err) {
        this.logger.error('[CallKitCore] onUIEvent 回调执行失败:', err)
      }
    }

    if (isRtcEvent(event) && this.config.onRtcEvent) {
      try {
        this.config.onRtcEvent(event)
      } catch (err) {
        this.logger.error('[CallKitCore] onRtcEvent 回调执行失败:', err)
      }
    }
  }

  private emitError(type: string, error: unknown, context?: Record<string, any>): void {
    const errMsg = error instanceof Error ? error.message : String(error)
    this.logger.error(`[CallKitCore] ${type}:`, error)
    this.emitEvent({
      type: 'callError',
      payload: {
        type,
        error: errMsg,
        callId: context?.callId,
        context,
      },
    })
  }

  private startDurationTimer(callId: string, channel: string, callType: CALL_TYPE, callerUserId: string): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer)
    }
    this.durationStartTime = Date.now()
    this.durationCallInfo = { callId, channel, callType, callerUserId }
    this.durationTimer = setInterval(() => {
      if (!this.durationCallInfo) return
      const duration = Date.now() - this.durationStartTime
      this.emitEvent({
        type: 'callDurationUpdated',
        payload: {
          callId: this.durationCallInfo.callId,
          channel: this.durationCallInfo.channel,
          callType: this.durationCallInfo.callType,
          callerUserId: this.durationCallInfo.callerUserId,
          duration,
        },
      })
    }, 1000)
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer)
      this.durationTimer = null
    }
    this.durationStartTime = 0
    this.durationCallInfo = null
  }

  // ───────────────────────────────────────────────
  // 内部：IM 连接状态管理
  // ───────────────────────────────────────────────

  private handleIMConnected(): void {
    this.logger.info('[CallKitCore] IM 已重新连接')
    // IM 重连后，如果当前有进行中的通话，需要确保监听仍然有效
    // 环信 IM SDK 的 addEventHandler 是持久注册的，断连不会自动清除 handler
    // 但如果 SDK 版本行为不同，这里提供兜底 remount
    if (!this.destroyed && this.imListener) {
      this.logger.info('[CallKitCore] IM 重连恢复：监听状态正常')
    }
  }

  private handleIMDisconnected(): void {
    this.logger.warn('[CallKitCore] IM 已断开连接')
    // IM 断开后，通话状态保持不变，等待重连或超时
    // 如果通话正在进行，由 RTC 层维持音视频，信令暂时中断
  }

  // ───────────────────────────────────────────────
  // 内部：超时定时器管理（Critical #1）
  // ───────────────────────────────────────────────

  /**
   * 启动邀请超时定时器。
   * 超时后调用状态机的 timeout() 并通过 processEvents 消费事件，
   * 确保上层 UI 能收到 callTimeout + callEnded 事件。
   */
  private startInviteTimeout(): void {
    this.clearInviteTimeout()
    this.inviteTimer = setTimeout(() => {
      const result = this.singleCallState.timeout()
      if (result.ok) {
        this.processEvents(result.events, this.singleCallState.getState())
      }
    }, this.inviteTimeoutMs)
  }

  private clearInviteTimeout(): void {
    if (this.inviteTimer) {
      clearTimeout(this.inviteTimer)
      this.inviteTimer = null
    }
  }
}
