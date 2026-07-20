"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const rtcEventTypes = /* @__PURE__ */ new Set([
  "shouldJoinRtc",
  "shouldLeaveRtc",
  "shouldPublishTracks",
  "localAudioChanged",
  "localVideoChanged"
]);
function isUIEvent(event) {
  return !rtcEventTypes.has(event.type);
}
function isRtcEvent(event) {
  return rtcEventTypes.has(event.type);
}
const defaultLogger = {
  error: (msg, ...args) => console.error(`[CallKitCore] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[CallKitCore] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[CallKitCore] ${msg}`, ...args),
  debug: (msg, ...args) => console.log(`[CallKitCore] ${msg}`, ...args),
  verbose: () => {
  }
  // 默认关闭 verbose
};
let globalLogger = defaultLogger;
function setLogger(logger) {
  globalLogger = logger;
}
function getLogger() {
  return globalLogger;
}
class EventBus {
  constructor(logger) {
    this.listeners = /* @__PURE__ */ new Map();
    this.logger = logger || getLogger();
  }
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(handler);
    this.logger.verbose?.(`[EventBus] 订阅事件: ${String(event)}`);
    return () => this.off(event, handler);
  }
  once(event, handler) {
    const onceHandler = (payload) => {
      this.off(event, onceHandler);
      handler(payload);
    };
    return this.on(event, onceHandler);
  }
  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }
  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) {
      this.logger.verbose?.(`[EventBus] 事件 ${String(event)} 无订阅者，跳过`);
      return;
    }
    this.logger.debug?.(`[EventBus] 触发事件: ${String(event)}`, payload);
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        this.logger.error(`[EventBus] 事件 ${String(event)} 的 handler 执行失败:`, error);
      }
    });
  }
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
}
const CALL_STATUS = {
  IDLE: 0,
  INVITING: 1,
  ALERTING: 2,
  CONFIRM_RING: 3,
  RECEIVED_CONFIRM_RING: 4,
  ANSWER_CALL: 5,
  CONFIRM_CALLEE: 6,
  IN_CALL: 7
};
const CALL_TYPE = {
  AUDIO_1V1: 0,
  // 一对一语音通话
  VIDEO_1V1: 1,
  // 一对一视频通话
  VIDEO_MULTI: 2,
  // 多人视频通话
  AUDIO_MULTI: 3
  // 多人语音通话
};
const HANGUP_REASON = {
  HANGUP: "hangup",
  // Hang up call
  CANCEL: "cancel",
  // Cancel call
  REMOTE_CANCEL: "remoteCancel",
  // Remote cancel call
  REFUSE: "refuse",
  // Refuse call
  REMOTE_REFUSE: "remoteRefuse",
  // Remote refuse call
  BUSY: "busy",
  // Busy
  NO_RESPONSE: "noResponse",
  // No response (timeout)
  REMOTE_NO_RESPONSE: "remoteNoResponse",
  // Remote no response
  HANDLE_ON_OTHER_DEVICE: "handleOnOtherDevice",
  // Handled on other device
  ABNORMAL_END: "abnormalEnd"
  // Abnormal end
};
const DEFAULT_TIMEOUT = 3e4;
function createIdleState() {
  return {
    status: CALL_STATUS.IDLE,
    callId: "",
    channel: "",
    token: "",
    type: CALL_TYPE.AUDIO_1V1,
    callerDevId: "",
    calleeDevId: "",
    callerUserId: "",
    calleeUserId: "",
    inviteTimeout: DEFAULT_TIMEOUT,
    inviteTimeoutTimer: null,
    startTime: null,
    audioEnabled: true,
    videoEnabled: true
  };
}
class SingleCallStateMachine {
  constructor(logger) {
    this.state = createIdleState();
    this.logger = logger || getLogger();
  }
  // ─── 查询 ───
  getState() {
    return Object.freeze({ ...this.state });
  }
  isIdle() {
    return this.state.status === CALL_STATUS.IDLE;
  }
  isInCall() {
    return this.state.status === CALL_STATUS.IN_CALL;
  }
  /**
   * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
   */
  isWaitingCalleeAction() {
    return this.state.status === CALL_STATUS.ALERTING || this.state.status === CALL_STATUS.CONFIRM_RING || this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING;
  }
  /**
   * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
   */
  isInActiveCall() {
    return this.state.status === CALL_STATUS.ANSWER_CALL || this.state.status === CALL_STATUS.CONFIRM_CALLEE || this.state.status === CALL_STATUS.IN_CALL;
  }
  /**
   * 当前是否可以接听（被叫端按钮可点击）
   */
  canAccept() {
    return this.state.status === CALL_STATUS.ALERTING || this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING;
  }
  /**
   * 当前是否可以拒绝（被叫端按钮可点击）
   */
  canReject() {
    return this.state.status === CALL_STATUS.ALERTING || this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING;
  }
  /**
   * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
   */
  canHangup() {
    return this.state.status !== CALL_STATUS.IDLE;
  }
  /**
   * 当前是否处于呼叫/响铃中（主叫等待对方接听）
   */
  isCalling() {
    return this.state.status === CALL_STATUS.INVITING || this.state.status === CALL_STATUS.CONFIRM_RING;
  }
  isCallIdMatch(incomingCallId) {
    return this.state.callId === incomingCallId;
  }
  getDuration() {
    if (!this.state.startTime) return 0;
    return Date.now() - this.state.startTime;
  }
  // ─── 初始化 ───
  /**
   * 主叫方发起邀请
   */
  initInvite(params) {
    this.clearTimeout();
    const oldStatus = this.state.status;
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
      inviteTimeout: params.timeout ?? DEFAULT_TIMEOUT
    };
    this.logger.stateChange?.(oldStatus, CALL_STATUS.INVITING, { callId: params.callId });
    return {
      ok: true,
      events: [
        {
          type: "STATUS_CHANGED",
          from: oldStatus,
          to: CALL_STATUS.INVITING,
          callId: params.callId
        },
        {
          type: "CALL_INVITED",
          callId: params.callId,
          isCaller: true,
          channel: params.channel,
          callType: params.callType
        }
      ]
    };
  }
  /**
   * 被叫方收到 invite，初始化响铃状态
   */
  initIncoming(params) {
    this.clearTimeout();
    const oldStatus = this.state.status;
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
      calleeUserId: params.calleeUserId
    };
    this.logger.stateChange?.(oldStatus, CALL_STATUS.ALERTING, { callId: params.callId });
    return {
      ok: true,
      events: [
        {
          type: "STATUS_CHANGED",
          from: oldStatus,
          to: CALL_STATUS.ALERTING,
          callId: params.callId
        },
        {
          type: "CALL_INVITED",
          callId: params.callId,
          isCaller: false,
          channel: params.channel,
          callType: params.callType
        }
      ]
    };
  }
  // ─── 信令响应 ───
  /**
   * 主叫方收到 alert（被叫已响铃）
   *
   * 与 lib 对齐：收到 alert 后保持 INVITING 状态不变（lib 的 handleAlertSignalMessage
   * 不修改 callState.status），只记录 calleeDevId 和发送 confirmRing。
   * 状态直到收到 confirmRing 后才变为 RECEIVED_CONFIRM_RING。
   */
  receiveAlert(calleeDevId) {
    if (this.state.status !== CALL_STATUS.INVITING) {
      this.logger.warn("[SingleCallStateMachine] receiveAlert: 当前状态不是 INVITING，忽略", {
        status: this.state.status
      });
      return { ok: false, events: [] };
    }
    this.state.calleeDevId = calleeDevId;
    this.logger.info("[SingleCallStateMachine] receiveAlert: 保持 INVITING，记录 calleeDevId", {
      callId: this.state.callId,
      calleeDevId
    });
    return { ok: true, events: [] };
  }
  /**
   * 被叫方收到 confirmRing
   */
  receiveConfirmRing(status) {
    if (this.state.status < CALL_STATUS.ALERTING) {
      this.logger.warn("[SingleCallStateMachine] receiveConfirmRing: 当前状态 < ALERTING，忽略");
      return { ok: false, events: [] };
    }
    if (this.state.status === CALL_STATUS.RECEIVED_CONFIRM_RING) {
      this.logger.info("[SingleCallStateMachine] receiveConfirmRing: 已是 RECEIVED_CONFIRM_RING，忽略");
      return { ok: false, events: [] };
    }
    if (!status) {
      this.logger.warn("[SingleCallStateMachine] receiveConfirmRing: status=false，忽略");
      return { ok: false, events: [] };
    }
    this.clearTimeout();
    const oldStatus = this.state.status;
    this.state.status = CALL_STATUS.RECEIVED_CONFIRM_RING;
    this.logger.stateChange?.(oldStatus, CALL_STATUS.RECEIVED_CONFIRM_RING, { callId: this.state.callId });
    return {
      ok: true,
      events: [
        {
          type: "STATUS_CHANGED",
          from: oldStatus,
          to: CALL_STATUS.RECEIVED_CONFIRM_RING,
          callId: this.state.callId
        }
      ]
    };
  }
  /**
   * 收到 answerCall 信令
   */
  receiveAnswer(result, fromCaller) {
    this.clearTimeout();
    if (this.state.status === CALL_STATUS.IN_CALL) {
      this.logger.info("[SingleCallStateMachine] receiveAnswer: 已在 IN_CALL，忽略");
      return { ok: false, events: [] };
    }
    if (result === "accept") {
      const oldStatus2 = this.state.status;
      this.state.status = CALL_STATUS.IN_CALL;
      this.state.startTime = Date.now();
      this.logger.stateChange?.(oldStatus2, CALL_STATUS.IN_CALL, { callId: this.state.callId });
      const isCaller = !fromCaller;
      const events2 = [
        {
          type: "STATUS_CHANGED",
          from: oldStatus2,
          to: CALL_STATUS.IN_CALL,
          callId: this.state.callId
        },
        {
          type: "CALL_ACCEPTED",
          callId: this.state.callId,
          isCaller,
          channel: this.state.channel,
          callType: this.state.type
        },
        {
          type: "CALL_STARTED",
          callId: this.state.callId,
          isCaller,
          channel: this.state.channel,
          callType: this.state.type
        },
        {
          type: "SHOULD_JOIN_RTC",
          callId: this.state.callId,
          channel: this.state.channel,
          token: this.state.token,
          role: fromCaller ? "callee" : "caller",
          callType: this.state.type
        }
      ];
      return { ok: true, events: events2 };
    }
    const oldStatus = this.state.status;
    const duration = 0;
    const reason = result === "busy" ? HANGUP_REASON.BUSY : HANGUP_REASON.REMOTE_REFUSE;
    const callId = this.state.callId;
    this.resetCore();
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IDLE, { callId, trigger: `answer:${result}` });
    const events = [
      {
        type: "CALL_ENDED",
        callId,
        reason,
        duration
      }
    ];
    if (result === "busy") {
      events.unshift({ type: "CALL_BUSY", callId });
    } else {
      events.unshift({ type: "CALL_REFUSED", callId, isRemote: true });
    }
    return { ok: true, events };
  }
  /**
   * 收到 cancelCall 信令
   * 
   * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
   */
  receiveCancel() {
    const currentStatus = this.state.status;
    const callId = this.state.callId;
    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn("[SingleCallStateMachine] receiveCancel: 当前状态 IDLE，忽略");
      return { ok: false, events: [] };
    }
    this.clearTimeout();
    this.resetCore();
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: "cancel" });
    return {
      ok: true,
      events: [
        { type: "CALL_CANCELED", callId, isRemote: true },
        { type: "CALL_ENDED", callId, reason: HANGUP_REASON.REMOTE_CANCEL, duration: 0 }
      ]
    };
  }
  /**
   * 收到 leaveCall 信令
   * 
   * 注：callId 校验和多端容错由 Handler 负责，状态机只处理匹配后的状态流转。
   */
  receiveLeave() {
    const currentStatus = this.state.status;
    const callId = this.state.callId;
    if (currentStatus === CALL_STATUS.IDLE) {
      return { ok: false, events: [] };
    }
    if (currentStatus === CALL_STATUS.IN_CALL) {
      const duration = this.getDuration();
      this.resetCore();
      this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: "leave" });
      return {
        ok: true,
        events: [{ type: "CALL_ENDED", callId, reason: HANGUP_REASON.HANGUP, duration }]
      };
    }
    this.resetCore();
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: "leave:alerting" });
    return {
      ok: true,
      events: [{ type: "CALL_ENDED", callId, reason: HANGUP_REASON.HANGUP, duration: 0 }]
    };
  }
  /**
   * 收到 confirmCallee 信令（被叫方）
   */
  receiveConfirmCallee() {
    if (this.state.status === CALL_STATUS.IDLE) {
      this.logger.warn("[SingleCallStateMachine] receiveConfirmCallee: 当前 IDLE，忽略");
      return { ok: false, events: [] };
    }
    if (this.state.status === CALL_STATUS.IN_CALL) {
      this.logger.info("[SingleCallStateMachine] receiveConfirmCallee: 已是 IN_CALL，跳过");
      return { ok: false, events: [] };
    }
    const oldStatus = this.state.status;
    this.state.status = CALL_STATUS.IN_CALL;
    this.state.startTime = Date.now();
    this.clearTimeout();
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IN_CALL, { callId: this.state.callId });
    const events = [
      {
        type: "STATUS_CHANGED",
        from: oldStatus,
        to: CALL_STATUS.IN_CALL,
        callId: this.state.callId
      },
      {
        type: "CALL_CONNECTED",
        callId: this.state.callId,
        channel: this.state.channel,
        callType: this.state.type
      },
      {
        type: "CALL_STARTED",
        callId: this.state.callId,
        isCaller: false,
        channel: this.state.channel,
        callType: this.state.type
      },
      {
        type: "SHOULD_JOIN_RTC",
        callId: this.state.callId,
        channel: this.state.channel,
        token: this.state.token,
        role: "callee",
        callType: this.state.type
      }
    ];
    return { ok: true, events };
  }
  // ─── 本地动作 ───
  /**
   * 本地挂断/取消
   */
  hangup(reason = HANGUP_REASON.HANGUP) {
    const currentStatus = this.state.status;
    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn("[SingleCallStateMachine] hangup: 当前状态 IDLE，忽略");
      return { ok: false, events: [] };
    }
    const duration = currentStatus === CALL_STATUS.IN_CALL ? this.getDuration() : 0;
    const callId = this.state.callId;
    this.clearTimeout();
    this.resetCore();
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: "hangup" });
    return {
      ok: true,
      events: [{ type: "CALL_ENDED", callId, reason, duration }]
    };
  }
  /**
   * 邀请超时
   */
  timeout() {
    const currentStatus = this.state.status;
    if (currentStatus === CALL_STATUS.IDLE || currentStatus === CALL_STATUS.IN_CALL) {
      return { ok: false, events: [] };
    }
    const callId = this.state.callId;
    this.resetCore();
    this.logger.stateChange?.(currentStatus, CALL_STATUS.IDLE, { callId, trigger: "timeout" });
    return {
      ok: true,
      events: [
        { type: "CALL_TIMEOUT", callId },
        { type: "CALL_ENDED", callId, reason: HANGUP_REASON.NO_RESPONSE, duration: 0 }
      ]
    };
  }
  /**
   * 强制重置状态机
   */
  reset() {
    this.clearTimeout();
    const oldStatus = this.state.status;
    this.state = createIdleState();
    this.logger.stateChange?.(oldStatus, CALL_STATUS.IDLE, { trigger: "forceReset" });
  }
  // ─── 超时管理（由外部调用） ───
  /**
   * 启动超时定时器。
   * 超时后自动调用 onTimeout 回调（由 CallKitCore 注册），确保事件不会被丢弃。
   */
  startTimeout(onTimeout) {
    this.clearTimeout();
    this.state.inviteTimeoutTimer = setTimeout(() => {
      const result = this.timeout();
      if (onTimeout && result.ok) {
        onTimeout(result);
      }
    }, this.state.inviteTimeout);
  }
  clearTimeout() {
    if (this.state.inviteTimeoutTimer) {
      clearTimeout(this.state.inviteTimeoutTimer);
      this.state.inviteTimeoutTimer = null;
    }
  }
  resetCore() {
    this.state = createIdleState();
  }
  // ─── 媒体状态 ───
  /**
   * 切换本地音频状态
   */
  toggleAudio() {
    this.state.audioEnabled = !this.state.audioEnabled;
    return {
      ok: true,
      events: [
        {
          type: "LOCAL_AUDIO_CHANGED",
          callId: this.state.callId,
          enabled: this.state.audioEnabled
        }
      ]
    };
  }
  /**
   * 切换本地视频状态
   */
  toggleVideo() {
    this.state.videoEnabled = !this.state.videoEnabled;
    return {
      ok: true,
      events: [
        {
          type: "LOCAL_VIDEO_CHANGED",
          callId: this.state.callId,
          enabled: this.state.videoEnabled
        }
      ]
    };
  }
}
class GroupCallSession {
  constructor(logger) {
    this.session = null;
    this.participants = /* @__PURE__ */ new Map();
    this.logger = logger || getLogger();
  }
  /**
   * 初始化会话
   */
  init(params) {
    this.session = {
      ...params,
      status: "inviting",
      startTime: Date.now()
    };
    this.participants.clear();
    this.logger.info("[GroupCallSession] 初始化", params);
  }
  /**
   * 添加参与者
   */
  addParticipant(info) {
    this.participants.set(info.userId, { ...info });
    this.logger.info("[GroupCallSession] 添加参与者", { userId: info.userId, state: info.state });
  }
  /**
   * 移除参与者
   */
  removeParticipant(userId) {
    const removed = this.participants.delete(userId);
    if (removed) {
      this.logger.info("[GroupCallSession] 移除参与者", { userId });
    }
    return removed;
  }
  /**
   * 标记参与者状态
   */
  setParticipantState(userId, state) {
    const p = this.participants.get(userId);
    if (!p) return false;
    p.state = state;
    this.logger.info("[GroupCallSession] 更新参与者状态", { userId, state });
    return true;
  }
  /**
   * 标记已接受
   */
  markAccepted(userId) {
    return this.setParticipantState(userId, "accepted");
  }
  /**
   * 标记已加入 RTC
   */
  markJoinedRtc(userId) {
    const ok = this.setParticipantState(userId, "joinedRtc");
    if (ok && this.session && this.session.status === "inviting") {
      this.session.status = "inCall";
    }
    return ok;
  }
  /**
   * 标记已离开 RTC
   */
  markLeftRtc(userId) {
    return this.setParticipantState(userId, "left");
  }
  /**
   * 标记音频静音状态
   */
  markAudioMuted(userId, muted) {
    const p = this.participants.get(userId);
    if (!p) return false;
    p.isMuted = muted;
    this.logger.info("[GroupCallSession] 更新音频状态", { userId, muted });
    return true;
  }
  /**
   * 标记视频开关状态
   */
  markVideoOn(userId, on) {
    const p = this.participants.get(userId);
    if (!p) return false;
    p.isCameraOn = on;
    this.logger.info("[GroupCallSession] 更新视频状态", { userId, on });
    return true;
  }
  /**
   * 获取参与者
   */
  getParticipant(userId) {
    const p = this.participants.get(userId);
    return p ? Object.freeze({ ...p }) : void 0;
  }
  /**
   * 获取所有参与者
   */
  getAllParticipants() {
    return Array.from(this.participants.values()).map((p) => Object.freeze({ ...p }));
  }
  /**
   * 获取当前在线参与者（未离开）
   */
  getActiveParticipants() {
    return this.getAllParticipants().filter((p) => p.state !== "left");
  }
  /**
   * 获取会话快照
   */
  getSnapshot() {
    return this.session ? Object.freeze({ ...this.session }) : null;
  }
  /**
   * 结束会话
   */
  end() {
    if (this.session) {
      this.session.status = "ended";
    }
    this.logger.info("[GroupCallSession] 会话结束");
  }
  /**
   * 销毁会话
   */
  destroy() {
    this.session = null;
    this.participants.clear();
    this.logger.info("[GroupCallSession] 已销毁");
  }
}
class SignalRouter {
  constructor(logger) {
    this.handlers = /* @__PURE__ */ new Map();
    this.logger = logger || getLogger();
    this.logger.warn("📡 [SignalRouter] 信令路由器已初始化");
  }
  register(action, handler) {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, []);
    }
    this.handlers.get(action).push(handler);
  }
  dispatch(message) {
    const action = message.ext?.action;
    if (!action) {
      this.logger.warn("[SignalRouter] 消息缺少 action，无法分发", message);
      return [];
    }
    this.logger.signal?.("recv", action, {
      from: message.from,
      to: message.to,
      callId: message.ext?.callId,
      result: message.ext?.result,
      deviceId: message.ext?.callerDevId || message.ext?.calleeDevId
    });
    const handlers = this.handlers.get(action) || [];
    if (handlers.length === 0) {
      this.logger.warn(`[SignalRouter] 未注册 action "${action}" 的处理器`);
      return [];
    }
    const allEvents = [];
    handlers.forEach((h) => {
      try {
        const result = h.handle(message);
        if (result && Array.isArray(result)) {
          allEvents.push(...result);
        }
      } catch (err) {
        this.logger.error("[SignalRouter] Handler 执行失败:", err);
      }
    });
    return allEvents;
  }
}
class SignalSender {
  constructor(imClient, logger, createMessageFn) {
    this.imClient = imClient;
    this.logger = logger || getLogger();
    this.createMessageFn = createMessageFn;
  }
  /**
   * 更新底层 IM 客户端实例（用于账号切换等场景）
   */
  updateImClient(imClient) {
    this.imClient = imClient;
    this.logger.info("[SignalSender] IM 客户端实例已更新");
  }
  /**
   * 发送 invite 文本消息
   */
  async sendInviteMessage(targetId, chatType, message, ext, groupId) {
    const isGroupChat = Array.isArray(targetId);
    const to = isGroupChat ? groupId || "" : targetId;
    const msgBody = {
      type: "txt",
      to,
      msg: message,
      chatType: isGroupChat ? "groupChat" : chatType,
      ext
    };
    if (isGroupChat && Array.isArray(targetId)) {
      msgBody.receiverList = targetId;
    }
    const msg = this.createMessage(msgBody);
    this.logger.debug?.("[SignalSender] sendInviteMessage msgBody", JSON.parse(JSON.stringify(msgBody)));
    this.logger.debug?.("[SignalSender] sendInviteMessage ext", {
      action: msgBody.ext?.action,
      callId: msgBody.ext?.callId,
      callerIMName: msgBody.ext?.callerIMName,
      calleeIMName: msgBody.ext?.calleeIMName,
      callerDevId: msgBody.ext?.callerDevId,
      channelName: msgBody.ext?.channelName,
      chatType: msgBody.ext?.chatType,
      type: msgBody.ext?.type,
      msgType: msgBody.ext?.msgType,
      invitedMembers: msgBody.ext?.invitedMembers,
      em_push_ext: msgBody.ext?.em_push_ext,
      em_apns_ext: msgBody.ext?.em_apns_ext,
      ease_chat_uikit_user_info: msgBody.ext?.ease_chat_uikit_user_info,
      callkitGroupInfo: msgBody.ext?.callkitGroupInfo
    });
    const result = await this.imClient.send(msg);
    this.logger.signal?.("send", "invite", { to, callId: ext.callId });
    return result;
  }
  /**
   * 发送 CMD 信令消息
   */
  async sendCmdMessage(targetId, chatType, ext, options) {
    const msgBody = {
      type: "cmd",
      to: targetId,
      chatType,
      action: "rtcCall",
      ext,
      deliverOnlineOnly: options?.deliverOnlineOnly || false
    };
    if (options?.receiverList) {
      msgBody.receiverList = options.receiverList;
    }
    const msg = this.createMessage(msgBody);
    const result = await this.imClient.send(msg);
    this.logger.signal?.("send", ext.action, { to: targetId, callId: ext.callId });
    return result;
  }
  /**
   * 兼容 full 版与 miniCore 版的消息创建
   * full 版: ChatSDK.message.create(options)
   * miniCore 版: client.Message.create(options)
   */
  createMessage(options) {
    if (this.createMessageFn) {
      return this.createMessageFn(options);
    }
    const client = this.imClient;
    if (typeof client !== "undefined" && client.message?.create) {
      return client.message.create(options);
    }
    if (client?.Message?.create) {
      return client.Message.create(options);
    }
    throw new Error(
      "[SignalSender] 无法创建消息：当前环境缺少 message.create API。请确认 easemob-websdk 已安装（full 版），或 miniCore 已注册消息插件。"
    );
  }
}
class SingleCallSignalHandler {
  constructor(stateMachine, sender, deviceIdProvider, logger) {
    this.stateMachine = stateMachine;
    this.sender = sender;
    this.getDeviceId = typeof deviceIdProvider === "function" ? deviceIdProvider : () => deviceIdProvider;
    this.logger = logger || getLogger();
    this.logger.warn("📞 [SingleCallSignalHandler] 单聊信令处理器已初始化");
  }
  get deviceId() {
    return this.getDeviceId();
  }
  handle(message) {
    const action = message.ext?.action;
    switch (action) {
      case "alert":
        return this.handleAlert(message);
      case "confirmRing":
        return this.handleConfirmRing(message);
      case "answerCall":
        return this.handleAnswerCall(message);
      case "cancelCall":
        return this.handleCancelCall(message);
      case "leaveCall":
        return this.handleLeaveCall(message);
      case "confirmCallee":
        return this.handleConfirmCallee(message);
      default:
        this.logger.warn(`[SingleCallSignalHandler] 未知 action: ${action}`);
        return [];
    }
  }
  // ───────────────────────────────────────────────
  // alert — 主叫方收到被叫已响铃
  // ───────────────────────────────────────────────
  handleAlert(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI;
    this.logger.signal?.("recv", "alert", {
      from: message.from,
      callId: ext?.callId,
      callerDevId: ext?.callerDevId,
      isGroupCall
    });
    if (ext.callerDevId !== this.deviceId) {
      this.logger.warn(
        `[SingleCallSignalHandler] 主叫多端: callerDevId(${ext.callerDevId}) ≠ 当前设备(${this.deviceId})`
      );
      return [];
    }
    const stateResult = this.stateMachine.receiveAlert(ext.calleeDevId);
    const shouldSendConfirmRing = stateResult.ok || isGroupCall;
    if (shouldSendConfirmRing) {
      const confirmRingPayload = this.buildConfirmRingPayload(message);
      if (confirmRingPayload) {
        this.sender.sendCmdMessage(
          message.from,
          "singleChat",
          {
            action: "confirmRing",
            callId: ext.callId,
            status: confirmRingPayload.status,
            callerDevId: ext.callerDevId,
            calleeDevId: ext.calleeDevId,
            ts: Date.now(),
            msgType: "rtcCallWithAgora"
          }
        ).catch(() => {
        });
      }
    }
    if (!stateResult.ok) {
      return [];
    }
    return stateResult.events;
  }
  buildConfirmRingPayload(message) {
    const ext = message.ext;
    if (!ext) return null;
    const currentState = this.stateMachine.getState();
    if (!currentState.callId) {
      this.logger.warn("[SingleCallSignalHandler] 当前无通话，无法构建 confirmRing");
      return null;
    }
    const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI;
    let status = true;
    if (ext.callId !== currentState.callId) {
      status = false;
      this.logger.warn(
        `[SingleCallSignalHandler] callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
    }
    if (currentState.status !== void 0 && currentState.status > CALL_STATUS.RECEIVED_CONFIRM_RING && !isGroupCall) {
      status = false;
      this.logger.warn(
        `[SingleCallSignalHandler] 单聊状态已超前: ${currentState.status}，confirmRing status=false`
      );
    }
    return { status };
  }
  // ───────────────────────────────────────────────
  // confirmRing — 被叫方收到主叫确认响铃
  // ───────────────────────────────────────────────
  handleConfirmRing(message) {
    const { ext } = message;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI;
    if (ext.callerDevId !== currentState.callerDevId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmRing 主叫设备不匹配: ext(${ext.callerDevId}) ≠ state(${currentState.callerDevId})`
      );
      return [];
    }
    if (ext.calleeDevId !== this.deviceId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmRing 被叫设备不匹配: ext(${ext.calleeDevId}) ≠ current(${this.deviceId})`
      );
      return [];
    }
    const stateResult = this.stateMachine.receiveConfirmRing(!!ext.status);
    return stateResult.events;
  }
  // ───────────────────────────────────────────────
  // answerCall — 主叫方收到被叫应答
  // ───────────────────────────────────────────────
  handleAnswerCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] answerCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
      return [];
    }
    const isGroupCall = currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI;
    if (isGroupCall) {
      this.logger.debug("[SingleCallSignalHandler] 群聊 answerCall 由 GroupCallSignalHandler 处理，本 Handler 忽略");
      return [];
    }
    if (currentState.status === CALL_STATUS.IN_CALL) {
      this.logger.debug("[SingleCallSignalHandler] 单聊已在 IN_CALL，忽略 answerCall");
      return [];
    }
    if (ext.callerDevId !== this.deviceId) {
      if (message.from === currentState.callerUserId) {
        const reason = ext.result === "accept" ? "已被其他端接听" : "已被其他端拒绝";
        this.logger.warn(`[SingleCallSignalHandler] answerCall ${reason}`);
        return [];
      }
      this.logger.warn(
        `[SingleCallSignalHandler] answerCall callerDevId 不匹配: ext(${ext.callerDevId}) ≠ current(${this.deviceId})`
      );
      return [];
    }
    const allEvents = [];
    if (ext.result !== "accept") {
      this.logger.signal?.("recv", "answerCall", {
        from: message.from,
        result: ext.result,
        callId: ext.callId
      });
      const stateResult = this.stateMachine.receiveAnswer(
        ext.result
      );
      allEvents.push(...stateResult.events);
      this.sendConfirmCallee(message.from, {
        callId: ext.callId,
        callerDevId: ext.callerDevId,
        calleeDevId: ext.calleeDevId,
        result: ext.result
      });
    } else {
      this.logger.signal?.("recv", "answerCall", {
        from: message.from,
        result: "accept",
        callId: ext.callId
      });
      this.sendConfirmCallee(message.from, {
        callId: ext.callId,
        callerDevId: ext.callerDevId,
        calleeDevId: ext.calleeDevId,
        result: "accept"
      });
      this.logger.info("[SingleCallSignalHandler] 一对一通话接受，进入 IN_CALL");
      const stateResult = this.stateMachine.receiveAnswer("accept");
      allEvents.push(...stateResult.events);
    }
    return allEvents;
  }
  // ───────────────────────────────────────────────
  // cancelCall
  // ───────────────────────────────────────────────
  handleCancelCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] cancelCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
      if (currentState.status === CALL_STATUS.IDLE) {
        this.logger.info("[SingleCallSignalHandler] 当前 IDLE，忽略");
        return [];
      }
      if (currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI) {
        this.logger.debug("[SingleCallSignalHandler] 群聊 cancelCall 由 GroupCallSignalHandler 处理");
        return [];
      }
      const isFromCaller = message.from === currentState.callerUserId;
      if (isFromCaller && (currentState.status === CALL_STATUS.ALERTING || currentState.status === CALL_STATUS.INVITING)) {
        this.logger.info("[SingleCallSignalHandler] 单聊收到主叫方取消（callId 不匹配），执行挂断");
        const stateResult2 = this.stateMachine.receiveCancel();
        return stateResult2.events;
      }
      return [];
    }
    this.logger.signal?.("recv", "cancelCall", {
      from: message.from,
      callId: ext.callId
    });
    this.logger.info("[SingleCallSignalHandler] 收到对方取消");
    const stateResult = this.stateMachine.receiveCancel();
    return stateResult.events;
  }
  // ───────────────────────────────────────────────
  // leaveCall
  // ───────────────────────────────────────────────
  handleLeaveCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] leaveCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
      if (currentState.status === CALL_STATUS.IDLE) {
        return [];
      }
      if (currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI) {
        this.logger.debug("[SingleCallSignalHandler] 群聊 leaveCall 由 GroupCallSignalHandler 处理");
        return [];
      }
      if (currentState.status === CALL_STATUS.IN_CALL) {
        this.logger.info("[SingleCallSignalHandler] 通话中对方离开，执行挂断");
        const stateResult2 = this.stateMachine.receiveLeave();
        return stateResult2.events;
      } else if (currentState.status === CALL_STATUS.ALERTING && message.from === currentState.callerUserId) {
        this.logger.info("[SingleCallSignalHandler] ALERTING 状态收到主叫方离开，执行挂断");
        const stateResult2 = this.stateMachine.receiveLeave();
        return stateResult2.events;
      }
      return [];
    }
    this.logger.signal?.("recv", "leaveCall", {
      from: message.from,
      callId: ext.callId
    });
    if (currentState.type === CALL_TYPE.VIDEO_MULTI || currentState.type === CALL_TYPE.AUDIO_MULTI) {
      this.logger.debug("[SingleCallSignalHandler] 群聊 leaveCall 由 GroupCallSignalHandler 处理");
      return [];
    }
    if (currentState.status === CALL_STATUS.IDLE) {
      return [];
    }
    if (currentState.status === CALL_STATUS.ALERTING || currentState.status === CALL_STATUS.INVITING) {
      if (message.from !== currentState.callerUserId) {
        this.logger.warn("[SingleCallSignalHandler] leaveCall callId 匹配但发送者不是主叫方，忽略");
        return [];
      }
    }
    const stateResult = this.stateMachine.receiveLeave();
    return stateResult.events;
  }
  // ───────────────────────────────────────────────
  // confirmCallee — 被叫方收到主叫确认 callee 就绪
  // ───────────────────────────────────────────────
  handleConfirmCallee(message) {
    const ext = message.ext;
    if (!ext) return [];
    this.logger.signal?.("recv", "confirmCallee", {
      from: message.from,
      callId: ext.callId,
      result: ext.result
    });
    this.logger.info("[SingleCallSignalHandler] 收到 confirmCallee");
    const currentState = this.stateMachine.getState();
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[SingleCallSignalHandler] confirmCallee callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
      return [];
    }
    if (ext.result && ext.result !== "accept") {
      this.logger.info(`[SingleCallSignalHandler] confirmCallee result=${ext.result}，忽略`);
      return [];
    }
    const stateResult = this.stateMachine.receiveConfirmCallee();
    return stateResult.events;
  }
  // ─── 私有辅助 ───
  sendConfirmCallee(to, payload) {
    this.sender.sendCmdMessage(
      to,
      "singleChat",
      {
        action: "confirmCallee",
        callId: payload.callId,
        callerDevId: payload.callerDevId,
        calleeDevId: payload.calleeDevId,
        result: payload.result,
        ts: Date.now(),
        msgType: "rtcCallWithAgora"
      }
    ).catch(() => {
    });
  }
}
class GroupCallSignalHandler {
  constructor(session, stateMachine, sender, userIdProvider, logger) {
    this.session = session;
    this.stateMachine = stateMachine;
    this.sender = sender;
    this.getUserId = typeof userIdProvider === "function" ? userIdProvider : () => userIdProvider;
    this.logger = logger || getLogger();
    this.logger.warn("👥 [GroupCallSignalHandler] 群聊信令处理器已初始化");
  }
  get userId() {
    return this.getUserId();
  }
  /**
   * 处理 invite 文本消息中的群聊初始化
   * 由 IMListener 在收到 invite 文本消息时直接调用（不走 SignalRouter）
   */
  handleInviteTextMessage(message) {
    const ext = message.ext;
    const callerUserId = ext?.callerIMName || message.from || "";
    const groupId = ext?.callkitGroupInfo?.groupId || "";
    const groupName = ext?.callkitGroupInfo?.groupName || "";
    const channel = ext?.channelName || "";
    const callType = ext?.type === CALL_TYPE.VIDEO_MULTI ? "video" : "audio";
    const invitedMembers = ext?.invitedMembers || [];
    const callId = ext?.callId || "";
    const callerUserInfo = ext?.ease_chat_uikit_user_info;
    const callerNickname = callerUserInfo?.nickname || callerUserId;
    const callerAvatar = callerUserInfo?.avatarURL || "";
    this.session.init({
      sessionId: channel,
      groupId,
      groupName,
      callType,
      callerUserId
    });
    this.session.addParticipant({
      userId: this.userId,
      nickname: this.userId,
      avatarUrl: "",
      state: "invited",
      isLocal: true,
      isMuted: false,
      isCameraOn: callType === "video",
      isSpeaking: false
    });
    if (callerUserId && callerUserId !== this.userId) {
      this.session.addParticipant({
        userId: callerUserId,
        nickname: callerNickname,
        avatarUrl: callerAvatar,
        state: "joinedRtc",
        isLocal: false,
        isMuted: false,
        isCameraOn: false,
        isSpeaking: false
      });
    }
    invitedMembers.forEach((m) => {
      if (m !== this.userId && m !== callerUserId) {
        this.session.addParticipant({
          userId: m,
          nickname: m,
          avatarUrl: "",
          state: "invited",
          isLocal: false,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false
        });
      }
    });
    this.logger.event?.("groupCallInit", {
      groupId,
      groupName,
      channel,
      callType,
      participants: this.session.getAllParticipants().map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        state: p.state
      }))
    });
    return [
      {
        type: "GROUP_CALL_INIT",
        callId,
        groupId,
        groupName,
        channel,
        callType,
        callerUserId,
        invitedMembers
      }
    ];
  }
  handle(message) {
    const action = message.ext?.action;
    switch (action) {
      case "answerCall":
        return this.handleAnswerCall(message);
      case "cancelCall":
        return this.handleCancelCall(message);
      case "leaveCall":
        return this.handleLeaveCall(message);
      default:
        this.logger.warn(`[GroupCallSignalHandler] 未知 action: ${action}`);
        return [];
    }
  }
  // ───────────────────────────────────────────────
  // answerCall — 群聊成员应答
  // ───────────────────────────────────────────────
  handleAnswerCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (currentState.type !== CALL_TYPE.VIDEO_MULTI && currentState.type !== CALL_TYPE.AUDIO_MULTI) {
      return [];
    }
    if (ext.callId !== currentState.callId) {
      this.logger.warn(
        `[GroupCallSignalHandler] answerCall callId 不匹配: ext(${ext.callId}) ≠ current(${currentState.callId})`
      );
      return [];
    }
    const fromUserId = message.from;
    const callId = currentState.callId;
    const channel = currentState.channel;
    const groupSnapshot = this.session.getSnapshot();
    const groupId = groupSnapshot?.groupId;
    if (ext.result !== "accept") {
      this.logger.signal?.("recv", "answerCall", {
        from: fromUserId,
        result: ext.result,
        callId,
        type: "group"
      });
      this.logger.info(`[GroupCallSignalHandler] 群聊成员拒绝: ${fromUserId}`);
      this.session.removeParticipant(fromUserId);
      return [
        {
          type: "PARTICIPANT_LEFT",
          callId,
          userId: fromUserId,
          channel,
          callType: currentState.type,
          reason: ext.result === "busy" ? "busy" : "refused",
          groupId
        }
      ];
    }
    this.logger.signal?.("recv", "answerCall", {
      from: fromUserId,
      result: "accept",
      callId,
      type: "group"
    });
    this.logger.info(`[GroupCallSignalHandler] 群聊成员接受: ${fromUserId}`);
    this.session.markAccepted(fromUserId);
    this.sendConfirmCallee(fromUserId, {
      callId,
      callerDevId: currentState.callerDevId || "",
      calleeDevId: ext.calleeDevId,
      result: "accept"
    });
    return [
      {
        type: "PARTICIPANT_STATE_CHANGED",
        callId,
        userId: fromUserId,
        state: "accepted",
        groupId
      },
      {
        type: "PARTICIPANT_JOINED",
        callId,
        userId: fromUserId,
        channel,
        callType: currentState.type,
        groupId
      }
    ];
  }
  // ─── 私有辅助 ───
  sendConfirmCallee(to, payload) {
    this.sender.sendCmdMessage(
      to,
      "singleChat",
      {
        action: "confirmCallee",
        callId: payload.callId,
        callerDevId: payload.callerDevId,
        calleeDevId: payload.calleeDevId,
        result: payload.result,
        ts: Date.now(),
        msgType: "rtcCallWithAgora"
      }
    ).catch(() => {
    });
  }
  // ───────────────────────────────────────────────
  // cancelCall — 群聊容错
  // ───────────────────────────────────────────────
  handleCancelCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (currentState.type !== CALL_TYPE.VIDEO_MULTI && currentState.type !== CALL_TYPE.AUDIO_MULTI) {
      return [];
    }
    const currentStatus = currentState.status;
    const isFromCaller = message.from === currentState.callerUserId;
    if (ext.callId !== currentState.callId) {
      if (isFromCaller && (currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING)) {
        this.logger.info("[GroupCallSignalHandler] 群聊收到主叫方取消（callId 不匹配），执行挂断");
        const stateResult = this.stateMachine.receiveCancel();
        return stateResult.events;
      }
      return [];
    }
    this.logger.signal?.("recv", "cancelCall", {
      from: message.from,
      callId: ext.callId,
      type: "group"
    });
    if (isFromCaller && (currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING)) {
      this.logger.info("[GroupCallSignalHandler] 群聊收到主叫方 cancelCall，执行远程挂断");
      const stateResult = this.stateMachine.receiveCancel();
      return stateResult.events;
    }
    this.logger.debug("[GroupCallSignalHandler] 群聊 cancelCall 状态不符，忽略");
    return [];
  }
  // ───────────────────────────────────────────────
  // leaveCall — 群聊成员离开
  // ───────────────────────────────────────────────
  handleLeaveCall(message) {
    const ext = message.ext;
    if (!ext) return [];
    const currentState = this.stateMachine.getState();
    if (currentState.type !== CALL_TYPE.VIDEO_MULTI && currentState.type !== CALL_TYPE.AUDIO_MULTI) {
      return [];
    }
    const currentStatus = currentState.status;
    const isFromCaller = message.from === currentState.callerUserId;
    const fromUserId = message.from;
    if (ext.callId !== currentState.callId) {
      if (currentStatus === CALL_STATUS.IDLE) {
        this.logger.info("[GroupCallSignalHandler] 当前 IDLE，忽略 leaveCall");
        return [];
      }
      if (currentStatus === CALL_STATUS.IN_CALL) {
        this.logger.info("[GroupCallSignalHandler] 通话中对方离开，继续处理（callId 不匹配）");
      } else if (currentStatus === CALL_STATUS.ALERTING && isFromCaller) {
        this.logger.info("[GroupCallSignalHandler] ALERTING 收到主叫方 leaveCall，继续处理");
      } else {
        this.logger.warn("[GroupCallSignalHandler] leaveCall callId 不匹配且状态不符，忽略");
        return [];
      }
    }
    if ((currentStatus === CALL_STATUS.ALERTING || currentStatus === CALL_STATUS.INVITING) && isFromCaller) {
      this.logger.info(`[GroupCallSignalHandler] 被叫方收到主叫方(${fromUserId})离开，挂断通话`);
      const stateResult = this.stateMachine.receiveCancel();
      return stateResult.events;
    }
    this.logger.signal?.("recv", "leaveCall", {
      from: fromUserId,
      callId: ext.callId,
      type: "group"
    });
    this.logger.info(`[GroupCallSignalHandler] 群聊成员离开: ${fromUserId}`);
    const groupSnapshot = this.session.getSnapshot();
    const groupId = groupSnapshot?.groupId;
    this.session.setParticipantState(fromUserId, "left");
    setTimeout(() => this.session.removeParticipant(fromUserId), 2e3);
    return [
      {
        type: "PARTICIPANT_LEFT",
        callId: currentState.callId,
        userId: fromUserId,
        channel: currentState.channel,
        callType: currentState.type,
        reason: "left",
        groupId
      }
    ];
  }
}
class IMListener {
  constructor(imClient, callbacks, logger) {
    this.mounted = false;
    this.handlerId = "callkit-core-listener";
    this.imClient = imClient;
    this.callbacks = callbacks;
    this.logger = logger || getLogger();
  }
  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.imClient.addEventHandler(this.handlerId, {
      onTextMessage: async (msg) => {
        this.logger.debug("[IMListener] onTextMessage", { from: msg.from, id: msg.id });
        await this.callbacks.onTextMessage?.(msg);
      },
      onCmdMessage: async (msg) => {
        this.logger.debug("[IMListener] onCmdMessage", { from: msg.from, action: msg.action });
        await this.callbacks.onCmdMessage?.(msg);
      },
      onConnected: () => {
        this.logger.info("[IMListener] IM 已连接");
        this.callbacks.onConnected?.();
      },
      onDisconnected: () => {
        this.logger.warn("[IMListener] IM 已断开");
        this.callbacks.onDisconnected?.();
      }
    });
    this.logger.warn("🔵 [IMListener] CORE 链路 IM 监听已挂载 | handlerId:", this.handlerId);
  }
  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    this.imClient.removeEventHandler(this.handlerId);
    this.logger.info("[IMListener] 监听已卸载");
  }
  /**
   * 更新底层 IM 客户端实例（用于账号切换等场景）
   */
  updateImClient(imClient) {
    const wasMounted = this.mounted;
    if (wasMounted) {
      this.unmount();
    }
    this.imClient = imClient;
    if (wasMounted) {
      this.mount();
    }
    this.logger.info("[IMListener] IM 客户端实例已更新");
  }
}
class MessageBuilder {
  /**
   * 构建 invite 文本消息的 ext
   */
  static buildInviteExt(params) {
    const ts = params.ts ?? Date.now();
    const invitedMembers = params.invitedMembers && params.invitedMembers.length > 0 ? params.invitedMembers : void 0;
    return {
      action: "invite",
      callId: params.callId || "",
      callerIMName: params.callerUserId || "",
      calleeIMName: params.calleeUserId || "",
      callerDevId: params.callerDevId || "",
      channelName: params.channel || "",
      chatType: params.callType || CALL_TYPE.AUDIO_1V1,
      type: params.callType || CALL_TYPE.AUDIO_1V1,
      ts,
      msgType: "rtcCallWithAgora",
      invitedMembers,
      em_push_ext: {
        type: "call",
        custom: {
          action: "invite",
          channelName: params.channel || "",
          type: params.callType || CALL_TYPE.AUDIO_1V1,
          callerDevId: params.callerDevId || "",
          callId: params.callId || "",
          ts,
          msgType: "rtcCallWithAgora",
          callerIMName: params.callerUserId || "",
          calleeIMName: params.calleeUserId || "",
          // 与旧版 ChatService 对齐：无昵称时 fallback 到 callerUserId，避免 iOS/APNS 解析异常
          callerNickname: params.callerInfo?.nickname || params.callerUserId || "",
          chatType: params.callType || CALL_TYPE.AUDIO_1V1
        }
      },
      em_apns_ext: {
        em_push_type: "voip"
      },
      ease_chat_uikit_user_info: params.callerInfo ? {
        nickname: params.callerInfo.nickname || params.callerUserId || "",
        avatarURL: params.callerInfo.avatarURL || ""
      } : void 0,
      callkitGroupInfo: params.groupInfo,
      // 兼容新版 iOS EaseCallUIKit：ext 最外层携带 groupId / receiverList
      groupId: params.groupInfo?.groupId,
      receiverList: invitedMembers
    };
  }
  /**
   * 构建 CMD 信令消息的 ext
   */
  static buildCmdExt(params) {
    const ts = params.ts ?? Date.now();
    const base = { callId: params.callId || "", ts, msgType: "rtcCallWithAgora" };
    switch (params.action) {
      case "alert":
        return {
          ...base,
          action: "alert",
          calleeDevId: params.calleeDevId || "",
          callerDevId: params.callerDevId || ""
        };
      case "confirmRing":
        return {
          ...base,
          action: "confirmRing",
          status: params.status ?? false,
          callerDevId: params.callerDevId || "",
          calleeDevId: params.calleeDevId || ""
        };
      case "answerCall":
        return {
          ...base,
          action: "answerCall",
          result: params.result || "busy",
          callerDevId: params.callerDevId || "",
          calleeDevId: params.calleeDevId || ""
        };
      case "confirmCallee":
        return {
          ...base,
          action: "confirmCallee",
          result: params.result || "accept",
          callerDevId: params.callerDevId || "",
          calleeDevId: params.calleeDevId || ""
        };
      case "cancelCall":
        return {
          ...base,
          action: "cancelCall",
          callerDevId: params.callerDevId || ""
        };
      case "leaveCall":
        return {
          ...base,
          action: "leaveCall"
        };
      default:
        throw new Error(`[MessageBuilder] 未知的信令动作: ${params.action}`);
    }
  }
}
const generateRandomChannel = (length = 8) => {
  const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
};
const isMessageExpired = (messageTime, toleranceMs = 4e4) => {
  if (!messageTime || messageTime <= 0) return false;
  return Date.now() - messageTime > toleranceMs;
};
const isCmdMessageExpired = (messageTime) => {
  return isMessageExpired(messageTime, 6e4);
};
const formatCallDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};
class CallKitCore {
  constructor(config) {
    this.destroyed = false;
    this.inviteTimer = null;
    this.invitingLock = false;
    this.pendingIncomingInvites = /* @__PURE__ */ new Map();
    this.rtcAppId = "";
    this.rtcUid = 0;
    this.durationTimer = null;
    this.durationStartTime = 0;
    this.durationSeconds = 0;
    this.durationCallInfo = null;
    this.config = config;
    this.logger = config.logger || getLogger();
    this.eventBus = new EventBus(this.logger);
    this.inviteTimeoutMs = config.inviteTimeout || 3e4;
    this.singleCallState = new SingleCallStateMachine(this.logger);
    this.groupCallSession = new GroupCallSession(this.logger);
    this.signalRouter = new SignalRouter(this.logger);
    this.signalSender = new SignalSender(config.imClient, this.logger, config.createMessage);
    this.singleCallHandler = new SingleCallSignalHandler(
      this.singleCallState,
      this.signalSender,
      () => this.deviceId,
      this.logger
    );
    this.groupCallHandler = new GroupCallSignalHandler(
      this.groupCallSession,
      this.singleCallState,
      this.signalSender,
      () => this.userId,
      this.logger
    );
    this.signalRouter.register("alert", this.singleCallHandler);
    this.signalRouter.register("confirmRing", this.singleCallHandler);
    this.signalRouter.register("answerCall", this.singleCallHandler);
    this.signalRouter.register("cancelCall", this.singleCallHandler);
    this.signalRouter.register("leaveCall", this.singleCallHandler);
    this.signalRouter.register("confirmCallee", this.singleCallHandler);
    this.signalRouter.register("answerCall", this.groupCallHandler);
    this.signalRouter.register("cancelCall", this.groupCallHandler);
    this.signalRouter.register("leaveCall", this.groupCallHandler);
    this.imListener = new IMListener(
      config.imClient,
      {
        onTextMessage: (msg) => this.handleTextMessage(msg),
        onCmdMessage: (msg) => this.handleCmdMessage(msg),
        onConnected: () => this.handleIMConnected(),
        onDisconnected: () => this.handleIMDisconnected()
      },
      this.logger
    );
    this.imListener.mount();
    this.logger.info("[CallKitCore] 初始化完成（userId/deviceId 将在登录后实时读取）");
    this.logger.warn("🚀 ========== CallKitCore 链路已激活 ========== 🚀");
    this.logger.warn("   版本: callkit-core | 当前用户:", this.userId || "(尚未登录)", "| 设备:", this.deviceId || "(尚未登录)");
  }
  get userId() {
    return this.config.imClient.context?.userId || this.config.imClient.user || "";
  }
  get deviceId() {
    return this.config.imClient.context?.jid?.clientResource || "";
  }
  /**
   * 更新底层 IM 客户端实例（用于账号切换等场景）。
   * 会同步更新 SignalSender、IMListener 以及内部 config，不丢失当前通话状态。
   */
  updateImClient(imClient) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    if (!imClient) throw new Error("updateImClient 需要有效的 IM 客户端实例");
    this.config.imClient = imClient;
    this.signalSender.updateImClient(imClient);
    this.imListener.updateImClient(imClient);
    this.logger.info("[CallKitCore] IM 客户端实例已更新");
    this.logger.warn("🚀 ========== CallKitCore 链路已更新 ========== 🚀");
    this.logger.warn("   版本: callkit-core | 当前用户:", this.userId || "(尚未登录)", "| 设备:", this.deviceId || "(尚未登录)");
  }
  // ───────────────────────────────────────────────
  // 单聊 API
  // ───────────────────────────────────────────────
  /**
   * 发起单聊通话
   */
  async inviteCall(params) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    if (!this.isIdle()) throw new Error("当前正在通话中，无法发起新通话");
    if (this.invitingLock) throw new Error("正在发起通话中，请勿重复点击");
    this.invitingLock = true;
    try {
      const callId = generateRandomChannel(16);
      const channel = generateRandomChannel(12);
      const token = await this.fetchRtcToken(channel);
      const stateResult = this.singleCallState.initInvite({
        calleeUserId: params.calleeUserId,
        callType: params.callType,
        callerDevId: this.deviceId,
        callerUserId: this.userId,
        callId,
        channel,
        token,
        timeout: this.inviteTimeoutMs
      });
      this.startInviteTimeout();
      const callerInfo = {
        ...this.config.userProfile,
        ...params.callerInfo
      };
      const ext = MessageBuilder.buildInviteExt({
        callId,
        callerUserId: this.userId,
        calleeUserId: params.calleeUserId,
        callerDevId: this.deviceId,
        channel,
        callType: params.callType,
        callerInfo
      });
      await this.signalSender.sendInviteMessage(
        params.calleeUserId,
        "singleChat",
        "[通话邀请]",
        ext
      );
      this.processEvents(stateResult.events, this.singleCallState.getState());
    } finally {
      this.invitingLock = false;
    }
  }
  /**
   * 响应来电（接受/拒绝）
   */
  async answerCall(params) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    const state = this.singleCallState.getState();
    const result = params.result ?? (params.accept ? "accept" : "refuse");
    const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI;
    const ext = MessageBuilder.buildCmdExt({
      action: "answerCall",
      callId: state.callId,
      callerDevId: state.callerDevId,
      calleeDevId: this.deviceId,
      result
    });
    await this.signalSender.sendCmdMessage(
      state.callerUserId,
      "singleChat",
      ext,
      { deliverOnlineOnly: true }
    );
    if (result === "accept") {
      if (isGroupCall) {
        this.logger.info("[CallKitCore] 群聊接受，等待 confirmCallee 后再进入 IN_CALL");
        this.clearInviteTimeout();
      } else {
        this.logger.info("[CallKitCore] 单聊接受，等待 confirmCallee");
      }
    } else {
      const hangupReason = result === "busy" ? HANGUP_REASON.BUSY : HANGUP_REASON.REFUSE;
      const hangupResult = this.singleCallState.hangup(hangupReason);
      this.processEvents(hangupResult.events, state);
    }
  }
  /**
   * 挂断/取消通话
   */
  async hangup(params) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    const state = this.singleCallState.getState();
    const currentStatus = state.status;
    if (currentStatus === CALL_STATUS.IDLE) {
      this.logger.warn("[CallKitCore] hangup: 当前 IDLE，忽略");
      return;
    }
    const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI;
    if (currentStatus === CALL_STATUS.INVITING || currentStatus === CALL_STATUS.ALERTING) {
      this.clearInviteTimeout();
      const ext = MessageBuilder.buildCmdExt({
        action: "cancelCall",
        callId: state.callId,
        callerDevId: state.callerDevId
      });
      if (isGroupCall) {
        const groupSnapshot = this.groupCallSession.getSnapshot();
        const groupId = groupSnapshot?.groupId || state.calleeUserId;
        const allParticipants = this.groupCallSession.getAllParticipants();
        const receiverList = allParticipants.filter((p) => p.userId !== this.userId && p.state === "invited").map((p) => p.userId);
        this.logger.warn(
          "[CallKitCore] 群聊取消: participants=",
          allParticipants.map((p) => ({ userId: p.userId, state: p.state })),
          "| receiverList=",
          receiverList
        );
        if (groupId && receiverList.length > 0) {
          this.logger.warn("[CallKitCore] 群聊取消: 发送 cancelCall 到", groupId, "receiverList:", receiverList);
          await this.signalSender.sendCmdMessage(groupId, "groupChat", ext, { receiverList }).catch((err) => {
            this.logger.error("[CallKitCore] 群聊取消: 发送 cancelCall 失败", err);
          });
        } else {
          this.logger.warn("[CallKitCore] 群聊取消: 无接收者，跳过发送 cancelCall");
        }
      } else {
        const targetId = state.callerUserId === this.userId ? state.calleeUserId : state.callerUserId;
        await this.signalSender.sendCmdMessage(targetId, "singleChat", ext).catch((err) => {
          this.logger.error("[CallKitCore] 发送 cancelCall 失败（单聊）", { targetId, callId: state.callId, error: err });
        });
      }
    } else if (currentStatus === CALL_STATUS.IN_CALL) {
      this.clearInviteTimeout();
      const ext = MessageBuilder.buildCmdExt({
        action: "leaveCall",
        callId: state.callId
      });
      if (isGroupCall) {
        const groupSnapshot = this.groupCallSession.getSnapshot();
        const groupId = groupSnapshot?.groupId || state.calleeUserId;
        const receiverList = this.groupCallSession.getAllParticipants().filter((p) => p.userId !== this.userId && p.state !== "left").map((p) => p.userId);
        if (groupId && receiverList.length > 0) {
          await this.signalSender.sendCmdMessage(groupId, "groupChat", ext, { receiverList }).catch((err) => {
            this.logger.error("[CallKitCore] 发送 leaveCall 失败（群聊）", { groupId, callId: state.callId, error: err });
          });
        }
      } else {
        const targetId = state.callerUserId === this.userId ? state.calleeUserId : state.callerUserId;
        await this.signalSender.sendCmdMessage(targetId, "singleChat", ext).catch((err) => {
          this.logger.error("[CallKitCore] 发送 leaveCall 失败（单聊）", { targetId, callId: state.callId, error: err });
        });
      }
    }
    const reason = params?.reason === "cancel" ? HANGUP_REASON.CANCEL : params?.reason === "timeout" ? HANGUP_REASON.NO_RESPONSE : HANGUP_REASON.HANGUP;
    const hangupResult = this.singleCallState.hangup(reason);
    this.clearInviteTimeout();
    this.processEvents(hangupResult.events, state);
  }
  // ───────────────────────────────────────────────
  // 群聊 API
  // ───────────────────────────────────────────────
  /**
   * 通话中邀请更多成员加入群聊通话
   */
  async inviteMoreParticipants(participantIds) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    const state = this.singleCallState.getState();
    if (state.status !== CALL_STATUS.IN_CALL && state.status !== CALL_STATUS.INVITING) {
      this.logger.warn("[CallKitCore] inviteMoreParticipants: 当前不在通话中，忽略");
      return;
    }
    const isGroupCall = state.type === CALL_TYPE.VIDEO_MULTI || state.type === CALL_TYPE.AUDIO_MULTI;
    if (!isGroupCall) {
      this.logger.warn("[CallKitCore] inviteMoreParticipants: 当前不是群聊通话，忽略");
      return;
    }
    const groupSnapshot = this.groupCallSession.getSnapshot();
    const groupId = groupSnapshot?.groupId;
    if (!groupId) {
      this.logger.warn("[CallKitCore] inviteMoreParticipants: 群聊会话未初始化");
      return;
    }
    const ext = MessageBuilder.buildInviteExt({
      callId: state.callId,
      callerUserId: this.userId,
      calleeUserId: groupId,
      callerDevId: this.deviceId,
      channel: state.channel,
      callType: state.type,
      invitedMembers: participantIds,
      groupInfo: { groupId, groupName: groupSnapshot?.groupName || groupId },
      callerInfo: this.config.userProfile
    });
    try {
      await this.signalSender.sendInviteMessage(
        participantIds,
        "groupChat",
        "[群通话邀请]",
        ext,
        groupId
      );
    } catch (err) {
      this.emitError("inviteMoreParticipantsFailed", err, { callId: state.callId, participantIds });
      this.logger.error("[CallKitCore] 发送追加邀请失败", err);
      throw err;
    }
    participantIds.forEach((userId) => {
      if (!this.groupCallSession.getParticipant(userId)) {
        this.groupCallSession.addParticipant({
          userId,
          nickname: userId,
          avatarUrl: "",
          state: "invited",
          isLocal: false,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false
        });
      }
    });
    this.logger.info("[CallKitCore] 已发送追加邀请", { groupId, participantIds });
  }
  /**
   * 发起群聊通话
   */
  async inviteGroupCall(params) {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    if (!this.isIdle()) throw new Error("当前正在通话中，无法发起新通话");
    if (this.invitingLock) throw new Error("正在发起通话中，请勿重复点击");
    this.invitingLock = true;
    try {
      const callId = generateRandomChannel(16);
      const channel = generateRandomChannel(12);
      const callTypeStr = params.callType === CALL_TYPE.VIDEO_MULTI ? "video" : "audio";
      const token = await this.fetchRtcToken(channel);
      const groupName = params.ext?.groupName || params.groupId;
      const groupAvatar = params.ext?.groupAvatar;
      this.groupCallSession.init({
        sessionId: channel,
        groupId: params.groupId,
        groupName,
        callType: callTypeStr,
        callerUserId: this.userId
      });
      this.groupCallSession.addParticipant({
        userId: this.userId,
        nickname: this.userId,
        avatarUrl: "",
        state: "joinedRtc",
        isLocal: true,
        isMuted: false,
        isCameraOn: callTypeStr === "video",
        isSpeaking: false
      });
      params.participantIds.forEach((userId) => {
        this.groupCallSession.addParticipant({
          userId,
          nickname: userId,
          avatarUrl: "",
          state: "invited",
          isLocal: false,
          isMuted: false,
          isCameraOn: false,
          isSpeaking: false
        });
      });
      this.processEvents(
        [
          {
            type: "GROUP_CALL_INIT",
            callId,
            groupId: params.groupId,
            groupName,
            channel,
            callType: callTypeStr,
            callerUserId: this.userId,
            invitedMembers: params.participantIds
          }
        ],
        this.singleCallState.getState()
      );
      const stateResult = this.singleCallState.initInvite({
        calleeUserId: params.groupId,
        callType: params.callType,
        callerDevId: this.deviceId,
        callerUserId: this.userId,
        callId,
        channel,
        token,
        timeout: this.inviteTimeoutMs
      });
      const callerInfo = {
        ...this.config.userProfile,
        ...params.callerInfo
      };
      const ext = MessageBuilder.buildInviteExt({
        callId,
        callerUserId: this.userId,
        calleeUserId: params.groupId,
        callerDevId: this.deviceId,
        channel,
        callType: params.callType,
        invitedMembers: params.participantIds,
        groupInfo: { groupId: params.groupId, groupName, groupAvatar },
        callerInfo
      });
      const inviteMessage = params.ext?.message || "[群通话邀请]";
      await this.signalSender.sendInviteMessage(
        params.participantIds,
        "groupChat",
        inviteMessage,
        ext,
        params.groupId
      );
      this.processEvents(stateResult.events, this.singleCallState.getState());
      this.logger.info("[CallKitCore] 群聊主叫方：进入 IN_CALL 并触发 RTC 加入");
      const answerResult = this.singleCallState.receiveAnswer("accept", false);
      if (answerResult.ok) {
        this.processEvents(answerResult.events, this.singleCallState.getState());
      }
    } finally {
      this.invitingLock = false;
    }
  }
  // ───────────────────────────────────────────────
  // 媒体控制
  // ───────────────────────────────────────────────
  /**
   * 切换本地音频（静音/取消静音）
   */
  toggleAudio() {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    const stateResult = this.singleCallState.toggleAudio();
    this.processEvents(stateResult.events, this.singleCallState.getState());
  }
  /**
   * 切换本地视频（开启/关闭摄像头）
   */
  toggleVideo() {
    if (this.destroyed) throw new Error("CallKitCore 已销毁");
    const stateResult = this.singleCallState.toggleVideo();
    this.processEvents(stateResult.events, this.singleCallState.getState());
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
  async fetchRtcToken(channel) {
    try {
      const tokenRes = await this.config.imClient.getRTCToken(channel);
      const data = tokenRes?.data ?? tokenRes ?? {};
      const token = data.RTCToken ?? data.accessToken ?? tokenRes?.accessToken ?? "";
      const appId = data.appId ?? tokenRes?.appId ?? "";
      const rtcUid = Number(data.RTCUId ?? data.rtcUid ?? 0) || 0;
      if (appId) this.rtcAppId = appId;
      if (rtcUid) this.rtcUid = rtcUid;
      if (!token) {
        this.logger.warn("[CallKitCore] getRTCToken 返回 token 为空", { tokenRes });
      } else {
        this.logger.info("[CallKitCore] 获取 RTC token 成功", {
          channel,
          appId: this.rtcAppId,
          rtcUid: this.rtcUid,
          hasToken: !!token
        });
      }
      return token;
    } catch (err) {
      this.emitError("rtcTokenFetchFailed", err, { channel });
      this.logger.warn("[CallKitCore] 获取 RTC token 失败，使用空 token", err);
      return "";
    }
  }
  /**
   * 上层调用 RTC SDK 后，通过此方法反馈 RTC 事件给核心库
   */
  reportRtcEvent(report) {
    this.logger.info("[CallKitCore] reportRtcEvent", report);
    const { type, payload } = report;
    if (payload.userId) {
      switch (type) {
        case "userJoined":
        case "userPublished":
          this.groupCallSession.markJoinedRtc(payload.userId);
          break;
        case "userLeft":
        case "userUnpublished":
          this.groupCallSession.markLeftRtc(payload.userId);
          break;
        case "userAudioMuted":
          this.groupCallSession.markAudioMuted(payload.userId, true);
          break;
        case "userAudioUnmuted":
          this.groupCallSession.markAudioMuted(payload.userId, false);
          break;
        case "userVideoMuted":
          this.groupCallSession.markVideoOn(payload.userId, false);
          break;
        case "userVideoUnmuted":
          this.groupCallSession.markVideoOn(payload.userId, true);
          break;
      }
    }
    if (type === "networkQuality" || type === "speaking" || type === "stoppedSpeaking" || type === "error") {
      const rtcEvent = {
        type: "rtcReport",
        payload: { type: report.type, payload: report.payload }
      };
      this.emitEvent(rtcEvent);
    }
  }
  // ───────────────────────────────────────────────
  // 状态查询
  // ───────────────────────────────────────────────
  getSingleCallState() {
    return this.singleCallState.getState();
  }
  getGroupCallSession() {
    return this.groupCallSession.getSnapshot();
  }
  /**
   * 获取群聊通话的所有参与者（包含状态信息）
   */
  getGroupCallParticipants() {
    return this.groupCallSession.getAllParticipants();
  }
  /**
   * 当前是否在通话中（IN_CALL 状态）
   */
  isInCall() {
    return this.singleCallState.isInCall();
  }
  /**
   * 当前是否处于可被接听的状态（被叫端弹窗显示区间）
   */
  isWaitingCalleeAction() {
    return this.singleCallState.isWaitingCalleeAction();
  }
  /**
   * 当前是否处于活跃通话中（已进入 RTC 或即将进入）
   */
  isInActiveCall() {
    return this.singleCallState.isInActiveCall();
  }
  /**
   * 当前是否可以接听（被叫端按钮可点击）
   */
  canAccept() {
    return this.singleCallState.canAccept();
  }
  /**
   * 当前是否可以拒绝（被叫端按钮可点击）
   */
  canReject() {
    return this.singleCallState.canReject();
  }
  /**
   * 当前是否可以挂断（主叫/被叫端的挂断按钮可点击）
   */
  canHangup() {
    return this.singleCallState.canHangup();
  }
  /**
   * 当前是否在呼叫/响铃中（INVITING 或 ALERTING 状态）
   */
  isCalling() {
    return this.singleCallState.isCalling();
  }
  /**
   * 获取当前通话类型，无通话时返回 null
   */
  getCurrentCallType() {
    const state = this.singleCallState.getState();
    return state.status === CALL_STATUS.IDLE ? null : state.type;
  }
  /**
   * 获取当前通话 ID，无通话时返回空字符串
   */
  getCurrentCallId() {
    return this.singleCallState.getState().callId || "";
  }
  /**
   * 当前是否空闲
   */
  isIdle() {
    return this.singleCallState.isIdle();
  }
  // ───────────────────────────────────────────────
  // 事件订阅（供上层精细控制）
  // ───────────────────────────────────────────────
  /**
   * 订阅通话事件
   * @returns 取消订阅函数
   */
  onEvent(handler) {
    return this.eventBus.on("callKitEvent", handler);
  }
  /**
   * 订阅单次通话事件
   */
  onceEvent(handler) {
    return this.eventBus.once("callKitEvent", handler);
  }
  // ───────────────────────────────────────────────
  // 生命周期
  // ───────────────────────────────────────────────
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearInviteTimeout();
    this.stopDurationTimer();
    this.imListener.unmount();
    this.eventBus.clear();
    this.singleCallState.reset();
    this.groupCallSession.destroy();
    this.logger.info("[CallKitCore] 已销毁");
  }
  // ───────────────────────────────────────────────
  // 内部：消息处理
  // ───────────────────────────────────────────────
  isSelfMessage(msg) {
    return msg.from === this.userId;
  }
  async handleTextMessage(msg) {
    const rawExt = msg.ext;
    const bodyExt = msg.body?.ext;
    const ext = rawExt || bodyExt;
    this.logger.warn("✉️ [CallKitCore] handleTextMessage 被调用", {
      from: msg.from,
      to: msg.to,
      msgType: msg.type,
      chatType: msg.chatType,
      hasRawExt: !!rawExt,
      hasBodyExt: !!bodyExt,
      extAction: ext?.action,
      extCallId: ext?.callId,
      self: this.isSelfMessage(msg)
    });
    if (this.isSelfMessage(msg)) {
      this.logger.warn("[CallKitCore] ❌ 忽略自己发送的文本消息");
      return;
    }
    if (!ext || ext.action !== "invite") {
      this.logger.warn("[CallKitCore] ❌ 忽略非 invite 文本消息 | ext.action=", ext?.action);
      return;
    }
    const isGroupCall = ext.chatType === CALL_TYPE.VIDEO_MULTI || ext.chatType === CALL_TYPE.AUDIO_MULTI || ext.callkitGroupInfo?.groupId;
    const currentStatus = this.singleCallState.getState().status;
    if (currentStatus > CALL_STATUS.IDLE) {
      this.logger.warn("[CallKitCore] ❌ 当前已在通话中，发送忙线拒绝 | currentStatus=", currentStatus);
      const busyExt = MessageBuilder.buildCmdExt({
        action: "answerCall",
        callId: ext.callId,
        callerDevId: ext.callerDevId,
        calleeDevId: this.deviceId,
        result: "busy"
      });
      this.signalSender.sendCmdMessage(msg.from, "singleChat", busyExt, {
        deliverOnlineOnly: true
      }).catch(() => {
      });
      return;
    }
    if (!isGroupCall) {
      if (msg.to && msg.to !== this.userId) {
        this.logger.warn("[CallKitCore] ❌ 单聊 invite 接收者不是当前用户 | msg.to=", msg.to);
        return;
      }
      if (ext.calleeDevId && ext.calleeDevId !== this.deviceId) {
        this.logger.warn("[CallKitCore] ❌ 单聊 invite calleeDevId 不匹配 | ext=", ext.calleeDevId, "| my=", this.deviceId);
        return;
      }
    } else {
      const invitedMembers = ext.invitedMembers || [];
      if (invitedMembers.length > 0 && !invitedMembers.includes(this.userId)) {
        this.logger.warn("[CallKitCore] ❌ 群聊 invite 当前用户不在被邀请列表中");
        return;
      }
    }
    const msgTime = msg.time || ext.ts;
    if (msgTime && isMessageExpired(msgTime, this.inviteTimeoutMs + 1e4)) {
      this.logger.warn("[CallKitCore] ❌ invite 消息已过期 | msgTime=", msgTime);
      return;
    }
    this.logger.warn(
      isGroupCall ? "✉️ [CallKitCore] ✅ 【群聊】确认收到 invite 文本消息 → 进入群聊处理分支" : "✉️ [CallKitCore] ✅ 【单聊】确认收到 invite 文本消息 → 进入单聊处理分支",
      { from: msg.from, callId: ext.callId, channel: ext.channelName, type: ext.type }
    );
    if (isGroupCall) {
      await this.handleGroupCallInvite(msg, ext).catch((err) => {
        this.emitError("groupCallInviteHandlingFailed", err, { messageId: msg.id });
        this.logger.error("[CallKitCore] 群聊 invite 处理失败", err);
      });
    } else {
      await this.handleSingleCallInvite(msg, ext);
    }
  }
  async handleGroupCallInvite(msg, ext) {
    const callId = ext.callId;
    const channel = ext.channelName;
    const callType = ext.type;
    const callerDevId = ext.callerDevId;
    const callerUserId = ext.callerIMName || msg.from || "";
    this.pendingIncomingInvites.set(callId, { aborted: false });
    const token = await this.fetchRtcToken(channel);
    const pending = this.pendingIncomingInvites.get(callId);
    this.pendingIncomingInvites.delete(callId);
    if (pending?.aborted) {
      this.logger.warn("[CallKitCore] 群聊 invite 在获取 token 期间已被取消/离开，跳过初始化");
      return;
    }
    if (this.singleCallState.getState().status === CALL_STATUS.IDLE) {
      this.logger.warn("🔄 [CallKitCore] 群聊被叫方：singleCallState 从 IDLE → ALERTING");
      const groupId = ext?.callkitGroupInfo?.groupId || ext?.groupId || "";
      const stateResult = this.singleCallState.initIncoming({
        callId,
        channel,
        token,
        callType,
        callerDevId,
        callerUserId,
        calleeDevId: this.deviceId,
        calleeUserId: groupId
        // 群聊时 calleeUserId 使用 groupId，与旧版对齐
      });
      this.logger.warn("[CallKitCore] initIncoming 返回事件数:", stateResult.events.length);
      this.processEvents(stateResult.events, this.singleCallState.getState());
      this.startInviteTimeout();
    } else {
      this.logger.warn(
        "[CallKitCore] ⚠️ 群聊被叫方：singleCallState 不是 IDLE，跳过 initIncoming | 当前状态=",
        this.singleCallState.getState().status
      );
    }
    const events = this.groupCallHandler.handleInviteTextMessage(msg);
    this.logger.warn("[CallKitCore] 群聊 invite 处理后事件:", events.map((e) => e.type));
    this.processEvents(events, this.singleCallState.getState());
    const incomingEvent = {
      type: "incomingCall",
      payload: {
        callId,
        callType,
        callerUserId,
        callerDevId,
        channel,
        calleeUserId: ext?.callkitGroupInfo?.groupId || ext?.groupId || "",
        token: "",
        callerInfo: ext.ease_chat_uikit_user_info,
        groupId: ext?.callkitGroupInfo?.groupId || ext?.groupId,
        groupName: ext?.callkitGroupInfo?.groupName
      }
    };
    this.logger.warn("[CallKitCore] 即将发出 incomingCall 事件:", { callId, callerUserId, callType });
    this.emitEvent(incomingEvent);
    this.logger.warn("[CallKitCore] incomingCall 事件已发出");
    this.sendAlertSignal(msg.from, ext.callId, ext.callerDevId);
  }
  async handleSingleCallInvite(msg, ext) {
    const callId = ext.callId;
    const channel = ext.channelName;
    const callType = ext.type;
    const callerDevId = ext.callerDevId;
    const callerUserId = ext.callerIMName || msg.from || "";
    const calleeUserId = ext.calleeIMName || msg.to || "";
    this.logger.debug("[CallKitCore] handleSingleCallInvite", {
      from: msg.from,
      callerIMName: ext.callerIMName,
      calleeIMName: ext.calleeIMName,
      resolvedCallerId: callerUserId,
      resolvedCalleeId: calleeUserId
    });
    const token = await this.fetchRtcToken(channel);
    const stateResult = this.singleCallState.initIncoming({
      callId,
      channel,
      token,
      callType,
      callerDevId,
      callerUserId,
      calleeDevId: this.deviceId,
      calleeUserId
    });
    this.startInviteTimeout();
    const incomingEvent = {
      type: "incomingCall",
      payload: {
        callId,
        callType,
        callerUserId,
        callerDevId,
        channel,
        calleeUserId,
        token,
        callerInfo: ext.ease_chat_uikit_user_info
      }
    };
    this.emitEvent(incomingEvent);
    this.processEvents(stateResult.events, this.singleCallState.getState());
    this.sendAlertSignal(msg.from, callId, callerDevId);
  }
  /**
   * 发送 alert CMD 信令给主叫方
   */
  sendAlertSignal(to, callId, callerDevId) {
    const alertExt = MessageBuilder.buildCmdExt({
      action: "alert",
      callId,
      callerDevId,
      calleeDevId: this.deviceId
    });
    this.signalSender.sendCmdMessage(to, "singleChat", alertExt, { deliverOnlineOnly: true }).catch(() => {
    });
  }
  handleCmdMessage(msg) {
    this.logger.warn("📨 [CallKitCore] handleCmdMessage 被调用", {
      from: msg.from,
      to: msg.to,
      action: msg.action,
      extAction: msg.ext?.action,
      callId: msg.ext?.callId,
      self: this.isSelfMessage(msg)
    });
    if (this.isSelfMessage(msg)) {
      this.logger.warn("[CallKitCore] ❌ 忽略自己发送的 CMD 消息");
      return;
    }
    if (msg.action !== "rtcCall") {
      this.logger.warn("[CallKitCore] ❌ 忽略非 rtcCall CMD 消息 | action=", msg.action);
      return;
    }
    const cmdTime = msg.time || msg.ext?.ts;
    if (cmdTime && isCmdMessageExpired(cmdTime)) {
      this.logger.warn("[CallKitCore] ❌ CMD 消息已过期 | cmdTime=", cmdTime);
      return;
    }
    const extAction = msg.ext?.action;
    const extCallId = msg.ext?.callId;
    if (extCallId && (extAction === "cancelCall" || extAction === "leaveCall") && this.pendingIncomingInvites.has(extCallId)) {
      this.logger.warn("[CallKitCore] 待处理 invite 收到取消/离开信令，标记为 aborted", {
        callId: extCallId,
        action: extAction
      });
      this.pendingIncomingInvites.get(extCallId).aborted = true;
      return;
    }
    const events = this.signalRouter.dispatch(msg);
    if (events.length > 0) {
      this.logger.warn("📨 [CallKitCore] ✅ CMD 消息处理后产生事件:", events.map((e) => e.type));
      this.processEvents(events, this.singleCallState.getState());
    } else {
      this.logger.warn("📨 [CallKitCore] ⚠️ CMD 消息未产生任何事件（可能被忽略或 handler 返回空）");
    }
  }
  // ───────────────────────────────────────────────
  // 内部：事件处理与映射
  // ───────────────────────────────────────────────
  processEvents(events, snapshot) {
    events.forEach((event) => {
      const callKitEvents = this.mapDomainEvents(event, snapshot);
      callKitEvents.forEach((callKitEvent) => {
        this.emitEvent(callKitEvent);
        this.handleRtcEvent(callKitEvent);
        if (callKitEvent.type === "callStarted" || callKitEvent.type === "callConnected") {
          this.startDurationTimer(
            callKitEvent.payload.callId,
            callKitEvent.payload.channel,
            callKitEvent.payload.callType,
            callKitEvent.payload.callerUserId
          );
        }
        if (callKitEvent.type === "callEnded") {
          this.stopDurationTimer();
        }
      });
    });
  }
  /**
   * 当配置了 rtcAdapter 时，自动处理 RTC 相关事件
   */
  handleRtcEvent(event) {
    const adapter = this.config.rtcAdapter;
    if (!adapter) return;
    switch (event.type) {
      case "shouldJoinRtc": {
        const p = event.payload;
        adapter.joinChannel({
          channel: p.channel,
          token: p.token,
          uid: p.uid,
          appId: p.appId
        }).catch((e) => {
          this.emitError("rtcJoinChannelFailed", e, { channel: p.channel, uid: p.uid });
          this.logger.error("[CallKitCore] rtcAdapter.joinChannel 失败:", e);
        });
        break;
      }
      case "shouldLeaveRtc": {
        adapter.leaveChannel().catch((e) => {
          this.emitError("rtcLeaveChannelFailed", e, { channel: event.payload.channel });
        });
        break;
      }
      case "shouldPublishTracks": {
        const p = event.payload;
        adapter.publishLocalTracks(p.trackTypes).catch((e) => {
          this.emitError("rtcPublishTracksFailed", e, { channel: p.channel, trackTypes: p.trackTypes });
          this.logger.error("[CallKitCore] rtcAdapter.publishLocalTracks 失败:", e);
        });
        break;
      }
      case "localAudioChanged": {
        adapter.setAudioEnabled(event.payload.enabled).catch((e) => {
          this.emitError("rtcSetAudioEnabledFailed", e, { enabled: event.payload.enabled });
          this.logger.error("[CallKitCore] rtcAdapter.setAudioEnabled 失败:", e);
        });
        break;
      }
      case "localVideoChanged": {
        adapter.setVideoEnabled(event.payload.enabled).catch((e) => {
          this.emitError("rtcSetVideoEnabledFailed", e, { enabled: event.payload.enabled });
          this.logger.error("[CallKitCore] rtcAdapter.setVideoEnabled 失败:", e);
        });
        break;
      }
    }
  }
  mapDomainEvents(event, snapshot) {
    const base = {
      callId: event.callId,
      channel: snapshot.channel,
      callType: snapshot.type,
      callerUserId: snapshot.callerUserId,
      calleeUserId: snapshot.calleeUserId
    };
    const isGroupCall = snapshot.type === CALL_TYPE.VIDEO_MULTI || snapshot.type === CALL_TYPE.AUDIO_MULTI;
    switch (event.type) {
      case "STATUS_CHANGED": {
        return [
          {
            type: "statusChanged",
            payload: {
              ...base,
              from: String(event.from),
              to: String(event.to)
            }
          }
        ];
      }
      case "CALL_INVITED": {
        const common = { ...base, isCaller: event.isCaller };
        return [
          { type: "callInvited", payload: common },
          { type: isGroupCall ? "groupCallInvited" : "singleCallInvited", payload: common }
        ];
      }
      case "CALL_STARTED": {
        const common = {
          ...base,
          isCaller: event.isCaller,
          startTime: Date.now()
        };
        return [
          { type: "callStarted", payload: common },
          { type: isGroupCall ? "groupCallStarted" : "singleCallStarted", payload: common }
        ];
      }
      case "CALL_ACCEPTED": {
        const common = { ...base, isCaller: event.isCaller };
        return [
          { type: "callAccepted", payload: common },
          { type: isGroupCall ? "groupCallAccepted" : "singleCallAccepted", payload: common }
        ];
      }
      case "CALL_CONNECTED": {
        return [
          { type: "callConnected", payload: base },
          { type: isGroupCall ? "groupCallConnected" : "singleCallConnected", payload: base }
        ];
      }
      case "CALL_ENDED": {
        const common = {
          ...base,
          reason: event.reason,
          duration: event.duration
        };
        return [
          { type: "callEnded", payload: common },
          { type: isGroupCall ? "groupCallEnded" : "singleCallEnded", payload: common }
        ];
      }
      case "CALL_TIMEOUT": {
        return [
          { type: "callTimeout", payload: base },
          { type: isGroupCall ? "groupCallTimeout" : "singleCallTimeout", payload: base }
        ];
      }
      case "CALL_REFUSED": {
        const common = { ...base, isRemote: event.isRemote };
        return [
          { type: "callRefused", payload: common },
          { type: isGroupCall ? "groupCallRefused" : "singleCallRefused", payload: common }
        ];
      }
      case "CALL_BUSY": {
        return [
          { type: "callBusy", payload: base },
          { type: isGroupCall ? "groupCallBusy" : "singleCallBusy", payload: base }
        ];
      }
      case "CALL_CANCELED": {
        const common = { ...base, isRemote: event.isRemote };
        return [
          { type: "callCanceled", payload: common },
          { type: isGroupCall ? "groupCallCanceled" : "singleCallCanceled", payload: common }
        ];
      }
      case "SHOULD_JOIN_RTC": {
        return [
          {
            type: "shouldJoinRtc",
            payload: {
              ...base,
              token: event.token,
              // Agora 加入频道必须使用服务端返回的 RTCUId（数值型），
              // 无法获取时兑底为 IM userId（与旧版付费智能兑底逻辑一致）
              uid: this.rtcUid || this.userId,
              appId: this.rtcAppId || void 0,
              role: event.role
            }
          }
        ];
      }
      case "GROUP_CALL_INIT": {
        return [
          {
            type: "groupCallInit",
            payload: {
              callId: event.callId,
              groupId: event.groupId,
              groupName: event.groupName,
              channel: event.channel,
              callType: event.callType,
              callerUserId: event.callerUserId,
              invitedMembers: event.invitedMembers
            }
          }
        ];
      }
      case "PARTICIPANT_STATE_CHANGED": {
        return [
          {
            type: "participantStateChanged",
            payload: {
              callId: event.callId,
              userId: event.userId,
              state: event.state,
              groupId: event.groupId
            }
          }
        ];
      }
      case "PARTICIPANT_JOINED": {
        return [
          {
            type: "participantJoined",
            payload: {
              ...base,
              userId: event.userId,
              groupId: event.groupId
            }
          }
        ];
      }
      case "PARTICIPANT_LEFT": {
        return [
          {
            type: "participantLeft",
            payload: {
              ...base,
              userId: event.userId,
              reason: event.reason,
              groupId: event.groupId
            }
          }
        ];
      }
      case "LOCAL_AUDIO_CHANGED": {
        return [{ type: "localAudioChanged", payload: { enabled: event.enabled } }];
      }
      case "LOCAL_VIDEO_CHANGED": {
        return [{ type: "localVideoChanged", payload: { enabled: event.enabled } }];
      }
      default:
        return [];
    }
  }
  emitEvent(event) {
    this.logger.debug("[CallKitCore] emitEvent:", event.type, "| onEvent存在=", !!this.config.onEvent, "| onUIEvent存在=", !!this.config.onUIEvent);
    const hasEventBusListeners = this.eventBus.listenerCount("callKitEvent") > 0;
    const hasLegacyOnEvent = !!this.config.onEvent;
    if (hasEventBusListeners && hasLegacyOnEvent) {
      this.logger.warn(
        "[CallKitCore] 同时使用了 config.onEvent 和 core.onEvent() 订阅，事件可能重复触发。建议只使用其中一种订阅方式。"
      );
    }
    this.eventBus.emit("callKitEvent", event);
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event);
        this.logger.debug("[CallKitCore] onEvent 回调执行成功:", event.type);
      } catch (err) {
        this.logger.error("[CallKitCore] onEvent 回调执行失败:", err);
      }
    }
    if (isUIEvent(event) && this.config.onUIEvent) {
      try {
        this.config.onUIEvent(event);
        this.logger.debug("[CallKitCore] onUIEvent 回调执行成功:", event.type);
      } catch (err) {
        this.logger.error("[CallKitCore] onUIEvent 回调执行失败:", err);
      }
    }
    if (isRtcEvent(event) && this.config.onRtcEvent) {
      try {
        this.config.onRtcEvent(event);
      } catch (err) {
        this.logger.error("[CallKitCore] onRtcEvent 回调执行失败:", err);
      }
    }
  }
  emitError(type, error, context) {
    const errMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`[CallKitCore] ${type}:`, error);
    this.emitEvent({
      type: "callError",
      payload: {
        type,
        error: errMsg,
        callId: context?.callId,
        context
      }
    });
  }
  startDurationTimer(callId, channel, callType, callerUserId) {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
    }
    this.durationStartTime = Date.now();
    this.durationSeconds = 0;
    this.durationCallInfo = { callId, channel, callType, callerUserId };
    this.durationTimer = setInterval(() => {
      if (!this.durationCallInfo) return;
      this.durationSeconds++;
      const duration = this.durationSeconds * 1e3;
      this.emitEvent({
        type: "callDurationUpdated",
        payload: {
          callId: this.durationCallInfo.callId,
          channel: this.durationCallInfo.channel,
          callType: this.durationCallInfo.callType,
          callerUserId: this.durationCallInfo.callerUserId,
          duration
        }
      });
    }, 1e3);
  }
  stopDurationTimer() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    this.durationStartTime = 0;
    this.durationSeconds = 0;
    this.durationCallInfo = null;
  }
  // ───────────────────────────────────────────────
  // 内部：IM 连接状态管理
  // ───────────────────────────────────────────────
  handleIMConnected() {
    this.logger.info("[CallKitCore] IM 已重新连接");
    if (!this.destroyed && this.imListener) {
      this.logger.info("[CallKitCore] IM 重连恢复：监听状态正常");
    }
  }
  handleIMDisconnected() {
    this.logger.warn("[CallKitCore] IM 已断开连接");
  }
  // ───────────────────────────────────────────────
  // 内部：超时定时器管理（Critical #1）
  // ───────────────────────────────────────────────
  /**
   * 启动邀请超时定时器。
   * 超时后调用状态机的 timeout() 并通过 processEvents 消费事件，
   * 确保上层 UI 能收到 callTimeout + callEnded 事件。
   */
  startInviteTimeout() {
    this.clearInviteTimeout();
    this.inviteTimer = setTimeout(() => {
      const result = this.singleCallState.timeout();
      if (result.ok) {
        this.processEvents(result.events, this.singleCallState.getState());
      }
    }, this.inviteTimeoutMs);
  }
  clearInviteTimeout() {
    if (this.inviteTimer) {
      clearTimeout(this.inviteTimer);
      this.inviteTimer = null;
    }
  }
}
const VERSION = "2.1.0";
exports.CALL_STATUS = CALL_STATUS;
exports.CALL_TYPE = CALL_TYPE;
exports.CallKitCore = CallKitCore;
exports.EventBus = EventBus;
exports.GroupCallSession = GroupCallSession;
exports.GroupCallSignalHandler = GroupCallSignalHandler;
exports.HANGUP_REASON = HANGUP_REASON;
exports.IMListener = IMListener;
exports.MessageBuilder = MessageBuilder;
exports.SignalRouter = SignalRouter;
exports.SignalSender = SignalSender;
exports.SingleCallSignalHandler = SingleCallSignalHandler;
exports.SingleCallStateMachine = SingleCallStateMachine;
exports.VERSION = VERSION;
exports.formatCallDuration = formatCallDuration;
exports.generateRandomChannel = generateRandomChannel;
exports.getLogger = getLogger;
exports.isCmdMessageExpired = isCmdMessageExpired;
exports.isMessageExpired = isMessageExpired;
exports.isRtcEvent = isRtcEvent;
exports.isUIEvent = isUIEvent;
exports.setLogger = setLogger;
//# sourceMappingURL=index.cjs.map
