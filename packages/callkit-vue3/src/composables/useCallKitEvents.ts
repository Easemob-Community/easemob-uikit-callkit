import { callKitEventBus } from "../core/events/CallKitEventBus";
import type {
  CallKitEventType,
  CallKitEventPayloads,
  CallKitEventHandler,
  CallRecord,
} from "../core/events/types";
import { CALL_TYPE, HANGUP_REASON } from "../types/callstate.types";

/**
 * useCallKitEvents
 * 优雅的 CallKit 事件订阅 Composable
 *
 * 使用示例：
 * ```ts
 * const { onCallEnded, onCallStarted, onIncomingCall } = useCallKitEvents()
 *
 * onCallStarted((e) => {
 *   console.log('通话开始', e.callId, e.channel)
 * })
 *
 * onCallEnded((e) => {
 *   console.log('通话结束', e.reason, '时长:', e.duration, 'ms')
 *   // 可在此发送系统消息通知
 * })
 *
 * onIncomingCall((e) => {
 *   console.log('收到来电', e.callerUserId)
 * })
 * ```
 *
 * 所有订阅都返回解绑函数，推荐在 onUnmounted 中调用：
 * ```ts
 * const unbind = onCallEnded(handler)
 * onUnmounted(() => unbind())
 * ```
 */
/**
 * 将 HANGUP_REASON 映射为 CallRecord 状态
 */
function mapReasonToStatus(
  reason: HANGUP_REASON
): CallRecord["status"] {
  switch (reason) {
    case HANGUP_REASON.HANGUP:
    case HANGUP_REASON.ABNORMAL_END:
    case HANGUP_REASON.HANDLE_ON_OTHER_DEVICE:
      return "ended";
    case HANGUP_REASON.REFUSE:
    case HANGUP_REASON.REMOTE_REFUSE:
      return "refused";
    case HANGUP_REASON.BUSY:
      return "busy";
    case HANGUP_REASON.CANCEL:
    case HANGUP_REASON.REMOTE_CANCEL:
      return "canceled";
    case HANGUP_REASON.NO_RESPONSE:
    case HANGUP_REASON.REMOTE_NO_RESPONSE:
      return "noResponse";
    default:
      return "ended";
  }
}

export function useCallKitEvents() {
  // 维护最后一条通话记录
  let lastCallRecord: CallRecord | null = null;

  // 内部自动订阅 callEnded（及精确域事件），缓存通话记录
  const saveCallRecord = (event: CallKitEventPayloads["callEnded"]) => {
    const isGroupCall =
      event.type === CALL_TYPE.VIDEO_MULTI ||
      event.type === CALL_TYPE.AUDIO_MULTI;

    lastCallRecord = {
      callId: event.callId,
      conversationId: event.conversationId,
      chatType: isGroupCall ? "groupChat" : "singleChat",
      from: event.callerUserId,
      to: event.groupId || event.calleeUserId || "",
      status: mapReasonToStatus(event.reason),
      duration: event.duration,
      timestamp: Date.now(),
      endedBy: event.endedBy,
    };
  };
  const unsubscribeCallEnded = callKitEventBus.on("callEnded", saveCallRecord);
  const unsubscribeSingleCallEnded = callKitEventBus.on("singleCallEnded", saveCallRecord);
  const unsubscribeGroupCallEnded = callKitEventBus.on("groupCallEnded", saveCallRecord);

  /**
   * 通用事件订阅
   */
  const on = <T extends CallKitEventType>(
    event: T,
    handler: CallKitEventHandler<T>
  ): (() => void) => {
    return callKitEventBus.on(event, handler);
  };

  /**
   * 通用一次性订阅
   */
  const once = <T extends CallKitEventType>(
    event: T,
    handler: CallKitEventHandler<T>
  ): (() => void) => {
    return callKitEventBus.once(event, handler);
  };

  /**
   * 通用取消订阅
   */
  const off = <T extends CallKitEventType>(
    event: T,
    handler: CallKitEventHandler<T>
  ): void => {
    callKitEventBus.off(event, handler);
  };

  // ─── 语义化便捷方法 ───

  /** 通话状态变化 */
  const onStatusChanged = (
    handler: CallKitEventHandler<"statusChanged">
  ): (() => void) => on("statusChanged", handler);

  /** 收到来电邀请 */
  const onIncomingCall = (
    handler: CallKitEventHandler<"incomingCall">
  ): (() => void) => on("incomingCall", handler);

  /** 通话邀请已发出/收到（邀请阶段，UI 应显示通话窗口） */
  const onCallInvited = (
    handler: CallKitEventHandler<"callInvited">
  ): (() => void) => on("callInvited", handler);

  /** 通话开始（双方/多方接通） */
  const onCallStarted = (
    handler: CallKitEventHandler<"callStarted">
  ): (() => void) => on("callStarted", handler);

  /** 通话结束 */
  const onCallEnded = (
    handler: CallKitEventHandler<"callEnded">
  ): (() => void) => on("callEnded", handler);

  /** 通话被取消 */
  const onCallCanceled = (
    handler: CallKitEventHandler<"callCanceled">
  ): (() => void) => on("callCanceled", handler);

  /** 通话被拒绝 */
  const onCallRefused = (
    handler: CallKitEventHandler<"callRefused">
  ): (() => void) => on("callRefused", handler);

  /** 通话邀请超时 */
  const onCallTimeout = (
    handler: CallKitEventHandler<"callTimeout">
  ): (() => void) => on("callTimeout", handler);

  /** 对方忙线 */
  const onCallBusy = (
    handler: CallKitEventHandler<"callBusy">
  ): (() => void) => on("callBusy", handler);

  // ─── 精确单聊事件 ───

  /** 单聊通话邀请已发出/收到 */
  const onSingleCallInvited = (
    handler: CallKitEventHandler<"singleCallInvited">
  ): (() => void) => on("singleCallInvited", handler);

  /** 单聊通话开始 */
  const onSingleCallStarted = (
    handler: CallKitEventHandler<"singleCallStarted">
  ): (() => void) => on("singleCallStarted", handler);

  /** 单聊通话已连接 */
  const onSingleCallConnected = (
    handler: CallKitEventHandler<"singleCallConnected">
  ): (() => void) => on("singleCallConnected", handler);

  /** 单聊通话结束 */
  const onSingleCallEnded = (
    handler: CallKitEventHandler<"singleCallEnded">
  ): (() => void) => on("singleCallEnded", handler);

  /** 单聊通话取消 */
  const onSingleCallCanceled = (
    handler: CallKitEventHandler<"singleCallCanceled">
  ): (() => void) => on("singleCallCanceled", handler);

  /** 单聊通话拒绝 */
  const onSingleCallRefused = (
    handler: CallKitEventHandler<"singleCallRefused">
  ): (() => void) => on("singleCallRefused", handler);

  /** 单聊通话超时 */
  const onSingleCallTimeout = (
    handler: CallKitEventHandler<"singleCallTimeout">
  ): (() => void) => on("singleCallTimeout", handler);

  /** 单聊对方忙线 */
  const onSingleCallBusy = (
    handler: CallKitEventHandler<"singleCallBusy">
  ): (() => void) => on("singleCallBusy", handler);

  // ─── 精确群聊事件 ───

  /** 群聊通话邀请已发出/收到 */
  const onGroupCallInvited = (
    handler: CallKitEventHandler<"groupCallInvited">
  ): (() => void) => on("groupCallInvited", handler);

  /** 群聊通话开始 */
  const onGroupCallStarted = (
    handler: CallKitEventHandler<"groupCallStarted">
  ): (() => void) => on("groupCallStarted", handler);

  /** 群聊通话已连接 */
  const onGroupCallConnected = (
    handler: CallKitEventHandler<"groupCallConnected">
  ): (() => void) => on("groupCallConnected", handler);

  /** 群聊通话结束 */
  const onGroupCallEnded = (
    handler: CallKitEventHandler<"groupCallEnded">
  ): (() => void) => on("groupCallEnded", handler);

  /** 群聊通话取消 */
  const onGroupCallCanceled = (
    handler: CallKitEventHandler<"groupCallCanceled">
  ): (() => void) => on("groupCallCanceled", handler);

  /** 群聊通话拒绝 */
  const onGroupCallRefused = (
    handler: CallKitEventHandler<"groupCallRefused">
  ): (() => void) => on("groupCallRefused", handler);

  /** 群聊通话超时 */
  const onGroupCallTimeout = (
    handler: CallKitEventHandler<"groupCallTimeout">
  ): (() => void) => on("groupCallTimeout", handler);

  /** 群聊对方忙线 */
  const onGroupCallBusy = (
    handler: CallKitEventHandler<"groupCallBusy">
  ): (() => void) => on("groupCallBusy", handler);

  /** 群通话成员加入 */
  const onParticipantJoined = (
    handler: CallKitEventHandler<"participantJoined">
  ): (() => void) => on("participantJoined", handler);

  /** 群通话成员离开 */
  const onParticipantLeft = (
    handler: CallKitEventHandler<"participantLeft">
  ): (() => void) => on("participantLeft", handler);

  /**
   * 获取最近一次通话记录
   * 在 callEnded 事件触发后自动生成，接入方可直接用于插入本地消息或展示通话记录
   */
  const getCallRecord = (): CallRecord | null => {
    return lastCallRecord;
  };

  /**
   * 清除缓存的通话记录
   */
  const clearCallRecord = (): void => {
    lastCallRecord = null;
  };

  return {
    // 通用 API
    on,
    once,
    off,
    // 语义化便捷方法
    onStatusChanged,
    onIncomingCall,
    onCallInvited,
    onCallStarted,
    onCallEnded,
    onCallCanceled,
    onCallRefused,
    onCallTimeout,
    onCallBusy,
    // 精确单聊事件
    onSingleCallInvited,
    onSingleCallStarted,
    onSingleCallConnected,
    onSingleCallEnded,
    onSingleCallCanceled,
    onSingleCallRefused,
    onSingleCallTimeout,
    onSingleCallBusy,
    // 精确群聊事件
    onGroupCallInvited,
    onGroupCallStarted,
    onGroupCallConnected,
    onGroupCallEnded,
    onGroupCallCanceled,
    onGroupCallRefused,
    onGroupCallTimeout,
    onGroupCallBusy,
    onParticipantJoined,
    onParticipantLeft,
    // 通话记录 API
    getCallRecord,
    clearCallRecord,
    // 内部订阅解绑（测试/清理用）
    _unsubscribeCallEnded: () => {
      unsubscribeCallEnded();
      unsubscribeSingleCallEnded();
      unsubscribeGroupCallEnded();
    },
  };
}

/**
 * useCallKitEvents 返回类型
 */
export type UseCallKitEventsReturn = ReturnType<typeof useCallKitEvents>;
